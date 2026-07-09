import assert from "node:assert/strict";
import test from "node:test";
import { getActivityOverview, loadPrunedActivityCache, rememberOpenTabActivity, rememberOpenTabsActivity } from "../src/core/page-activity-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { rememberTabLifecycle } from "../src/core/tab-lifecycle-log.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("activity cache tracks first seen and strips sensitive URL parts", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");

  await rememberOpenTabActivity(
    chrome,
    {
      id: 10,
      windowId: 1,
      title: "Private project issue",
      url: "https://example.com/project/ABCDEF1234567890?token=secret#reply"
    },
    null,
    { now }
  );
  await rememberOpenTabActivity(
    chrome,
    {
      id: 10,
      windowId: 1,
      title: "Private project issue",
      url: "https://example.com/project/ABCDEF1234567890?token=secret#reply"
    },
    {
      status: "ok",
      sample: {
        title: "Issue summary",
        metaDescription: "Work item",
        contentKind: "discussion",
        headings: ["Implementation"],
        visibleText: "Not stored in activity cache"
      }
    },
    { now: now + 1000 }
  );

  const cache = chrome.__state.storage[STORAGE_KEYS.pageActivityCache];
  assert.equal(JSON.stringify(cache).includes("token=secret"), false);
  assert.equal(JSON.stringify(cache).includes("ABCDEF1234567890"), false);
  assert.equal(JSON.stringify(cache).includes("Not stored in activity cache"), false);
  const entry = Object.values(cache.entries)[0];
  assert.equal(entry.seenCount, 2);
  assert.equal(entry.sample.title, "Issue summary");
  assert.equal(entry.sample.contentKind, "discussion");
  assert.equal(entry.firstSeenAt, "2026-06-25T00:00:00.000Z");
  assert.equal(entry.lastSeenAt, "2026-06-25T00:00:01.000Z");
});

test("activity overview returns local recap and old-tab candidates without closing tabs", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const old = now - 20 * 24 * 60 * 60 * 1000;
  const chrome = createFakeChrome({
    groups: [{ id: 77, windowId: 1, title: "AI backlog", color: "blue" }],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Old AI paper", url: "https://papers.example/ai", active: true, groupId: 77 },
          { id: 11, title: "Fresh project issue", url: "https://github.com/acme/repo/issues/1" }
        ]
      }
    ]
  });

  await rememberOpenTabActivity(chrome, { id: 10, windowId: 1, title: "Old AI paper", url: "https://papers.example/ai" }, null, { now: old });
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 10, windowId: 1, index: 0, title: "Old AI paper", url: "https://papers.example/ai", active: true, groupId: 77 },
    { now: old + 1000 }
  );
  await rememberOpenTabsActivity(
    chrome,
    [{ id: 11, windowId: 1, title: "Fresh project issue", url: "https://github.com/acme/repo/issues/1" }],
    { now }
  );

  const overview = await getActivityOverview(chrome, { rangeMs: 30 * 24 * 60 * 60 * 1000, now });

  assert.equal(overview.openTabs.total, 2);
  assert.equal(overview.openTabs.staleCandidates, 1);
  assert.equal(overview.staleTabs[0].tabId, 10);
  assert.equal(overview.staleTabs[0].currentGroupTitle, "AI backlog");
  assert.equal(overview.staleTabs[0].activeCount, 1);
  assert.equal(overview.recap.entries >= 2, true);
  assert.equal((await chrome.tabs.get(10)).title, "Old AI paper");
});

test("activity overview hides saved private activity when incognito is excluded", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const privateTab = {
    id: 12,
    windowId: 2,
    index: 0,
    title: "Private investor research",
    url: "https://private.example/research",
    active: true,
    incognito: true
  };
  const publicTab = {
    id: 13,
    windowId: 1,
    index: 0,
    title: "Public project plan",
    url: "https://public.example/plan",
    active: true
  };
  const publicSameUrlAsPrivate = {
    id: 14,
    windowId: 1,
    index: 1,
    title: "Public tab with reused private URL",
    url: "https://private.example/research"
  };
  const chrome = createFakeChrome({
    windows: [
      { id: 1, focused: true, tabs: [publicTab, publicSameUrlAsPrivate] },
      { id: 2, focused: false, incognito: true, tabs: [privateTab] }
    ]
  });

  await rememberOpenTabActivity(chrome, privateTab, null, { now, includeIncognitoTabs: true });
  await rememberOpenTabActivity(chrome, publicTab, null, { now: now + 1000 });
  await rememberTabLifecycle(chrome, "tab_activated", privateTab, { now, includeIncognitoTabs: true });
  await rememberTabLifecycle(chrome, "tab_activated", publicTab, { now: now + 1000 });

  const excluded = await getActivityOverview(chrome, { rangeMs: 24 * 60 * 60 * 1000, now: now + 2000 });
  const included = await getActivityOverview(chrome, {
    rangeMs: 24 * 60 * 60 * 1000,
    now: now + 2000,
    includeIncognitoTabs: true
  });

  assert.equal(excluded.cache.entries, 1);
  assert.equal(excluded.openTabs.total, 2);
  assert.equal(excluded.openTabs.tracked, 1);
  assert.equal(excluded.recap.recentPages.some((page) => page.title === "Private investor research"), false);
  assert.equal(excluded.lifecycle.olderOpenTabs.some((tab) => tab.tabId === 12), false);
  assert.equal(excluded.lifecycle.events, 1);
  assert.equal(included.cache.entries, 2);
  assert.equal(included.openTabs.total, 3);
  assert.equal(included.recap.recentPages.some((page) => page.title === "Private investor research"), true);
  assert.equal(included.lifecycle.olderOpenTabs.some((tab) => tab.tabId === 12), true);
  assert.equal(included.lifecycle.events, 2);
});

test("batch activity remember writes storage once and keeps recently active old pages in range", async () => {
  const chrome = createFakeChrome();
  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  let writes = 0;
  chrome.storage.local.set = async (values) => {
    writes += 1;
    return originalSet(values);
  };

  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const old = now - 20 * 24 * 60 * 60 * 1000;
  await rememberOpenTabActivity(
    chrome,
    { id: 10, windowId: 1, title: "Old research doc", url: "https://docs.example/research" },
    null,
    { now: old }
  );

  writes = 0;
  const { stored } = await rememberOpenTabsActivity(
    chrome,
    [
      { id: 10, windowId: 1, title: "Old research doc", url: "https://docs.example/research" },
      { id: 11, windowId: 1, title: "New issue", url: "https://github.com/acme/repo/issues/2" },
      { id: 12, windowId: 1, title: "Private tab", url: "https://private.example/", incognito: true }
    ],
    { now }
  );

  assert.equal(stored, 2);
  assert.equal(writes, 1);
  const cache = chrome.__state.storage[STORAGE_KEYS.pageActivityCache];
  assert.equal(Object.keys(cache.entries).length, 2);
  const entry = Object.values(cache.entries).find((item) => item.title === "Old research doc");
  assert.equal(entry.seenCount, 2);
  assert.equal(entry.firstSeenAt, new Date(old).toISOString());
  assert.equal(entry.lastSeenAt, new Date(now).toISOString());

  const overview = await getActivityOverview(chrome, { rangeMs: 24 * 60 * 60 * 1000, now });
  assert.equal(overview.recap.entries, 2);
});

test("activity overview persists cache compaction for expired local memory", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      stale: {
        key: "stale",
        title: "Expired activity",
        hostname: "old.example",
        sanitizedUrl: "https://old.example/page",
        lastSeenAt: new Date(now - 46 * 24 * 60 * 60 * 1000).toISOString()
      },
      fresh: {
        key: "fresh",
        title: "Fresh activity",
        hostname: "fresh.example",
        sanitizedUrl: "https://fresh.example/page",
        lastSeenAt: new Date(now - 60 * 1000).toISOString()
      }
    }
  };

  const overview = await getActivityOverview(chrome, { now });
  const cache = chrome.__state.storage[STORAGE_KEYS.pageActivityCache];

  assert.equal(overview.cache.entries, 1);
  assert.equal(cache.entries.stale, undefined);
  assert.equal(cache.entries.fresh.title, "Fresh activity");
});

test("activity cache compaction is queued with later writes", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      stale: {
        key: "stale",
        title: "Expired activity",
        hostname: "old.example",
        sanitizedUrl: "https://old.example/page",
        lastSeenAt: new Date(now - 46 * 24 * 60 * 60 * 1000).toISOString()
      },
      fresh: {
        key: "fresh",
        title: "Fresh activity",
        hostname: "fresh.example",
        sanitizedUrl: "https://fresh.example/page",
        lastSeenAt: new Date(now - 60 * 1000).toISOString()
      }
    }
  };

  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  let firstActivitySetStarted;
  let releaseFirstActivitySet;
  const firstActivitySet = new Promise((resolve) => {
    firstActivitySetStarted = resolve;
  });
  chrome.storage.local.set = async (values) => {
    if (!releaseFirstActivitySet && values?.[STORAGE_KEYS.pageActivityCache]) {
      await new Promise((resolve) => {
        releaseFirstActivitySet = resolve;
        firstActivitySetStarted();
      });
    }
    return originalSet(values);
  };

  const compactPromise = loadPrunedActivityCache(chrome, now);
  await firstActivitySet;
  const writePromise = rememberOpenTabActivity(
    chrome,
    { id: 22, windowId: 1, title: "New activity", url: "https://new.example/page" },
    null,
    { now: now + 1000 }
  );

  releaseFirstActivitySet();
  await Promise.all([compactPromise, writePromise]);

  const titles = Object.values(chrome.__state.storage[STORAGE_KEYS.pageActivityCache].entries).map((entry) => entry.title);
  assert.equal(titles.includes("Expired activity"), false);
  assert.equal(titles.includes("Fresh activity"), true);
  assert.equal(titles.includes("New activity"), true);
});
