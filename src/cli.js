import fs from 'node:fs';
import path from 'node:path';
import { parseTraces } from './ingest.js';
import { analyze } from './analyze.js';
import { buildSuite } from './generate.js';
import { calibrate, labelingSheet, parseCsv, renderCalibration } from './calibrate.js';
import { renderHtml, renderMarkdown } from './report.js';

const HELP = `tracegrade — turn production agent traces into a calibrated eval suite

Usage
  tracegrade analyze <traces.jsonl> [--out dir] [--max-steps 12] [--threshold 0.08]
  tracegrade generate <traces.jsonl> [--out suite.json] [--max-cases 30]
  tracegrade sheet <suite.json> [--out labels.csv]
  tracegrade calibrate <suite.json> <labels.csv> [--out calibration.md] [--json]
  tracegrade gate <baseline.json> <current.json> [--max-regression 0.05]
  tracegrade version

Input
  JSONL (one trace per line) or a JSON array. Required per trace: input, output.
  Optional: id, expected, status (pass|fail), steps[], tools[], tokens,
  latency_ms, labels[], meta.

Examples
  tracegrade analyze examples/traces.jsonl --out examples/out
  tracegrade generate examples/traces.jsonl --out examples/out/suite.json
  tracegrade sheet examples/out/suite.json --out examples/out/labels.csv
  tracegrade calibrate examples/out/suite.json examples/out/labels.csv

Exit codes
  0 success, 1 failure or regression detected, 2 usage error.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current.startsWith('--')) {
      const key = current.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        index += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(current);
    }
  }
  return args;
}

function readTraces(file) {
  if (!file) throw new Error('missing traces file');
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  return parseTraces(fs.readFileSync(file, 'utf8'));
}

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function numberFlag(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configFrom(args) {
  return {
    maxSteps: numberFlag(args['max-steps'], 12),
    maxTokens: numberFlag(args['max-tokens'], 12000),
    maxLatencyMs: numberFlag(args['max-latency'], 30000),
    clusterThreshold: numberFlag(args.threshold, 0.08),
  };
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'version' || command === '--version') {
    const pkg = readJson(new URL('../package.json', import.meta.url).pathname);
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return;
  }

  if (command === 'analyze') {
    const traces = readTraces(args._[0]);
    const analysis = analyze(traces, configFrom(args));
    const suite = buildSuite(analysis, traces);
    const out = args.out || 'tracegrade-out';
    writeFile(path.join(out, 'analysis.json'), JSON.stringify(analysis, null, 2));
    writeFile(path.join(out, 'report.html'), renderHtml(analysis, suite));
    writeFile(path.join(out, 'report.md'), renderMarkdown(analysis, suite));
    process.stdout.write(
      `${analysis.stats.total} traces · ${analysis.stats.failing} failing (${(analysis.stats.failureRate * 100).toFixed(1)}%) · ${analysis.clusters.length} clusters · ${suite.cases.length} cases\n` +
        `wrote ${path.join(out, 'report.html')}, report.md and analysis.json\n`,
    );
    return;
  }

  if (command === 'generate') {
    const traces = readTraces(args._[0]);
    const analysis = analyze(traces, configFrom(args));
    const suite = buildSuite(analysis, traces, { maxCases: numberFlag(args['max-cases'], 30) });
    const out = args.out || 'suite.json';
    writeFile(out, JSON.stringify(suite, null, 2));
    process.stdout.write(`${suite.cases.length} cases from ${analysis.clusters.length} clusters → ${out}\n`);
    return;
  }

  if (command === 'sheet') {
    const suite = readJson(args._[0]);
    const out = args.out || 'labels.csv';
    writeFile(out, labelingSheet(suite));
    process.stdout.write(`labeling sheet for ${suite.cases.length} cases → ${out}\n`);
    return;
  }

  if (command === 'calibrate') {
    const suite = args._[1] ? readJson(args._[0]) : null;
    const labelsFile = args._[1] || args._[0];
    if (!labelsFile) throw new Error('missing labels file');
    const rows = parseCsv(fs.readFileSync(labelsFile, 'utf8'));
    const result = calibrate(rows);
    process.stdout.write(renderCalibration(result) + '\n');
    if (args.out) {
      writeFile(args.out, renderCalibration(result));
      process.stdout.write(`→ ${args.out}\n`);
    }
    if (args.json) {
      writeFile(args.json, JSON.stringify(result, null, 2));
      process.stdout.write(`→ ${args.json}\n`);
    }
    if (result.metrics.n > 0 && result.metrics.kappa < 0.4) process.exitCode = 1;
    return;
  }

  if (command === 'gate') {
    const baseline = readJson(args._[0]);
    const current = readJson(args._[1]);
    if (!baseline.stats || !current.stats) throw new Error('gate expects analysis.json files');
    const allowed = numberFlag(args['max-regression'], 0.05);
    const delta = current.stats.failureRate - baseline.stats.failureRate;
    const newCodes = Object.keys(current.byCode || {}).filter((code) => !(code in (baseline.byCode || {})));
    const pass = delta <= allowed && newCodes.length === 0;
    process.stdout.write(
      `failure rate ${(baseline.stats.failureRate * 100).toFixed(1)}% → ${(current.stats.failureRate * 100).toFixed(1)}% (${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts)\n` +
        `${newCodes.length ? `new failure modes: ${newCodes.join(', ')}\n` : 'no new failure modes\n'}` +
        `${pass ? 'gate: pass' : 'gate: fail'}\n`,
    );
    if (!pass) process.exitCode = 1;
    return;
  }

  process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
  process.exitCode = 2;
}

export { HELP };
