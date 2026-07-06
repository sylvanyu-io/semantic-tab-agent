import assert from "node:assert/strict";
import test from "node:test";
import { cachedPageSampleForTab, capturePageSummaryIfAllowed, rememberPageSummary } from "../src/core/page-summary-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { DEFAULT_SETTINGS, PAGE_CONTEXT_MODES } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("page summary cache matches sanitized URL fingerprints without storing full URLs", async () => {
  const chrome = createFakeChrome();
  await rememberPageSummary(
    chrome,
    {
      id: 10,
      title: "Private issue",
      url: "https://example.com/project/ABCDEF1234567890?token=secret#section"
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
    fullUrl: ""
  });
  assert.equal(cached.status, "ok");
  assert.equal(cached.sample.visibleText, "Visible text");
  assert.equal(cached.sample.contentKind, "discussion");
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
