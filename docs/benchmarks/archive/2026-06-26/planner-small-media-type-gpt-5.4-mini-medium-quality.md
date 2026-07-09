# Planner Benchmark Quality Analysis

Generated: 2026-06-26T08:47:03.554Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T08-44-23-601Z.json` (planner-scale-2026-06-26T08-44-23-601Z, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T08-44-23-601Z.json | media_type | 24 | hierarchical | ok | 22.5s | 2 | 7 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| planner-scale-2026-06-26T08-44-23-601Z.json | media_type | 24 | single_full_detail | ok | 34.5s | 1 | 6 | 95.8% | 100.0% | 100.0% | 100.0% | 100.0% |
| planner-scale-2026-06-26T08-44-23-601Z.json | media_type | 60 | hierarchical | ok | 17.6s | 1 | 8 | 100.0% | 80.0% | 100.0% | 88.9% | 88.9% |
| planner-scale-2026-06-26T08-44-23-601Z.json | media_type | 60 | single_full_detail | ok | 75.1s | 1 | 9 | 100.0% | 96.9% | 100.0% | 98.4% | 98.4% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
