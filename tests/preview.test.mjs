import assert from "node:assert/strict";
import test from "node:test";
import { buildPreview } from "../src/core/preview.js";

test("preview retains every cleanup candidate for manual review", () => {
  const candidates = Array.from({ length: 33 }, (_, index) => ({
    tabId: index + 1,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Cleanup candidate ${index + 1}`,
    hostname: "example.com",
    priority: index < 10 ? "high" : index < 20 ? "medium" : "low",
    reason: "Review this tab manually.",
    evidence: ["Old task"]
  }));

  const preview = buildPreview(
    {
      groups: [],
      reviewTabs: [],
      cleanup: {
        summary: "Review all candidates.",
        candidates
      }
    },
    {
      tabs: candidates,
      plannerTabs: candidates,
      windows: [{ windowId: 1 }],
      excludedTabs: [],
      lockedGroups: [],
      pageSamples: []
    },
    { ok: true, warnings: [] },
    { analyzeGrouping: false, analyzeCleanup: true }
  );

  assert.equal(preview.cleanup.candidateCount, 33);
  assert.equal(preview.cleanup.candidates.length, 33);
  assert.equal(preview.cleanup.candidates.at(-1).tabId, 33);
});
