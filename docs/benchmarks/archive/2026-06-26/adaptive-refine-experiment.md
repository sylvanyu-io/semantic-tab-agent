# Adaptive Refinement Experiment

Date: 2026-06-26

This document records a rejected optimization experiment. The idea was to skip
second-pass refinement for small uncertain leftovers and leave them in Review,
reducing wall-clock latency and request count.

## Decision

Do not ship this experiment.

The experiment improved speed, but it reduced automatic organization quality on
the synthetic benchmark. TabRecap's product premise depends on semantic grouping
quality, so speed improvements that lower grouping recall are not acceptable as
the default planner behavior.

## Data Sources

Before the experiment:

- `docs/benchmarks/data/planner-scale-2026-06-26T05-59-23-988Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-small-scale-before-adaptive-refine.md`

After the experiment:

- `docs/benchmarks/data/planner-scale-2026-06-26T06-08-59-938Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-small-scale-after-adaptive-refine.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T06-12-33-835Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-scale-after-adaptive-refine.md`

Quality analysis:

- `docs/benchmarks/archive/2026-06-26/planner-quality-analysis.md`

## Before/After Summary

Small synthetic inventories:

| Tabs | Before Time | After Time | Before Pair F1 | After Pair F1 | Outcome |
| ---: | ---: | ---: | ---: | ---: | --- |
| 20 | 19.6s | 10.7s | 61.1% | 57.1% | Faster, lower quality. |
| 50 | 17.9s | 14.6s | 98.0% | 92.6% | Faster, lower quality. |
| 80 | 46.7s | 17.2s | 94.8% | 91.7% | Faster, lower quality. |

Scale synthetic inventories:

| Tabs | Prior Parallel Time | Experiment Time | Prior Pair F1 | Experiment Pair F1 | Outcome |
| ---: | ---: | ---: | ---: | ---: | --- |
| 120 | 64.5s | 20.5s | 94.7% | 94.7% | Faster, no measured F1 loss in this run. |
| 300 | 66.0s | 79.7s | 96.7% | 85.5% | Slower and lower quality. |
| 400 | 123.8s | 111.6s | 12.8% | 54.4% | Faster and better than the previous bad 400-tab run, but still far below acceptable recall. |

## Interpretation

Skipping refinement for uncertain leftovers is too blunt:

- it makes small runs faster by reducing request count;
- it often lowers coverage and pairwise recall because tabs are left for Review
  instead of being semantically grouped;
- on 300 tabs it made both speed and quality worse because the model produced a
  large bucket that still needed refinement;
- on 400 tabs it improved a very bad prior run, but the resulting pairwise F1 is
  still not good enough to justify the strategy.

## Product Rule

Accuracy wins over latency for the default planner. Future optimizations should
keep second-pass refinement available and make it cheaper or better targeted,
instead of skipping it merely because the uncertain set is small.

Prefer:

- lower-cost refinement models or lower reasoning effort after a strong coarse
  pass;
- bounded parallel refinement for genuinely large or mixed buckets;
- evaluator/repair passes for low-quality bucket splits;
- prompt and payload compaction that preserves semantic signals;
- quality gates based on coverage, pair precision, pair recall, and review count.

Avoid:

- using review count reduction as a proxy for quality;
- shipping a speed win without pairwise quality evidence;
- skipping refinement when it is the only mechanism that can recover uncertain
  or mixed coarse buckets.
