import { humanizeCode } from './analyze.js';

/**
 * Turn failure clusters into eval cases: input, expected behaviour, rubric and
 * deterministic assertions wherever the failure mode allows one.
 */

const ASSERTIONS = {
  WRONG_ANSWER: (trace) => ({ type: 'answer_matches', expected: trace.expected, mode: 'semantic_or_exact' }),
  TOOL_ERROR: (trace, finding) => ({ type: 'no_tool_error', tool: toolFromEvidence(trace, finding) }),
  TOOL_NOT_FOUND: (trace) => ({ type: 'allowed_tools', tools: trace.tools || [] }),
  NO_TOOL_CALL: () => ({ type: 'must_call_tool' }),
  EMPTY_OUTPUT: () => ({ type: 'non_empty' }),
  SCHEMA_VIOLATION: (trace) => ({ type: 'valid_json', required_keys: keysOf(trace.expected) }),
  REFUSAL: () => ({ type: 'does_not_refuse' }),
  TOOL_LOOP: () => ({ type: 'max_identical_calls', max: 2 }),
  STEP_LIMIT: (trace, finding) => ({ type: 'max_steps', max: Math.max(1, Number(finding.evidence) - 1) || 12 }),
  TOKEN_BUDGET: (trace, finding) => ({ type: 'max_tokens', max: Math.max(1, Number(finding.evidence) - 1) || 12000 }),
  LATENCY_BUDGET: (trace, finding) => ({ type: 'max_latency_ms', max: Math.max(1, Number(finding.evidence) - 1) || 30000 }),
};

const RUBRIC = {
  WRONG_ANSWER: 'States the correct result and shows the tool data it came from.',
  TOOL_ERROR: 'Recovers from a failed tool call or explains the failure without inventing a result.',
  TOOL_NOT_FOUND: 'Only calls tools that exist in the declared toolset.',
  NO_TOOL_CALL: 'Calls the tool needed for the task before answering.',
  EMPTY_OUTPUT: 'Returns a complete answer, not an empty response.',
  SCHEMA_VIOLATION: 'Returns valid JSON with every required key.',
  REFUSAL: 'Attempts the task instead of refusing it.',
  TOOL_LOOP: 'Reaches an answer without repeating the same call more than twice.',
  STEP_LIMIT: 'Finishes within the step budget.',
  TOKEN_BUDGET: 'Finishes within the token budget.',
  LATENCY_BUDGET: 'Finishes within the latency budget.',
};

function toolFromEvidence(trace, finding) {
  const quoted = /"([^"]+)"/.exec(finding.detail);
  if (quoted) return quoted[1];
  const failed = trace.steps.find((step) => step.ok === false);
  return failed?.name || null;
}

function keysOf(expected) {
  if (!expected) return [];
  try {
    const parsed = JSON.parse(expected);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.keys(parsed);
  } catch {
    return [];
  }
  return [];
}

function shortInput(trace) {
  const firstLine = trace.input.split('\n').map((line) => line.trim()).filter(Boolean)[0] || trace.input;
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildSuite(analysis, traces, options = {}) {
  const maxCases = options.maxCases ?? 30;
  const perCluster = options.perCluster ?? 2;
  const byId = new Map(traces.map((trace) => [trace.id, trace]));
  const seen = new Set();
  const cases = [];

  for (const cluster of analysis.clusters) {
    for (const example of cluster.examples.slice(0, perCluster)) {
      if (cases.length >= maxCases) break;
      const trace = byId.get(example.traceId);
      if (!trace) continue;
      const key = normalise(trace.input);
      if (seen.has(key)) continue;
      seen.add(key);

      const findings = analysis.traces.find((entry) => entry.id === trace.id)?.findings || [];
      const codes = [...new Set(findings.map((finding) => finding.code))];
      const assertions = [];
      for (const code of codes) {
        const factory = ASSERTIONS[code];
        if (!factory) continue;
        const finding = findings.find((entry) => entry.code === code);
        const assertion = factory(trace, finding);
        if (assertion && !assertions.some((existing) => JSON.stringify(existing) === JSON.stringify(assertion))) {
          assertions.push(assertion);
        }
      }
      if (assertions.length === 0) {
        assertions.push({ type: 'judge', rubric: 'Answer matches the expected behaviour.' });
      }

      const rubric = [
        'Answers the request directly, without asking for information already provided.',
        ...codes.map((code) => RUBRIC[code]).filter(Boolean),
        'Does not invent data that the tools did not return.',
      ];

      cases.push({
        id: `case-${String(cases.length + 1).padStart(3, '0')}`,
        name: `${humanizeCode(codes[0] || 'FAILURE')} — ${shortInput(trace)}`,
        cluster: cluster.id,
        cluster_label: cluster.label,
        failure_codes: codes,
        severity: findings.some((finding) => finding.severity === 'high') ? 'high' : 'medium',
        source_traces: [trace.id],
        input: trace.input,
        expected_behavior: trace.expected
          ? `Returns: ${trace.expected}`
          : findings.map((finding) => finding.detail).join(' ') || 'Completes the task without the observed failure.',
        rubric,
        assertions,
      });
    }
    if (cases.length >= maxCases) break;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { traces: analysis.stats.total, failing: analysis.stats.failing, clusters: analysis.clusters.length },
    stats: {
      cases: cases.length,
      bySeverity: cases.reduce((acc, item) => ({ ...acc, [item.severity]: (acc[item.severity] || 0) + 1 }), {}),
      byCode: cases.reduce((acc, item) => {
        for (const code of item.failure_codes) acc[code] = (acc[code] || 0) + 1;
        return acc;
      }, {}),
    },
    cases,
  };
}
