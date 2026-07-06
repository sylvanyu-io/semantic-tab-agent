# Planner Benchmark Quality Analysis

Generated: 2026-07-06T10:36:14.133Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-07-06T10-31-52-720Z-pid19058.json` (planner-scale-2026-07-06T10-31-52-720Z-pid19058, partial: false)
- `docs/benchmarks/data/planner-scale-2026-07-06T10-34-02-822Z-pid21095.json` (planner-scale-2026-07-06T10-34-02-822Z-pid21095, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-07-06T10-31-52-720Z-pid19058.json | behavior_flow | 48 | auto | ok | 86.7s | 2 | 7 | 100.0% | 100.0% | 100.0% | 100.0% | 65.5% |
| planner-scale-2026-07-06T10-34-02-822Z-pid21095.json | behavior_flow | 48 | auto | ok | 103.0s | 2 | 5 | 81.3% | 91.0% | 79.6% | 84.9% | 54.4% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
