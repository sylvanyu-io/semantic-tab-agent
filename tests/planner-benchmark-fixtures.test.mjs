import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerPayload } from "../src/core/gateway-planner.js";
import { DEFAULT_SETTINGS, PROMPT_PRESETS } from "../src/shared/settings.js";
import { buildBenchmarkRunId, parseBenchmarkPromptPreset, parseBenchmarkStrategies } from "../scripts/planner-benchmark-options.mjs";
import { BENCHMARK_SCENARIOS, buildBenchmarkInventory, parseBenchmarkScenarios } from "../scripts/planner-benchmark-fixtures.mjs";

test("benchmark scenario parser supports all named coverage fixtures", () => {
  assert.deepEqual(parseBenchmarkScenarios(""), ["task_bursts"]);
  assert.deepEqual(parseBenchmarkScenarios("all"), Object.keys(BENCHMARK_SCENARIOS));
  assert.deepEqual(parseBenchmarkScenarios("domain_traps,media_type"), ["domain_traps", "media_type"]);
  assert.throws(() => parseBenchmarkScenarios("unknown"), /Unknown BENCHMARK_SCENARIOS/);
});

test("benchmark prompt preset parser supports explicit preset comparisons", () => {
  assert.equal(parseBenchmarkPromptPreset(""), PROMPT_PRESETS.CONSERVATIVE);
  assert.equal(parseBenchmarkPromptPreset("media_type"), PROMPT_PRESETS.MEDIA_TYPE);
  assert.equal(parseBenchmarkPromptPreset(" read_later "), PROMPT_PRESETS.READ_LATER);
  assert.throws(() => parseBenchmarkPromptPreset("platform_source"), /Unknown BENCHMARK_PROMPT_PRESET/);
});

test("benchmark strategy parser supports product-default auto runs", () => {
  const known = ["auto", "hierarchical", "single_full_detail"];
  assert.deepEqual([...parseBenchmarkStrategies("", known)], ["hierarchical", "single_full_detail"]);
  assert.deepEqual([...parseBenchmarkStrategies("auto", known)], ["auto"]);
  assert.deepEqual([...parseBenchmarkStrategies("auto,hierarchical", known)], ["auto", "hierarchical"]);
  assert.throws(() => parseBenchmarkStrategies("fast", known), /Unknown BENCHMARK_STRATEGIES/);
});

test("benchmark run ids include process identity for parallel evidence runs", () => {
  const now = new Date("2026-06-26T09:11:51.796Z");
  assert.equal(buildBenchmarkRunId(now, 101), "planner-scale-2026-06-26T09-11-51-796Z-pid101");
  assert.notEqual(buildBenchmarkRunId(now, 101), buildBenchmarkRunId(now, 202));
});

test("benchmark fixtures store ground truth without sending it to planner payload", () => {
  const inventory = buildBenchmarkInventory(24, { scenario: "low_signal_samples", windowCount: 3 });
  assert.equal(inventory.pageSamples.length, 24);
  assert.equal(Object.keys(inventory.benchmarkTruth.topicByTabId).length, 24);

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  const sampleColumn = payload.tabs[0][payload.tabFields.indexOf("pageSample")];
  assert.equal(sampleColumn[payload.pageSampleFields.indexOf("status")], "ok");
  assert.equal(sampleColumn[payload.pageSampleFields.indexOf("visibleText")], "");
  assert.ok(payload.pageSampleSignals.length > 0);
  assert.match(payload.pageSampleSignals[0][payload.pageSampleSignalFields.indexOf("summary")], /Codex|Chrome extension|Model evaluation/);

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("benchmarkTruth"), false);
  assert.equal(serialized.includes("topicByTabId"), false);
  assert.equal(serialized.includes("familyByTabId"), false);
  assert.equal(serialized.includes("staleCandidateByTabId"), false);
});

test("domain trap fixture reuses hosts across unrelated semantic topics", () => {
  const inventory = buildBenchmarkInventory(60, { scenario: "domain_traps", windowCount: 4 });
  const topicsByHost = new Map();
  for (const tab of inventory.plannerTabs) {
    const topics = topicsByHost.get(tab.hostname) || new Set();
    topics.add(inventory.benchmarkTruth.topicByTabId[tab.tabId]);
    topicsByHost.set(tab.hostname, topics);
  }

  assert.ok([...topicsByHost.values()].some((topics) => topics.size >= 4));
});

test("media type fixture uses media categories as evaluation truth", () => {
  const inventory = buildBenchmarkInventory(60, { scenario: "media_type", windowCount: 4 });
  const topicValues = new Set(Object.values(inventory.benchmarkTruth.topicByTabId));
  assert.ok(topicValues.has("video"));
  assert.ok(topicValues.has("docs"));
  assert.ok(topicValues.has("paper"));
});

test("multi-window fixture spreads related topics across windows", () => {
  const inventory = buildBenchmarkInventory(80, { scenario: "multi_window", windowCount: 5 });
  const windowsByTopic = new Map();
  for (const tab of inventory.plannerTabs) {
    const topic = inventory.benchmarkTruth.topicByTabId[tab.tabId];
    const windows = windowsByTopic.get(topic) || new Set();
    windows.add(tab.windowId);
    windowsByTopic.set(topic, windows);
  }

  assert.ok([...windowsByTopic.values()].some((windows) => windows.size >= 3));
});

test("behavior flow fixture adds interaction evidence without leaking truth labels", () => {
  const inventory = buildBenchmarkInventory(48, { scenario: "behavior_flow", windowCount: 4 });
  assert.ok(inventory.benchmarkTruth.dimensions.includes("activation_flow"));
  assert.ok(inventory.activationFlow.runs.length > 0);
  assert.ok(inventory.activationFlow.transitions.length > 0);
  assert.ok(inventory.activationFlow.evidence.length > 0);
  assert.ok(inventory.activationFlow.tabActivity.length > 0);
  assert.ok(inventory.activationFlow.runs.every((run) => run.ids.length >= 3));
  assert.ok(inventory.activationFlow.evidence.some((entry) => entry.clues.includes("returned to an earlier tab")));

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  assert.ok(payload.activationFlowRuns.length > 0);
  assert.ok(payload.activationFlowTransitions.length > 0);
  assert.ok(payload.activationFlowEvidence.length > 0);

  const serializedFlow = JSON.stringify({
    activity: payload.activationFlowTabActivity,
    runs: payload.activationFlowRuns,
    transitions: payload.activationFlowTransitions,
    evidence: payload.activationFlowEvidence
  });
  for (const topic of Object.values(inventory.benchmarkTruth.topicByTabId)) {
    assert.equal(serializedFlow.includes(topic), false);
  }
});

test("behavior flow fixture can be stripped for A/B benchmark baselines", () => {
  const inventory = buildBenchmarkInventory(48, { scenario: "behavior_flow", windowCount: 4, includeActivationFlow: false });
  assert.equal(inventory.benchmarkTruth.dimensions.includes("activation_flow"), true);
  assert.deepEqual(inventory.activationFlow, { tabActivity: [], runs: [], transitions: [], evidence: [] });

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  assert.deepEqual(payload.activationFlowTabActivity, []);
  assert.deepEqual(payload.activationFlowRuns, []);
  assert.deepEqual(payload.activationFlowTransitions, []);
  assert.deepEqual(payload.activationFlowEvidence, []);
});
