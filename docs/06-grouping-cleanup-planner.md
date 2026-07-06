# Combined grouping and cleanup planner

Date: 2026-06-26

## Product decision

TabRecap should treat organization and cleanup as one AI analysis pass.

Before this change, grouping and cleanup were separate product paths:

- `tabs:startAnalyze` generated a grouping plan.
- `activity:analyzeCleanup` sent a separate cleanup request after the user opened the old cleanup helper.
- The cleanup result did not update the grouping preview when a user manually closed suggested tabs.

After this change:

- The main planner workflow includes `analysisFeatures.grouping` and `analysisFeatures.cleanup`.
- The AI returns grouping recommendations and cleanup recommendations as one user-visible analysis result.
- The preview shows both grouping recommendations and cleanup recommendations.
- Closing cleanup candidates is explicit user action only.
- Closing cleanup candidates rewrites the stored job, removes closed tabs from the plan, rebuilds validation, and refreshes the preview before the user applies grouping.
- The old standalone cleanup runtime message and standalone gateway cleanup planner were removed so the product cannot accidentally issue a second cleanup-only LLM request.

## Request-count impact

| Flow | Before | After |
| --- | ---: | ---: |
| Generate grouping only | 1 planner job | 1 planner job |
| Generate grouping + cleanup | 1 grouping job + 1 cleanup job | 1 combined planner job |
| Small combined job below the hierarchical threshold | 1 full-detail AI request | 1 full-detail AI request |
| Large combined job at/above the hierarchical threshold | Previously forced back to 1 full-detail AI request | 1 coarse request plus bounded bucket-worker refinement requests |
| Close cleanup candidate | No linked plan update | 0 AI requests; local job rebase |

This is primarily a UX and reliability decision: the user starts one analysis and gets one preview. The implementation can still split a large inventory into internal worker requests, then merge grouping and cleanup recommendations locally.

## Safety rules

- The AI never receives a close-tab tool.
- Cleanup candidates are review suggestions only.
- The extension closes tabs only after a direct click on a single candidate or the selected-candidates bulk action.
- After closing, the stored plan is filtered and revalidated so apply cannot act on closed tabs.
- Apply/undo/cleanup-close operations all use the browser mutation queue.

## Planner strategy

The product-default planner path is adaptive:

- Below the measured hierarchical threshold, TabRecap uses one full-detail AI request.
- At or above the threshold, TabRecap uses a coarse pass followed by bounded parallel bucket refinements.
- The coarse pass only creates broad grouping buckets.
- Each refinement worker can return both refined groups and cleanup candidates for its bucket.
- The runtime merges worker outputs deterministically by tab id, original tab order, bucket id, and cleanup priority.

The product idea remains one analysis job. It is not a requirement that the implementation use exactly one low-level AI request.

## Evidence

Functional checks at implementation time covered Node tests, Playwright UI
smoke tests, current/history secret scans, and local plus store package builds.
Current release verification is centralized in `docs/09-release-readiness.md`,
so this design record does not carry stale test-count snapshots.

New regression coverage:

- Gateway planner returns cleanup candidates in the same full-detail plan request.
- Gateway planner switch coverage verifies grouping-only and cleanup-only modes still use the same planner route.
- 50-tab product sessions route through hierarchical bucket workers even when cleanup analysis is enabled.
- Coarse requests do not carry cleanup instructions; refinement workers receive cleanup instructions and only the activity rows for their bucket.
- Closing cleanup candidates is explicit and updates the stored plan preview.
- UI smoke verifies generated preview includes cleanup suggestions and supports selected-candidate closing.

## Follow-up benchmark

Live gateway speed should be remeasured after public gateway pressure is normal. The prior quota/rate-limit samples are not valid product evidence for this decision.
