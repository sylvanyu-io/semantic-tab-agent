import assert from "node:assert/strict";
import test from "node:test";
import {
  getTabActivationFlowContext,
  getTabLifecycleStats,
  reconcileTabLifecycle,
  recordTabClosed,
  rememberTabLifecycle,
  rememberTabsLifecycle
} from "../src/core/tab-lifecycle-log.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("tab lifecycle log records open activation and close without sensitive URL parts", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tab = {
    id: 7,
    windowId: 1,
    index: 0,
    title: "Billing token page",
    url: "https://example.com/project/SECRET123456789012?token=abc#section",
    active: true
  };

  await rememberTabLifecycle(chrome, "tab_created", tab, { now });
  await rememberTabLifecycle(chrome, "tab_activated", tab, { now: now + 1000 });
  const closed = await recordTabClosed(chrome, 7, { windowId: 1, isWindowClosing: false }, { now: now + 2000 });

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  assert.equal(JSON.stringify(log).includes("token=abc"), false);
  assert.equal(JSON.stringify(log).includes("SECRET123456789012"), false);
  assert.equal(closed.closedAt, "2026-06-25T00:00:02.000Z");
  assert.equal(closed.closeReason, "tab_closed");
  assert.equal(Object.values(log.sessions)[0].activeCount, 1);
  assert.equal(log.events.map((event) => event.type).includes("tab_closed"), true);
});

test("tab lifecycle reconciliation infers missed opens and closes", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Research page", url: "https://example.com/research", active: true }]
      }
    ]
  });

  const firstStats = await reconcileTabLifecycle(chrome, { now });
  assert.equal(firstStats.openSessions, 1);
  assert.equal(firstStats.reconcileStats.inferredOpened, 1);

  chrome.__state.windows.get(1).tabs = [];
  const secondStats = await reconcileTabLifecycle(chrome, { now: now + 5000 });

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  const session = Object.values(log.sessions)[0];
  assert.equal(secondStats.openSessions, 0);
  assert.equal(secondStats.inferredClosed, 1);
  assert.equal(session.closeReason, "missing_after_reconcile");
  assert.equal(log.events.some((event) => event.type === "tab_closed_inferred"), true);
});

test("tab lifecycle writes are queued so concurrent events do not overwrite each other", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = Array.from({ length: 24 }, (_, index) => ({
    id: 100 + index,
    windowId: 1,
    index,
    title: `Queued tab ${index}`,
    url: `https://example.com/page-${index}`,
    active: index === 0
  }));

  await Promise.all(tabs.map((tab, index) => rememberTabLifecycle(chrome, "tab_seen", tab, { now: now + index })));

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  assert.equal(Object.keys(log.sessions).length, 24);
  assert.equal(log.events.filter((event) => event.type === "tab_seen").length, 24);
});

test("tab lifecycle can store an inventory in one batch", async () => {
  const chrome = createFakeChrome();
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: "A", url: "https://a.example/", active: true },
    { id: 2, windowId: 1, index: 1, title: "B", url: "https://b.example/", active: false }
  ];

  const result = await rememberTabsLifecycle(chrome, tabs, { now: Date.parse("2026-06-25T00:00:00.000Z") });
  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];

  assert.equal(result.stored, 2);
  assert.equal(Object.keys(log.sessions).length, 2);
});

test("tab lifecycle stats persist log compaction for expired sessions and old events", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    nextSeq: 2000,
    sessions: {
      stale: {
        id: "stale",
        tabId: 10,
        windowId: 1,
        title: "Expired session",
        lastObservedAt: new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString()
      },
      fresh: {
        id: "fresh",
        tabId: 11,
        windowId: 1,
        title: "Fresh session",
        openedAt: new Date(now - 60 * 1000).toISOString(),
        lastObservedAt: new Date(now - 60 * 1000).toISOString()
      }
    },
    tabIndex: { 10: "stale", 11: "fresh" },
    events: Array.from({ length: 1805 }, (_, index) => ({
      seq: index + 1,
      type: "tab_seen",
      tabId: index % 2 ? 10 : 11,
      windowId: 1,
      at: new Date(now - index * 1000).toISOString()
    }))
  };

  const stats = await getTabLifecycleStats(chrome, { now });
  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];

  assert.equal(stats.sessions, 1);
  assert.equal(log.sessions.stale, undefined);
  assert.equal(log.sessions.fresh.title, "Fresh session");
  assert.equal(log.tabIndex[10], undefined);
  assert.equal(log.tabIndex[11], "fresh");
  assert.equal(log.events.length, 1800);
  assert.equal(log.events[0].seq, 6);
});

test("tab lifecycle read compaction is queued with later writes", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    nextSeq: 3,
    sessions: {
      stale: {
        id: "stale",
        tabId: 10,
        windowId: 1,
        title: "Expired session",
        lastObservedAt: new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString()
      },
      fresh: {
        id: "fresh",
        tabId: 11,
        windowId: 1,
        title: "Fresh session",
        openedAt: new Date(now - 60 * 1000).toISOString(),
        lastObservedAt: new Date(now - 60 * 1000).toISOString()
      }
    },
    tabIndex: { 10: "stale", 11: "fresh" },
    events: []
  };

  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  let firstLifecycleSetStarted;
  let releaseFirstLifecycleSet;
  const firstLifecycleSet = new Promise((resolve) => {
    firstLifecycleSetStarted = resolve;
  });
  chrome.storage.local.set = async (values) => {
    if (!releaseFirstLifecycleSet && values?.[STORAGE_KEYS.tabLifecycleLog]) {
      await new Promise((resolve) => {
        releaseFirstLifecycleSet = resolve;
        firstLifecycleSetStarted();
      });
    }
    return originalSet(values);
  };

  const statsPromise = getTabLifecycleStats(chrome, { now });
  await firstLifecycleSet;
  const writePromise = rememberTabLifecycle(
    chrome,
    "tab_seen",
    { id: 12, windowId: 1, index: 2, title: "New tab", url: "https://new.example/", active: false },
    { now: now + 1000 }
  );

  releaseFirstLifecycleSet();
  await Promise.all([statsPromise, writePromise]);

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  assert.equal(log.sessions.stale, undefined);
  assert.equal(Object.values(log.sessions).some((session) => session.tabId === 12), true);
});

test("tab lifecycle activation count only increments on real re-entry", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");

  await rememberTabsLifecycle(
    chrome,
    [
      { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
      { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: false }
    ],
    { now }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { now: now + 1000 }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: true },
    { now: now + 2000 }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { now: now + 3000 }
  );

  const sessions = Object.values(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog].sessions).sort((left, right) => left.tabId - right.tabId);
  assert.equal(sessions[0].activeCount, 2);
  assert.equal(sessions[1].activeCount, 1);
  assert.equal(sessions[0].active, true);
  assert.equal(sessions[1].active, false);
});

test("tab lifecycle counts focused-window returns without double-counting focus noise", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");

  await rememberTabsLifecycle(
    chrome,
    [
      { id: 1, windowId: 1, index: 0, title: "Window one anchor", url: "https://a.example/", active: true },
      { id: 2, windowId: 2, index: 0, title: "Window two anchor", url: "https://b.example/", active: true }
    ],
    { now }
  );
  await rememberTabLifecycle(
    chrome,
    "window_focused",
    { id: 2, windowId: 2, index: 0, title: "Window two anchor", url: "https://b.example/", active: true },
    { now: now + 1000 }
  );
  await rememberTabLifecycle(
    chrome,
    "window_focused",
    { id: 2, windowId: 2, index: 0, title: "Window two anchor", url: "https://b.example/", active: true },
    { now: now + 5 * 60 * 1000 }
  );
  await rememberTabLifecycle(
    chrome,
    "window_focused",
    { id: 2, windowId: 2, index: 0, title: "Window two anchor", url: "https://b.example/", active: true },
    { now: now + 5 * 60 * 1000 + 500 }
  );

  const sessions = Object.values(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog].sessions).sort((left, right) => left.tabId - right.tabId);
  assert.equal(sessions[0].activeCount, 1);
  assert.equal(sessions[1].activeCount, 2);
  assert.equal(sessions[1].lastActivatedAt, "2026-06-25T00:05:00.000Z");
});

test("tab lifecycle extracts activation flow context with dwell and return-to-anchor evidence", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: false },
    { id: 3, windowId: 1, index: 2, title: "Three", url: "https://c.example/", active: false }
  ];

  await rememberTabsLifecycle(chrome, tabs, { now });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], active: true }, { now: now + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[1], active: true }, { now: now + 30 * 60 * 1000 + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[2], active: true }, { now: now + 32 * 60 * 1000 + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], active: true }, { now: now + 32 * 60 * 1000 + 31 * 1000 });

  const context = await getTabActivationFlowContext(chrome, tabs.map((tab) => ({ tabId: tab.id })));

  assert.equal(context.runs.length, 1);
  assert.deepEqual(context.runs[0].ids, [1, 2, 3, 1]);
  assert.deepEqual(context.runs[0].dwellSeconds, [1800, 120, 30]);
  assert.equal(context.runs[0].returnToId, 1);
  assert.deepEqual(context.runs[0].repeatedIds, [1]);
  assert.deepEqual(context.transitions, [
    {
      fromId: 1,
      toId: 2,
      count: 1,
      avgDwellSeconds: 1800,
      maxDwellSeconds: 1800,
      lastAt: "2026-06-25T00:32:31.000Z",
      clues: ["long source dwell", "returned to source later"]
    },
    {
      fromId: 2,
      toId: 3,
      count: 1,
      avgDwellSeconds: 120,
      maxDwellSeconds: 120,
      lastAt: "2026-06-25T00:32:31.000Z",
      clues: ["quick handoff"]
    },
    {
      fromId: 3,
      toId: 1,
      count: 1,
      avgDwellSeconds: 30,
      maxDwellSeconds: 30,
      lastAt: "2026-06-25T00:32:31.000Z",
      clues: ["quick handoff"]
    }
  ]);

  const tabOneActivity = context.tabActivity.find((activity) => activity.id === 1);
  assert.equal(tabOneActivity.activeCount, 2);
  assert.equal(tabOneActivity.totalActiveSeconds, 1800);
  assert.equal(tabOneActivity.returnedToCount, 1);
  assert.deepEqual(tabOneActivity.nearbyIds, [2, 3]);

  assert.equal(context.evidence.length, 1);
  assert.deepEqual(context.evidence[0].ids, [1, 2, 3]);
  assert.equal(context.evidence[0].strength, 0.71);
  assert.deepEqual(context.evidence[0].clues, [
    "same activation run",
    "returned to an earlier tab",
    "quick handoff",
    "long anchor then short checks"
  ]);
});

test("tab lifecycle keeps activation flow separated by idle gaps and windows", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: false },
    { id: 3, windowId: 1, index: 2, title: "Three", url: "https://c.example/", active: false },
    { id: 4, windowId: 2, index: 0, title: "Four", url: "https://d.example/", active: true },
    { id: 5, windowId: 2, index: 1, title: "Five", url: "https://e.example/", active: false }
  ];

  await rememberTabsLifecycle(chrome, tabs, { now });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[0], active: true }, { now: now + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[3], active: true }, { now: now + 10 * 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[4], active: true }, { now: now + 70 * 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[1], active: true }, { now: now + 121 * 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[2], active: true }, { now: now + 121 * 1000 + 91 * 60 * 1000 });

  const context = await getTabActivationFlowContext(chrome, tabs.map((tab) => ({ tabId: tab.id })));

  assert.equal(context.runs.length, 2);
  assert.deepEqual(context.runs.map((run) => run.windowId), [1, 2]);
  assert.deepEqual(context.runs.map((run) => run.ids), [
    [1, 2],
    [4, 5]
  ]);
  assert.deepEqual(context.runs.map((run) => run.dwellSeconds), [[120], [60]]);
  assert.equal(context.evidence.some((entry) => entry.ids.includes(2) && entry.ids.includes(3)), false);
});

test("tab lifecycle caps activation flow output for large histories", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = Array.from({ length: 140 }, (_, index) => ({
    id: 1000 + index,
    windowId: 1,
    index,
    title: `Large history tab ${index}`,
    url: `https://example.com/${index}`,
    active: index === 0
  }));

  await rememberTabsLifecycle(chrome, tabs, { now });
  for (let runIndex = 0; runIndex < 40; runIndex += 1) {
    const runStart = now + runIndex * 2 * 60 * 60 * 1000;
    const tabOffset = runIndex * 3;
    await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[tabOffset], active: true }, { now: runStart + 1000 });
    await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[tabOffset + 1], active: true }, { now: runStart + 31 * 1000 });
    await rememberTabLifecycle(chrome, "tab_activated", { ...tabs[tabOffset + 2], active: true }, { now: runStart + 61 * 1000 });
  }

  const context = await getTabActivationFlowContext(chrome, tabs.map((tab) => ({ tabId: tab.id })));

  assert.equal(context.runs.length, 24);
  assert.equal(context.transitions.length <= 120, true);
  assert.equal(context.evidence.length <= 80, true);
  assert.equal(context.runs.every((run) => run.ids.length <= 24), true);
  assert.equal(context.tabActivity.every((activity) => activity.nearbyIds.length <= 6), true);
});
