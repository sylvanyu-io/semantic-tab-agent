import assert from "node:assert/strict";
import test from "node:test";
import { formatStressSummaryMarkdown, summarizeStressArtifact } from "../scripts/summarize-stress-artifact.mjs";

const artifact = {
  runId: "sta-stress-test",
  totalTabs: 240,
  windowCount: 4,
  gatewayTabs: 0,
  artifactPath: "/tmp/sta-stress-test.json",
  results: [
    { label: "fake all-window analyze", elapsedMs: 36227 },
    { label: "fake all-window apply", elapsedMs: 2890 },
    { label: "fake all-window undo", elapsedMs: 3384 },
    { label: "all-window apply and undo", details: { groups: 6, restoredTabs: 240 } },
    { label: "fake current-window analyze", elapsedMs: 4884 },
    { label: "current-window apply and undo", details: { windowTabs: 60, groups: 6 } },
    { label: "sampling risk gate", details: { requested: 60, ok: 0, permissionRequired: 0, blocked: 60 } },
    { label: "UI-driven full page sampling", elapsedMs: 39956 },
    { label: "UI-driven page sampling", details: { requested: 240, ok: 240, permissionRequired: 0, blocked: 0 } },
    { label: "active-tab page sampling", elapsedMs: 297 },
    { label: "active-tab page sampling", details: { requested: 4, ok: 4, permissionRequired: 0, blocked: 0 } },
    { label: "gateway all-window analyze skipped", details: { reason: "STRESS_GATEWAY is not enabled" } }
  ]
};

test("stress artifact summary extracts release evidence fields", () => {
  const summary = summarizeStressArtifact(artifact);

  assert.equal(summary.runId, "sta-stress-test");
  assert.equal(summary.file, "sta-stress-test.json");
  assert.equal(summary.status, "unknown");
  assert.equal(summary.totalTabs, 240);
  assert.equal(summary.windowCount, 4);
  assert.deepEqual(summary.allWindow, { groups: 6, restoredTabs: 240 });
  assert.deepEqual(summary.currentWindow, { windowTabs: 60, groups: 6 });
  assert.equal(summary.fullPageSampling.ok, 240);
  assert.equal(summary.activeTabSampling.ok, 4);
  assert.equal(summary.gateway.reason, "STRESS_GATEWAY is not enabled");
  assert.equal(summary.gatewayRecap, null);
  assert.equal(summary.timings.allWindowAnalyzeMs, 36227);
});

test("stress artifact summary formats copy for release notes", () => {
  const markdown = formatStressSummaryMarkdown(summarizeStressArtifact(artifact));

  assert.match(markdown, /Status: unknown/);
  assert.match(markdown, /Scope: 240 tabs across 4 windows/);
  assert.match(markdown, /All-window apply\/undo: 6 groups, restored 240 tabs/);
  assert.match(markdown, /Current-window apply\/undo: 6 groups for 60 tabs/);
  assert.match(markdown, /Page-summary risk gate: blocked 60 of 60 attempted samples/);
  assert.match(markdown, /Authorized page sampling: read 240 of 240 pages/);
  assert.match(markdown, /Gateway branch: skipped \(STRESS_GATEWAY is not enabled\)/);
  assert.match(markdown, /Gateway recap: skipped \(STRESS_GATEWAY is not enabled\)/);
});

test("stress artifact summary records the live AI recap branch", () => {
  const liveArtifact = {
    ...artifact,
    results: artifact.results
      .filter((entry) => entry.label !== "gateway all-window analyze skipped")
      .concat(
        { label: "gateway all-window analyze", details: { tabs: 180, groups: 8, reviewTabs: 12, warnings: 0 } },
        { label: "gateway time recap", details: { source: "ai", pages: 180, themes: 6, timeline: 3 } }
      )
  };

  const summary = summarizeStressArtifact(liveArtifact);
  const markdown = formatStressSummaryMarkdown(summary);

  assert.deepEqual(summary.gatewayRecap, { source: "ai", pages: 180, themes: 6, timeline: 3 });
  assert.match(markdown, /Gateway recap: ai, 180 pages, 6 themes, 3 timeline entries/);
});

test("stress artifact summary rejects malformed artifacts", () => {
  assert.throws(() => summarizeStressArtifact({ runId: "bad" }), /missing totalTabs/);
});

test("stress artifact summary surfaces failed stress runs", () => {
  const summary = summarizeStressArtifact({
    ...artifact,
    status: "failed",
    failure: { message: "Timed out waiting for UI sampling result" }
  });
  const markdown = formatStressSummaryMarkdown(summary);

  assert.equal(summary.status, "failed");
  assert.match(markdown, /Status: failed/);
  assert.match(markdown, /Failure: Timed out waiting for UI sampling result/);
});
