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
- `activationFlowTransitions`: directed handoff rows with `fromId`, `toId`,
  count, average dwell seconds, max dwell seconds, recency, and short clues.
  This captures "tab A -> tab B" evidence directly instead of forcing the model
  to infer all transitions from a longer run array.
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
- Directed transition payload size is capped at 120 rows.
- Full-detail, coarse, refinement, and cleanup planner requests all receive the
  same scoped transition rows. Coarse planning must not mention direct
  transitions in the system prompt without including them in its payload.
- Preserved existing groups, excluded tabs, and out-of-bucket tabs are behavior
  barriers. A scoped planner request must not create a new relationship by
  deleting those middle tabs from a larger activation run or evidence row.
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
  - confirms planner payload includes activity, run, transition, and evidence
    rows;
  - confirms scoped planner payloads do not bridge behavior evidence across
    non-planner tabs;
  - confirms hierarchical coarse and refinement requests both carry scoped
    transition rows;
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

- targeted behavior/planner tests: 61 pass;
- full test suite: 179 pass;
- extension build succeeded: `dist/tab-recap-0.2.5.zip`;
- whitespace check passed.

Additional verification on 2026-07-07:

- fixed the hierarchical coarse planner payload so it includes
  `activationFlowTransitions`, matching the existing system prompt;
- targeted behavior/planner tests: 69 pass;
- full release gate passed locally: 250 Node tests, 36 Playwright UI tests,
  secret scans, dev/store extension builds, and release artifact audit.

Additional verification on 2026-07-08:

- fixed activation-flow scoping so preserved existing groups remain behavior
  barriers instead of being removed before flow extraction;
- fixed inventory collection so excluded but visible tabs, such as pinned tabs
  that are not part of the organizer plan, still act as local activation-flow
  barriers before the planner payload is scoped;
- fixed refinement sub-inventories so `activationFlowEvidence` rows are kept
  only when the whole evidence row belongs to the subrequest; the runtime no
  longer turns a larger `[A, locked, B]` evidence row into a fake `[A, B]`
  relationship;
- targeted behavior/planner tests: 54 pass;
- full Node/Worker test suite: 267 pass;
- current secret scan passed.

Additional verification on 2026-07-09:

- rechecked the intended "anchor tab -> short checks -> return to anchor"
  pattern: a tab with a long dwell, two quick follow-up tabs, and a return to
  the first tab is represented as dwell seconds, quick handoff clues, and
  return-to-anchor evidence rather than a hard grouping rule;
- rechecked scoped planner payload behavior: preserved groups, excluded tabs,
  and out-of-bucket tabs remain barriers, so a larger activation run cannot be
  compressed into a fake relationship between two eligible tabs;
- targeted behavior/planner/evidence tests: 77 pass;
- full release-style check passed locally: 325 Node/Worker tests and 50
  Playwright UI smoke tests.

## Transition Payload Check

After adding directed transitions, a local no-network measurement on the
48-tab `behavior_flow` fixture produced:

| Metric | Value |
| --- | ---: |
| Tabs | 48 |
| Activation runs | 12 |
| Directed transition rows | 36 |
| Higher-level evidence rows | 12 |
| Payload with transitions | 16,845 bytes |
| Payload without transitions | 13,990 bytes |
| Added bytes | 2,855 bytes |
| Added payload size | 20.4% |

This is an intentional tradeoff: the additional rows stay compact and carry no
titles, URLs, summaries, or truth labels, but they let the LLM see repeated
handoffs directly.

## What This Proves

This proves the harness now captures and transmits behavior evidence in a
bounded, non-answer-leaking form, and that the planner prompt treats it as
secondary evidence.

## Live A/B Results

Two live synthetic A/B pairs have been recorded. They are enough to justify
keeping the feature path, but not enough to claim a universal quality win across
all real browsing sessions.

| Date | Condition | Run | Tabs | Time | Requests | Groups | Coverage | Topic F1 | Family F1 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-07-06 | activationFlow enabled | `planner-scale-2026-07-06T10-31-52-720Z-pid19058` | 48 | 86.7s | 2 | 7 | 100.0% | 100.0% | 65.5% |
| 2026-07-06 | activationFlow disabled | `planner-scale-2026-07-06T10-34-02-822Z-pid21095` | 48 | 103.0s | 2 | 5 | 81.3% | 84.9% | 54.4% |
| 2026-07-09 | activationFlow enabled | `planner-scale-2026-07-08T23-18-08-085Z-pid32611` | 50 | 29.7s | 3 | 8 | 98.0% | 80.3% | 51.6% |
| 2026-07-09 | activationFlow disabled | `planner-scale-2026-07-08T23-19-00-443Z-pid33587` | 50 | 47.6s | 3 | 8 | 94.0% | 66.7% | 48.8% |

What changed across these runs:

- With activation flow, Topic F1 stayed higher in both pairs: `100.0%` vs
  `84.9%`, then `80.3%` vs `66.7%`.
- Coverage stayed higher with activation flow: `100.0%` vs `81.3%`, then
  `98.0%` vs `94.0%`.
- The 2026-07-09 pair grouped two more tabs automatically with activation flow
  (`49` grouped, `1` review) than without it (`47` grouped, `3` review).
- The activation-flow payload used more prompt tokens, as expected.
- Both enabled runs were faster in these samples, but this should not be treated
  as a latency guarantee because model variance is high.

Artifacts:

- 2026-07-06 with activation flow:
  `docs/benchmarks/data/planner-scale-2026-07-06T10-31-52-720Z-pid19058.json`
- 2026-07-06 without activation flow:
  `docs/benchmarks/data/planner-scale-2026-07-06T10-34-02-822Z-pid21095.json`
- 2026-07-09 with activation flow:
  `docs/benchmarks/data/planner-scale-2026-07-08T23-18-08-085Z-pid32611.json`
- 2026-07-09 without activation flow:
  `docs/benchmarks/data/planner-scale-2026-07-08T23-19-00-443Z-pid33587.json`
- Combined quality report:
  `docs/benchmarks/archive/generated/activation-flow-quality.md`
- Individual reports:
  - `docs/benchmarks/archive/generated/activation-flow-with.md`
  - `docs/benchmarks/archive/generated/activation-flow-without.md`

Additional proof still requires more live A/B runs:

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
