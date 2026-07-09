# Gateway Planner Before/After: Parallel Refinement

Date: 2026-06-26

This document records the measurable outcome of changing TabRecap's gateway
planner from serial hierarchical refinement to bounded parallel refinement with
medium-effort bucket workers.

## Change Under Test

Code commit:

- `a93160b perf: parallelize gateway planner refinement`

Behavioral changes:

- coarse planning remains one low-effort request;
- refinement slices now run with bounded concurrency, default 3 and hard cap 5;
- refinement requests default to medium thinking unless the user selected low;
- final merge remains deterministic and sorted by original tab order.

## Data Sources

Baseline, before the change:

- `docs/benchmarks/data/planner-scale-2026-06-26T02-58-49-708Z.json`
- `docs/benchmarks/data/planner-scale-2026-06-26T03-20-51-401Z.json`
- summary: `docs/benchmarks/archive/2026-06-26/gateway-planner-scale.md`

After the change:

- `docs/benchmarks/data/planner-scale-2026-06-26T05-03-27-199Z.json`
- summary: `docs/benchmarks/archive/2026-06-26/gateway-planner-scale-after-parallel.md`

Benchmark command for the after run:

```bash
BENCHMARK_STRATEGIES=hierarchical \
BENCHMARK_REPORT_PATH=docs/benchmarks/archive/2026-06-26/gateway-planner-scale-after-parallel.md \
BENCHMARK_TAB_COUNTS=120,300,400 \
npm run benchmark:planner-scale
```

All runs used synthetic metadata-only inventories and the built-in gateway with
`gpt-5.5` selected in settings. In the after run, the coarse request used low
reasoning effort and each refinement request used medium reasoning effort. They
are live gateway measurements, so network, gateway queueing, and
non-deterministic model output can affect timings.

## Result Table

| Tabs | Before: serial hierarchical | After: parallel hierarchical | Outcome |
| ---: | --- | --- | --- |
| 120 | ok, 40.4s, 2 requests, 12 groups, 120 grouped, 0 review | ok, 64.5s, 2 requests, 9 groups, 108 grouped, 12 review | Slower in this run. No small-session latency win proven. |
| 300 | ok, 57.7s, 1 request, 10 groups, 300 grouped, 0 review | ok, 66.0s, 2 requests, 12 groups, 300 grouped, 0 review | Slightly slower, but the after run did an extra refinement request. |
| 400 | failed, 240.0s timeout, 9 requests, no valid preview | ok, 123.8s, 11 requests, 89 groups, 351 grouped, 49 review | Fixed the large-session timeout case and returned a valid preview. |

## Interpretation

The change is not a universal latency improvement.

- At 120 tabs, the after run was slower and left 12 tabs in review. This is
  acceptable evidence against claiming a small-session performance win.
- At 300 tabs, the after run was also slower, but the request path differed: the
  before run accepted the coarse result directly, while the after run performed
  one refinement.
- At 400 tabs, the change clearly improved the failure mode: the old serial
  implementation timed out at 240 seconds, while the new implementation
  completed in 123.8 seconds and produced a locally valid preview.

The measurable win is therefore:

- better completion reliability for large refinement-heavy sessions;
- lower wall-clock time in the 400-tab timeout case;
- not proven better latency for small or easy coarse-pass sessions.

## Product Decision

Keep the parallel refinement change because the product pain is concentrated in
large tab piles. A 120-tab case that already finishes is less important than a
400-tab case that previously could not produce a preview.

Do not use this data to claim that TabRecap is faster for every workload.

## Follow-Up Measurements

Before changing the default visible model or thinking level, run a model matrix:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `claude-sonnet-4-6`

Record for each:

- latency;
- request count;
- validation pass/fail;
- grouped/review counts;
- group count and obvious over-splitting;
- whether cleanup candidates identify stale/duplicate tabs instead of core work.
