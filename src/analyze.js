import { clusterItems, topTerms } from './cluster.js';
import { detect, isFailing } from './detect.js';

export const CODE_LABELS = {
  WRONG_ANSWER: 'Wrong answer',
  TOOL_ERROR: 'Tool failure',
  TOOL_NOT_FOUND: 'Unknown tool',
  NO_TOOL_CALL: 'Skipped the tool',
  EMPTY_OUTPUT: 'Empty answer',
  SCHEMA_VIOLATION: 'Schema violation',
  REFUSAL: 'Refusal',
  TOOL_LOOP: 'Tool loop',
  STEP_LIMIT: 'Too many steps',
  TOKEN_BUDGET: 'Token overrun',
  LATENCY_BUDGET: 'Latency overrun',
  UNCLASSIFIED: 'Unclassified failure',
};

// Root cause first: a trace whose tool failed and whose answer is therefore
// wrong belongs under "tool failure", not "wrong answer".
const PRIORITY = [
  'TOOL_ERROR',
  'TOOL_NOT_FOUND',
  'REFUSAL',
  'EMPTY_OUTPUT',
  'SCHEMA_VIOLATION',
  'TOOL_LOOP',
  'STEP_LIMIT',
  'NO_TOOL_CALL',
  'WRONG_ANSWER',
  'TOKEN_BUDGET',
  'LATENCY_BUDGET',
];

export function humanizeCode(code) {
  return CODE_LABELS[code] || code;
}

export function rootCode(findings) {
  for (const code of PRIORITY) {
    if (findings.some((finding) => finding.code === code)) return code;
  }
  return 'UNCLASSIFIED';
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = key(item);
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) counts[entry] = (counts[entry] || 0) + 1;
    } else {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

export function analyze(traces, config = {}) {
  const evaluated = traces.map((trace) => ({ trace, findings: detect(trace, config) }));
  const failing = evaluated.filter(({ trace, findings }) => isFailing(trace, findings));
  const byCode = countBy(failing, ({ findings }) => findings.map((finding) => finding.code));
  const threshold = config.clusterThreshold ?? 0.08;

  // Group by root cause first, then cluster by topic inside each group. Mixing
  // every failure into one vector space lets shared pleasantries ("sorry",
  // "right now") collapse unrelated modes into a single blob.
  const groups = new Map();
  for (const entry of failing) {
    const code = rootCode(entry.findings);
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(entry);
  }

  const clusters = [];
  for (const [code, members] of groups) {
    const items = members.map(({ trace }) => ({
      id: trace.id,
      text: [trace.input, trace.output, ...trace.labels].join(' '),
    }));
    const raw = items.length === 1 ? [{ members: [0], centroid: new Map() }] : clusterItems(items, { threshold });
    for (const cluster of raw) {
      const clusterMembers = cluster.members.map((index) => members[index]);
      const terms = cluster.centroid.size ? topTerms(cluster.centroid, 3) : [];
      clusters.push({
        id: '',
        size: clusterMembers.length,
        dominant: code,
        label: terms.length ? `${humanizeCode(code)}: ${terms.join(', ')}` : humanizeCode(code),
        codes: countBy(clusterMembers, (member) => member.findings.map((finding) => finding.code)),
        terms,
        examples: clusterMembers.slice(0, 3).map((member) => ({
          traceId: member.trace.id,
          input: member.trace.input.slice(0, 240),
          output: member.trace.output.slice(0, 240),
          codes: member.findings.map((finding) => finding.code),
        })),
      });
    }
  }

  clusters.sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
  clusters.forEach((cluster, index) => {
    cluster.id = `C${index + 1}`;
  });

  const passing = evaluated.filter(({ trace, findings }) => !isFailing(trace, findings) && trace.status === 'pass');
  const unknown = evaluated.filter(({ trace, findings }) => !isFailing(trace, findings) && trace.status !== 'pass');

  return {
    generatedAt: new Date().toISOString(),
    config: {
      threshold,
      maxSteps: config.maxSteps ?? 12,
      maxTokens: config.maxTokens ?? 12000,
      maxLatencyMs: config.maxLatencyMs ?? 30000,
    },
    stats: {
      total: traces.length,
      failing: failing.length,
      passing: passing.length,
      unknown: unknown.length,
      failureRate: traces.length ? Number((failing.length / traces.length).toFixed(4)) : 0,
    },
    byCode,
    clusters,
    traces: evaluated.map(({ trace, findings }) => ({
      id: trace.id,
      status: trace.status,
      failing: isFailing(trace, findings),
      root: findings.length ? rootCode(findings) : null,
      codes: findings.map((finding) => finding.code),
      findings,
    })),
  };
}
