import { getSettings, handleRuntimeMessage } from "../core/controller.js";
import { rememberOpenTabActivity, rememberOpenTabsActivity } from "../core/page-activity-cache.js";
import { capturePageSummaryIfAllowed } from "../core/page-summary-cache.js";
import { reconcileTabLifecycle, recordTabClosed, rememberTabLifecycle } from "../core/tab-lifecycle-log.js";

const summaryCaptureTimers = new Map();
const SUMMARY_SWEEP_ALARM = "tabTidy.summarySweep";
const LIFECYCLE_RECONCILE_ALARM = "tabTidy.lifecycleReconcile";
const SUMMARY_SWEEP_PERIOD_MINUTES = 30;
const LIFECYCLE_RECONCILE_PERIOD_MINUTES = 15;
const SUMMARY_CAPTURE_DELAY_MS = 1200;

configureSidePanel();
syncLifecycleReconcileAlarm().catch((error) => console.debug(error));
scheduleLifecycleReconcile();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(chrome, message, sender)
    .then(async (result) => {
      if (message?.type === "settings:save") {
        await syncSummarySweepAlarm().catch((error) => console.debug(error));
        if (result?.continuousPageSummaries) {
          scheduleOpenTabSummarySweep();
        }
      }
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      console.warn(error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

chrome.runtime.onInstalled?.addListener(() => {
  configureSidePanel();
  syncLifecycleReconcileAlarm().catch((error) => console.debug(error));
  scheduleLifecycleReconcile();
  syncSummarySweepAlarm().catch((error) => console.debug(error));
  scheduleOpenTabSummarySweep();
});

chrome.runtime.onStartup?.addListener(() => {
  configureSidePanel();
  syncLifecycleReconcileAlarm().catch((error) => console.debug(error));
  scheduleLifecycleReconcile();
  syncSummarySweepAlarm().catch((error) => console.debug(error));
  scheduleOpenTabSummarySweep();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name === LIFECYCLE_RECONCILE_ALARM) {
    scheduleLifecycleReconcile();
  }
  if (alarm?.name === SUMMARY_SWEEP_ALARM) {
    scheduleOpenTabSummarySweep();
  }
});

chrome.tabs.onActivated?.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => rememberTabLifecycleWithSettings("tab_activated", tab))
    .catch((error) => console.debug(error));
  scheduleSummaryCapture(tabId);
});

chrome.tabs.onCreated?.addListener((tab) => {
  rememberTabLifecycleWithSettings("tab_created", tab).catch((error) => console.debug(error));
});

chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.delete(tabId);
  recordTabClosed(chrome, tabId, removeInfo).catch((error) => console.debug(error));
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete" || changeInfo.title) {
    rememberTabLifecycleWithSettings("tab_updated", tab).catch((error) => console.debug(error));
  }
  if (changeInfo.status === "complete") {
    scheduleSummaryCapture(tabId);
  }
});

chrome.windows.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id) {
      rememberTabLifecycleWithSettings("window_focused", tab).catch((error) => console.debug(error));
      scheduleSummaryCapture(tab.id);
    }
  }).catch((error) => console.debug(error));
});

function configureSidePanel() {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((error) => console.debug(error));
}

function scheduleSummaryCapture(tabId) {
  if (!Number.isInteger(tabId)) return;
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.set(
    tabId,
    setTimeout(() => {
      summaryCaptureTimers.delete(tabId);
      captureSummaryForTab(tabId).catch((error) => console.debug(error));
    }, SUMMARY_CAPTURE_DELAY_MS)
  );
}

async function syncSummarySweepAlarm() {
  if (!chrome.alarms?.create) return;
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) {
    await chrome.alarms.clear?.(SUMMARY_SWEEP_ALARM);
    return;
  }
  await chrome.alarms.create(SUMMARY_SWEEP_ALARM, {
    periodInMinutes: SUMMARY_SWEEP_PERIOD_MINUTES,
    delayInMinutes: 1
  });
}

async function syncLifecycleReconcileAlarm() {
  if (!chrome.alarms?.create) return;
  await chrome.alarms.create(LIFECYCLE_RECONCILE_ALARM, {
    periodInMinutes: LIFECYCLE_RECONCILE_PERIOD_MINUTES,
    delayInMinutes: 1
  });
}

function scheduleLifecycleReconcile() {
  setTimeout(() => {
    reconcileTabLifecycleWithSettings().catch((error) => console.debug(error));
  }, 0);
}

function scheduleOpenTabSummarySweep() {
  setTimeout(() => {
    sweepOpenTabsForSummaries().catch((error) => console.debug(error));
  }, SUMMARY_CAPTURE_DELAY_MS);
}

async function sweepOpenTabsForSummaries() {
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  const tabs = windows.flatMap((window) => window.tabs || []);
  await rememberOpenTabsActivity(chrome, tabs).catch((error) => console.debug(error));
  for (const tab of tabs) {
    if (!tab?.id) continue;
    await capturePageSummaryIfAllowed(chrome, tab, settings).catch((error) => console.debug(error));
  }
}

async function captureSummaryForTab(tabId) {
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  await rememberOpenTabActivity(chrome, tab).catch((error) => console.debug(error));
  await capturePageSummaryIfAllowed(chrome, tab, settings);
}

async function rememberTabLifecycleWithSettings(type, tab) {
  const settings = await getSettings(chrome);
  return rememberTabLifecycle(chrome, type, tab, { includeIncognitoTabs: settings.includeIncognitoTabs });
}

async function reconcileTabLifecycleWithSettings() {
  const settings = await getSettings(chrome);
  return reconcileTabLifecycle(chrome, { includeIncognitoTabs: settings.includeIncognitoTabs });
}
