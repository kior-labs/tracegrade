import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTraces } from '../src/ingest.js';
import { analyze } from '../src/analyze.js';
import { buildSuite } from '../src/generate.js';

const traces = parseTraces(
  [
    {
      id: 'a',
      input: 'Where is order A-1?',
      output: 'I cannot check that.',
      expected: 'Order A-1 shipped.',
      status: 'fail',
      steps: [{ type: 'tool_call', name: 'lookup_order', ok: false, error: 'timeout' }],
    },
    {
      id: 'b',
      input: 'Where is order A-2?',
      output: 'Order A-2 shipped.',
      expected: 'Order A-2 shipped.',
      status: 'pass',
      steps: [{ type: 'tool_call', name: 'lookup_order', ok: true, args: { id: 'A-2' } }],
    },
    {
      id: 'c',
      input: 'Refund order A-3.',
      output: 'Refund is 12.00.',
      expected: 'Refund is 24.00.',
      status: 'fail',
      steps: [{ type: 'tool_call', name: 'refund_order', ok: true }],
    },
  ].map((trace) => JSON.stringify(trace)).join('\n'),
);

test('builds one case per cluster member and skips passing traces', () => {
  const analysis = analyze(traces);
  const suite = buildSuite(analysis, traces);
  assert.equal(analysis.stats.total, 3);
  assert.equal(analysis.stats.failing, 2);
  assert.equal(suite.cases.length, 2);
  assert.ok(suite.cases.every((item) => item.source_traces[0] !== 'b'));
});

test('maps failure codes to assertions and rubrics', () => {
  const analysis = analyze(traces);
  const suite = buildSuite(analysis, traces);
  const toolCase = suite.cases.find((item) => item.failure_codes.includes('TOOL_ERROR'));
  assert.ok(toolCase.assertions.some((assertion) => assertion.type === 'no_tool_error'));
  assert.ok(toolCase.rubric.length >= 2);
  assert.equal(toolCase.severity, 'high');
});

test('case identifiers are stable and sequential', () => {
  const analysis = analyze(traces);
  const suite = buildSuite(analysis, traces);
  assert.deepEqual(
    suite.cases.map((item) => item.id),
    ['case-001', 'case-002'],
  );
});

test('respects the maximum number of cases', () => {
  const analysis = analyze(traces);
  const suite = buildSuite(analysis, traces, { maxCases: 1 });
  assert.equal(suite.cases.length, 1);
});
