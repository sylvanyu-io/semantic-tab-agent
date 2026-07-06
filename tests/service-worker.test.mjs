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
