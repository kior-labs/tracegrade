import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/detect.js';
import { normaliseTrace } from '../src/ingest.js';

const base = {
  input: 'Where is order A-1042?',
  output: 'Order A-1042 shipped on 3 May.',
  expected: 'Order A-1042 shipped on 3 May.',
  status: 'pass',
  steps: [],
};

test('a clean trace produces no findings', () => {
  assert.deepEqual(detect(normaliseTrace(base)), []);
});

test('detects a wrong answer', () => {
  const findings = detect(normaliseTrace({ ...base, output: 'Your parcel is lost.' }));
  assert.equal(findings[0].code, 'WRONG_ANSWER');
});

test('detects a failed tool call', () => {
  const findings = detect(
    normaliseTrace({ ...base, steps: [{ type: 'tool_call', name: 'lookup_order', ok: false, error: 'timeout' }] }),
  );
  assert.ok(findings.some((finding) => finding.code === 'TOOL_ERROR'));
});

test('distinguishes an unknown tool from a failing one', () => {
  const findings = detect(
    normaliseTrace({ ...base, steps: [{ type: 'tool_call', name: 'get_order', ok: false, error: 'unknown tool: get_order' }] }),
  );
  assert.ok(findings.some((finding) => finding.code === 'TOOL_NOT_FOUND'));
  assert.ok(!findings.some((finding) => finding.code === 'TOOL_ERROR'));
});

test('detects a refusal', () => {
  const findings = detect(normaliseTrace({ ...base, output: "I'm sorry, but I can't help with that." }));
  assert.ok(findings.some((finding) => finding.code === 'REFUSAL'));
});

test('detects an empty output', () => {
  const findings = detect(normaliseTrace({ ...base, output: '  ' }));
  assert.ok(findings.some((finding) => finding.code === 'EMPTY_OUTPUT'));
});

test('detects invalid JSON when JSON is expected', () => {
  const findings = detect(normaliseTrace({ ...base, expected: '{"id":"A-1042"}', output: 'The order is A-1042.' }));
  assert.ok(findings.some((finding) => finding.code === 'SCHEMA_VIOLATION'));
});

test('detects missing keys in JSON output', () => {
  const findings = detect(
    normaliseTrace({ ...base, expected: '{"id":"A-1042","total":42}', output: '{"id":"A-1042"}' }),
  );
  assert.ok(findings.some((finding) => finding.code === 'SCHEMA_VIOLATION'));
});

test('detects a repeated identical tool call', () => {
  const step = { type: 'tool_call', name: 'lookup_order', args: { order_id: 'A-1042' } };
  const findings = detect(normaliseTrace({ ...base, steps: [step, step, step] }));
  assert.ok(findings.some((finding) => finding.code === 'TOOL_LOOP'));
});

test('detects a missing required tool call', () => {
  const findings = detect(normaliseTrace({ ...base, meta: { requires_tool: true } }));
  assert.ok(findings.some((finding) => finding.code === 'NO_TOOL_CALL'));
});

test('honours the step and token budgets', () => {
  const steps = Array.from({ length: 5 }, (_, index) => ({ type: 'tool_call', name: 'search', args: { q: index } }));
  const findings = detect(normaliseTrace({ ...base, steps, tokens: 5000 }), { maxSteps: 3, maxTokens: 1000 });
  assert.ok(findings.some((finding) => finding.code === 'STEP_LIMIT'));
  assert.ok(findings.some((finding) => finding.code === 'TOKEN_BUDGET'));
});
