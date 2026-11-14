import { humanizeCode } from './analyze.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function bars(byCode, failing) {
  const entries = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted">No failures detected.</p>';
  return entries
    .map(([code, count]) => {
      const width = Math.max(4, Math.round((count / Math.max(1, failing)) * 100));
      return `<div class="bar-row"><span class="bar-label">${esc(humanizeCode(code))}</span><span class="bar"><span style="width:${width}%"></span></span><span class="bar-count">${count}</span></div>`;
    })
    .join('');
}

function clusters(clustersList) {
  if (!clustersList.length) return '<p class="muted">No failure clusters. Nothing to generate.</p>';
  return clustersList
    .map((cluster) => {
      const codes = Object.keys(cluster.codes)
        .map((code) => `<span class="chip">${esc(humanizeCode(code))}</span>`)
        .join('');
      const examples = cluster.examples
        .map(
          (example) =>
            `<div class="example"><div>${esc(example.input) || '<em>no input</em>'}</div><div class="example-output">${esc(example.output) || '<em>no output</em>'}</div></div>`,
        )
        .join('');
      return `<article class="card"><header><h3>${esc(cluster.label)}</h3><span class="count">${cluster.size}</span></header><div class="chips">${codes}</div>${examples}</article>`;
    })
    .join('');
}

function caseTable(cases) {
  if (!cases || cases.length === 0) return '';
  return `<section><h2>Generated eval cases</h2><table><thead><tr><th>ID</th><th>Name</th><th>Severity</th><th>Assertions</th></tr></thead><tbody>${cases
    .map(
      (item) =>
        `<tr><td class="mono">${esc(item.id)}</td><td>${esc(item.name)}</td><td><span class="sev ${item.severity}">${esc(item.severity)}</span></td><td>${item.assertions.map((assertion) => `<code>${esc(assertion.type)}</code>`).join(' ')}</td></tr>`,
    )
    .join('')}</tbody></table></section>`;
}

export function renderHtml(analysis, suite) {
  const { stats, byCode, clusters: failureClusters } = analysis;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracegrade report</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e8eaf0; --muted:#8d95a6; --bad:#ff7a7a; --warn:#ffc46b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 56px 24px 80px; }
  h1 { font-size: 30px; margin: 0 0 6px; letter-spacing:-0.02em; }
  h2 { font-size: 19px; margin: 40px 0 14px; }
  h3 { font-size: 15px; margin: 0; }
  .muted { color: var(--muted); }
  .mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .sub { color: var(--muted); margin: 0 0 28px; }
  .stats { display:grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .stat .n { font-size:26px; font-weight:600; letter-spacing:-0.03em; }
  .stat .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; margin-top:4px; }
  .bar-row { display:grid; grid-template-columns: 150px 1fr 36px; align-items:center; gap:12px; margin:8px 0; }
  .bar-label { color:var(--muted); font-size:13px; }
  .bar { height:8px; background:#1d222c; border-radius:99px; overflow:hidden; }
  .bar span { display:block; height:100%; background:linear-gradient(90deg,#5b7cfa,#8f6bff); }
  .bar-count { text-align:right; font-variant-numeric: tabular-nums; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin:12px 0; }
  .card header { display:flex; justify-content:space-between; gap:16px; align-items:baseline; }
  .count { color:var(--muted); font-variant-numeric: tabular-nums; }
  .chips { margin:10px 0; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; border:1px solid var(--line); border-radius:99px; padding:2px 8px; color:var(--muted); }
  .example { border-left:2px solid var(--line); padding:6px 0 6px 12px; margin:10px 0; font-size:13px; }
  .example-output { color:var(--muted); font-size:12.5px; margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); font-size:13px; vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.07em; }
  tr:last-child td { border-bottom:none; }
  .sev { font-size:11px; padding:2px 7px; border-radius:99px; text-transform:uppercase; letter-spacing:.05em; }
  .sev.high { background:rgba(255,122,122,.12); color:var(--bad); }
  .sev.medium { background:rgba(255,196,107,.12); color:var(--warn); }
  footer { margin-top:56px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:16px; }
</style>
</head>
<body>
<main>
  <h1>Tracegrade report</h1>
  <p class="sub">${stats.total} traces · ${new Date(analysis.generatedAt).toUTCString()}${suite ? ` · ${suite.cases.length} generated cases` : ''}</p>
  <div class="stats">
    <div class="stat"><div class="n">${stats.total}</div><div class="l">Traces</div></div>
    <div class="stat"><div class="n">${stats.failing}</div><div class="l">Failing</div></div>
    <div class="stat"><div class="n">${(stats.failureRate * 100).toFixed(1)}%</div><div class="l">Failure rate</div></div>
    <div class="stat"><div class="n">${failureClusters.length}</div><div class="l">Failure clusters</div></div>
  </div>
  <h2>Failure modes</h2>
  ${bars(byCode, stats.failing)}
  <h2>Clusters</h2>
  ${clusters(failureClusters)}
  ${caseTable(suite?.cases)}
  <footer>Generated by Tracegrade, a Kior Labs product. Deterministic analysis: no model calls were made.</footer>
</main>
</body>
</html>`;
}

export function renderMarkdown(analysis, suite) {
  const lines = [];
  lines.push('# Tracegrade report');
  lines.push('');
  lines.push(`${analysis.stats.total} traces · ${analysis.stats.failing} failing · ${(analysis.stats.failureRate * 100).toFixed(1)}% failure rate · ${analysis.clusters.length} clusters`);
  lines.push('');
  lines.push('## Failure modes');
  lines.push('');
  for (const [code, count] of Object.entries(analysis.byCode).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${humanizeCode(code)}**: ${count}`);
  }
  lines.push('');
  lines.push('## Clusters');
  lines.push('');
  for (const cluster of analysis.clusters) {
    lines.push(`### ${cluster.label} (${cluster.size})`);
    lines.push('');
    for (const example of cluster.examples) {
      lines.push(`- \`${example.traceId}\` ${example.input.replace(/\n/g, ' ').slice(0, 160)}`);
    }
    lines.push('');
  }
  if (suite?.cases?.length) {
    lines.push('## Generated cases');
    lines.push('');
    lines.push('| ID | Name | Severity | Assertions |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of suite.cases) {
      lines.push(`| ${item.id} | ${item.name.replace(/\|/g, '\\|')} | ${item.severity} | ${item.assertions.map((assertion) => assertion.type).join(', ')} |`);
    }
  }
  return lines.join('\n');
}
