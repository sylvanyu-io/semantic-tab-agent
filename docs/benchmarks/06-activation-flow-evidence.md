# Activation Flow Evidence

Date: 2026-07-06

## Why This Exists

TabRecap used to send title, URL, original tab order, page summaries, and local
activity counters to the planner. That misses one useful signal: pages that the
user repeatedly opens together in the same short work loop.

Example behavior:

- stay on tab A for a long time;
- jump to tab B and tab C for quick checks;
- return to tab A.

That pattern does not prove the pages share a topic, but it is useful evidence
when title, URL, page summary, and order point in the same direction.

## Current Design

The runtime now derives an `activationFlow` block from the local tab lifecycle
log. It is included in planner payloads as evidence only:

- `activationFlowTabActivity`: active count, total active seconds, max active
  seconds, last activation time, run participation, return count, nearby ids.
- `activationFlowRuns`: compact activation runs with window id, start/end time,
  tab ids, dwell seconds, return-to-anchor id, and repeated ids.
- `activationFlowEvidence`: small clusters of tab ids with strength and clues
  such as same activation run, quick handoff, long anchor then short checks, and
  returned to an earlier tab.

Prompt guardrail:

- activation flow can support semantic grouping;
- it must not override title, URL, page summaries, original order, or user
  instructions;
- adjacent activation alone is not enough to group tabs.

## Safety Boundaries

- The lifecycle log stores sanitized URL data, not query strings or fragments.
- Long idle gaps split activation runs.
- Windows are processed independently.
- Repeated activation of the same tab is deduplicated inside a run.
- Payload size is capped: 24 recent runs, 80 evidence rows, 6 nearby ids per tab.
- Existing benchmark truth labels are not sent to planner payloads.

## Verification Added

Code-level coverage:

- `tests/tab-lifecycle-log.test.mjs`
  - extracts dwell seconds and return-to-anchor evidence;
  - splits runs across idle gaps and browser windows;
  - caps large histories.
- `tests/tab-inventory.test.mjs`
  - confirms collected inventories include activation flow context.
- `tests/gateway-planner.test.mjs`
  - confirms planner payload includes activation flow rows;
  - confirms prompt guardrails are present.
- `tests/planner-benchmark-fixtures.test.mjs`
  - adds a `behavior_flow` synthetic fixture;
  - confirms fixture interaction evidence enters payload;
  - confirms benchmark truth labels do not leak into activation flow payload.

Latest local verification:

```bash
node --test tests/planner-benchmark-fixtures.test.mjs tests/gateway-planner.test.mjs tests/tab-lifecycle-log.test.mjs tests/tab-inventory.test.mjs
npm test
npm run build:extension
git diff --check
```

Observed result on 2026-07-06:

- targeted behavior/planner tests: 60 pass;
- full test suite: 174 pass;
- extension build succeeded: `dist/tab-recap-0.2.5.zip`;
- whitespace check passed.

## What This Proves

This proves the harness now captures and transmits behavior evidence in a
bounded, non-answer-leaking form, and that the planner prompt treats it as
secondary evidence.

It does not yet prove live model quality improves. That requires a live A/B run:

1. run `BENCHMARK_SCENARIOS=behavior_flow` with activation flow enabled;
2. run the same fixture with `BENCHMARK_ACTIVATION_FLOW=0` to strip it from
   the inventory;
3. compare Topic/Family F1 and review counts using
   `scripts/analyze-planner-benchmark-quality.mjs`;
4. inspect at least one real browser session where related pages are not
   adjacent in final tab order but were used together.

Command template:

```bash
BENCHMARK_SCENARIOS=behavior_flow BENCHMARK_TAB_COUNTS=48 BENCHMARK_STRATEGIES=auto npm run benchmark:planner-scale
BENCHMARK_SCENARIOS=behavior_flow BENCHMARK_TAB_COUNTS=48 BENCHMARK_STRATEGIES=auto BENCHMARK_ACTIVATION_FLOW=0 npm run benchmark:planner-scale
npm run analyze:planner-quality -- docs/benchmarks/data/<with-flow>.json docs/benchmarks/data/<without-flow>.json --output=docs/benchmarks/archive/generated/activation-flow-quality.md
```

## Expected Effect

The expected improvement is narrow but important:

- better grouping for research/comparison flows where pages are opened and
  revisited together;
- better cleanup ranking for tabs that act as anchor pages versus short checks;
- fewer mistakes on generic titles when behavior and semantic signals agree.

The expected non-effect:

- it should not force grouping for unrelated tabs that were merely clicked near
  each other;
- it should not replace page summaries for forum/article pages whose value is
  only visible in page content.
