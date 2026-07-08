import assert from "node:assert/strict";
import test from "node:test";
import { cachedPageSampleForTab, capturePageSummaryIfAllowed, loadPrunedPageSummaryCache, pageSummaryCacheKey, rememberPageSummary } from "../src/core/page-summary-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { DEFAULT_SETTINGS, PAGE_CONTEXT_MODES } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("page summary cache matches opaque URL fingerprints without storing full URLs", async () => {
  const chrome = createFakeChrome();
  const rawUrl = "https://example.com/project/ABCDEF1234567890?token=secret#section";
  await rememberPageSummary(
    chrome,
    {
      id: 10,
      title: "Private issue",
      url: rawUrl
    },
    {
      status: "ok",
      sample: {
        title: "Private issue",
        metaDescription: "Useful summary",
        language: "en",
        contentKind: "discussion",
        headings: ["Heading"],
        visibleText: "Visible text"
      }
    }
  );

  const cache = chrome.__state.storage[STORAGE_KEYS.pageSummaryCache];
  assert.equal(JSON.stringify(cache).includes("token=secret"), false);
  assert.equal(JSON.stringify(cache).includes("ABCDEF1234567890"), false);
  const entry = Object.values(cache.entries)[0];
  assert.equal(entry.seenCount, 1);
  assert.match(entry.firstSeenAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(entry.lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);

  const cached = await cachedPageSampleForTab(chrome, {
    tabId: 10,
    windowId: 1,
    sanitizedUrl: "https://example.com/project",
    pageSummaryKey: pageSummaryCacheKey(rawUrl)
  });
  assert.equal(cached.status, "ok");
  assert.equal(cached.sample.visibleText, "Visible text");
  assert.equal(cached.sample.contentKind, "discussion");
});

test("page summary cache keeps distinct tokenized paths separate without storing tokens", async () => {
  const chrome = createFakeChrome();
  const firstUrl = "https://example.com/project/AAA111111111111111111111111111111111111?token=first";
  const secondUrl = "https://example.com/project/BBB222222222222222222222222222222222222?token=second";

  await rememberPageSummary(
    chrome,
    { id: 10, title: "First private issue", url: firstUrl },
    { status: "ok", sample: { title: "First private issue", visibleText: "First private summary" } }
  );
  await rememberPageSummary(
    chrome,
    { id: 11, title: "Second private issue", url: secondUrl },
    { status: "ok", sample: { title: "Second private issue", visibleText: "Second private summary" } }
  );

  const cache = chrome.__state.storage[STORAGE_KEYS.pageSummaryCache];
  assert.equal(Object.keys(cache.entries).length, 2);
  assert.equal(JSON.stringify(cache).includes("AAA111111111111111111111111111111111111"), false);
  assert.equal(JSON.stringify(cache).includes("BBB222222222222222222222222222222222222"), false);
  assert.equal(JSON.stringify(cache).includes("token=first"), false);
  assert.equal(JSON.stringify(cache).includes("token=second"), false);

  const firstCached = await cachedPageSampleForTab(chrome, {
    tabId: 10,
    windowId: 1,
    pageSummaryKey: pageSummaryCacheKey(firstUrl),
    sanitizedUrl: "https://example.com/project"
  });
  const secondCached = await cachedPageSampleForTab(chrome, {
    tabId: 11,
    windowId: 1,
    pageSummaryKey: pageSummaryCacheKey(secondUrl),
    sanitizedUrl: "https://example.com/project"
  });

  assert.equal(firstCached.sample.visibleText, "First private summary");
  assert.equal(secondCached.sample.visibleText, "Second private summary");
});

test("page summary pruning uses the same injected clock as the write", async () => {
  const chrome = createFakeChrome();
  const realNow = Date.now();
  const injectedNow = realNow + 30 * 24 * 60 * 60 * 1000;
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      stale: {
        key: "stale",
        title: "Stale summary",
        sampledAt: new Date(realNow - 24 * 60 * 60 * 1000).toISOString(),
        lastUsedAt: new Date(realNow - 24 * 60 * 60 * 1000).toISOString(),
        sample: { title: "Stale summary", visibleText: "Old text" }
      }
    }
  };

  await rememberPageSummary(
    chrome,
    { id: 11, title: "Fresh page", url: "https://fresh.example/page" },
    {
      status: "ok",
      sample: { title: "Fresh page", visibleText: "Fresh text" }
    },
    { now: injectedNow }
  );

  const cache = chrome.__state.storage[STORAGE_KEYS.pageSummaryCache];
  assert.equal(cache.entries.stale, undefined);
  assert.equal(Object.values(cache.entries).some((entry) => entry.title === "Fresh page"), true);
});

test("cached page summary reads persist cache compaction for expired summaries", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  await rememberPageSummary(
    chrome,
    { id: 11, title: "Fresh page", url: "https://fresh.example/page" },
    {
      status: "ok",
      sample: { title: "Fresh page", visibleText: "Fresh text" }
    },
    { now }
  );
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache].entries.stale = {
    key: "stale",
    title: "Expired summary",
    sampledAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    lastUsedAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    sample: { title: "Expired summary", visibleText: "Old text" }
  };

  const cached = await cachedPageSampleForTab(
    chrome,
    {
      tabId: 11,
      windowId: 1,
      sanitizedUrl: "https://fresh.example/page",
      fullUrl: ""
    },
    { now }
  );
  const cache = chrome.__state.storage[STORAGE_KEYS.pageSummaryCache];

  assert.equal(cached.sample.title, "Fresh page");
  assert.equal(cache.entries.stale, undefined);
  assert.equal(Object.values(cache.entries).length, 1);
});

test("page summary cache compaction is queued with later writes", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  await rememberPageSummary(
    chrome,
    { id: 11, title: "Fresh page", url: "https://fresh.example/page" },
    {
      status: "ok",
      sample: { title: "Fresh page", visibleText: "Fresh text" }
    },
    { now }
  );
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache].entries.stale = {
    key: "stale",
    title: "Expired summary",
    sampledAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    lastUsedAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    sample: { title: "Expired summary", visibleText: "Old text" }
  };

  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  let firstSummarySetStarted;
  let releaseFirstSummarySet;
  const firstSummarySet = new Promise((resolve) => {
    firstSummarySetStarted = resolve;
  });
  chrome.storage.local.set = async (values) => {
    if (!releaseFirstSummarySet && values?.[STORAGE_KEYS.pageSummaryCache]) {
      await new Promise((resolve) => {
        releaseFirstSummarySet = resolve;
        firstSummarySetStarted();
      });
    }
    return originalSet(values);
  };

  const compactPromise = loadPrunedPageSummaryCache(chrome, now);
  await firstSummarySet;
  const writePromise = rememberPageSummary(
    chrome,
    { id: 12, title: "New summary", url: "https://new.example/page" },
    {
      status: "ok",
      sample: { title: "New summary", visibleText: "New text" }
    },
    { now: now + 1000 }
  );

  releaseFirstSummarySet();
  await Promise.all([compactPromise, writePromise]);

  const titles = Object.values(chrome.__state.storage[STORAGE_KEYS.pageSummaryCache].entries).map((entry) => entry.title);
  assert.equal(titles.includes("Expired summary"), false);
  assert.equal(titles.includes("Fresh page"), true);
  assert.equal(titles.includes("New summary"), true);
});

test("continuous summary capture skips sleeping tabs", async () => {
  const chrome = createFakeChrome();
  let sampled = false;
  chrome.scripting.executeScript = async () => {
    sampled = true;
    return [{ result: { title: "Sample", visibleText: "Text" } }];
  };

  const result = await capturePageSummaryIfAllowed(
    chrome,
    { id: 10, active: true, discarded: true, url: "https://example.com/page" },
    { ...DEFAULT_SETTINGS, continuousPageSummaries: true }
  );

  assert.equal(result.status, "skipped");
  assert.equal(sampled, false);
});

test("continuous summary capture skips incognito tabs by default", async () => {
  const chrome = createFakeChrome();
  let sampled = false;
  chrome.scripting.executeScript = async () => {
    sampled = true;
    return [{ result: { title: "Private sample", visibleText: "Private text" } }];
  };

  const result = await capturePageSummaryIfAllowed(
    chrome,
    { id: 10, active: true, incognito: true, url: "https://private.example/page" },
    { ...DEFAULT_SETTINGS, continuousPageSummaries: true, includeIncognitoTabs: false }
  );

  assert.equal(result.status, "skipped");
  assert.equal(sampled, false);
  assert.equal(chrome.__state.storage[STORAGE_KEYS.pageSummaryCache], undefined);
  assert.equal(chrome.__state.storage[STORAGE_KEYS.pageActivityCache], undefined);
});

test("continuous summary capture can store incognito tabs when explicitly enabled", async () => {
  const chrome = createFakeChrome();
  chrome.permissions.contains = async (request) =>
    Boolean(request.permissions?.includes("scripting") || request.origins?.includes("https://*/*"));
  chrome.scripting.executeScript = async () => [
    {
      result: {
        title: "Private live page",
        metaDescription: "Private but user-enabled summary",
        language: "en",
        headings: ["Private overview"],
        visibleText: "Private live page text"
      }
    }
  ];

  const result = await capturePageSummaryIfAllowed(
    chrome,
    { id: 10, active: true, incognito: true, url: "https://private.example/docs" },
    {
      ...DEFAULT_SETTINGS,
      continuousPageSummaries: true,
      includeIncognitoTabs: true,
      pageContextMode: PAGE_CONTEXT_MODES.OFF
    }
  );

  assert.equal(result.status, "ok");
  const cached = await cachedPageSampleForTab(chrome, {
    tabId: 10,
    windowId: 1,
    sanitizedUrl: "https://private.example/docs",
    fullUrl: ""
  }, { includeIncognitoTabs: true });
  assert.equal(cached.sample.title, "Private live page");
  const activityEntry = Object.values(chrome.__state.storage[STORAGE_KEYS.pageActivityCache].entries)[0];
  assert.equal(activityEntry.lastKnownState.incognito, true);
});

test("cached page summaries do not reuse incognito samples unless enabled", async () => {
  const chrome = createFakeChrome();
  await rememberPageSummary(
    chrome,
    { id: 10, title: "Private cached page", url: "https://private.example/cached", incognito: true },
    {
      status: "ok",
      sample: {
        title: "Private cached page",
        visibleText: "Private cached visible text"
      }
    },
    { includeIncognitoTabs: true }
  );

  const descriptor = {
    tabId: 10,
    windowId: 1,
    sanitizedUrl: "https://private.example/cached",
    fullUrl: ""
  };

  assert.equal(await cachedPageSampleForTab(chrome, descriptor), null);
  const cached = await cachedPageSampleForTab(chrome, descriptor, { includeIncognitoTabs: true });
  assert.equal(cached.sample.title, "Private cached page");
});

test("continuous summary capture stores authorized live pages", async () => {
  const chrome = createFakeChrome();
  chrome.permissions.contains = async (request) =>
    Boolean(request.permissions?.includes("scripting") || request.origins?.includes("https://*/*"));
  chrome.scripting.executeScript = async () => [
    {
      result: {
        title: "Live page",
        metaDescription: "A page that can be summarized",
        language: "en",
        headings: ["Overview"],
        visibleText: "Readable live page text"
      }
    }
  ];

  const result = await capturePageSummaryIfAllowed(
    chrome,
    { id: 10, active: true, url: "https://example.com/docs" },
    {
      ...DEFAULT_SETTINGS,
      continuousPageSummaries: true,
      pageContextMode: PAGE_CONTEXT_MODES.OFF
    }
  );

  assert.equal(result.status, "ok");
  const cached = await cachedPageSampleForTab(chrome, {
    tabId: 10,
    windowId: 1,
    sanitizedUrl: "https://example.com/docs",
    fullUrl: ""
  });
  assert.equal(cached.sample.title, "Live page");
});
