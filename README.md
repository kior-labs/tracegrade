# Tracegrade

**Turn production agent traces into a calibrated eval suite.**

Your agent fails in production. You have the traces. What you do not have is the thing every eval platform assumes you already built: a failure taxonomy, a set of test cases, and a judge you can trust.

Tracegrade builds that layer from the traces themselves. It clusters real failures, generates eval cases with assertions and rubrics, and measures whether your judge agrees with humans — before you gate a deploy on it.

No model calls, no account, no data leaving your machine.

```bash
npx github:kiorlabs/tracegrade analyze examples/traces.jsonl --out out
```

```
27 traces · 22 failing (81.5%) · 7 clusters · 12 cases
wrote out/report.html, report.md and analysis.json
```

## Why

Most eval suites are written from imagination: a handful of prompts someone thought of in a planning meeting. They pass while production burns, because the failures that matter are the ones nobody imagined.

The traces already contain the failures. What is missing is the work between "we have logs" and "we have a regression suite": grouping failures into modes, deciding what correct looks like for each, writing assertions, and proving the judge is not just agreeing with itself.

Tracegrade does that work deterministically, so the suite is reproducible and reviewable in a pull request.

## Install

Requires Node 18.17 or newer.

```bash
# run without installing
npx github:kiorlabs/tracegrade --help

# or install globally
npm install -g github:kiorlabs/tracegrade
tracegrade --help
```

## Quickstart

```bash
tracegrade analyze examples/traces.jsonl --out out     # report.html, report.md, analysis.json
tracegrade generate examples/traces.jsonl --out out/suite.json
tracegrade sheet out/suite.json --out out/labels.csv   # human labelling sheet
# fill in the human column, add your judge's verdicts, then:
tracegrade calibrate out/suite.json examples/labels.csv
```

The generated report opens in any browser:

```
out/report.html
```

## Commands

| Command | What it does |
| --- | --- |
| `analyze <traces>` | Detects failure modes, clusters them, writes an HTML/Markdown report and `analysis.json` |
| `generate <traces>` | Emits eval cases: input, expected behaviour, rubric, deterministic assertions |
| `sheet <suite>` | Writes a CSV for human labelling |
| `calibrate <suite> <labels>` | Agreement, Cohen's kappa, confusion matrix, disagreements |
| `gate <baseline> <current>` | Fails CI when the failure rate regresses or a new failure mode appears |

Flags: `--out`, `--max-steps`, `--max-tokens`, `--max-latency`, `--threshold` (clustering), `--max-cases`, `--max-regression`.

Exit codes: `0` success, `1` regression or poor judge agreement, `2` usage error.

## Input format

JSONL, one trace per line, or a JSON array. Only `input` and `output` are required.

```json
{
  "id": "t-001",
  "input": "Where is order A-1042?",
  "output": "I couldn't check your order right now.",
  "expected": "Order A-1042 shipped on 3 May and arrives on 6 May.",
  "status": "fail",
  "tools": ["lookup_order", "refund_order"],
  "steps": [
    { "type": "tool_call", "name": "lookup_order", "ok": false, "error": "upstream 504" }
  ],
  "tokens": 940,
  "latency_ms": 1200
}
```

Chat-style logs work too: pass `messages` and the input, output and tool steps are derived from the conversation. See [docs/DATASET.md](docs/DATASET.md).

## What it detects

Deterministic, explainable signals — each one becomes an assertion where possible.

| Code | Meaning | Typical assertion |
| --- | --- | --- |
| `WRONG_ANSWER` | Output does not match the expected answer | `answer_matches` |
| `TOOL_ERROR` | A tool failed and the agent did not recover | `no_tool_error` |
| `TOOL_NOT_FOUND` | The agent called a tool that does not exist | `allowed_tools` |
| `NO_TOOL_CALL` | The task needed a tool; the agent answered anyway | `must_call_tool` |
| `EMPTY_OUTPUT` | Empty or whitespace answer | `non_empty` |
| `SCHEMA_VIOLATION` | Expected JSON, got prose or missing keys | `valid_json` |
| `REFUSAL` | Deflected instead of attempting the task | `does_not_refuse` |
| `TOOL_LOOP` | Repeated the same call three or more times | `max_identical_calls` |
| `STEP_LIMIT` | Ran past the step budget | `max_steps` |
| `TOKEN_BUDGET` | Ran past the token budget | `max_tokens` |
| `LATENCY_BUDGET` | Ran past the latency budget | `max_latency_ms` |

## How it works

1. **Detect.** Each trace is checked against the detectors above. Findings carry evidence and a severity.
2. **Cluster.** Failing traces become tf-idf vectors and are grouped by cosine similarity against a running centroid. Deterministic, no embeddings, no API key.
3. **Generate.** Each cluster contributes up to two cases: the input, the expected behaviour, a rubric built from the failure mode, and assertions that can run in CI.
4. **Calibrate.** Human labels are compared with judge verdicts. Cohen's kappa tells you whether the judge is measuring the same thing the humans are. Below 0.4, the rubric is the problem, not the model.

## What this is not

- **Not an observability platform.** It does not ingest continuously or store traces. Export them, run it in CI, keep the suite in the repo.
- **Not an LLM judge.** It produces the rubric, the cases and the calibration math; you bring the judge you already use. That is deliberate: a judge you cannot calibrate is a random number generator with good manners.
- **Not a guarantee.** Clustering is lexical. If your failures differ only in meaning, not wording, raise `--threshold` or label a sample by hand first.

## Development

```bash
npm test        # node:test, no dependencies
npm run demo    # regenerate the example report
```

Zero runtime dependencies. MIT licensed.

---

A [Kior Labs](https://kiorlabs.com) product. Built by [Vivek Shanbhag](https://github.com/vivshanbhag).
