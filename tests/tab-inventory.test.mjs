import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerPayload } from "../src/core/gateway-planner.js";
import { collectTabInventory } from "../src/core/tab-inventory.js";
import { rememberTabLifecycle, rememberTabsLifecycle } from "../src/core/tab-lifecycle-log.js";
import { DEFAULT_SETTINGS, EXISTING_GROUP_MODES } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

function assertNoPlannerBehaviorBridge(payload) {
  assert.deepEqual(payload.activationFlowRuns, []);
  assert.deepEqual(payload.activationFlowTransitions, []);
  assert.deepEqual(payload.activationFlowEvidence, []);
  assert.deepEqual(
    payload.activationFlowTabActivity.map((row) => [row[0], row.at(-1)]),
    [
      [10, []],
      [12, []]
    ]
  );
}

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

test("tab inventory keeps preserved group tabs as activation-flow barriers", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = [
    { id: 10, title: "Research brief", url: "https://docs.example/brief", active: true },
    { id: 11, title: "Preserved workspace", url: "https://workspace.example/locked", groupId: 900 },
    { id: 12, title: "Render notes", url: "https://render.example/notes" }
  ];
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs }],
    groups: [{ id: 900, windowId: 1, title: "Keep this group", color: "blue" }]
  });

  await rememberTabsLifecycle(
    chrome,
    tabs.map((tab, index) => ({ ...tab, windowId: 1, index })),
    { now }
  );
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], windowId: 1, index: 0, active: true }, { now: now + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[1], windowId: 1, index: 1, active: true }, { now: now + 6000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[2], windowId: 1, index: 2, active: true }, { now: now + 10_000 });

  const inventory = await collectTabInventory(
    chrome,
    { ...DEFAULT_SETTINGS, existingGroupMode: EXISTING_GROUP_MODES.PRESERVE },
    { windowId: 1, strictWindowId: true }
  );

  assert.deepEqual(
    inventory.plannerTabs.map((tab) => tab.tabId),
    [10, 12]
  );
  assert.deepEqual(inventory.lockedGroups.map((group) => group.tabIds), [[11]]);
  assert.deepEqual(inventory.activationFlow.runs.map((run) => run.ids), [[10, 11, 12]]);
  assert.deepEqual(
    inventory.activationFlow.transitions.map((transition) => [transition.fromId, transition.toId]),
    [
      [10, 11],
      [11, 12]
    ]
  );

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  assertNoPlannerBehaviorBridge(payload);
});

test("tab inventory keeps excluded tabs as activation-flow barriers", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = [
    { id: 10, title: "Research brief", url: "https://docs.example/brief", active: true },
    { id: 11, title: "Pinned mail", url: "https://mail.example/inbox", pinned: true },
    { id: 12, title: "Render notes", url: "https://render.example/notes" }
  ];
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs }]
  });

  await rememberTabsLifecycle(
    chrome,
    tabs.map((tab, index) => ({ ...tab, windowId: 1, index })),
    { now }
  );
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], windowId: 1, index: 0, active: true }, { now: now + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[1], windowId: 1, index: 1, active: true }, { now: now + 6000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[2], windowId: 1, index: 2, active: true }, { now: now + 10_000 });

  const inventory = await collectTabInventory(chrome, DEFAULT_SETTINGS, { windowId: 1, strictWindowId: true });

  assert.deepEqual(
    inventory.plannerTabs.map((tab) => tab.tabId),
    [10, 12]
  );
  assert.deepEqual(
    inventory.excludedTabs.map((tab) => [tab.tabId, tab.exclusionReason]),
    [[11, "Pinned tabs are excluded by policy."]]
  );
  assert.deepEqual(inventory.activationFlow.runs.map((run) => run.ids), [[10, 11, 12]]);
  assert.deepEqual(
    inventory.activationFlow.transitions.map((transition) => [transition.fromId, transition.toId]),
    [
      [10, 11],
      [11, 12]
    ]
  );

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  assertNoPlannerBehaviorBridge(payload);
});

test("tab inventory keeps activation flow shape when behavior storage is unavailable", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Docs", url: "https://docs.example/a", active: true },
          { id: 11, title: "Issue", url: "https://github.com/org/repo/issues/1", active: false }
        ]
      }
    ]
  });
  chrome.storage.local.get = async () => {
    throw new Error("storage temporarily unavailable");
  };

  const inventory = await collectTabInventory(chrome, DEFAULT_SETTINGS, { windowId: 1, strictWindowId: true });

  assert.deepEqual(inventory.activationFlow, {
    tabActivity: [],
    runs: [],
    transitions: [],
    evidence: []
  });
  assert.equal(inventory.plannerTabs.length, 2);
});
