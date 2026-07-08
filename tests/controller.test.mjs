import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTabs,
  applyLastPlan,
  cancelActiveJob,
  canUndoLastApply,
  clearAnalysisState,
  generateProgressCopy,
  getActiveJob,
  getLastJob,
  handleRuntimeMessage,
  startAnalyzeTabs,
  undoLastApply
} from "../src/core/controller.js";
import { applyValidatedPlan, undoFromRollback } from "../src/core/chrome-executor.js";
import { rememberPageSummary } from "../src/core/page-summary-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  LANGUAGE_MODES,
  ORGANIZE_MODES,
  PLANNER_PROVIDERS,
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  TARGET_WINDOW_MODES,
  UNDO_TARGET_WINDOW_MODES
} from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

const FAKE_PLANNER_SETTINGS = Object.freeze({
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.FAKE
});

test("analyze/apply/undo groups only the current window by default", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "OpenAI API docs", url: "https://platform.openai.com/docs" },
          { id: 12, title: "Pinned mail", url: "https://mail.example.com", pinned: true }
        ]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "GitLab issue", url: "https://gitlab.com/acme/repo/-/issues/1" }]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.totalTabsCount, 3);
  assert.equal(job.preview.eligibleTabsCount, 2);
  assert.equal(job.preview.windowCount, 1);
  assert.equal(job.preview.groupedTabsCount + job.preview.reviewTabsCount, 2);
  assert.equal(job.preview.excludedTabsCount, 1);
  assert.deepEqual(
    job.inventory.plannerTabs.map((tab) => tab.tabId).sort(),
    [10, 11]
  );

  const result = await applyLastPlan(chrome);
  assert.equal(result.groupedTabsCount, 2);
  const groupedTab = await chrome.tabs.get(10);
  assert.notEqual(groupedTab.groupId, -1);
  assert.equal((await chrome.tabGroups.query({ windowId: 1 })).find((group) => group.id === groupedTab.groupId)?.collapsed, true);
  assert.equal((await chrome.tabs.get(20)).groupId, -1);

  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 3);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("cleanup candidate focus activates the tab without closing anything", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: false,
        tabs: [{ id: 10, title: "Old tab", url: "https://example.com/old", active: false }]
      },
      {
        id: 2,
        focused: true,
        tabs: [{ id: 20, title: "Current tab", url: "https://example.com/current", active: true }]
      }
    ]
  });

  const result = await handleRuntimeMessage(chrome, { type: "activity:focusTab", tabId: 10, windowId: 1 });

  assert.equal(result.focused, true);
  assert.equal((await chrome.windows.get(1)).focused, true);
  assert.equal((await chrome.tabs.get(10)).active, true);
  assert.equal((await chrome.tabs.query({})).length, 2);
});

test("cleanup candidate focus leaves only one active tab in the target window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Cleanup candidate", url: "https://example.com/old", active: false },
          { id: 11, title: "Current tab", url: "https://example.com/current", active: true }
        ]
      }
    ]
  });

  await handleRuntimeMessage(chrome, { type: "activity:focusTab", tabId: 10, windowId: 1 });

  assert.equal((await chrome.tabs.get(10)).active, true);
  assert.equal((await chrome.tabs.get(11)).active, false);
  assert.deepEqual(
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((tab) => tab.id),
    [10]
  );
});

test("clearing local memory removes activity records without closing tabs or preferences", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Current work", url: "https://example.com/work", active: true }]
      }
    ]
  });
  chrome.__state.storage[STORAGE_KEYS.settings] = { languageMode: "zh-CN" };
  chrome.__state.storage[STORAGE_KEYS.lastRollback] = { createdAt: "2026-06-27T00:00:00.000Z" };
  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = { version: 1, entries: { page: { title: "Activity" } } };
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = { version: 1, entries: { page: { title: "Summary" } } };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = { version: 1, sessions: { page: { title: "Lifecycle" } }, events: [] };

  const result = await handleRuntimeMessage(chrome, { type: "activity:clearLocalMemory" });

  assert.equal(result.cleared, true);
  assert.equal(result.removedCount, 3);
  assert.deepEqual(
    result.removedKeys.sort(),
    [STORAGE_KEYS.pageActivityCache, STORAGE_KEYS.pageSummaryCache, STORAGE_KEYS.tabLifecycleLog].sort()
  );
  assert.equal(chrome.__state.storage[STORAGE_KEYS.pageActivityCache], undefined);
  assert.equal(chrome.__state.storage[STORAGE_KEYS.pageSummaryCache], undefined);
  assert.equal(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog], undefined);
  assert.deepEqual(chrome.__state.storage[STORAGE_KEYS.settings], { languageMode: "zh-CN" });
  assert.deepEqual(chrome.__state.storage[STORAGE_KEYS.lastRollback], { createdAt: "2026-06-27T00:00:00.000Z" });
  assert.equal((await chrome.tabs.query({})).length, 1);
});

test("diagnostics snapshot summarizes local state without sensitive page or provider data", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Private customer research", url: "https://private.example.com/secret?token=abc", active: true }]
      }
    ]
  });
  chrome.__state.storage[STORAGE_KEYS.settings] = {
    languageMode: "zh-CN",
    gatewayProviderMode: "custom",
    gatewayBaseUrl: "https://api.deepseek.com/v1",
    gatewayApiKey: "sk-private-secret",
    rememberProviderKeys: true,
    gatewayModel: "custom",
    gatewayCustomModel: "deepseek-v4-pro",
    customPrompt: "Never export this prompt"
  };
  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      private: {
        title: "Private customer research",
        url: "https://private.example.com/secret?token=abc",
        openCount: 3
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      private: {
        title: "Private summary title",
        sample: { visibleText: "Private body text should never leave diagnostics" }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      private: { title: "Private lifecycle title", url: "https://private.example.com/lifecycle" }
    },
    events: [{ type: "activated", tabId: 10 }]
  };
  chrome.__state.storage[`${STORAGE_KEYS.activeJob}:1`] = {
    operationId: "job_secret",
    status: "error",
    phase: "planning",
    progress: 72,
    message: "Failed on Private customer research",
    error: "AI gateway failed for https://private.example.com/secret with sk-private-secret: error code 1033",
    createdAt: "2026-07-06T12:00:00.000Z",
    updatedAt: "2026-07-06T12:01:00.000Z"
  };
  chrome.__state.storage[`${STORAGE_KEYS.lastRollback}:1`] = {
    createdAt: "2026-07-06T12:02:00.000Z",
    tabs: [{ id: 10, title: "Private customer research" }],
    groups: [{ id: 1, title: "Private group" }]
  };

  const result = await handleRuntimeMessage(chrome, { type: "diagnostics:getSnapshot" });
  const serialized = JSON.stringify(result);

  assert.equal(result.schema, "tabrecap_diagnostics_v1");
  assert.equal(result.settings.gatewayHost, "api.deepseek.com");
  assert.equal(result.settings.customKeyPresent, true);
  assert.equal(result.localMemory.pageActivityEntries, 1);
  assert.equal(result.localMemory.pageSummaryEntries, 1);
  assert.equal(result.localMemory.tabLifecycleSessions, 1);
  assert.equal(result.localMemory.tabLifecycleEvents, 1);
  assert.equal(result.jobs.active[0].errorKind, "cloudflare_or_tunnel");
  assert.equal(result.jobs.rollback[0].tabCount, 1);
  assert.equal(result.jobs.rollback[0].groupCount, 1);
  assert.equal(serialized.includes("sk-private-secret"), false);
  assert.equal(serialized.includes("private.example.com"), false);
  assert.equal(serialized.includes("Private customer research"), false);
  assert.equal(serialized.includes("Private body text"), false);
  assert.equal(serialized.includes("Never export this prompt"), false);
});

test("closing cleanup candidates is explicit and updates the stored plan preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Old docs", url: "https://example.com/old", active: true },
          { id: 11, title: "Current docs", url: "https://example.com/current" }
        ]
      }
    ]
  });
  const settings = { ...FAKE_PLANNER_SETTINGS, analyzeCleanup: true };
  const job = {
    operationId: "job_cleanup_close",
    createdAt: new Date().toISOString(),
    settings,
    invocation: { windowId: 1 },
    inventory: {
      scope: { kind: "current_window", currentWindowId: 1, invocationWindowId: 1, windowIds: [1] },
      windows: [{ windowId: 1, type: "normal", focused: true, incognito: false, tabCount: 2 }],
      tabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Old docs", hostname: "example.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Current docs", hostname: "example.com" }
      ],
      plannerTabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Old docs", hostname: "example.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Current docs", hostname: "example.com" }
      ],
      excludedTabs: [],
      lockedGroups: [],
      pageSamples: []
    },
    plan: {
      schemaVersion: 1,
      mode: settings.organizeMode,
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1 },
      eligibleTabs: [
        { tabId: 10, windowId: 1 },
        { tabId: 11, windowId: 1 }
      ],
      excludedTabs: [],
      groups: [
        {
          groupKey: "docs",
          title: "Docs",
          color: "blue",
          confidence: 0.9,
          reason: "Docs work.",
          tabRefs: [
            { tabId: 10, windowId: 1 },
            { tabId: 11, windowId: 1 }
          ]
        }
      ],
      reviewTabs: [],
      cleanup: {
        schema: "tab_recap_cleanup_v1",
        summary: "Old docs can be checked.",
        candidates: [
          { tabId: 10, windowId: 1, title: "Old docs", hostname: "example.com", priority: "high", reason: "Old task.", evidence: [] }
        ]
      }
    },
    validation: { ok: true, errors: [], warnings: [] },
    preview: {
      analysisFeatures: { grouping: true, cleanup: true },
      groups: [{ title: "Docs", reason: "Docs work.", tabCount: 2 }],
      groupedTabsCount: 2,
      reviewTabsCount: 0,
      cleanup: {
        summary: "Old docs can be checked.",
        candidateCount: 1,
        candidates: [{ tabId: 10, windowId: 1, title: "Old docs", hostname: "example.com", priority: "high", reason: "Old task." }]
      }
    }
  };
  await chrome.storage.local.set({ [`${STORAGE_KEYS.lastJob}:1`]: job });

  const result = await handleRuntimeMessage(chrome, {
    type: "tabs:closeCleanupCandidates",
    windowId: 1,
    tabIds: [10],
    languageMode: "en-US"
  });

  await assert.rejects(() => chrome.tabs.get(10), /No tab with id 10/);
  assert.equal((await chrome.tabs.get(11)).title, "Current docs");
  assert.deepEqual(result.closedTabIds, [10]);
  assert.equal(result.preview.groupedTabsCount, 1);
  assert.equal(result.preview.cleanup.candidateCount, 0);
  const stored = await getLastJob(chrome, 1);
  assert.deepEqual(stored.plan.groups[0].tabRefs.map((ref) => ref.tabId), [11]);
  assert.equal(stored.validation.ok, true);
});

test("cleanup close removes stale candidates from the stored plan", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 11, title: "Current docs", url: "https://example.com/current", active: true }]
      }
    ]
  });
  const settings = { ...FAKE_PLANNER_SETTINGS, analyzeCleanup: true };
  const job = {
    operationId: "job_cleanup_stale_close",
    createdAt: new Date().toISOString(),
    settings,
    invocation: { windowId: 1 },
    inventory: {
      scope: { kind: "current_window", currentWindowId: 1, invocationWindowId: 1, windowIds: [1] },
      windows: [{ windowId: 1, type: "normal", focused: true, incognito: false, tabCount: 2 }],
      tabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Already closed", hostname: "example.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Current docs", hostname: "example.com" }
      ],
      plannerTabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Already closed", hostname: "example.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Current docs", hostname: "example.com" }
      ],
      excludedTabs: [],
      lockedGroups: [],
      pageSamples: []
    },
    plan: {
      schemaVersion: 1,
      mode: settings.organizeMode,
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1 },
      eligibleTabs: [
        { tabId: 10, windowId: 1 },
        { tabId: 11, windowId: 1 }
      ],
      excludedTabs: [],
      groups: [
        {
          groupKey: "docs",
          title: "Docs",
          color: "blue",
          confidence: 0.9,
          reason: "Docs work.",
          tabRefs: [
            { tabId: 10, windowId: 1 },
            { tabId: 11, windowId: 1 }
          ]
        }
      ],
      reviewTabs: [],
      cleanup: {
        schema: "tab_recap_cleanup_v1",
        summary: "Old docs can be checked.",
        candidates: [
          { tabId: 10, windowId: 1, title: "Already closed", hostname: "example.com", priority: "high", reason: "Old task.", evidence: [] }
        ]
      }
    },
    validation: { ok: true, errors: [], warnings: [] },
    preview: {
      analysisFeatures: { grouping: true, cleanup: true },
      groups: [{ title: "Docs", reason: "Docs work.", tabCount: 2 }],
      groupedTabsCount: 2,
      reviewTabsCount: 0,
      cleanup: {
        summary: "Old docs can be checked.",
        candidateCount: 1,
        candidates: [{ tabId: 10, windowId: 1, title: "Already closed", hostname: "example.com", priority: "high", reason: "Old task." }]
      }
    }
  };
  await chrome.storage.local.set({ [`${STORAGE_KEYS.lastJob}:1`]: job });

  const result = await handleRuntimeMessage(chrome, {
    type: "tabs:closeCleanupCandidates",
    windowId: 1,
    tabIds: [10],
    languageMode: "zh-CN"
  });

  assert.deepEqual(result.closedTabIds, []);
  assert.deepEqual(result.skippedTabIds, [10]);
  assert.equal((await chrome.tabs.get(11)).title, "Current docs");
  assert.equal(result.preview.groupedTabsCount, 1);
  assert.equal(result.preview.cleanup.candidateCount, 0);
  const stored = await getLastJob(chrome, 1);
  assert.deepEqual(stored.plan.groups[0].tabRefs.map((ref) => ref.tabId), [11]);
  assert.equal(stored.validation.ok, true);
});

test("cleanup candidate focus follows a tab that moved to another window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: false,
        tabs: []
      },
      {
        id: 2,
        focused: true,
        tabs: [{ id: 10, title: "Moved tab", url: "https://example.com/moved", active: false }]
      }
    ]
  });

  const result = await handleRuntimeMessage(chrome, { type: "activity:focusTab", tabId: 10, windowId: 1, languageMode: "en-US" });

  assert.equal(result.focused, true);
  assert.equal(result.windowId, 2);
  assert.equal((await chrome.windows.get(2)).focused, true);
  assert.equal((await chrome.tabs.get(10)).active, true);
});

test("cleanup candidate focus errors follow the requested UI language when the tab is gone", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Current tab", url: "https://example.com/current", active: true }]
      }
    ]
  });

  await assert.rejects(
    () => handleRuntimeMessage(chrome, { type: "activity:focusTab", tabId: 99, windowId: 1, languageMode: "en-US" }),
    /This tab has already been closed/
  );
});

test("window-scoped jobs and undo state do not overwrite another window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "OpenAI API docs", url: "https://platform.openai.com/docs" }
        ]
      },
      {
        id: 2,
        tabs: [
          { id: 20, title: "Chrome extension docs", url: "https://developer.chrome.com/docs/extensions", active: true },
          { id: 21, title: "Vite docs", url: "https://vite.dev/guide/" }
        ]
      }
    ]
  });

  const firstJob = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  const secondJob = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 2 });

  assert.equal((await getLastJob(chrome, 1)).operationId, firstJob.operationId);
  assert.equal((await getLastJob(chrome, 2)).operationId, secondJob.operationId);
  assert.equal((await canUndoLastApply(chrome)).canUndo, false);

  await applyLastPlan(chrome, { windowId: 1 });
  assert.equal((await canUndoLastApply(chrome, 1)).canUndo, true);
  assert.equal((await canUndoLastApply(chrome, 2)).canUndo, false);
});

test("default scoped job lookup follows the last focused active tab window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: false,
        tabs: [{ id: 10, title: "Window one docs", url: "https://example.com/one", active: true }]
      },
      {
        id: 2,
        focused: true,
        tabs: [{ id: 20, title: "Window two docs", url: "https://example.com/two", active: true }]
      }
    ]
  });
  chrome.__state.storage[`${STORAGE_KEYS.lastJob}:1`] = { operationId: "window-one", status: "complete" };
  chrome.__state.storage[`${STORAGE_KEYS.lastJob}:2`] = { operationId: "window-two", status: "complete" };

  const job = await getLastJob(chrome);

  assert.equal(job.operationId, "window-two");
});

test("current-window analysis ignores invalid invocation window ids", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true }]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 0 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.inventory.scope.currentWindowId, 1);
  assert.equal(job.inventory.plannerTabs[0].tabId, 10);
});

test("collapse toggle can leave newly created groups expanded", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, { ...FAKE_PLANNER_SETTINGS, collapseGroupsAfterApply: false }, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  await applyLastPlan(chrome);
  const groupedTab = await chrome.tabs.get(10);
  assert.notEqual(groupedTab.groupId, -1);
  assert.equal((await chrome.tabGroups.query({ windowId: 1 })).find((group) => group.id === groupedTab.groupId)?.collapsed, false);
});

test("apply rebases small tab changes since preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const window = chrome.__state.windows.get(1);
  window.tabs = [
    { ...window.tabs[0], index: 0 },
    {
      ...window.tabs[1],
      id: 12,
      index: 1,
      title: "Untitled workspace",
      url: "https://example.com/workspace",
      groupId: -1
    }
  ];

  const confirmation = await applyLastPlan(chrome);
  assert.equal(confirmation.requiresChangedTabsConfirmation, true);
  assert.equal(confirmation.rebasedPlan.changedTabsCount, 2);
  assert.deepEqual(confirmation.rebasedPlan.removedTabIds, [11]);
  assert.deepEqual(confirmation.rebasedPlan.skippedNewTabIds, [12]);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(12)).groupId, -1);

  const result = await applyLastPlan(chrome, {
    confirmChangedTabs: true,
    confirmationToken: confirmation.rebasedPlan.confirmationToken
  });
  assert.equal(result.rebasedPlan.changedTabsCount, 2);
  assert.deepEqual(result.rebasedPlan.removedTabIds, [11]);
  assert.deepEqual(result.rebasedPlan.addedReviewTabIds, [12]);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);
  assert.notEqual((await chrome.tabs.get(12)).groupId, -1);
});

test("apply treats same-id page changes as changed tabs requiring fresh confirmation", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  await chrome.tabs.update(11, {
    title: "Shopping cart",
    url: "https://shop.example/cart"
  });

  const confirmation = await applyLastPlan(chrome);
  assert.equal(confirmation.requiresChangedTabsConfirmation, true);
  assert.deepEqual(confirmation.rebasedPlan.changedContentTabIds, [11]);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);

  const result = await applyLastPlan(chrome, {
    confirmChangedTabs: true,
    confirmationToken: confirmation.rebasedPlan.confirmationToken
  });
  assert.equal(result.rebasedPlan.changedTabsCount, 1);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);
  assert.notEqual((await chrome.tabs.get(11)).groupId, -1);
});

test("changed-tab confirmation tokens expire when the tab inventory changes again", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  await chrome.tabs.update(11, { title: "Different topic", url: "https://example.com/different" });
  const firstConfirmation = await applyLastPlan(chrome);
  assert.equal(firstConfirmation.requiresChangedTabsConfirmation, true);

  const window = chrome.__state.windows.get(1);
  window.tabs.push({
    ...window.tabs[0],
    id: 12,
    index: window.tabs.length,
    title: "New tab after confirmation",
    url: "https://example.com/new",
    groupId: -1
  });

  const staleConfirmation = await applyLastPlan(chrome, {
    confirmChangedTabs: true,
    confirmationToken: firstConfirmation.rebasedPlan.confirmationToken
  });
  assert.equal(staleConfirmation.requiresChangedTabsConfirmation, true);
  assert.notEqual(staleConfirmation.rebasedPlan.confirmationToken, firstConfirmation.rebasedPlan.confirmationToken);
  assert.equal(staleConfirmation.rebasedPlan.changedTabsCount, 2);
});

test("apply asks to regenerate when too many tabs changed since preview", async () => {
  const originalTabs = Array.from({ length: 8 }, (_, index) => ({
    id: 100 + index,
    title: `Chrome API docs ${index}`,
    url: `https://developer.chrome.com/docs/${index}`,
    active: index === 0
  }));
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs: originalTabs }]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const window = chrome.__state.windows.get(1);
  window.tabs = Array.from({ length: 8 }, (_, index) => ({
    ...window.tabs[0],
    id: 200 + index,
    index,
    title: `New workspace ${index}`,
    url: `https://example.com/new-${index}`,
    active: index === 0,
    groupId: -1
  }));

  await assert.rejects(() => applyLastPlan(chrome), /标签页变化较多，请重新生成方案。变化标签页 16 个。/);
});

test("current-window apply refuses to drift to another window after preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "GitLab issue", url: "https://gitlab.com/acme/repo/-/issues/2" }
        ]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "Shopping cart", url: "https://shop.example/cart" }]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  await chrome.windows.remove(1);
  chrome.__state.windows.get(2).focused = true;

  await assert.rejects(() => applyLastPlan(chrome, { windowId: 1 }), /预览中的当前窗口已关闭，请重新生成方案。/);
  assert.equal((await chrome.tabs.get(20)).groupId, -1);
});

test("apply operations are serialized so double submit cannot mutate twice", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "GitLab issue", url: "https://gitlab.com/acme/repo/-/issues/2" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const results = await Promise.allSettled([applyLastPlan(chrome), applyLastPlan(chrome)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /No analyzed plan is available/);

  const groups = await chrome.tabGroups.query({ windowId: 1 });
  assert.equal(groups.length, 1);
});

test("review group title follows the selected result language when applying", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page A", url: "https://rare-a.example", active: true },
          { id: 11, title: "Obscure page B", url: "https://rare-b.example" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, { ...FAKE_PLANNER_SETTINGS, languageMode: LANGUAGE_MODES.EN_US }, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.reviewGroupTitle, "Needs Review");

  await applyLastPlan(chrome);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "Needs Review");
});

test("stored plans are normalized before preview is returned", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Project issue", url: "https://github.com/acme/repo/issues/1", active: true },
          { id: 11, title: "Unclear page", url: "https://rare.example/page" }
        ]
      }
    ]
  });
  const settings = {
    ...FAKE_PLANNER_SETTINGS,
    reviewGroupMode: "create_review_group",
    languageMode: "zh-CN"
  };
  const staleJob = {
    operationId: "job_stale_review_group",
    createdAt: new Date().toISOString(),
    settings,
    invocation: { windowId: 1 },
    inventory: {
      scope: { kind: "current_window", currentWindowId: 1, invocationWindowId: 1, windowIds: [1] },
      windows: [{ windowId: 1, type: "normal", focused: true, incognito: false, tabCount: 2 }],
      tabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Project issue", hostname: "github.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Unclear page", hostname: "rare.example" }
      ],
      plannerTabs: [
        { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Project issue", hostname: "github.com" },
        { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Unclear page", hostname: "rare.example" }
      ],
      excludedTabs: [],
      lockedGroups: [],
      pageSamples: []
    },
    plan: {
      schemaVersion: 1,
      mode: settings.organizeMode,
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1 },
      eligibleTabs: [
        { tabId: 10, windowId: 1 },
        { tabId: 11, windowId: 1 }
      ],
      excludedTabs: [],
      groups: [
        {
          groupKey: "needs-review",
          title: "待确认",
          color: "grey",
          confidence: 0.9,
          reason: "AI 暂时拿不准。",
          tabRefs: [{ tabId: 11, windowId: 1 }]
        },
        {
          groupKey: "project",
          title: "当前项目",
          color: "blue",
          confidence: 0.9,
          reason: "Issue and project work.",
          tabRefs: [{ tabId: 10, windowId: 1 }]
        }
      ],
      reviewTabs: [],
      cleanup: null
    },
    validation: { ok: true, errors: [], warnings: [] },
    preview: {
      groups: [
        { title: "当前项目", tabCount: 1 },
        { title: "待确认", tabCount: 1 }
      ],
      groupedTabsCount: 2,
      reviewTabsCount: 0
    }
  };
  await chrome.storage.local.set({ [`${STORAGE_KEYS.lastJob}:1`]: staleJob });

  const job = await getLastJob(chrome, 1);

  assert.equal(job.validation.ok, true);
  assert.deepEqual(
    job.plan.groups.map((group) => group.title),
    ["当前项目"]
  );
  assert.deepEqual(
    job.plan.reviewTabs.map((ref) => ref.tabId),
    [11]
  );
  assert.deepEqual(
    job.preview.groups.map((group) => group.title),
    ["当前项目"]
  );
  assert.equal(job.preview.reviewTabsCount, 1);
  assert.equal(job.preview.reviewGroupTitle, "待分类");

  const persisted = chrome.__state.storage[`${STORAGE_KEYS.lastJob}:1`];
  assert.deepEqual(
    persisted.plan.groups.map((group) => group.title),
    ["当前项目"]
  );
  assert.equal(persisted.preview.reviewTabsCount, 1);
});

test("apply preserves planned order when excluded tabs sit between planned tabs", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 99, title: "Pinned mail", url: "https://mail.example.com", pinned: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  await applyLastPlan(chrome);

  const window = await chrome.windows.get(1, { populate: true });
  assert.deepEqual(
    window.tabs.map((tab) => tab.id),
    [99, 10, 11]
  );
});

test("undo availability is hydrated from the stored rollback snapshot", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "OpenAI API docs", url: "https://platform.openai.com/docs" }
        ]
      }
    ]
  });

  assert.equal((await canUndoLastApply(chrome)).canUndo, false);
  await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  await applyLastPlan(chrome);
  assert.equal((await canUndoLastApply(chrome)).canUndo, true);
  await undoLastApply(chrome);
  assert.equal((await canUndoLastApply(chrome)).canUndo, false);
});

test("applying a plan keeps review-like groups after topic groups", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page", url: "https://rare.example", active: true },
          { id: 11, title: "Current project issue", url: "https://github.com/acme/repo/issues/1" }
        ]
      }
    ]
  });
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    tabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CURRENT_WINDOW,
    targetWindow: { kind: "current_window", windowId: 1, title: "当前窗口" },
    groups: [
      { groupKey: "needs-review", title: "待确认", color: "grey", confidence: 0.9, tabRefs: [{ tabId: 10, windowId: 1 }] },
      { groupKey: "work", title: "当前项目", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] }
    ],
    reviewTabs: [],
    excludedTabs: []
  };

  await applyValidatedPlan(chrome, plan, inventory, DEFAULT_SETTINGS);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  const tabs = await chrome.tabs.query({ windowId: 1 });

  assert.deepEqual(
    groups.map((group) => group.title),
    ["当前项目", "待分类"]
  );
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [11, 10]
  );
});

test("applying reviewTabs moves the runtime review group after topic groups", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page", url: "https://rare.example", active: true },
          { id: 11, title: "Current project issue", url: "https://github.com/acme/repo/issues/1" }
        ]
      }
    ]
  });
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    tabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CURRENT_WINDOW,
    targetWindow: { kind: "current_window", windowId: 1, title: "当前窗口" },
    groups: [{ groupKey: "work", title: "当前项目", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] }],
    reviewTabs: [{ tabId: 10, windowId: 1, reason: "主题不明确" }],
    excludedTabs: []
  };

  await applyValidatedPlan(chrome, plan, inventory, DEFAULT_SETTINGS);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  const tabs = await chrome.tabs.query({ windowId: 1 });

  assert.deepEqual(
    groups.map((group) => group.title),
    ["当前项目", "待分类"]
  );
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [11, 10]
  );
});

test("consolidate_one_window merges all eligible normal-window tabs into the invocation window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "GitHub issue", url: "https://github.com/acme/repo/issues/1", active: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "OpenAI model docs", url: "https://platform.openai.com/docs/models" }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.NEW_WINDOW,
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.requiresConfirmation, true);
  assert.equal(job.plan.targetWindow.windowId, 1);

  const blocked = await applyLastPlan(chrome);
  assert.equal(blocked.requiresMultiWindowConfirmation, true);

  const result = await applyLastPlan(chrome, { confirmMultiWindow: true });
  assert.equal(result.movedTabsCount, 2);
  assert.deepEqual(result.createdWindowIds, []);
  assert.equal(result.targetWindowId, 1);
  const targetWindow = await chrome.windows.get(result.targetWindowId, { populate: true });
  assert.deepEqual(
    targetWindow.tabs.map((tab) => tab.id).sort(),
    [10, 20]
  );

  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.reduce((sum, window) => sum + window.tabs.length, 0), 2);
});

test("consolidate_one_window can use the invocation window as target", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "GitHub issue", url: "https://github.com/acme/repo/issues/1", active: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "Chrome extension docs", url: "https://developer.chrome.com/docs/extensions" }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW,
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.plan.targetWindow.windowId, 1);

  const result = await applyLastPlan(chrome, { confirmMultiWindow: true });
  assert.equal(result.targetWindowId, 1);
  assert.deepEqual(result.createdWindowIds, []);
  const targetWindow = await chrome.windows.get(1, { populate: true });
  assert.deepEqual(
    targetWindow.tabs.map((tab) => tab.id).sort(),
    [10, 20]
  );
});

test("consolidate_one_window with no eligible tabs is a no-op", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Pinned mail", url: "https://mail.example.com", active: true, pinned: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "Pinned docs", url: "https://docs.example.com", pinned: true }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.NEW_WINDOW
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.excludedTabsCount, 2);

  const result = await applyLastPlan(chrome, { confirmMultiWindow: true });
  assert.equal(result.movedTabsCount, 0);
  assert.equal(result.createdWindowIds.length, 0);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.length, 2);
});

test("apply failure keeps a rollback snapshot so undo can restore", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalUpdate = chrome.tabGroups.update;
  chrome.tabGroups.update = async (...args) => {
    await originalUpdate(...args);
    throw new Error("simulated group update failure");
  };

  await assert.rejects(() => applyLastPlan(chrome), /simulated group update failure/);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);

  chrome.tabGroups.update = originalUpdate;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("new-window apply failure after seed move can still undo", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "GitHub issue", url: "https://github.com/acme/repo/issues/1", active: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "OpenAI model docs", url: "https://platform.openai.com/docs/models" }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.NEW_WINDOW,
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE,
    undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.CLOSE_EMPTY_CREATED
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalMove = chrome.tabs.move;
  chrome.tabs.move = async (tabIds, moveProperties) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    if (ids.includes(20)) {
      throw new Error("simulated move failure");
    }
    return originalMove(tabIds, moveProperties);
  };

  await assert.rejects(() => applyLastPlan(chrome, { confirmMultiWindow: true }), /simulated move failure/);

  chrome.tabs.move = originalMove;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  const restoredTab10 = await chrome.tabs.get(10);
  const restoredTab20 = await chrome.tabs.get(20);
  assert.notEqual(restoredTab10.windowId, restoredTab20.windowId);
  assert.equal(restoredTab20.windowId, 2);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.length, 2);
});

test("undo can close an empty target window created by the operation", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true }]
      },
      {
        id: 2,
        tabs: []
      }
    ]
  });

  const rollback = {
    operationId: "op_test",
    undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.CLOSE_EMPTY_CREATED,
    sourceWindows: [
      {
        windowId: 1,
        type: "normal",
        state: "normal",
        activeTabId: 10,
        tabOrder: [10]
      }
    ],
    sourceGroups: [],
    tabs: [{ tabId: 10, windowId: 1, index: 0, pinned: false, active: true, highlighted: false, groupId: -1 }],
    createdWindowIds: [2],
    createdGroupIds: [],
    operationJournal: []
  };

  const result = await undoFromRollback(chrome, rollback);
  assert.deepEqual(result.closedCreatedWindowIds, [2]);
  await assert.rejects(() => chrome.windows.get(2), /No window with id 2/);
});

test("undo restores highlighted tab state", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true, highlighted: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups", highlighted: true }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  await applyLastPlan(chrome);
  await chrome.tabs.update(11, { highlighted: false });

  await undoLastApply(chrome);
  assert.equal((await chrome.tabs.get(10)).highlighted, true);
  assert.equal((await chrome.tabs.get(11)).highlighted, true);
});

test("apply fails instead of silently grouping a partial tab set", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalGet = chrome.tabs.get;
  chrome.tabs.get = async (tabId) => {
    if (tabId === 11) throw new Error("tab disappeared during apply");
    return originalGet(tabId);
  };

  await assert.rejects(() => applyLastPlan(chrome), /tab\(s\) disappeared: 11/);

  chrome.tabs.get = originalGet;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("non-fake planners retry once with validation feedback", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Gateway JSON docs", url: "https://example.com/gateway-json", active: true }]
      }
    ]
  });
  const validPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 10, windowId: 1 }],
    excludedTabs: [],
    groups: [
      {
        groupKey: "api-docs",
        title: "API Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [{ tabId: 10, windowId: 1 }],
        reason: "Gateway API documentation."
      }
    ],
    reviewTabs: []
  };
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 2) {
      assert.match(body.messages[0].content, /Previous planner output failed local validation/);
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(calls === 1 ? { ...validPlan, groups: [], reviewTabs: [] } : validPlan)
              }
            }
          ]
        };
      }
    };
  };

  try {
    const job = await analyzeTabs(
      chrome,
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "test-key" },
      { windowId: 1 }
    );
    assert.equal(calls, 2);
    assert.equal(job.validation.ok, true);
    assert.equal(job.plan.groups.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("active tab page samples are attached to analysis preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Ambiguous", url: "https://example.com/page", active: true }]
      }
    ]
  });

  const job = await analyzeTabs(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.FAKE,
      pageContextMode: PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    { windowId: 1 }
  );

  assert.equal(job.inventory.pageSamples.length, 1);
  assert.equal(job.inventory.pageSamples[0].status, "ok");
  assert.equal(job.inventory.pageSamples[0].sample, undefined);
  assert.equal(job.preview.pageSampling.ok, 1);
  assert.equal(job.preview.pageSampling.requested, 1);

  const storedJob = await getLastJob(chrome);
  assert.equal(JSON.stringify(storedJob).includes("Visible page text"), false);
  assert.equal(storedJob.inventory.pageSamples[0].sample, undefined);
});

test("page sampling timeouts fall back without blocking analysis", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://a.example/*", "https://b.example/*", "https://c.example/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "A", url: "https://a.example/page", active: true },
          { id: 11, title: "B", url: "https://b.example/page" },
          { id: 12, title: "C", url: "https://c.example/page" }
        ]
      }
    ]
  });

  chrome.scripting.executeScript = async ({ target }) => {
    if (target.tabId === 11) return new Promise(() => {});
    return [{ result: { title: `Sample ${target.tabId}`, headings: [], visibleText: "Readable text" } }];
  };
  globalThis.__semanticTabAgentPageSampleTimeoutMs = 10;

  try {
    const job = await analyzeTabs(
      chrome,
      {
        ...FAKE_PLANNER_SETTINGS,
        pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
        pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
      },
      { windowId: 1 }
    );

    assert.equal(job.inventory.pageSamples.length, 3);
    assert.deepEqual(
      job.inventory.pageSamples.map((sample) => sample.tabId),
      [10, 11, 12]
    );
    assert.equal(job.inventory.pageSamples.find((sample) => sample.tabId === 11).status, "blocked");
    assert.match(job.inventory.pageSamples.find((sample) => sample.tabId === 11).reason, /Timed out/);
    assert.equal(job.preview.pageSampling.ok, 2);
    assert.equal(job.preview.pageSampling.blocked, 1);
  } finally {
    delete globalThis.__semanticTabAgentPageSampleTimeoutMs;
  }
});

test("discarded tabs skip page sampling without waking the page", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://a.example/*", "https://b.example/*", "https://c.example/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "A", url: "https://a.example/page", active: true },
          { id: 11, title: "B", url: "https://b.example/page", discarded: true },
          { id: 12, title: "C", url: "https://c.example/page", discarded: true }
        ]
      }
    ]
  });

  const sampledTabIds = [];
  chrome.scripting.executeScript = async ({ target }) => {
    sampledTabIds.push(target.tabId);
    return [{ result: { title: `Sample ${target.tabId}`, headings: [], visibleText: "Readable text" } }];
  };

  const job = await analyzeTabs(
    chrome,
    {
      ...FAKE_PLANNER_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    { windowId: 1 }
  );

  assert.deepEqual(sampledTabIds, [10]);
  assert.deepEqual(
    job.inventory.pageSamples.map((sample) => sample.status),
    ["ok", "discarded", "discarded"]
  );
  assert.equal(job.preview.pageSampling.requested, 3);
  assert.equal(job.preview.pageSampling.ok, 1);
  assert.equal(job.preview.pageSampling.blocked, 2);
});

test("continuous summary cache can enrich analysis without live page sampling", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Cached", url: "https://example.com/project", active: true }]
      }
    ]
  });
  chrome.scripting.executeScript = async () => {
    throw new Error("Live page sampling should not run.");
  };
  await rememberPageSummary(
    chrome,
    { id: 10, title: "Cached", url: "https://example.com/project" },
    {
      status: "ok",
      sample: {
        title: "Cached page",
        metaDescription: "Cached metadata",
        language: "en",
        headings: ["Cached heading"],
        visibleText: "Cached visible text"
      }
    }
  );

  const job = await analyzeTabs(
    chrome,
    {
      ...FAKE_PLANNER_SETTINGS,
      continuousPageSummaries: true,
      pageContextMode: PAGE_CONTEXT_MODES.OFF,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_PERSISTENTLY
    },
    { windowId: 1 }
  );

  assert.equal(job.inventory.pageSamples.length, 1);
  assert.equal(job.inventory.pageSamples[0].reason, "Cached page summary.");
  assert.equal(job.preview.pageSampling.ok, 1);
});

test("live analysis sampling caches incognito summaries only when explicitly enabled", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://private.example/*"],
    windows: [
      {
        id: 1,
        focused: true,
        incognito: true,
        tabs: [{ id: 10, title: "Private research", url: "https://private.example/project", active: true }]
      }
    ]
  });
  chrome.scripting.executeScript = async () => [
    {
      result: {
        title: "Private research summary",
        headings: ["Private heading"],
        visibleText: "Private page details"
      }
    }
  ];

  const job = await analyzeTabs(
    chrome,
    {
      ...FAKE_PLANNER_SETTINGS,
      includeIncognitoTabs: true,
      continuousPageSummaries: true,
      pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_PERSISTENTLY
    },
    { windowId: 1 }
  );

  assert.equal(job.inventory.pageSamples.length, 1);
  assert.equal(job.preview.pageSampling.ok, 1);
  const cache = chrome.__state.storage[STORAGE_KEYS.pageSummaryCache];
  assert.equal(Object.values(cache.entries)[0].sample.title, "Private research summary");
  const activityEntry = Object.values(chrome.__state.storage[STORAGE_KEYS.pageActivityCache].entries)[0];
  assert.equal(activityEntry.lastKnownState.incognito, true);
});

test("canceling during page sampling marks the job canceled immediately", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://example.com/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Ambiguous", url: "https://example.com/page", active: true }]
      }
    ]
  });

  chrome.scripting.executeScript = async () => new Promise(() => {});
  globalThis.__semanticTabAgentPageSampleTimeoutMs = 30_000;

  try {
    const pending = analyzeTabs(
      chrome,
      {
        ...FAKE_PLANNER_SETTINGS,
        pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
        pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
      },
      { windowId: 1 }
    );

    await waitForActiveJob(chrome, (job) => job?.phase === "sampling");
    const cancelResult = await cancelActiveJob(chrome);
    assert.equal(cancelResult.canceled, true);
    assert.equal(cancelResult.job.status, "canceled");
    assert.equal(cancelResult.job.message, "已停止生成。");
    await assert.rejects(pending, /已停止生成/);
    assert.equal((await getActiveJob(chrome)).status, "canceled");
  } finally {
    delete globalThis.__semanticTabAgentPageSampleTimeoutMs;
  }
});

test("active analysis exposes progress and can be canceled", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Gateway planner docs", url: "https://example.com/docs", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  let sawAbortSignal = false;
  globalThis.fetch = async (_url, options) => {
    sawAbortSignal = Boolean(options.signal);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")));
    });
  };

  try {
    const pending = analyzeTabs(
      chrome,
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
      { windowId: 1 }
    );

    await waitForActiveJob(chrome, (job) => job?.phase === "planning" && job.progress >= 40);
    const activeJob = await getActiveJob(chrome);
    assert.equal(activeJob.status, "running");
    assert.equal(sawAbortSignal, true);

    const cancelResult = await cancelActiveJob(chrome);
    assert.equal(cancelResult.canceled, true);
    await assert.rejects(pending, /已停止生成/);

    const canceledJob = await getActiveJob(chrome);
    assert.equal(canceledJob.status, "canceled");
    assert.equal(canceledJob.message, "已停止生成。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("active analysis terminal errors are redacted before storage", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Sensitive gateway docs", url: "https://example.com/docs", active: true }]
      }
    ]
  });
  const providerKey = ["sk", "private", "provider", "token", "1234567890"].join("-");
  const tokenizedUrl = "https://private.example.com/secret/project?token=abc123";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(`gateway failed for ${tokenizedUrl} with Bearer ${providerKey}`);
  };

  try {
    await startAnalyzeTabs(
      chrome,
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
      { windowId: 1 }
    );
    const failedJob = await waitForActiveJob(chrome, (job) => job?.status === "error");
    const serialized = JSON.stringify(failedJob);
    assert.equal(serialized.includes(providerKey), false);
    assert.equal(serialized.includes("token=abc123"), false);
    assert.equal(serialized.includes("private.example.com"), false);
    assert.equal(serialized.includes("/secret/project"), false);
    assert.equal(serialized.includes("Bearer [redacted]"), true);
    assert.equal(serialized.includes("[redacted-url]"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("running analyses are isolated per source window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Window one docs", url: "https://example.com/window-one", active: true }]
      },
      {
        id: 2,
        focused: false,
        tabs: [{ id: 20, title: "Window two docs", url: "https://example.com/window-two", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" };
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")));
    });

  try {
    const first = await startAnalyzeTabs(chrome, settings, { windowId: 1 });
    await waitForWindowActiveJob(chrome, 1, (job) => job?.operationId === first.operationId && job.phase === "planning");

    const second = await startAnalyzeTabs(chrome, settings, { windowId: 2 });
    await waitForWindowActiveJob(chrome, 2, (job) => job?.operationId === second.operationId && job.phase === "planning");

    await assert.rejects(() => startAnalyzeTabs(chrome, settings, { windowId: 1 }), /已有整理任务正在运行/);
    assert.equal((await getActiveJob(chrome, 1)).operationId, first.operationId);
    assert.equal((await getActiveJob(chrome, 2)).operationId, second.operationId);

    await cancelActiveJob(chrome, 1);
    assert.equal((await getActiveJob(chrome, 1)).status, "canceled");
    assert.equal((await getActiveJob(chrome, 2)).status, "running");

    await cancelActiveJob(chrome, 2);
    assert.equal((await getActiveJob(chrome, 2)).status, "canceled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all-window analysis is blocked while a window analysis is running", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Window one docs", url: "https://example.com/window-one", active: true }]
      },
      {
        id: 2,
        focused: false,
        tabs: [{ id: 20, title: "Window two docs", url: "https://example.com/window-two", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" };
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")));
    });

  try {
    const first = await startAnalyzeTabs(chrome, settings, { windowId: 1 });
    await waitForWindowActiveJob(chrome, 1, (job) => job?.operationId === first.operationId && job.phase === "planning");

    await assert.rejects(
      () => startAnalyzeTabs(chrome, { ...settings, organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW }, { windowId: 2 }),
      /已有整理任务正在运行/
    );
    assert.equal((await getActiveJob(chrome, 1)).status, "running");
    assert.equal(await getActiveJob(chrome, 2), null);

    await cancelActiveJob(chrome, 1);
    assert.equal((await getActiveJob(chrome, 1)).status, "canceled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("window analysis is blocked while an all-window analysis is running", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Window one docs", url: "https://example.com/window-one", active: true }]
      },
      {
        id: 2,
        focused: false,
        tabs: [{ id: 20, title: "Window two docs", url: "https://example.com/window-two", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const settings = {
    ...DEFAULT_SETTINGS,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key"
  };
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")));
    });

  try {
    const allWindows = await startAnalyzeTabs(chrome, settings, { windowId: 1 });
    await waitForWindowActiveJob(chrome, 1, (job) => job?.operationId === allWindows.operationId && job.phase === "planning");

    await assert.rejects(
      () => startAnalyzeTabs(chrome, { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" }, { windowId: 2 }),
      /已有整理任务正在运行/
    );
    assert.equal((await getActiveJob(chrome, 1)).status, "running");
    assert.equal(await getActiveJob(chrome, 2), null);

    await cancelActiveJob(chrome, 1);
    assert.equal((await getActiveJob(chrome, 1)).status, "canceled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("startAnalyzeTabs returns immediately while the background job writes final preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups", active: true }]
      }
    ]
  });

  const started = await startAnalyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.match(started.operationId, /^job_/);

  const completeJob = await waitForActiveJob(chrome, (job) => job?.operationId === started.operationId && job.status === "complete");
  assert.equal(completeJob.progress, 100);

  const lastJob = await getLastJob(chrome);
  assert.equal(lastJob.operationId, started.operationId);
  assert.equal(lastJob.validation.ok, true);
  assert.equal(lastJob.preview.groups.length > 0, true);
});

test("gateway analyses create and reuse an anonymous install id", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const requestHeaders = [];
  globalThis.fetch = async (_url, options) => {
    requestHeaders.push(options.headers);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [
                    {
                      groupKey: "chrome-docs",
                      title: "Chrome Docs",
                      color: "blue",
                      confidence: 0.9,
                      tabRefs: [
                        { tabId: 10, windowId: 1 },
                        { tabId: 11, windowId: 1 }
                      ],
                      reason: "Chrome extension documentation."
                    }
                  ],
                  reviewTabs: []
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY };
    await analyzeTabs(chrome, settings, { windowId: 1 });
    const firstInstallId = chrome.__state.storage[STORAGE_KEYS.installId];
    await analyzeTabs(chrome, settings, { windowId: 1 });

    assert.match(firstInstallId, /^install_/);
    assert.equal(chrome.__state.storage[STORAGE_KEYS.installId], firstInstallId);
    assert.equal(requestHeaders.length, 2);
    assert.equal(requestHeaders[0].authorization, undefined);
    assert.equal(requestHeaders[0]["x-tab-recap-install-id"], firstInstallId);
    assert.equal(requestHeaders[1]["x-tab-recap-install-id"], firstInstallId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("progress copy generation uses spark without tab metadata", async () => {
  const chrome = createFakeChrome();
  const originalFetch = globalThis.fetch;
  const messages = Array.from({ length: 12 }, (_, index) => `整理线索${index}`);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.3-codex-spark");
    assert.equal(body.max_tokens, 1200);
    assert.match(body.messages[0].content, /Return strict JSON only/);
    assert.doesNotMatch(options.body, /Chrome tabs API docs|https?:\/\//);
    assert.equal(options.headers["x-tab-recap-install-id"].startsWith("install_"), true);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages }) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await generateProgressCopy(chrome, {
      phase: "planning",
      tabCount: 252,
      windowCount: 4,
      languageMode: "zh-CN"
    });
    assert.equal(result.model, "gpt-5.3-codex-spark");
    assert.deepEqual(result.messages, messages);
    assert.equal(calls[0].url, "https://cliproxy.sylvanyu.io/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("progress copy generation falls back locally without leaking gateway errors", async () => {
  const chrome = createFakeChrome();
  const originalFetch = globalThis.fetch;
  const fakeSkKey = ["sk", "progress", "copy", "token", "1234567890"].join("-");
  const tokenizedUrl = "https://private.example.com/progress/copy?token=abc123";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: `upstream failed for ${tokenizedUrl} with Bearer ${fakeSkKey}`
        }
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );

  try {
    const result = await generateProgressCopy(chrome, {
      phase: "recapping",
      languageMode: "en-US"
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.source, "local_fallback");
    assert.equal(result.model, "gpt-5.3-codex-spark");
    assert.equal(result.messages.length, 90);
    assert.match(result.messages[0], /timeline/i);
    assert.equal(serialized.includes(fakeSkKey), false);
    assert.equal(serialized.includes("token=abc123"), false);
    assert.equal(serialized.includes("/progress/copy"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canceling during preview cannot be overwritten by completion", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });

  const originalSet = chrome.storage.local.set;
  let issuedCancel = false;
  const activeJobKey = `${STORAGE_KEYS.activeJob}:1`;
  chrome.storage.local.set = async (items) => {
    await originalSet(items);
    const activeJob = items[activeJobKey] || items[STORAGE_KEYS.activeJob];
    if (activeJob?.phase === "preview" && !issuedCancel) {
      issuedCancel = true;
      await cancelActiveJob(chrome);
    }
  };

  await startAnalyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  const finalJob = await waitForActiveJob(chrome, (job) => job?.status === "canceled" || job?.status === "complete");

  assert.equal(issuedCancel, true);
  assert.equal(finalJob.status, "canceled");
  assert.equal(finalJob.message, "已停止生成。");
  assert.equal(await getLastJob(chrome), null);
});

test("clearAnalysisState removes terminal previews but preserves running jobs", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });

  await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal((await getActiveJob(chrome))?.status, "complete");
  assert.notEqual(await getLastJob(chrome), null);

  assert.deepEqual(await clearAnalysisState(chrome), { cleared: true });
  assert.equal(await getActiveJob(chrome), null);
  assert.equal(await getLastJob(chrome), null);

  chrome.__state.storage[`${STORAGE_KEYS.activeJob}:1`] = {
    operationId: "running-test",
    status: "running",
    phase: "planning",
    progress: 40,
    message: "正在整理"
  };
  await assert.rejects(() => clearAnalysisState(chrome), /正在整理中/);
  assert.equal(chrome.__state.storage[`${STORAGE_KEYS.activeJob}:1`].status, "running");
});

test("clearAnalysisState only clears the requested window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "React docs", url: "https://react.dev/learn", active: true },
          { id: 11, title: "MDN CSS grid", url: "https://developer.mozilla.org/docs/Web/CSS/CSS_grid_layout" }
        ]
      },
      {
        id: 2,
        tabs: [
          { id: 20, title: "Sailing route notes", url: "https://example.com/sailing", active: true },
          { id: 21, title: "Weather forecast", url: "https://example.com/weather" }
        ]
      }
    ]
  });

  const firstJob = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  const secondJob = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 2 });
  assert.equal((await getActiveJob(chrome, 1))?.operationId, firstJob.operationId);
  assert.equal((await getLastJob(chrome, 1))?.operationId, firstJob.operationId);
  assert.equal((await getActiveJob(chrome, 2))?.operationId, secondJob.operationId);
  assert.equal((await getLastJob(chrome, 2))?.operationId, secondJob.operationId);

  assert.deepEqual(await clearAnalysisState(chrome, 1), { cleared: true });
  assert.equal(await getActiveJob(chrome, 1), null);
  assert.equal(await getLastJob(chrome, 1), null);
  assert.equal((await getActiveJob(chrome, 2))?.operationId, secondJob.operationId);
  assert.equal((await getLastJob(chrome, 2))?.operationId, secondJob.operationId);
});

async function waitForActiveJob(chrome, predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const job = await getActiveJob(chrome);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for active analysis job.");
}

async function waitForWindowActiveJob(chrome, windowId, predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const job = await getActiveJob(chrome, windowId);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for active analysis job in window ${windowId}.`);
}
