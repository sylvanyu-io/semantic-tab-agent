import { getSettings, handleRuntimeMessage } from "../core/controller.js";
import { rememberOpenTabActivity, rememberOpenTabsActivity } from "../core/page-activity-cache.js";
import { capturePageSummaryIfAllowed } from "../core/page-summary-cache.js";
import { reconcileTabLifecycle, recordTabClosed, rememberTabLifecycle } from "../core/tab-lifecycle-log.js";
import { redactSensitiveText } from "../shared/redaction.js";

const summaryCaptureTimers = new Map();
const SUMMARY_SWEEP_ALARM = "tabRecap.summarySweep";
const LIFECYCLE_RECONCILE_ALARM = "tabRecap.lifecycleReconcile";
const SUMMARY_SWEEP_PERIOD_MINUTES = 30;
const LIFECYCLE_RECONCILE_PERIOD_MINUTES = 15;
const SUMMARY_CAPTURE_DELAY_MS = 1200;

configureSidePanel();
syncLifecycleReconcileAlarm().catch((error) => logBackgroundError("lifecycle_reconcile_alarm_sync", error));
scheduleLifecycleReconcile();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(chrome, message, sender)
    .then(async (result) => {
      if (message?.type === "settings:save") {
        await syncSummarySweepAlarm().catch((error) => logBackgroundError("summary_sweep_alarm_sync", error));
        if (result?.continuousPageSummaries && contentAccessFeatureAvailable()) {
          scheduleOpenTabSummarySweep();
        }
      }
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      const safeError = sanitizeBackgroundErrorMessage(error);
      logBackgroundError("runtime_message", error);
      sendResponse({ ok: false, error: safeError });
    });

  return true;
});

chrome.runtime.onInstalled?.addListener(() => {
  configureSidePanel();
  syncLifecycleReconcileAlarm().catch((error) => logBackgroundError("lifecycle_reconcile_alarm_sync", error));
  scheduleLifecycleReconcile();
  syncSummarySweepAlarm().catch((error) => logBackgroundError("summary_sweep_alarm_sync", error));
  scheduleOpenTabSummarySweep();
});

chrome.runtime.onStartup?.addListener(() => {
  configureSidePanel();
  syncLifecycleReconcileAlarm().catch((error) => logBackgroundError("lifecycle_reconcile_alarm_sync", error));
  scheduleLifecycleReconcile();
  syncSummarySweepAlarm().catch((error) => logBackgroundError("summary_sweep_alarm_sync", error));
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
    .catch((error) => logBackgroundError("tab_activated", error));
  scheduleSummaryCapture(tabId);
});

chrome.tabs.onCreated?.addListener((tab) => {
  rememberTabLifecycleWithSettings("tab_created", tab).catch((error) => logBackgroundError("tab_created", error));
});

chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.delete(tabId);
  recordTabClosed(chrome, tabId, removeInfo).catch((error) => logBackgroundError("tab_removed", error));
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete" || changeInfo.title) {
    rememberTabLifecycleWithSettings("tab_updated", tab).catch((error) => logBackgroundError("tab_updated", error));
  }
  if (changeInfo.status === "complete") {
    scheduleSummaryCapture(tabId);
  }
});

chrome.windows.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id) {
      rememberTabLifecycleWithSettings("window_focused", tab).catch((error) => logBackgroundError("window_focused", error));
      scheduleSummaryCapture(tab.id);
    }
  }).catch((error) => logBackgroundError("window_focus_query", error));
});

function configureSidePanel() {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((error) => logBackgroundError("side_panel_configure", error));
}

function scheduleSummaryCapture(tabId) {
  if (!contentAccessFeatureAvailable()) return;
  if (!Number.isInteger(tabId)) return;
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.set(
    tabId,
    setTimeout(() => {
      summaryCaptureTimers.delete(tabId);
      captureSummaryForTab(tabId).catch((error) => logBackgroundError("summary_capture", error));
    }, SUMMARY_CAPTURE_DELAY_MS)
  );
}

async function syncSummarySweepAlarm() {
  if (!chrome.alarms?.create) return;
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries || !contentAccessFeatureAvailable()) {
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
    reconcileTabLifecycleWithSettings().catch((error) => logBackgroundError("lifecycle_reconcile", error));
  }, 0);
}

function scheduleOpenTabSummarySweep() {
  if (!contentAccessFeatureAvailable()) return;
  setTimeout(() => {
    sweepOpenTabsForSummaries().catch((error) => logBackgroundError("summary_sweep", error));
  }, SUMMARY_CAPTURE_DELAY_MS);
}

async function sweepOpenTabsForSummaries() {
  if (!contentAccessFeatureAvailable()) return;
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  const tabs = windows.flatMap((window) => window.tabs || []);
  await rememberOpenTabsActivity(chrome, tabs, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch((error) =>
    logBackgroundError("open_tabs_activity", error)
  );
  for (const tab of tabs) {
    if (!tab?.id) continue;
    await capturePageSummaryIfAllowed(chrome, tab, settings).catch((error) => logBackgroundError("summary_sweep_tab", error));
  }
}

async function captureSummaryForTab(tabId) {
  if (!contentAccessFeatureAvailable()) return;
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  await rememberOpenTabActivity(chrome, tab, null, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch((error) =>
    logBackgroundError("open_tab_activity", error)
  );
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

function contentAccessFeatureAvailable() {
  const manifest = chrome.runtime?.getManifest?.();
  if (!manifest) return true;
  return Boolean(
    (manifest.optional_permissions || []).includes("scripting") &&
      (manifest.optional_host_permissions || []).some((origin) => origin === "https://*/*" || origin === "http://*/*")
  );
}

function logBackgroundError(source, error) {
  const message = sanitizeBackgroundErrorMessage(error);
  console.debug(JSON.stringify({ event: "tab_recap_background_error", source, message }));
}

function sanitizeBackgroundErrorMessage(error) {
  return redactBackgroundErrorString(error?.message || error || "Background operation failed.");
}

function redactBackgroundErrorString(value) {
  return redactSensitiveText(value).slice(0, 500);
}
