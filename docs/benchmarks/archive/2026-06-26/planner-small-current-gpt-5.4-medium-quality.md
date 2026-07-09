# Planner Benchmark Quality Analysis

Generated: 2026-06-26T08:35:16.762Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T08-30-08-901Z.json` (planner-scale-2026-06-26T08-30-08-901Z, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T08-30-08-901Z.json | task_bursts | 24 | hierarchical | ok | 24.6s | 2 | 7 | 91.7% | 53.3% | 88.9% | 66.7% | 46.3% |
| planner-scale-2026-06-26T08-30-08-901Z.json | task_bursts | 24 | single_full_detail | ok | 21.9s | 1 | 9 | 91.7% | 100.0% | 94.4% | 97.1% | 49.3% |
| planner-scale-2026-06-26T08-30-08-901Z.json | task_bursts | 60 | hierarchical | ok | 24.8s | 1 | 10 | 100.0% | 100.0% | 100.0% | 100.0% | 58.5% |
| planner-scale-2026-06-26T08-30-08-901Z.json | task_bursts | 60 | single_full_detail | ok | 31.3s | 1 | 9 | 88.3% | 100.0% | 86.2% | 92.6% | 52.5% |
| planner-scale-2026-06-26T08-30-08-901Z.json | media_type | 24 | hierarchical | ok | 24.3s | 4 | 10 | 100.0% | 73.9% | 38.6% | 50.7% | 50.7% |
| planner-scale-2026-06-26T08-30-08-901Z.json | media_type | 24 | single_full_detail | ok | 33.8s | 1 | 8 | 91.7% | 69.6% | 36.4% | 47.8% | 47.8% |
| planner-scale-2026-06-26T08-30-08-901Z.json | media_type | 60 | hierarchical | ok | 38.9s | 4 | 16 | 100.0% | 57.9% | 35.5% | 44.0% | 44.0% |
| planner-scale-2026-06-26T08-30-08-901Z.json | media_type | 60 | single_full_detail | ok | 81.1s | 1 | 18 | 83.3% | 86.0% | 17.3% | 28.9% | 28.9% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
