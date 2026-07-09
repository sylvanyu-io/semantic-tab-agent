# Planner Benchmark Quality Analysis

Generated: 2026-06-26T09:20:56.861Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T09-17-25-877Z-pid91707.json` (planner-scale-2026-06-26T09-17-25-877Z-pid91707, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 36 | hierarchical | ok | 22.4s | 2 | 8 | 97.2% | 100.0% | 100.0% | 100.0% | 100.0% |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 36 | single_full_detail | ok | 22.7s | 1 | 7 | 97.2% | 96.0% | 100.0% | 98.0% | 98.0% |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 48 | hierarchical | ok | 19.6s | 2 | 8 | 100.0% | 98.0% | 100.0% | 99.0% | 99.0% |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 48 | single_full_detail | ok | 30.9s | 1 | 7 | 93.8% | 100.0% | 99.5% | 99.7% | 99.7% |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 50 | hierarchical | ok | 32.8s | 2 | 9 | 100.0% | 97.0% | 100.0% | 98.5% | 98.5% |
| planner-scale-2026-06-26T09-17-25-877Z-pid91707.json | media_type | 50 | single_full_detail | ok | 19.8s | 1 | 7 | 94.0% | 98.0% | 99.5% | 98.7% | 98.7% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
