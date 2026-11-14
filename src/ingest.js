/**
 * Trace ingestion. Accepts JSONL (one trace per line) or a JSON array.
 * Normalises the shapes agents actually emit into one internal form.
 */

const CONTENT_FIELDS = ['content', 'text', 'output_text'];

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          for (const field of CONTENT_FIELDS) {
            if (typeof part[field] === 'string') return part[field];
          }
          if (part.type === 'tool_use' || part.type === 'tool_call') return '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof value === 'object') {
    for (const field of CONTENT_FIELDS) {
      if (typeof value[field] === 'string') return value[field];
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function normaliseStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type || (raw.name ? 'tool_call' : 'step');
  const ok = raw.ok !== false && raw.error == null;
  return {
    type,
    name: raw.name || raw.tool || raw.tool_name || null,
    ok,
    error: raw.error ? String(raw.error) : null,
    args: raw.args ?? raw.arguments ?? raw.input ?? null,
    result: raw.result ?? raw.output ?? null,
  };
}

function fromMessages(messages) {
  if (!Array.isArray(messages)) return { input: '', output: '', steps: [] };
  const inputs = [];
  const steps = [];
  let output = '';
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = message.role || message.type;
    if (role === 'user' || role === 'human') inputs.push(textOf(message.content));
    if (role === 'assistant' || role === 'ai') {
      const text = textOf(message.content);
      if (text) output = text;
    }
    if (role === 'tool' || role === 'function' || role === 'tool_result') {
      steps.push(
        normaliseStep({
          type: 'tool_result',
          name: message.name || message.tool_call_id || null,
          ok: message.is_error !== true,
          error: message.is_error ? textOf(message.content) : null,
          result: message.content,
        }),
      );
    }
    const calls = message.tool_calls || message.toolCalls;
    if (Array.isArray(calls)) {
      for (const call of calls) {
        steps.push(
          normaliseStep({
            type: 'tool_call',
            name: call?.function?.name || call?.name,
            args: call?.function?.arguments || call?.arguments || call?.input,
          }),
        );
      }
    }
  }
  return { input: inputs.filter(Boolean).join('\n'), output, steps };
}

export function normaliseTrace(raw, index = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('trace must be an object');
  const fromMessagesShape = fromMessages(raw.messages);
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(normaliseStep).filter(Boolean)
    : fromMessagesShape.steps;

  const input = raw.input ?? raw.prompt ?? raw.question ?? fromMessagesShape.input ?? '';
  const output = raw.output ?? raw.completion ?? raw.response ?? fromMessagesShape.output ?? '';
  const expected = raw.expected ?? raw.reference ?? raw.golden ?? null;

  let status = raw.status ?? raw.outcome ?? null;
  if (status == null && typeof raw.score === 'number') status = raw.score >= 0.5 ? 'pass' : 'fail';
  status = status === 'failed' ? 'fail' : status === 'passed' ? 'pass' : status;

  return {
    id: String(raw.id ?? raw.trace_id ?? `trace-${index + 1}`),
    input: String(input || ''),
    output: String(output || ''),
    expected: expected == null ? null : String(expected),
    status: status === 'pass' || status === 'fail' ? status : 'unknown',
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    steps,
    tools: Array.isArray(raw.tools) ? raw.tools.map(String) : null,
    tokens: Number.isFinite(raw.tokens) ? raw.tokens : null,
    latencyMs: Number.isFinite(raw.latency_ms) ? raw.latency_ms : Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
  };
}

export function parseTraces(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array of traces');
    return parsed.map(normaliseTrace);
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return normaliseTrace(JSON.parse(line), index);
      } catch (error) {
        throw new Error(`line ${index + 1}: ${error.message}`);
      }
    });
}
