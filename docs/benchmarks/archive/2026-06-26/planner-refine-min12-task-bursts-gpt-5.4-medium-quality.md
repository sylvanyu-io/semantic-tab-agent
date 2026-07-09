# Planner Benchmark Quality Analysis

Generated: 2026-06-26T12:00:56.334Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10717.json` (planner-scale-2026-06-26T09-30-04-592Z-pid10717, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T09-30-04-592Z-pid10717.json | task_bursts | 50 | hierarchical | ok | 26.5s | 2 | 12 | 100.0% | 100.0% | 92.2% | 95.9% | 54.5% |
| planner-scale-2026-06-26T09-30-04-592Z-pid10717.json | task_bursts | 60 | hierarchical | ok | 27.0s | 2 | 12 | 100.0% | 100.0% | 94.7% | 97.3% | 56.3% |
| planner-scale-2026-06-26T09-30-04-592Z-pid10717.json | task_bursts | 120 | hierarchical | ok | 73.8s | 11 | 29 | 99.2% | 100.0% | 32.4% | 49.0% | 24.6% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
