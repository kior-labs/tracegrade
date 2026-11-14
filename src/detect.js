/**
 * Failure detectors. Deterministic, explainable signals extracted from a trace.
 * Each finding names the evidence so the generated eval case can assert on it.
 */

const REFUSAL = /^(i can't|i cannot|i'm sorry, but|i am sorry, but|as an ai|i'm unable to|i am unable to)/i;
const TOOL_NOT_FOUND = /(unknown tool|tool not found|no such tool|unrecognized tool|invalid tool)/i;

const SEVERITY = {
  WRONG_ANSWER: 'high',
  TOOL_ERROR: 'high',
  TOOL_NOT_FOUND: 'high',
  NO_TOOL_CALL: 'high',
  EMPTY_OUTPUT: 'high',
  SCHEMA_VIOLATION: 'medium',
  REFUSAL: 'medium',
  TOOL_LOOP: 'medium',
  STEP_LIMIT: 'medium',
  TOKEN_BUDGET: 'low',
  LATENCY_BUDGET: 'low',
};

function normaliseText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a, b) {
  const left = new Set(normaliseText(a).split(' ').filter(Boolean));
  const right = new Set(normaliseText(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function parseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numbersOf(value) {
  return (String(value || '').match(/\d+(?:[.,]\d+)?/g) || []).map((number) => number.replace(',', '.'));
}

function looksLikeJson(value) {
  const trimmed = String(value || '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function toolCalls(trace) {
  return trace.steps.filter((step) => step.type === 'tool_call' || (step.type === 'tool_result' && step.name));
}

export function detect(trace, config = {}) {
  const findings = [];
  const add = (code, detail, evidence) => findings.push({ code, severity: SEVERITY[code] || 'medium', detail, evidence });
  const maxSteps = config.maxSteps ?? 12;
  const maxTokens = config.maxTokens ?? 12000;
  const maxLatencyMs = config.maxLatencyMs ?? 30000;
  const calls = toolCalls(trace);

  if (!trace.output.trim()) add('EMPTY_OUTPUT', 'The agent returned no answer.', '');

  if (trace.output.trim() && REFUSAL.test(trace.output.trim())) {
    add('REFUSAL', 'The agent refused or deflected instead of attempting the task.', trace.output.slice(0, 180));
  }

  const failed = trace.steps.filter((step) => step.ok === false);
  for (const step of failed) {
    const message = step.error || 'tool call failed';
    if (TOOL_NOT_FOUND.test(message)) {
      add('TOOL_NOT_FOUND', `The agent called "${step.name}" which does not exist.`, message.slice(0, 180));
    } else {
      add('TOOL_ERROR', `Tool "${step.name || 'unknown'}" failed and the agent did not recover.`, message.slice(0, 180));
    }
  }

  if (Array.isArray(trace.tools) && trace.tools.length > 0) {
    for (const step of calls) {
      if (step.name && !trace.tools.includes(step.name)) {
        add('TOOL_NOT_FOUND', `The agent called "${step.name}", which is not in the declared toolset.`, step.name);
      }
    }
  }

  const signatures = new Map();
  for (const step of calls) {
    const signature = `${step.name}:${JSON.stringify(step.args ?? null)}`;
    signatures.set(signature, (signatures.get(signature) || 0) + 1);
  }
  for (const [signature, count] of signatures) {
    if (count >= 3) {
      add('TOOL_LOOP', `The agent repeated the same call ${count} times.`, signature.slice(0, 160));
      break;
    }
  }

  if (trace.steps.length > maxSteps) {
    add('STEP_LIMIT', `The trace ran ${trace.steps.length} steps, above the limit of ${maxSteps}.`, String(trace.steps.length));
  }

  if (trace.tokens != null && trace.tokens > maxTokens) {
    add('TOKEN_BUDGET', `The trace used ${trace.tokens} tokens, above the budget of ${maxTokens}.`, String(trace.tokens));
  }

  if (trace.latencyMs != null && trace.latencyMs > maxLatencyMs) {
    add('LATENCY_BUDGET', `The trace took ${trace.latencyMs} ms, above the budget of ${maxLatencyMs} ms.`, String(trace.latencyMs));
  }

  if (trace.meta.requires_tool === true && calls.length === 0) {
    add('NO_TOOL_CALL', 'The task needs a tool, but the agent answered without calling one.', '');
  }

  if (trace.expected) {
    if (looksLikeJson(trace.expected)) {
      const parsed = parseJson(trace.output);
      if (!parsed) {
        add('SCHEMA_VIOLATION', 'The expected answer is JSON, but the output is not valid JSON.', trace.output.slice(0, 180));
      } else {
        const expectedValue = parseJson(trace.expected);
        if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
          const missing = Object.keys(expectedValue).filter((key) => !(key in parsed));
          if (missing.length) {
            add('SCHEMA_VIOLATION', `The output is missing required keys: ${missing.join(', ')}.`, missing.join(', '));
          }
        }
      }
    } else {
      // Numbers carry the answer in most support and finance traces. A single
      // changed digit is a wrong answer even when every other word matches.
      // Decimal figures are amounts and measurements, not identifiers, so a
      // changed one is a wrong answer. Integer IDs are often not repeated.
      const decimals = (value) => numbersOf(value).filter((number) => number.includes('.'));
      const expectedDecimals = decimals(trace.expected);
      const changedFigure = decimals(trace.output).find((number) => !expectedDecimals.includes(number));
      if (expectedDecimals.length > 0 && changedFigure) {
        add('WRONG_ANSWER', `The answer states a different figure than expected (${changedFigure} is not in the expected answer).`, trace.output.slice(0, 180));
      } else if (jaccard(trace.expected, trace.output) < 0.5) {
        add('WRONG_ANSWER', 'The answer does not match the expected result.', trace.output.slice(0, 180));
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding.code}:${finding.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}

export function isFailing(trace, findings) {
  if (trace.status === 'fail') return true;
  if (trace.status === 'pass') return false;
  return findings.some((finding) => finding.severity === 'high');
}
