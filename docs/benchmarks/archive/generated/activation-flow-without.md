# Gateway Planner Scale Benchmark

Generated: 2026-07-06T10:35:45.794Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Auxiliary model: gpt-5.3-codex-spark
- Thinking intensity: high
- Prompt preset: conservative
- Grouping granularity: balanced
- Activation flow: disabled
- Strategy filter: auto
- Scenario filter: behavior_flow
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-07-06T10-34-02-822Z-pid21095.json`

## Scenario Coverage

- Behavior flow evidence: Simulates user activation runs, dwell time, and return-to-anchor behavior without leaking fixture truth labels.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Tokens | I/O bytes | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Behavior flow evidence | 48 | product default auto route | split_cleanup | ok | 103.0s | 2 | 16034 | 34.7 KB | 5 | 39 | 9 | ok |

## Takeaways

- Behavior flow evidence, 48 tabs: auto used split_cleanup and completed successfully in 103.0s with 2 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

