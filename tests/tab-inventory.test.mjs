import assert from "node:assert/strict";
import test from "node:test";
import { collectTabInventory } from "../src/core/tab-inventory.js";
import { rememberTabLifecycle, rememberTabsLifecycle } from "../src/core/tab-lifecycle-log.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("tab inventory includes activation flow behavior context", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = [
    { id: 10, title: "Docs", url: "https://docs.example/a", active: true },
    { id: 11, title: "Issue", url: "https://github.com/org/repo/issues/1", active: false }
  ];
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs }]
  });

  await rememberTabsLifecycle(
    chrome,
    tabs.map((tab, index) => ({ ...tab, windowId: 1, index })),
    { now }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { ...tabs[0], id: 10, windowId: 1, index: 0, active: true },
    { now: now + 1000 }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { ...tabs[1], id: 11, windowId: 1, index: 1, active: true },
    { now: now + 7000 }
  );

  const inventory = await collectTabInventory(chrome, DEFAULT_SETTINGS, { windowId: 1, strictWindowId: true });

  assert.deepEqual(inventory.activationFlow.runs.map((run) => run.ids), [[10, 11]]);
  assert.deepEqual(inventory.activationFlow.runs[0].dwellSeconds, [6]);
  assert.deepEqual(inventory.activationFlow.transitions, [
    {
      fromId: 10,
      toId: 11,
      count: 1,
      avgDwellSeconds: 6,
      maxDwellSeconds: 6,
      lastAt: "2026-06-25T00:00:07.000Z",
      clues: ["quick handoff"]
    }
  ]);
  assert.deepEqual(inventory.activationFlow.evidence[0].ids, [10, 11]);
  assert.equal(inventory.activationFlow.tabActivity.find((activity) => activity.id === 10).totalActiveSeconds, 6);
});
