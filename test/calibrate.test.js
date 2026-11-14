import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, cohensKappa, labelingSheet, parseCsv } from '../src/calibrate.js';

test('parses quoted CSV fields with commas and newlines', () => {
  const rows = parseCsv('case_id,human,notes\nc1,pass,"fine, but slow"\nc2,fail,"line one\nline two"');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, 'fine, but slow');
  assert.equal(rows[1].notes, 'line one\nline two');
});

test('kappa is 1 when human and judge agree perfectly', () => {
  const metrics = cohensKappa([
    { human: 'pass', judge: 'pass' },
    { human: 'fail', judge: 'fail' },
  ]);
  assert.equal(metrics.kappa, 1);
  assert.equal(metrics.agreement, 1);
});

test('kappa is 0 when agreement equals chance', () => {
  const metrics = cohensKappa([
    { human: 'pass', judge: 'pass' },
    { human: 'pass', judge: 'fail' },
    { human: 'fail', judge: 'pass' },
    { human: 'fail', judge: 'fail' },
  ]);
  assert.equal(metrics.kappa, 0);
});

test('reports disagreements and unlabelled rows', () => {
  const result = calibrate([
    { case_id: 'c1', human: 'pass', judge: 'fail' },
    { case_id: 'c2', human: 'fail', judge: 'fail' },
    { case_id: 'c3', human: '', judge: 'pass' },
  ]);
  assert.equal(result.metrics.n, 2);
  assert.equal(result.disagreements.length, 1);
  assert.equal(result.disagreements[0].caseId, 'c1');
  assert.equal(result.unlabelled, 1);
  assert.equal(result.confusion.pass.fail, 1);
});

test('verdict escalates as kappa falls', () => {
  const result = calibrate([
    { case_id: 'c1', human: 'pass', judge: 'fail' },
    { case_id: 'c2', human: 'fail', judge: 'pass' },
  ]);
  assert.match(result.verdict, /Poor agreement/);
});

test('writes a labeling sheet with empty human and judge columns', () => {
  const csv = labelingSheet({ cases: [{ id: 'case-001', input: 'Where is A-1?, please' }] });
  const rows = parseCsv(csv);
  assert.equal(rows[0].human, '');
  assert.equal(rows[0].input, 'Where is A-1?, please');
});
