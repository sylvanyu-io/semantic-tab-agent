import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("service worker lifecycle listeners honor the include-incognito setting", async () => {
  const listeners = {};
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        incognito: true,
        tabs: [
          {
            id: 10,
            title: "Private research thread",
            url: "https://private.example/research",
            active: true,
            incognito: true
          }
        ]
      }
    ]
  });
  chrome.__state.storage[STORAGE_KEYS.settings] = {
    ...DEFAULT_SETTINGS,
    includeIncognitoTabs: true
  };
  installServiceWorkerEventMocks(chrome, listeners);

  globalThis.chrome = chrome;
  try {
    await import(`${pathToFileURL(`${process.cwd()}/src/background/service-worker.js`).href}?test=${Date.now()}`);
    assert.equal(typeof listeners.tabCreated, "function");

    listeners.tabCreated({
      id: 10,
      windowId: 1,
      index: 0,
      title: "Private research thread",
      url: "https://private.example/research",
      active: true,
      incognito: true
    });
    await waitForCondition(() => lifecycleEvents(chrome).some((event) => event.type === "tab_created"), "Timed out waiting for incognito creation log.");

    const session = Object.values(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog].sessions)[0];
    assert.equal(session.incognito, true);
    assert.equal(session.title, "Private research thread");
    assert.equal(lifecycleEvents(chrome).some((event) => event.type === "tab_created" && event.tabId === 10), true);
  } finally {
    delete globalThis.chrome;
  }
});

test("service worker does not record unmatched tab removals when private tabs are excluded", async () => {
  const listeners = {};
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        incognito: true,
        tabs: [
          {
            id: 10,
            title: "Private research thread",
            url: "https://private.example/research",
            active: true,
            incognito: true
          }
        ]
      }
    ]
  });
  installServiceWorkerEventMocks(chrome, listeners);

  globalThis.chrome = chrome;
  try {
    await import(`${pathToFileURL(`${process.cwd()}/src/background/service-worker.js`).href}?test=${Date.now()}`);
    assert.equal(typeof listeners.tabRemoved, "function");

    listeners.tabRemoved(10, { windowId: 1, isWindowClosing: false });
    await waitForCondition(() => chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog], "Timed out waiting for close handling.");

    assert.equal(lifecycleEvents(chrome).some((event) => event.type === "tab_closed_unmatched"), false);
    assert.equal(lifecycleEvents(chrome).some((event) => event.tabId === 10), false);
  } finally {
    delete globalThis.chrome;
  }
});

test("service worker records focused-window returns for lifecycle evidence", async () => {
  const listeners = {};
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          {
            id: 10,
            title: "Window one reference",
            url: "https://example.com/one",
            active: true
          }
        ]
      },
      {
        id: 2,
        focused: false,
        tabs: [
          {
            id: 20,
            title: "Window two background",
            url: "https://example.com/two-background",
            active: false
          },
          {
            id: 21,
            title: "Window two reference",
            url: "https://example.com/two",
            active: true
          }
        ]
      }
    ]
  });
  installServiceWorkerEventMocks(chrome, listeners);

  globalThis.chrome = chrome;
  try {
    await import(`${pathToFileURL(`${process.cwd()}/src/background/service-worker.js`).href}?test=${Date.now()}`);
    assert.equal(typeof listeners.windowFocusChanged, "function");

    listeners.windowFocusChanged(2);
    await waitForCondition(
      () => lifecycleEvents(chrome).some((event) => event.type === "window_focused" && event.tabId === 21),
      "Timed out waiting for focused-window lifecycle log."
    );

    assert.equal(lifecycleEvents(chrome).some((event) => event.type === "window_focused" && event.tabId === 20), false);
    const session = Object.values(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog].sessions).find((item) => item.tabId === 21);
    assert.equal(session.activeCount, 1);
    assert.equal(session.lastActivatedAt.length > 0, true);
  } finally {
    delete globalThis.chrome;
  }
});

test("service worker disables background summaries when the manifest has no content access feature", async () => {
  const listeners = {};
  const alarmCreates = [];
  const alarmClears = [];
  let scriptExecutions = 0;
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          {
            id: 10,
            title: "Research page",
            url: "https://example.com/research",
            active: true
          }
        ]
      }
    ]
  });
  chrome.__state.storage[STORAGE_KEYS.settings] = {
    ...DEFAULT_SETTINGS,
    continuousPageSummaries: true,
    pageSamplingConsentMode: "acknowledged_persistently",
    pageContextMode: "ambiguous_with_permission"
  };
  installServiceWorkerEventMocks(chrome, listeners);
  chrome.runtime.getManifest = () => ({ optional_permissions: [], optional_host_permissions: [] });
  chrome.alarms.create = async (name, options) => {
    alarmCreates.push({ name, options });
  };
  chrome.alarms.clear = async (name) => {
    alarmClears.push(name);
  };
  chrome.scripting.executeScript = async () => {
    scriptExecutions += 1;
    return [{ result: { title: "Should not run" } }];
  };

  globalThis.chrome = chrome;
  try {
    await import(`${pathToFileURL(`${process.cwd()}/src/background/service-worker.js`).href}?test=${Date.now()}`);
    const settingsSaveResponse = await new Promise((resolve) => {
      listeners.runtimeMessage(
        {
          type: "settings:save",
          settings: {
            ...DEFAULT_SETTINGS,
            continuousPageSummaries: true,
            pageSamplingConsentMode: "acknowledged_persistently",
            pageContextMode: "ambiguous_with_permission"
          }
        },
        {},
        resolve
      );
    });
    await listeners.installed();
    listeners.tabActivated({ tabId: 10, windowId: 1 });
    listeners.tabUpdated(10, { status: "complete" }, { id: 10, windowId: 1, url: "https://example.com/research" });
    await new Promise((resolve) => setTimeout(resolve, 1300));

    assert.equal(settingsSaveResponse.ok, true);
    assert.equal(alarmCreates.some((entry) => entry.name === "tabRecap.summarySweep"), false);
    assert.equal(alarmClears.includes("tabRecap.summarySweep"), true);
    assert.equal(scriptExecutions, 0);
  } finally {
    delete globalThis.chrome;
  }
});

test("service worker redacts runtime errors before logging or responding", async () => {
  const listeners = {};
  const debugLogs = [];
  const originalDebug = console.debug;
  const chrome = createFakeChrome();
  installServiceWorkerEventMocks(chrome, listeners);
  console.debug = (...args) => {
    debugLogs.push(args.map((arg) => String(arg)).join(" "));
  };

  globalThis.chrome = chrome;
  try {
    await import(`${pathToFileURL(`${process.cwd()}/src/background/service-worker.js`).href}?test=${Date.now()}`);
    const fakeProviderKey = ["sk", "private", "secret", "token", "1234567890"].join("-");
    const response = await new Promise((resolve) => {
      listeners.runtimeMessage(
        {
          type: [
            "unknown-message",
            "https://private.example.com/secret/project?token=abc123",
            fakeProviderKey
          ].join(" ")
        },
        {},
        resolve
      );
    });

    const serializedLogs = debugLogs.join("\n");
    assert.equal(response.ok, false);
    assert.equal(response.error.includes("[redacted-url]"), true);
    assert.equal(response.error.includes("private.example.com"), false);
    assert.equal(response.error.includes("[redacted-key]"), true);
    assert.equal(response.error.includes(fakeProviderKey), false);
    assert.equal(response.error.includes("token=abc123"), false);
    assert.equal(response.error.includes("/secret/project"), false);
    assert.equal(serializedLogs.includes("tab_recap_background_error"), true);
    assert.equal(serializedLogs.includes("[redacted-url]"), true);
    assert.equal(serializedLogs.includes("private.example.com"), false);
    assert.equal(serializedLogs.includes("[redacted-key]"), true);
    assert.equal(serializedLogs.includes(fakeProviderKey), false);
    assert.equal(serializedLogs.includes("token=abc123"), false);
    assert.equal(serializedLogs.includes("/secret/project"), false);
  } finally {
    console.debug = originalDebug;
    delete globalThis.chrome;
  }
});

function installServiceWorkerEventMocks(chrome, listeners) {
  chrome.runtime = chrome.runtime || {};
  chrome.runtime.onMessage = { addListener: (callback) => { listeners.runtimeMessage = callback; } };
  chrome.runtime.onInstalled = { addListener: (callback) => { listeners.installed = callback; } };
  chrome.runtime.onStartup = { addListener: (callback) => { listeners.startup = callback; } };
  chrome.alarms = {
    create: async () => {},
    clear: async () => {},
    onAlarm: { addListener: (callback) => { listeners.alarm = callback; } }
  };
  chrome.sidePanel = {
    setPanelBehavior: async () => {}
  };
  chrome.tabs.onActivated = { addListener: (callback) => { listeners.tabActivated = callback; } };
  chrome.tabs.onCreated = { addListener: (callback) => { listeners.tabCreated = callback; } };
  chrome.tabs.onRemoved = { addListener: (callback) => { listeners.tabRemoved = callback; } };
  chrome.tabs.onUpdated = { addListener: (callback) => { listeners.tabUpdated = callback; } };
  chrome.windows.WINDOW_ID_NONE = -1;
  chrome.windows.onFocusChanged = { addListener: (callback) => { listeners.windowFocusChanged = callback; } };
}

function lifecycleEvents(chrome) {
  return chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog]?.events || [];
}

async function waitForCondition(predicate, message) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}
