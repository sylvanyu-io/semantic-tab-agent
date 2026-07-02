import assert from "node:assert/strict";
import test from "node:test";
import { getActivityOverview, rememberOpenTabActivity, rememberOpenTabsActivity } from "../src/core/page-activity-cache.js";
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
