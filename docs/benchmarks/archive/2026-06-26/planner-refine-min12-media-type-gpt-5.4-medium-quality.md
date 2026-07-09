# Planner Benchmark Quality Analysis

Generated: 2026-06-26T12:00:56.387Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10702.json` (planner-scale-2026-06-26T09-30-04-592Z-pid10702, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T09-30-04-592Z-pid10702.json | media_type | 50 | hierarchical | ok | 25.1s | 3 | 8 | 98.0% | 98.0% | 100.0% | 99.0% | 99.0% |
| planner-scale-2026-06-26T09-30-04-592Z-pid10702.json | media_type | 60 | hierarchical | ok | 26.3s | 2 | 9 | 100.0% | 96.9% | 100.0% | 98.4% | 98.4% |
| planner-scale-2026-06-26T09-30-04-592Z-pid10702.json | media_type | 120 | hierarchical | ok | 44.0s | 6 | 10 | 100.0% | 98.0% | 87.8% | 92.6% | 92.6% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
