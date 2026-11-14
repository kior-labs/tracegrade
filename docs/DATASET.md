# Dataset format

Tracegrade reads JSONL (one object per line) or a JSON array of objects. Only `input` and `output` are required; everything else improves the analysis.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | no | Stable trace ID. Defaults to `trace-N`. |
| `input` | string | yes\* | The user request. |
| `output` | string | yes\* | The agent's final answer. |
| `expected` | string | no | Reference answer. Drives `WRONG_ANSWER` and `SCHEMA_VIOLATION`. JSON strings are parsed and checked for required keys. |
| `status` | `pass` \| `fail` | no | Ground truth if you have it. Without it, a trace counts as failing only when a high-severity detector fires. |
| `steps` | array | no | `{type, name, ok, error, args, result}`. Drives tool failure, loop and step-count detection. |
| `tools` | string[] | no | Declared toolset. Any call outside it is `TOOL_NOT_FOUND`. |
| `tokens` | number | no | Total tokens for the trace. |
| `latency_ms` | number | no | Wall-clock latency. |
| `labels` | string[] | no | Your own tags. Included in cluster text. |
| `meta.requires_tool` | boolean | no | Set when the task cannot be answered without a tool. |
| `messages` | array | no | Chat transcript; input, output and tool results are derived. |

\* With `messages`, `input` and `output` are derived from the conversation.

## Chat-style logs

If your traces come from an agent framework, the messages array is usually enough:

```json
{"id":"c1","messages":[
  {"role":"user","content":"Where is order A-1042?"},
  {"role":"assistant","content":"","tool_calls":[{"function":{"name":"lookup_order","arguments":"{\"order_id\":\"A-1042\"}"}}]},
  {"role":"tool","name":"lookup_order","content":"shipped 3 May"},
  {"role":"assistant","content":"Order A-1042 shipped on 3 May."}
]}
```

Recognised roles: `user`/`human`, `assistant`/`ai`, `tool`/`function`/`tool_result`. Content may be a string or an array of parts with `text`.

## Exporting from common tools

- **LangSmith / Langfuse / Braintrust** — export runs as JSONL, then map `input`, `output`, `status` and tool spans into the fields above with a small script. Keep `expected` where your dataset has references.
- **Your own logs** — one line per completed request is enough. Start with `id`, `input`, `output`, `status`; add `steps` when you want tool-level failures.

## Choosing a threshold

Clustering is lexical (tf-idf plus cosine) and runs inside each failure mode, so a low default works: traces of the same failure often share few words. The default `--threshold 0.08` suits short support-style requests.

- Raise it (0.15–0.3) when distinct problems inside one mode merge.
- Lower it (0.03–0.05) when one obvious problem splits into many clusters.
- If failures differ in meaning but not wording, no threshold will fix it. Label 20 traces by hand, then use those labels as your calibration set.

## Size

A few hundred traces is plenty for a first suite. Above that, sample the failures rather than the whole set: `analyze` only clusters failing traces, so 200 failures give a clearer taxonomy than 20,000 mixed traces.
