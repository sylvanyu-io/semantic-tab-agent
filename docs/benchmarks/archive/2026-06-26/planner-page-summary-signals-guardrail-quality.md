# Planner Benchmark Quality Analysis

Generated: 2026-06-26T07:37:09.343Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T07-33-44-803Z.json` (planner-scale-2026-06-26T07-33-44-803Z, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T07-33-44-803Z.json | domain_traps | 24 | single_full_detail | ok | 76.9s | 1 | 10 | 95.8% | 100.0% | 88.9% | 94.1% | 47.8% |
| planner-scale-2026-06-26T07-33-44-803Z.json | media_type | 24 | single_full_detail | ok | 108.1s | 1 | 10 | 83.3% | 100.0% | 29.5% | 45.6% | 45.6% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
