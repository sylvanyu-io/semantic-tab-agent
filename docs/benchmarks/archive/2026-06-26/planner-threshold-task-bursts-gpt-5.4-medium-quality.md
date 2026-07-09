# Planner Benchmark Quality Analysis

Generated: 2026-06-26T09:20:56.749Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T09-17-25-037Z-pid91629.json` (planner-scale-2026-06-26T09-17-25-037Z-pid91629, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 36 | hierarchical | ok | 33.8s | 2 | 9 | 94.4% | 60.6% | 89.6% | 72.3% | 60.2% |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 36 | single_full_detail | ok | 31.2s | 1 | 8 | 88.9% | 72.4% | 87.5% | 79.2% | 63.4% |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 48 | hierarchical | ok | 13.9s | 1 | 8 | 100.0% | 55.1% | 100.0% | 71.0% | 59.4% |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 48 | single_full_detail | ok | 35.0s | 1 | 10 | 95.8% | 100.0% | 92.4% | 96.0% | 54.5% |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 50 | hierarchical | ok | 28.6s | 2 | 12 | 100.0% | 100.0% | 92.2% | 95.9% | 54.5% |
| planner-scale-2026-06-26T09-17-25-037Z-pid91629.json | task_bursts | 50 | single_full_detail | ok | 25.9s | 1 | 9 | 86.0% | 100.0% | 83.3% | 90.9% | 50.6% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
