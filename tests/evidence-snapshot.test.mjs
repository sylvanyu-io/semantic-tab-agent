import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimeMessage } from "../src/core/controller.js";
import { buildEvidenceSnapshot } from "../src/core/evidence-snapshot.js";
import { rememberOpenTabsActivity } from "../src/core/page-activity-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { rememberTabLifecycle, rememberTabsLifecycle } from "../src/core/tab-lifecycle-log.js";
import { DEFAULT_SETTINGS, ORGANIZE_MODES, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

const NOW = Date.parse("2026-07-06T10:00:00.000Z");

test("evidence snapshot defaults to redacted aggregate counts", async () => {
  const chrome = await seededSnapshotChrome();

  const snapshot = await buildEvidenceSnapshot(
    chrome,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, organizeMode: ORGANIZE_MODES.CURRENT_WINDOW },
    { windowId: 1, now: NOW, range: { preset: "7d" } }
  );
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schema, "tab_recap_evidence_snapshot_v1");
  assert.equal(snapshot.privacy, "redacted_counts");
  assert.equal(snapshot.counts.plannerTabs, 3);
  assert.equal(snapshot.counts.activationRuns, 1);
  assert.equal(snapshot.counts.activationTransitions, 3);
  assert.equal(snapshot.behavior.repeatedRuns, 1);
  assert.equal(snapshot.behavior.transitions, 3);
  assert.equal(snapshot.behavior.quickHandoffs >= 1, true);
  assert.equal(snapshot.tabState.sampleableTabs, 3);
  assert.equal("privateDetails" in snapshot, false);
  assert.equal(serialized.includes("Secret Strategy Doc"), false);
  assert.equal(serialized.includes("token=SHOULD_NOT_LEAK"), false);
});

test("evidence snapshot private mode carries inspectable local details", async () => {
  const chrome = await seededSnapshotChrome();

  const snapshot = await buildEvidenceSnapshot(
    chrome,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, organizeMode: ORGANIZE_MODES.CURRENT_WINDOW },
    { windowId: 1, now: NOW, range: { preset: "7d" }, includePrivateFields: true }
  );

  assert.equal(snapshot.privacy, "private_details");
  assert.equal(snapshot.privateDetails.plannerTabs.some((tab) => tab.title === "Secret Strategy Doc"), true);
  assert.equal(snapshot.privateDetails.activationFlow.runs[0].returnToId, 10);
  assert.equal(snapshot.privateDetails.recapPages.some((page) => page.summary), true);
});

test("evidence snapshot runtime message stays redacted unless private fields are requested", async () => {
  const chrome = await seededSnapshotChrome();

  const redacted = await handleRuntimeMessage(chrome, {
    type: "activity:getEvidenceSnapshot",
    windowId: 1,
    range: { preset: "7d" }
  });
  const privateSnapshot = await handleRuntimeMessage(chrome, {
    type: "activity:getEvidenceSnapshot",
    windowId: 1,
    range: { preset: "7d" },
    includePrivateFields: true
  });

  assert.equal(redacted.privacy, "redacted_counts");
  assert.equal("privateDetails" in redacted, false);
  assert.equal(privateSnapshot.privacy, "private_details");
  assert.equal(privateSnapshot.privateDetails.plannerTabs.length, 3);
});

async function seededSnapshotChrome() {
  const tabs = [
    { id: 10, title: "Secret Strategy Doc", url: "https://docs.example.com/strategy?token=SHOULD_NOT_LEAK", active: true },
    { id: 11, title: "Related issue", url: "https://github.com/acme/repo/issues/42" },
    { id: 12, title: "Benchmark notes", url: "https://bench.example.com/agent-flow" }
  ];
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs }]
  });

  await rememberOpenTabsActivity(chrome, tabs.map((tab, index) => ({ ...tab, windowId: 1, index })), { now: NOW - 60_000 });
  await rememberTabsLifecycle(chrome, tabs.map((tab, index) => ({ ...tab, windowId: 1, index })), { now: NOW - 20 * 60_000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], windowId: 1, index: 0, active: true }, { now: NOW - 19 * 60_000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[1], windowId: 1, index: 1, active: true }, { now: NOW - 10 * 60_000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[2], windowId: 1, index: 2, active: true }, { now: NOW - 9 * 60_000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], windowId: 1, index: 0, active: true }, { now: NOW - 2 * 60_000 });

  await chrome.storage.local.set({
    [STORAGE_KEYS.pageSummaryCache]: {
      version: 1,
      entries: {
        strategy: {
          key: "strategy",
          origin: "https://docs.example.com/*",
          title: "Secret Strategy Doc",
          firstSeenAt: new Date(NOW - 22 * 60_000).toISOString(),
          lastSeenAt: new Date(NOW - 2 * 60_000).toISOString(),
          sampledAt: new Date(NOW - 3 * 60_000).toISOString(),
          lastUsedAt: new Date(NOW - 3 * 60_000).toISOString(),
          seenCount: 3,
          sample: {
            title: "Secret Strategy Doc",
            metaDescription: "Private planning notes",
            contentKind: "document",
            headings: ["Plan", "Evidence"],
            visibleText: "Private page text"
          }
        }
      }
    }
  });

  return chrome;
}
