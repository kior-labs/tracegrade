import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/detect.js';
import { normaliseTrace } from '../src/ingest.js';

test('flags a changed figure even when the wording matches', () => {
  const findings = detect(
    normaliseTrace({
      input: 'How much was order A-8830?',
      expected: 'Order A-8830 total was 89.99 GBP.',
      output: 'Order A-8830 total was 98.99 GBP.',
      status: 'fail',
    }),
  );
  assert.ok(findings.some((finding) => finding.code === 'WRONG_ANSWER'));
  assert.match(findings[0].detail, /98\.99/);
});

test('does not flag matching figures', () => {
  const findings = detect(
    normaliseTrace({
      input: 'How much was order A-8830?',
      expected: 'Order A-8830 total was 89.99 GBP.',
      output: 'The total was 89.99 GBP.',
    }),
  );
  assert.equal(findings.length, 0);
});
