# Planner Benchmark Quality Analysis

Generated: 2026-06-26T06:49:06.238Z

This report evaluates synthetic benchmark outputs against known topic slugs embedded in synthetic URLs. Review tabs are treated as singleton clusters, so coverage and pairwise recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T02-58-49-708Z.json` (planner-scale-2026-06-26T02-58-49-708Z, partial: true)
- `docs/benchmarks/data/planner-scale-2026-06-26T03-20-51-401Z.json` (planner-scale-2026-06-26T03-20-51-401Z, partial: true)
- `docs/benchmarks/data/planner-scale-2026-06-26T05-03-27-199Z.json` (planner-scale-2026-06-26T05-03-27-199Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T05-59-23-988Z.json` (planner-scale-2026-06-26T05-59-23-988Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-08-59-938Z.json` (planner-scale-2026-06-26T06-08-59-938Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-12-33-835Z.json` (planner-scale-2026-06-26T06-12-33-835Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-31-09-684Z.json` (planner-scale-2026-06-26T06-31-09-684Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-32-02-652Z.json` (planner-scale-2026-06-26T06-32-02-652Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-32-53-023Z.json` (planner-scale-2026-06-26T06-32-53-023Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-45-15-751Z.json` (planner-scale-2026-06-26T06-45-15-751Z, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T06-47-42-153Z.json` (planner-scale-2026-06-26T06-47-42-153Z, partial: false)

## Metrics

| Run | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Pair Precision | Pair Recall | Pair F1 |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T02-58-49-708Z.json | 120 | hierarchical | ok | 40.4s | 2 | 12 | 100.0% | 100.0% | 92.7% | 96.2% |
| planner-scale-2026-06-26T02-58-49-708Z.json | 120 | single_full_detail | ok | 77.5s | 1 | 9 | 88.3% | 100.0% | 86.8% | 92.9% |
| planner-scale-2026-06-26T02-58-49-708Z.json | 300 | hierarchical | ok | 57.7s | 1 | 10 | 100.0% | 100.0% | 100.0% | 100.0% |
| planner-scale-2026-06-26T02-58-49-708Z.json | 300 | single_full_detail | failed | 121.7s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T03-20-51-401Z.json | 400 | hierarchical | failed | 240.0s | 9 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T05-03-27-199Z.json | 120 | hierarchical | ok | 64.5s | 2 | 9 | 90.0% | 100.0% | 90.0% | 94.7% |
| planner-scale-2026-06-26T05-03-27-199Z.json | 300 | hierarchical | ok | 66.0s | 2 | 12 | 100.0% | 100.0% | 93.6% | 96.7% |
| planner-scale-2026-06-26T05-03-27-199Z.json | 400 | hierarchical | ok | 123.8s | 11 | 89 | 87.8% | 100.0% | 6.8% | 12.8% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 20 | hierarchical | ok | 19.6s | 3 | 7 | 100.0% | 45.8% | 91.7% | 61.1% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 20 | single_full_detail | ok | 39.0s | 1 | 7 | 85.0% | 64.7% | 91.7% | 75.9% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 50 | hierarchical | ok | 17.9s | 2 | 11 | 100.0% | 100.0% | 96.1% | 98.0% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 50 | single_full_detail | ok | 43.7s | 1 | 9 | 90.0% | 100.0% | 90.2% | 94.8% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 80 | hierarchical | ok | 46.7s | 2 | 9 | 90.0% | 100.0% | 90.0% | 94.8% |
| planner-scale-2026-06-26T05-59-23-988Z.json | 80 | single_full_detail | ok | 70.6s | 1 | 9 | 90.0% | 100.0% | 90.0% | 94.8% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 20 | hierarchical | ok | 10.7s | 1 | 6 | 90.0% | 43.5% | 83.3% | 57.1% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 20 | single_full_detail | ok | 38.6s | 1 | 6 | 90.0% | 43.5% | 83.3% | 57.1% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 50 | hierarchical | ok | 14.6s | 1 | 9 | 88.0% | 100.0% | 86.3% | 92.6% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 50 | single_full_detail | ok | 43.7s | 1 | 9 | 88.0% | 100.0% | 86.3% | 92.6% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 80 | hierarchical | ok | 17.2s | 1 | 9 | 87.5% | 100.0% | 84.7% | 91.7% |
| planner-scale-2026-06-26T06-08-59-938Z.json | 80 | single_full_detail | ok | 73.8s | 1 | 9 | 90.0% | 100.0% | 90.0% | 94.8% |
| planner-scale-2026-06-26T06-12-33-835Z.json | 120 | hierarchical | ok | 20.5s | 1 | 9 | 90.0% | 100.0% | 90.0% | 94.7% |
| planner-scale-2026-06-26T06-12-33-835Z.json | 300 | hierarchical | ok | 79.7s | 3 | 18 | 90.3% | 100.0% | 74.7% | 85.5% |
| planner-scale-2026-06-26T06-12-33-835Z.json | 400 | hierarchical | ok | 111.6s | 11 | 29 | 99.0% | 100.0% | 37.4% | 54.4% |
| planner-scale-2026-06-26T06-31-09-684Z.json | 50 | hierarchical | failed | 0.9s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T06-31-09-684Z.json | 120 | hierarchical | failed | 0.1s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T06-32-02-652Z.json | 50 | hierarchical | failed | 0.4s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T06-32-02-652Z.json | 120 | hierarchical | failed | 0.1s | 1 | - | 0.0% | 0.0% | 0.0% | 0.0% |
| planner-scale-2026-06-26T06-32-53-023Z.json | 50 | hierarchical | ok | 27.4s | 2 | 11 | 98.0% | 100.0% | 92.2% | 95.9% |
| planner-scale-2026-06-26T06-32-53-023Z.json | 120 | hierarchical | ok | 41.7s | 2 | 12 | 100.0% | 100.0% | 92.7% | 96.2% |
| planner-scale-2026-06-26T06-45-15-751Z.json | 50 | hierarchical | ok | 58.3s | 2 | 10 | 100.0% | 100.0% | 100.0% | 100.0% |
| planner-scale-2026-06-26T06-45-15-751Z.json | 120 | hierarchical | ok | 69.7s | 2 | 12 | 100.0% | 100.0% | 92.1% | 95.9% |
| planner-scale-2026-06-26T06-47-42-153Z.json | 50 | hierarchical | ok | 27.1s | 2 | 12 | 100.0% | 100.0% | 92.2% | 95.9% |
| planner-scale-2026-06-26T06-47-42-153Z.json | 120 | hierarchical | ok | 36.7s | 2 | 12 | 100.0% | 100.0% | 92.7% | 96.2% |

## Reading The Numbers

- Pair precision answers: when TabRecap puts two tabs in the same group, how often do they share the synthetic ground-truth topic?
- Pair recall answers: among tabs that share a ground-truth topic, how often did TabRecap keep them together?
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- These are synthetic metadata-only fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
