/**
 * Judge calibration: compare automated judgements with human labels.
 * Reports agreement, Cohen's kappa and the cases worth re-reading.
 */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/\r\n/g, '\n');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);
  if (rows.length === 0) return [];

  const header = rows[0].map((name) => name.trim().toLowerCase());
  return rows.slice(1).map((values) => {
    const record = {};
    header.forEach((name, index) => {
      record[name] = (values[index] ?? '').trim();
    });
    return record;
  });
}

function normaliseLabel(value) {
  const label = String(value || '').trim().toLowerCase();
  if (['pass', 'passed', 'true', '1', 'yes', 'good'].includes(label)) return 'pass';
  if (['fail', 'failed', 'false', '0', 'no', 'bad'].includes(label)) return 'fail';
  return null;
}

export function cohensKappa(pairs) {
  const usable = pairs.filter((pair) => pair.human && pair.judge);
  if (usable.length === 0) return { n: 0, agreement: 0, kappa: 0, expected: 0 };
  const total = usable.length;
  const agreement = usable.filter((pair) => pair.human === pair.judge).length / total;
  const humanPass = usable.filter((pair) => pair.human === 'pass').length / total;
  const judgePass = usable.filter((pair) => pair.judge === 'pass').length / total;
  const expected = humanPass * judgePass + (1 - humanPass) * (1 - judgePass);
  const kappa = expected === 1 ? 1 : (agreement - expected) / (1 - expected);
  return { n: total, agreement, expected, kappa };
}

export function verdictFor(metrics) {
  if (!metrics.n) return 'No labelled rows yet. Fill in the human column first.';
  if (metrics.kappa >= 0.8) return 'Strong agreement. The judge is safe to gate on.';
  if (metrics.kappa >= 0.6) return 'Moderate agreement. Usable, but re-read the disagreements before gating.';
  if (metrics.kappa >= 0.4) return 'Weak agreement. Tighten the rubric and add exemplars from the disagreements.';
  return 'Poor agreement. The judge is measuring something other than what the humans are. Rewrite the rubric before trusting any score.';
}

export function calibrate(rows) {
  const pairs = rows
    .map((row) => ({
      caseId: row.case_id || row.id || row.case || '',
      human: normaliseLabel(row.human ?? row.human_label ?? row.label),
      judge: normaliseLabel(row.judge ?? row.judge_label ?? row.auto),
      notes: row.notes || '',
    }))
    .filter((pair) => pair.caseId);

  const scored = pairs.filter((pair) => pair.human && pair.judge);
  const metrics = cohensKappa(scored);
  const confusion = { pass: { pass: 0, fail: 0 }, fail: { pass: 0, fail: 0 } };
  for (const pair of scored) confusion[pair.human][pair.judge] += 1;

  const disagreements = scored
    .filter((pair) => pair.human !== pair.judge)
    .map((pair) => ({ ...pair, direction: `human ${pair.human}, judge ${pair.judge}` }));

  const unlabelled = pairs.filter((pair) => !pair.human);

  return {
    metrics,
    confusion,
    disagreements,
    unlabelled: unlabelled.length,
    total: pairs.length,
    verdict: verdictFor(metrics),
  };
}

export function labelingSheet(suite) {
  const header = 'case_id,input,human,judge,notes';
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = suite.cases.map((item) => [item.id, item.input.slice(0, 400), '', '', ''].map(escape).join(','));
  return [header, ...rows].join('\n');
}

export function renderCalibration(result) {
  const lines = [];
  lines.push('# Judge calibration');
  lines.push('');
  lines.push(`**Cases scored:** ${result.metrics.n} of ${result.total}`);
  lines.push(`**Agreement:** ${(result.metrics.agreement * 100).toFixed(1)}%`);
  lines.push(`**Cohen's kappa:** ${result.metrics.kappa.toFixed(3)}`);
  lines.push('');
  lines.push(`> ${result.verdict}`);
  lines.push('');
  lines.push('| | judge pass | judge fail |');
  lines.push('| --- | --- | --- |');
  lines.push(`| **human pass** | ${result.confusion.pass.pass} | ${result.confusion.pass.fail} |`);
  lines.push(`| **human fail** | ${result.confusion.fail.pass} | ${result.confusion.fail.fail} |`);
  lines.push('');
  if (result.disagreements.length) {
    lines.push('## Disagreements');
    lines.push('');
    lines.push('| case | direction | notes |');
    lines.push('| --- | --- | --- |');
    for (const item of result.disagreements) {
      lines.push(`| ${item.caseId} | ${item.direction} | ${item.notes.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  if (result.unlabelled) lines.push(`${result.unlabelled} case(s) still have no human label.`);
  return lines.join('\n');
}
