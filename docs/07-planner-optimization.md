# Agent Planner Optimization Notes

This note captures the direction for making TabRecap's AI planner faster and
more reliable at 200-400 tabs.

## What Other Agent Harnesses Suggest

Useful external patterns:

- Anthropic's agent engineering guidance emphasizes simple, composable
  workflows before autonomous agents. The relevant workflow patterns here are
  routing, parallelization, orchestrator-workers, and evaluator-optimizer:
  https://www.anthropic.com/engineering/building-effective-agents
- LangGraph's orchestrator-worker workflow splits work into subtasks, sends them
  to workers, then synthesizes their outputs:
  https://docs.langchain.com/oss/python/langgraph/workflows-agents
- AutoGen's mixture-of-agents pattern uses an orchestrator, multiple worker
  agents, and final aggregation:
  https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/mixture-of-agents.html
- OpenAI Agents SDK documentation highlights tracing/evaluation as the way to
  inspect and improve agent workflows:
  https://openai.github.io/openai-agents-python/tracing/

TabRecap should borrow the workflow patterns, not the framework weight. This is
not an open-ended coding agent. It is a bounded classification and recommendation
pipeline over a known tab inventory.

## Current Product Decision

As of the planner correction on 2026-06-26, the product default is one
user-visible analysis job, not one low-level AI request. The same generated
preview returns grouping recommendations and cleanup recommendations, controlled
by `analyzeGrouping` and `analyzeCleanup`.

The implementation remains adaptive:

- below 50 tabs, the default path uses a single full-detail request;
- at 50+ tabs, the default path uses coarse routing plus bounded bucket-worker
  refinement;
- grouping and cleanup are merged into one validated preview.

Previous quota/rate-limit failures from local gateway pressure are not treated
as product evidence, but the earlier measured threshold and quality comparison
still apply.

## Historical Problem

The earlier optimization work compared two extremes:

- Single full-detail request: one large prompt, one final plan. Simple, but a
  300-tab run failed in live gateway testing while the local gateway was under
  unrelated pressure.
- Hierarchical coarse/refine: one broad pass plus bucket refinement. More
  reliable in some cases, but refinements are serial and still use heavy
  settings, so 400 tabs can run too long.

The bottleneck is model/runtime scheduling, not local JSON handling.

## Product Harness

Use an adaptive orchestrator-worker plan:

1. Build a compact local tab table.
2. Run a cheap router/coarse pass with a smaller or lower-thinking model.
3. Split into buckets using tab ids only.
4. Launch worker refinements concurrently with a bounded concurrency limit.
5. Ask each worker for both group recommendations and cleanup recommendations
   for its bucket.
6. Merge deterministically by tab id, original order, and bucket id.
7. Run local validation.
8. If validation fails, repair only the invalid slice instead of retrying the
   whole inventory.
9. Optionally run a final small summarizer pass for group names and user-facing
   rationale, not for tab assignment.

## Model Strategy

Default should not be `gpt-5.5` high for every step.

Detailed comparison record:

- `docs/benchmarks/README.md`
- `docs/benchmarks/01-current-planner-decision.md`
- `docs/benchmarks/02-current-planner-quality.md`
- `docs/benchmarks/03-model-routing.md`
- `docs/benchmarks/04-model-matrix-2026-06-26.md`
- `docs/benchmarks/05-gateway-model-availability-2026-06-26.md`
- Superseded run reports: `docs/benchmarks/archive/2026-06-26/`

Public leaderboard signal checked on 2026-06-26:

- Artificial Analysis ranks `gpt-5.5` high and medium close enough that medium is
  the better bulk default for this classification workload:
  https://artificialanalysis.ai/leaderboards/models
- The same leaderboard shows `gpt-5.4-mini` as much cheaper and faster, with
  lower but still usable intelligence for lightweight tab clustering.
- Claude models remain useful, but the user's Claude token budget is limited.
  Do not route every bucket refinement through Sonnet by default.

Runtime recommendation:

- Coarse/router: selected GPT-family planner model with low thinking.
- Refinement workers: selected GPT-family planner model with medium thinking by
  default, even when the visible user setting is high. If the user selects low,
  keep low.
- Automatically route 50+ tab product sessions to hierarchical coarse/refine,
  including sessions where cleanup recommendations are part of the same
  generated preview.
- `gpt-5.4-mini`: expose as an optional preset for cost/speed-sensitive runs.
- `claude-sonnet-4-6`: keep available as a manual choice and reserve future
  automatic use for small repair/polish slices, not full inventories.
- `claude-opus-4-8`: manual fallback only.
- Final naming/synthesis: low or medium, and only if the merged plan needs it.

The task is mostly language clustering and structured output. It needs strong
semantic judgment, but not deep coding/math reasoning.

## Concurrency Strategy

Use bounded parallelism:

- Default worker concurrency: 3.
- Hard cap: 5.
- Per-worker timeout: 60-90 seconds.
- Strategy timeout: 180-240 seconds.

If one bucket fails:

- Keep successful buckets.
- Put failed bucket tabs into Review/Pending confirmation.
- Surface a product-facing explanation.
- Never block the whole plan because one worker failed.

## Data Contract

Workers should return compact JSON:

```json
{
  "bucketId": "ai-coding",
  "groups": [
    {
      "key": "agent-tools",
      "title": "AI agent tools",
      "color": "blue",
      "confidence": 0.82,
      "ids": [1, 2, 3],
      "reason": "Same task context."
    }
  ],
  "review": [
    { "id": 4, "reason": "Unclear from title and URL." }
  ],
  "cleanup": {
    "candidates": [
      {
        "id": 5,
        "priority": "medium",
        "reason": "Looks like an old comparison page.",
        "evidence": ["older sequence position", "weak connection to current buckets"]
      }
    ]
  }
}
```

The final browser mutation must still be driven only by local validated data.

## Behavioral Evidence Contract

The planner receives three levels of behavior signal:

- `activationFlowRuns`: recent in-window browsing runs with ordered tab IDs and
  dwell durations.
- `activationFlowTransitions`: compact directed rows such as `fromId -> toId`
  with count, average dwell, max dwell, recency, and short clues. This captures
  repeated handoffs like "read an anchor page, check two references, return to
  the anchor" without sending titles or page text.
- `activationFlowEvidence`: unordered higher-level clusters that summarize
  repeated togetherness, quick handoffs, and return-to-anchor patterns.

These signals help the LLM identify task relationships that title/domain
matching misses. They must remain supporting evidence: semantic content,
original tab order, page summaries, URL privacy mode, and the user's prompt stay
authoritative.

Window focus returns count as tab re-entry signals with short deduplication.
This matters for multi-window users: returning to a window's already-active tab
may not fire a native tab activation event, but it still means the user came
back to that page. The lifecycle log records this as recency/open-count evidence
without turning it into a hard grouping rule.

When a large session is refined in bucket-sized subrequests, activation runs are
scoped as contiguous in-bucket segments. The runtime keeps real adjacent
handoffs such as `A -> B` when both tabs are in the refinement bucket, but it
does not simply filter IDs out of a mixed run because that would misalign dwell
durations and imply transitions the user did not actually make.

The same rule applies to `activationFlowEvidence`: an evidence row is kept only
when the entire row belongs to the scoped request. The runtime must not turn
`[A, locked group tab, B]` into `[A, B]`, because preserved groups, excluded
tabs, and out-of-bucket tabs are behavior barriers.

Inventory collection therefore builds local activation flow from eligible plus
excluded visible tabs. The planner payload still emits only planner-scope rows,
but pinned or otherwise excluded tabs can break a run before the AI sees it.

## Next Implementation Steps

1. Continue refactoring `gateway-planner.js` into explicit planner stages:
   `routeTabs`, `refineBucket`, `mergeBucketPlans`, `repairPlan`.
2. Add a validator repair path that can retry only the invalid slice instead of
   retrying the full inventory.
3. Measure the corrected combined adaptive path against the prior full-detail
   regression path with grouping + cleanup both enabled.
4. Add benchmark modes for:
   - single full-detail;
   - serial hierarchical;
   - parallel hierarchical;
   - model/thinking matrix.
   Scenario coverage is now available through `BENCHMARK_SCENARIOS`; see
   `docs/benchmarks/README.md` for the current index and archive location.
5. Make benchmark reports append or aggregate instead of overwriting the previous
   report.
