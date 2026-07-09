# Planner Benchmark Quality Analysis

Generated: 2026-06-26T08:42:04.417Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T08-35-28-104Z.json` (planner-scale-2026-06-26T08-35-28-104Z, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T08-35-28-104Z.json | task_bursts | 24 | hierarchical | ok | 48.7s | 2 | 9 | 95.8% | 63.6% | 77.8% | 70.0% | 45.9% |
| planner-scale-2026-06-26T08-35-28-104Z.json | task_bursts | 24 | single_full_detail | ok | 56.2s | 1 | 9 | 91.7% | 83.3% | 83.3% | 83.3% | 51.4% |
| planner-scale-2026-06-26T08-35-28-104Z.json | task_bursts | 60 | hierarchical | ok | 16.6s | 1 | 9 | 100.0% | 83.5% | 100.0% | 91.0% | 66.2% |
| planner-scale-2026-06-26T08-35-28-104Z.json | task_bursts | 60 | single_full_detail | ok | 84.1s | 1 | 10 | 95.0% | 100.0% | 89.5% | 94.4% | 54.0% |
| planner-scale-2026-06-26T08-35-28-104Z.json | media_type | 24 | hierarchical | ok | 24.3s | 3 | 8 | 100.0% | 63.6% | 47.7% | 54.5% | 54.5% |
| planner-scale-2026-06-26T08-35-28-104Z.json | media_type | 24 | single_full_detail | ok | 98.1s | 1 | 8 | 83.3% | 93.8% | 34.1% | 50.0% | 50.0% |
| planner-scale-2026-06-26T08-35-28-104Z.json | media_type | 60 | hierarchical | ok | 37.6s | 1 | 9 | 100.0% | 64.2% | 54.8% | 59.1% | 59.1% |
| planner-scale-2026-06-26T08-35-28-104Z.json | media_type | 60 | single_full_detail | failed | 15.3s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## Reading The Numbers

- Topic precision answers: when TabRecap puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did TabRecap keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
