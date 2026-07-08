import {
  BUILTIN_GATEWAY_BASE_URL,
  DEFAULT_SETTINGS,
  ORGANIZE_MODES,
  PAGE_CONTEXT_MODES,
  PLANNER_PROVIDERS,
  TARGET_WINDOW_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { localizedText } from "../shared/language.js";
import { shouldShowPageSampleCount } from "../shared/page-sampling-copy.js";
import { redactSensitiveText } from "../shared/redaction.js";
import { applyValidatedPlan, createRollbackSnapshot, undoFromRollback } from "./chrome-executor.js";
import { getActivityOverview, rememberOpenTabsActivity } from "./page-activity-cache.js";
import { cachedPageSamplesForTabs, rememberPageSummary } from "./page-summary-cache.js";
import { requestPageSample } from "./page-sampler.js";
import { reconcileTabLifecycle, rememberTabsLifecycle } from "./tab-lifecycle-log.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { testGatewayConnection } from "./gateway-planner.js";
import { createPlan } from "./planner.js";
import { normalizePlanForSettings } from "./plan-normalizer.js";
import { buildPreview } from "./preview.js";
import { STORAGE_KEYS, getLocal, removeLocal, setLocal } from "./storage.js";
import { collectTabInventory } from "./tab-inventory.js";
import { TIME_RECAP_GATEWAY_TIMEOUT_MS, generateTimeRecap } from "./time-recap.js";
import { buildEvidenceSnapshot } from "./evidence-snapshot.js";
import { validatePlan } from "./plan-validator.js";

const activeAnalyses = new Map();
const activeTimeRecaps = new Map();
let browserMutationQueue = Promise.resolve();
const ACTIVE_JOB_TERMINAL_STATUSES = new Set(["complete", "canceled", "error"]);
const APPLY_REBASE_MAX_CHANGED_TABS = 25;
const APPLY_REBASE_MAX_CHANGED_RATIO = 0.2;
const PROGRESS_COPY_MODEL = "gpt-5.3-codex-spark";
const PROGRESS_COPY_COUNT = 90;
const PROGRESS_COPY_MAX_LENGTH = 18;
const PROGRESS_COPY_TIMEOUT_MS = 12_000;
const PAGE_SAMPLE_CONCURRENCY = 6;
const PAGE_SAMPLE_TIMEOUT_MS = 1800;
const CLEANUP_ACTIVITY_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_MEMORY_KEYS = Object.freeze([
  STORAGE_KEYS.pageActivityCache,
  STORAGE_KEYS.pageSummaryCache,
  STORAGE_KEYS.tabLifecycleLog
]);

function scopedStorageKey(baseKey, windowId) {
  return `${baseKey}:${normalizeWindowScope(windowId)}`;
}

function normalizeWindowScope(windowId) {
  return Number.isInteger(windowId) && windowId > 0 ? String(windowId) : "global";
}

async function resolveStateWindowId(chromeApi, requestedWindowId = null) {
  if (Number.isInteger(requestedWindowId) && requestedWindowId > 0) {
    return requestedWindowId;
  }

  if (chromeApi.tabs?.query) {
    const activeTabs = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const [activeTab] = activeTabs || [];
    if (Number.isInteger(activeTab?.windowId)) {
      return activeTab.windowId;
    }
  }

  if (chromeApi.windows?.getCurrent) {
    const currentWindow = await chromeApi.windows.getCurrent().catch(() => null);
    if (Number.isInteger(currentWindow?.id)) {
      return currentWindow.id;
    }
  }

  return null;
}

async function getScopedLocal(chromeApi, baseKey, windowId, fallback = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  if (!Number.isInteger(resolvedWindowId)) return fallback;
  return getLocal(chromeApi, scopedStorageKey(baseKey, resolvedWindowId), fallback);
}

async function setScopedLocal(chromeApi, baseKey, windowId, value) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  if (!Number.isInteger(resolvedWindowId)) {
    throw new Error("Unable to resolve the current window for this operation.");
  }
  return setLocal(chromeApi, scopedStorageKey(baseKey, resolvedWindowId), value);
}

async function removeScopedLocal(chromeApi, baseKey, windowId) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  if (!Number.isInteger(resolvedWindowId)) return;
  await removeLocal(chromeApi, scopedStorageKey(baseKey, resolvedWindowId));
}

export async function handleRuntimeMessage(chromeApi, message) {
  switch (message?.type) {
    case "settings:get":
      return getSettings(chromeApi);
    case "settings:save":
      return saveSettings(chromeApi, message.settings);
    case "tabs:startAnalyze":
      return startAnalyzeTabs(chromeApi, message.settings, { windowId: message.windowId }, message.persistedSettings);
    case "tabs:analyze":
      return analyzeTabs(chromeApi, message.settings, { windowId: message.windowId }, message.persistedSettings);
    case "tabs:getActiveJob":
      return getActiveJob(chromeApi, message.windowId);
    case "tabs:getLastJob":
      return getLastJob(chromeApi, message.windowId);
    case "tabs:clearAnalysisState":
      return clearAnalysisState(chromeApi, message.windowId);
    case "tabs:cancelActiveJob":
      return cancelActiveJob(chromeApi, message.windowId);
    case "progressCopy:generate":
      return generateProgressCopy(chromeApi, message);
    case "gateway:testConnection":
      return testGatewayConnection(message.settings || {}, globalThis.fetch, { timeoutMs: message.timeoutMs || 15_000 });
    case "activity:getOverview": {
      const settings = await getSettings(chromeApi);
      await reconcileTabLifecycle(chromeApi, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch(() => null);
      return getActivityOverview(chromeApi, { rangeMs: message.rangeMs, includeIncognitoTabs: settings.includeIncognitoTabs });
    }
    case "activity:clearLocalMemory":
      return clearLocalActivityMemory(chromeApi);
    case "diagnostics:getSnapshot":
      return getDiagnosticsSnapshot(chromeApi);
    case "activity:getEvidenceSnapshot":
      return getEvidenceSnapshotForMessage(chromeApi, message);
    case "activity:generateTimeRecap":
      return generateTimeRecapForMessage(chromeApi, message);
    case "activity:cancelTimeRecap":
      return cancelTimeRecap(chromeApi, message);
    case "activity:focusTab":
      return focusActivityTab(chromeApi, message);
    case "tabs:closeCleanupCandidates":
      return closeCleanupCandidates(chromeApi, message);
    case "tabs:applyLastPlan":
      return applyLastPlan(chromeApi, {
        windowId: message.windowId,
        confirmChangedTabs: Boolean(message.confirmChangedTabs),
        confirmationToken: message.confirmationToken || "",
        confirmMultiWindow: Boolean(message.confirmMultiWindow)
      });
    case "tabs:canUndo":
      return canUndoLastApply(chromeApi, message.windowId);
    case "tabs:undoLastApply":
      return undoLastApply(chromeApi, message.windowId);
    default:
      throw new Error(`Unknown message type: ${message?.type || "<missing>"}`);
  }
}

async function clearLocalActivityMemory(chromeApi) {
  const before = await chromeApi.storage.local.get(LOCAL_MEMORY_KEYS);
  const removedKeys = LOCAL_MEMORY_KEYS.filter((key) => before[key] !== undefined);
  await removeLocal(chromeApi, LOCAL_MEMORY_KEYS);
  return {
    cleared: true,
    removedKeys,
    removedCount: removedKeys.length
  };
}

async function getDiagnosticsSnapshot(chromeApi) {
  const [settings, storage] = await Promise.all([
    getSettings(chromeApi),
    chromeApi.storage.local.get(null)
  ]);
  const manifest = chromeApi.runtime?.getManifest?.();
  return {
    schema: "tabrecap_diagnostics_v1",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: "TabRecap",
    extensionVersion: manifest?.version || "",
    settings: summarizeDiagnosticSettings(settings),
    localMemory: summarizeLocalMemory(storage),
    jobs: {
      active: summarizeScopedStoredItems(storage, STORAGE_KEYS.activeJob, summarizeStoredJob),
      last: summarizeScopedStoredItems(storage, STORAGE_KEYS.lastJob, summarizeStoredJob),
      rollback: summarizeScopedStoredItems(storage, STORAGE_KEYS.lastRollback, summarizeRollback)
    },
    storage: summarizeStorageKeys(storage)
  };
}

function summarizeDiagnosticSettings(settings) {
  const normalized = normalizeSettings(settings);
  const gatewayBaseUrl =
    normalized.gatewayProviderMode === "builtin"
      ? BUILTIN_GATEWAY_BASE_URL
      : normalized.gatewayBaseUrl;
  return {
    languageMode: normalized.languageMode,
    organizeMode: normalized.organizeMode,
    promptPreset: normalized.promptPreset,
    groupingGranularity: normalized.groupingGranularity,
    analyzeGrouping: normalized.analyzeGrouping,
    analyzeCleanup: normalized.analyzeCleanup,
    pageContextMode: normalized.pageContextMode,
    hostPermissionRequestMode: normalized.hostPermissionRequestMode,
    continuousPageSummaries: normalized.continuousPageSummaries,
    urlPrivacyMode: normalized.urlPrivacyMode,
    includePinnedTabs: normalized.includePinnedTabs,
    includeIncognitoTabs: normalized.includeIncognitoTabs,
    collapseGroupsAfterApply: normalized.collapseGroupsAfterApply,
    existingGroupMode: normalized.existingGroupMode,
    reviewGroupMode: normalized.reviewGroupMode,
    plannerProvider: normalized.plannerProvider,
    gatewayProviderMode: normalized.gatewayProviderMode,
    gatewayHost: safeDiagnosticHost(gatewayBaseUrl),
    gatewayPathConfigured: hasDiagnosticPath(gatewayBaseUrl),
    gatewayModel: normalized.gatewayModel,
    gatewayAuxiliaryModel: normalized.gatewayAuxiliaryModel,
    customModelConfigured: Boolean(normalized.gatewayCustomModel),
    customAuxiliaryModelConfigured: Boolean(normalized.gatewayCustomAuxiliaryModel),
    gatewayThinkingIntensity: normalized.gatewayThinkingIntensity,
    customKeyPresent: Boolean(normalized.gatewayApiKey),
    rememberProviderKeys: normalized.rememberProviderKeys
  };
}

function summarizeLocalMemory(storage) {
  const activityEntries = Object.keys(storage[STORAGE_KEYS.pageActivityCache]?.entries || {});
  const summaryEntries = Object.keys(storage[STORAGE_KEYS.pageSummaryCache]?.entries || {});
  const lifecycleSessions = Object.keys(storage[STORAGE_KEYS.tabLifecycleLog]?.sessions || {});
  const lifecycleEvents = Array.isArray(storage[STORAGE_KEYS.tabLifecycleLog]?.events)
    ? storage[STORAGE_KEYS.tabLifecycleLog].events
    : [];
  return {
    pageActivityEntries: activityEntries.length,
    pageSummaryEntries: summaryEntries.length,
    tabLifecycleSessions: lifecycleSessions.length,
    tabLifecycleEvents: lifecycleEvents.length
  };
}

function summarizeScopedStoredItems(storage, baseKey, summarizeValue) {
  return Object.entries(storage)
    .filter(([key]) => key === baseKey || key.startsWith(`${baseKey}:`))
    .map(([key, value]) => ({
      scope: diagnosticScopeFromKey(key, baseKey),
      ...summarizeValue(value)
    }))
    .sort((left, right) => String(left.scope).localeCompare(String(right.scope)));
}

function summarizeStoredJob(job = {}) {
  return {
    status: safeDiagnosticString(job.status, 40),
    phase: safeDiagnosticString(job.phase, 60),
    progress: typeof job.progress === "number" ? Math.max(0, Math.min(100, Math.round(job.progress))) : null,
    createdAt: safeDiagnosticIso(job.createdAt),
    updatedAt: safeDiagnosticIso(job.updatedAt),
    finishedAt: safeDiagnosticIso(job.finishedAt),
    operationIdPresent: Boolean(job.operationId),
    errorKind: classifyDiagnosticError(job.error)
  };
}

function summarizeRollback(rollback = {}) {
  const tabIds = Array.isArray(rollback.tabs) ? rollback.tabs : [];
  const groups = Array.isArray(rollback.groups) ? rollback.groups : [];
  return {
    createdAt: safeDiagnosticIso(rollback.createdAt),
    tabCount: tabIds.length,
    groupCount: groups.length
  };
}

function summarizeStorageKeys(storage) {
  const keys = Object.keys(storage || {});
  const knownPrefixes = Object.values(STORAGE_KEYS);
  return {
    totalKeys: keys.length,
    knownKeys: keys.filter((key) => knownPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))).length,
    unknownKeys: keys.filter((key) => !knownPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))).length
  };
}

function diagnosticScopeFromKey(key, baseKey) {
  if (key === baseKey) return "legacy";
  return key.slice(baseKey.length + 1) || "unknown";
}

function classifyDiagnosticError(error) {
  const text = String(error || "");
  if (!text) return "";
  if (/timed?\s*out|timeout/i.test(text)) return "timeout";
  if (/\b(530|1033)\b|cloudflare|tunnel/i.test(text)) return "cloudflare_or_tunnel";
  if (/\b(401|403)\b|unauthorized|forbidden|api key|auth/i.test(text)) return "auth";
  if (/invalid\s+json|unexpected token|not valid json|json/i.test(text)) return "invalid_json";
  if (/model.*(unavailable|unsupported|not available)|unsupported.*model/i.test(text)) return "unsupported_model";
  if (/cancel|abort/i.test(text)) return "canceled";
  return "other";
}

function safeDiagnosticHost(rawUrl) {
  try {
    return new URL(rawUrl || "").hostname;
  } catch {
    return "";
  }
}

function hasDiagnosticPath(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    return Boolean(url.pathname && url.pathname !== "/");
  } catch {
    return false;
  }
}

function safeDiagnosticString(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function safeDiagnosticIso(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

async function getEvidenceSnapshotForMessage(chromeApi, message = {}) {
  const settings = normalizeSettings({
    ...(await getSettings(chromeApi)),
    ...(message.settings || {}),
    languageMode: message.languageMode || message.settings?.languageMode
  });
  await reconcileTabLifecycle(chromeApi, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch(() => null);
  return buildEvidenceSnapshot(chromeApi, settings, {
    range: message.range || {},
    windowId: message.windowId,
    strictWindowId: Boolean(message.strictWindowId),
    includePrivateFields: Boolean(message.includePrivateFields)
  });
}

async function generateTimeRecapForMessage(chromeApi, message = {}) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, message.windowId);
  const scope = normalizeWindowScope(resolvedWindowId);
  const operationId = message.operationId || createOperationId();
  const abortController = new AbortController();
  const previousRecap = activeTimeRecaps.get(scope);
  previousRecap?.abortController?.abort();
  activeTimeRecaps.set(scope, { operationId, abortController });

  let settings = normalizeSettings(message.settings || {});
  try {
    const storedSettings = await getSettings(chromeApi);
    settings = normalizeSettings({
      ...storedSettings,
      ...(message.settings || {}),
      languageMode: message.languageMode || message.settings?.languageMode || storedSettings.languageMode
    });
    await reconcileTabLifecycle(chromeApi, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch(() => null);

    const requestedTimeoutMs = Number(message.timeoutMs);
    const options = {
      range: message.range || {},
      signal: abortController.signal,
      operationId,
      timeoutMs: Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
        ? requestedTimeoutMs
        : TIME_RECAP_GATEWAY_TIMEOUT_MS
    };
    if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
      options.installId = await getOrCreateInstallId(chromeApi);
    }
    return await generateTimeRecap(chromeApi, settings, options);
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(localizedText(settings.languageMode, "已停止生成回顾。", "Recap generation stopped."));
    }
    throw error;
  } finally {
    const active = activeTimeRecaps.get(scope);
    if (active?.operationId === operationId) activeTimeRecaps.delete(scope);
  }
}

async function cancelTimeRecap(chromeApi, message = {}) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, message.windowId);
  const scope = normalizeWindowScope(resolvedWindowId);
  const active = activeTimeRecaps.get(scope);
  if (!active || (message.operationId && active.operationId !== message.operationId)) {
    return { canceled: false };
  }
  active.abortController.abort();
  activeTimeRecaps.delete(scope);
  return { canceled: true, operationId: active.operationId };
}

async function focusActivityTab(chromeApi, message = {}) {
  const tabId = Number(message.tabId);
  const languageMode = message.languageMode || "zh-CN";
  if (!Number.isInteger(tabId)) {
    throw new Error(localizedText(languageMode, "找不到这个标签页。请刷新清理建议。", "This tab cannot be found. Refresh cleanup suggestions."));
  }
  const tab = await chromeApi.tabs?.get?.(tabId).catch(() => null);
  if (!tab) {
    throw new Error(localizedText(languageMode, "这个标签页已经关闭。请刷新清理建议。", "This tab has already been closed. Refresh cleanup suggestions."));
  }
  await chromeApi.windows?.update?.(tab.windowId, { focused: true }).catch(() => null);
  await chromeApi.tabs?.update?.(tabId, { active: true });
  return { focused: true, tabId, windowId: tab.windowId };
}

export async function closeCleanupCandidates(chromeApi, message = {}) {
  return enqueueBrowserMutation(() => closeCleanupCandidatesLocked(chromeApi, message));
}

async function closeCleanupCandidatesLocked(chromeApi, message = {}) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, message.windowId);
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId);
  if (!job?.preview) {
    throw new Error(localizedText(message.languageMode || "zh-CN", "还没有可清理的方案，请先生成方案。", "Generate a plan before closing cleanup candidates."));
  }

  const requestedIds = uniqueNumbers(asArray(message.tabIds).map((value) => Number(value)));
  if (!requestedIds.length) {
    throw new Error(localizedText(message.languageMode || "zh-CN", "这个标签页现在无法关闭，请重新生成后再试。", "This tab cannot be closed right now. Regenerate the plan and try again."));
  }

  const candidateIds = new Set((job.plan?.cleanup?.candidates || job.preview?.cleanup?.candidates || []).map((tab) => tab.tabId));
  const allowedIds = requestedIds.filter((tabId) => candidateIds.has(tabId));
  if (!allowedIds.length) {
    throw new Error(localizedText(message.languageMode || "zh-CN", "这些标签页不在清理建议里，请重新生成。", "These tabs are not in the cleanup suggestions. Regenerate the plan."));
  }

  const existingIds = [];
  const skippedIds = [];
  const liveTabs = await Promise.all(allowedIds.map((tabId) => chromeApi.tabs?.get?.(tabId).catch(() => null)));
  for (const [position, tabId] of allowedIds.entries()) {
    const tab = liveTabs[position];
    if (!tab) {
      skippedIds.push(tabId);
      continue;
    }
    if (Number.isInteger(message.windowId) && job.settings?.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW && tab.windowId !== resolvedWindowId) {
      skippedIds.push(tabId);
      continue;
    }
    existingIds.push(tabId);
  }

  if (existingIds.length) {
    await chromeApi.tabs?.remove?.(existingIds);
  }

  const removedIds = [...existingIds, ...skippedIds];
  const updatedJob = removeTabsFromStoredJob(job, removedIds);
  const storedJob = sanitizeJobForStorage(updatedJob);
  await setScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId, storedJob);
  return {
    closedTabIds: existingIds,
    skippedTabIds: skippedIds,
    preview: storedJob.preview,
    validation: storedJob.validation
  };
}

function removeTabsFromStoredJob(job, tabIds) {
  const removeIds = new Set(uniqueNumbers(tabIds));
  if (!removeIds.size) return job;
  const inventory = filterInventoryTabs(job.inventory, removeIds);
  const plan = filterPlanTabs(job.plan, removeIds);
  return normalizeStoredJobForPreview({
    ...job,
    inventory,
    plan
  });
}

function filterInventoryTabs(inventory = {}, removeIds) {
  const keepTab = (tab) => !removeIds.has(tab?.tabId);
  return {
    ...inventory,
    tabs: (inventory.tabs || []).filter(keepTab),
    plannerTabs: (inventory.plannerTabs || []).filter(keepTab),
    excludedTabs: (inventory.excludedTabs || []).filter(keepTab),
    lockedGroups: (inventory.lockedGroups || [])
      .map((group) => ({
        ...group,
        tabIds: (group.tabIds || []).filter((tabId) => !removeIds.has(tabId))
      }))
      .filter((group) => group.tabIds.length),
    pageSamples: (inventory.pageSamples || []).filter((sample) => !removeIds.has(sample.tabId))
  };
}

function filterPlanTabs(plan = {}, removeIds) {
  const keepRef = (ref) => !removeIds.has(ref?.tabId);
  return {
    ...plan,
    eligibleTabs: (plan.eligibleTabs || []).filter(keepRef),
    excludedTabs: (plan.excludedTabs || []).filter(keepRef),
    groups: (plan.groups || [])
      .map((group) => ({
        ...group,
        tabRefs: (group.tabRefs || []).filter(keepRef)
      }))
      .filter((group) => group.tabRefs.length),
    reviewTabs: (plan.reviewTabs || []).filter(keepRef),
    cleanup: plan.cleanup
      ? {
          ...plan.cleanup,
          candidates: (plan.cleanup.candidates || []).filter((candidate) => !removeIds.has(candidate.tabId))
        }
      : plan.cleanup
  };
}

function createLocalCleanupAnalysis(inventory, overview, settings) {
  const plannerIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  const candidates = (overview.staleTabs || [])
    .filter((tab) => plannerIds.has(tab.tabId))
    .slice(0, 12)
    .map((tab) => ({
      ...tab,
      priority: tab.ageMs >= 30 * 24 * 60 * 60 * 1000 || tab.idleMs >= 14 * 24 * 60 * 60 * 1000 ? "high" : "medium",
      reason: localizedText(
        settings.languageMode,
        "它已经较久没有活跃，可能是上一个阶段留下来的页面。",
        "It has been inactive for a while and may belong to an earlier task."
      ),
      evidence: [
        localizedText(settings.languageMode, `首次见到 ${formatDaysForCleanup(tab.ageMs)}`, `First seen ${formatDaysForCleanup(tab.ageMs)}`),
        localizedText(settings.languageMode, `最近活跃 ${formatDaysForCleanup(tab.idleMs)}`, `Last active ${formatDaysForCleanup(tab.idleMs)}`)
      ]
    }));
  return {
    schema: "tab_recap_cleanup_v1",
    summary: localizedText(
      settings.languageMode,
      `找到 ${candidates.length} 个可以先检查的标签页。`,
      `Found ${candidates.length} tabs worth reviewing first.`
    ),
    candidates
  };
}

function formatDaysForCleanup(ms) {
  const days = Math.max(0, Math.round(Number(ms || 0) / (24 * 60 * 60 * 1000)));
  return `${days}d`;
}

export async function getSettings(chromeApi) {
  return normalizeSettings(await getLocal(chromeApi, STORAGE_KEYS.settings, DEFAULT_SETTINGS));
}

export async function saveSettings(chromeApi, nextSettings) {
  const settings = normalizeSettings(nextSettings);
  await setLocal(chromeApi, STORAGE_KEYS.settings, settingsForPersistence(settings));
  return settings;
}

export async function analyzeTabs(chromeApi, rawSettings, invocation = {}, persistedSettings = null) {
  const { operationId, abortController, windowId } = await createActiveAnalysis(chromeApi, rawSettings, invocation);
  return runActiveAnalysis(chromeApi, rawSettings, { ...invocation, windowId }, operationId, abortController, persistedSettings, windowId);
}

export async function startAnalyzeTabs(chromeApi, rawSettings, invocation = {}, persistedSettings = null) {
  const { operationId, abortController, windowId } = await createActiveAnalysis(chromeApi, rawSettings, invocation);
  runActiveAnalysis(chromeApi, rawSettings, { ...invocation, windowId }, operationId, abortController, persistedSettings, windowId).catch(() => {});
  return { operationId };
}

async function createActiveAnalysis(chromeApi, rawSettings, invocation = {}) {
  const windowId = await resolveStateWindowId(chromeApi, invocation.windowId);
  await assertNoRunningAnalysis(chromeApi, windowId);
  const operationId = createOperationId();
  const abortController = new AbortController();
  activeAnalyses.set(normalizeWindowScope(windowId), { operationId, abortController });
  await writeActiveJob(chromeApi, {
    operationId,
    status: "running",
    phase: "starting",
    progress: 1,
    message: "正在准备整理",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: redactSettingsForJob(normalizeSettings(rawSettings)),
    invocation: { ...invocation, windowId }
  }, windowId);

  return { operationId, abortController, windowId };
}

async function runActiveAnalysis(chromeApi, rawSettings, invocation, operationId, abortController, persistedSettings = null, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId ?? invocation.windowId);
  const reportProgress = (patch) => updateActiveJob(chromeApi, operationId, patch, resolvedWindowId);

  try {
    await reportProgress({ phase: "settings", progress: 4, message: "正在保存偏好" });
    await saveSettings(chromeApi, persistedSettings || rawSettings);
    const settings = normalizeSettings(rawSettings);
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "inventory", progress: 10, message: "正在读取标签页" });
    const inventory = await collectTabInventory(chromeApi, settings, invocation);
    if (inventory.tabs?.length) {
      await Promise.allSettled([
        rememberOpenTabsActivity(chromeApi, inventory.tabs || [], { includeIncognitoTabs: settings.includeIncognitoTabs }),
        rememberTabsLifecycle(chromeApi, inventory.tabs || [], { includeIncognitoTabs: settings.includeIncognitoTabs })
      ]);
    }
    await reportProgress({
      phase: "inventory",
      progress: 16,
      message: `已读取 ${inventory.plannerTabs?.length || 0} 个可整理标签页`,
      tabCount: inventory.plannerTabs?.length || 0,
      windowCount: inventory.windows?.length || 0
    });
    throwIfCanceled(abortController.signal);

    await attachPageSamples(chromeApi, inventory, settings, {
      signal: abortController.signal,
      onProgress: reportProgress
    });
    throwIfCanceled(abortController.signal);

    const activityOverview = settings.analyzeCleanup
      ? await collectCleanupActivityOverview(chromeApi, settings, CLEANUP_ACTIVITY_RANGE_MS)
      : null;
    throwIfCanceled(abortController.signal);

    const planOptions = {
      signal: abortController.signal,
      onProgress: reportProgress,
      activityOverview,
      operationId
    };
    if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
      planOptions.installId = await getOrCreateInstallId(chromeApi);
    }

    await reportProgress({ phase: "planning", progress: 40, message: "正在生成 AI 方案" });
    const { plan, validation } = await createValidatedPlan(inventory, settings, {
      ...planOptions
    });
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "preview", progress: 96, message: "正在生成预览" });
    throwIfCanceled(abortController.signal);
    const preview = buildPreview(plan, inventory, validation, settings);
    throwIfCanceled(abortController.signal);
    const jobSettings = redactSettingsForJob(settings);
    const job = {
      operationId,
      createdAt: new Date().toISOString(),
      settings: jobSettings,
      invocation,
      inventory,
      plan,
      validation,
      preview
    };

    const storedJob = sanitizeJobForStorage(job);
    await setScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId, storedJob);
    await reportProgress({
      status: "complete",
      phase: "complete",
      progress: 100,
      message: validation?.ok ? "方案好了，可以先检查" : "方案需要检查",
      finishedAt: new Date().toISOString()
    });
    return storedJob;
  } catch (error) {
    const canceled = abortController.signal.aborted;
    const message = canceled ? "已停止生成。" : error.message;
    await reportProgress({
      status: canceled ? "canceled" : "error",
      phase: canceled ? "canceled" : "error",
      message,
      error: canceled ? "" : error.message,
      finishedAt: new Date().toISOString()
    });
    throw new Error(message);
  } finally {
    activeAnalyses.delete(normalizeWindowScope(resolvedWindowId));
  }
}

export async function getLastJob(chromeApi, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId);
  if (!job) return null;
  const normalizedJob = normalizeStoredJobForPreview(job);
  if (JSON.stringify(normalizedJob) !== JSON.stringify(sanitizeJobForStorage(job))) {
    await setScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId, normalizedJob);
  }
  return normalizedJob;
}

export async function clearAnalysisState(chromeApi, windowId = null) {
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.activeJob, windowId);
  if (job && !ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    throw new Error("正在整理中，不能清空当前方案。");
  }
  await removeScopedLocal(chromeApi, STORAGE_KEYS.activeJob, windowId);
  await removeScopedLocal(chromeApi, STORAGE_KEYS.lastJob, windowId);
  return { cleared: true };
}

export async function getActiveJob(chromeApi, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.activeJob, resolvedWindowId);
  if (!job) return null;
  const activeAnalysis = activeAnalyses.get(normalizeWindowScope(resolvedWindowId));
  if ((job.status === "running" || job.status === "canceling") && activeAnalysis?.operationId !== job.operationId) {
    return writeActiveJob(chromeApi, {
      ...job,
      status: job.status === "canceling" ? "canceled" : "error",
      phase: job.status === "canceling" ? "canceled" : "error",
      message: job.status === "canceling" ? "已停止生成。" : "后台任务已停止，请重新生成。",
      error: job.status === "canceling" ? "" : "The background worker no longer has this active analysis.",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, resolvedWindowId);
  }
  return job;
}

export async function cancelActiveJob(chromeApi, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.activeJob, resolvedWindowId);
  if (!job || ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    return { canceled: false, job: job || null };
  }

  const controller = activeAnalyses.get(normalizeWindowScope(resolvedWindowId))?.abortController;
  const nextJob = await writeActiveJob(chromeApi, {
    ...job,
    status: "canceled",
    phase: "canceled",
    message: "已停止生成。",
    error: "",
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, resolvedWindowId);
  controller?.abort();
  return { canceled: Boolean(controller), job: nextJob };
}

export async function generateProgressCopy(chromeApi, request = {}) {
  const activeJob = await getActiveJob(chromeApi, request.windowId);
  const installId = await getOrCreateInstallId(chromeApi);
  const languageMode = normalizeProgressLanguage(request.languageMode || activeJob?.settings?.languageMode);
  const phase = String(request.phase || activeJob?.phase || "planning");
  if (typeof fetch !== "function") {
    return localProgressCopyResult(languageMode, phase);
  }

  const body = {
    model: PROGRESS_COPY_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "Return strict JSON only: {\"messages\":[\"...\"]}.",
          "Write short loading captions for an AI browser-tab organization extension.",
          "Do not claim real internal thoughts, exact work already completed, or user-private content.",
          "Avoid repeating wording. No numbering, markdown, emoji, quotes, or terminal punctuation.",
          `Return exactly ${PROGRESS_COPY_COUNT} messages. Each message must be at most ${PROGRESS_COPY_MAX_LENGTH} Chinese characters or 6 English words.`
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          languageMode,
          phase,
          tabCount: Number(request.tabCount || activeJob?.tabCount || 0),
          windowCount: Number(request.windowCount || activeJob?.windowCount || 0),
          style: "calm, varied, product-like, suitable for multi-minute progress UI"
        })
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200
  };

  try {
    const { response, data } = await fetchJsonWithTimeout(
      fetch,
      `${BUILTIN_GATEWAY_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tab-recap-install-id": installId,
          "x-tab-recap-request-id": `progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        },
        body: JSON.stringify(body)
      },
      "Progress copy generation",
      PROGRESS_COPY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error("Progress copy generation failed.");
    }

    return {
      model: PROGRESS_COPY_MODEL,
      source: "ai",
      messages: normalizeProgressCopyMessages(extractProgressCopyText(data))
    };
  } catch {
    return localProgressCopyResult(languageMode, phase);
  }
}

export async function applyLastPlan(chromeApi, options = {}) {
  return enqueueBrowserMutation(() => applyLastPlanLocked(chromeApi, options));
}

async function applyLastPlanLocked(chromeApi, options = {}) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, options.windowId);
  const job = await getScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId);
  if (!job) throw new Error("No analyzed plan is available.");
  if (!job.validation?.ok) {
    throw new Error(`Cannot apply an invalid plan: ${(job.validation?.errors || []).join(" ")}`);
  }
  if (job.settings?.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW && !options.confirmMultiWindow) {
    return { requiresMultiWindowConfirmation: true };
  }

  const latestInventory = await collectTabInventory(chromeApi, job.settings, invocationForApply(job));
  let planForApply = job.plan;
  let inventoryForApply = latestInventory;
  let rebaseSummary = null;
  let latestValidation = validatePlan(planForApply, latestInventory, job.settings);
  if (!latestValidation.ok || hasPlannerTabDrift(job.inventory, latestInventory)) {
    const rebased = rebasePlanForLatestInventory(job.plan, job.inventory, latestInventory, job.settings, {
      includeUnpreviewedTabsInReview: Boolean(options.confirmChangedTabs)
    });
    if (!rebased.validation.ok) {
      throw new Error(`标签页变化较多，请重新生成方案。${rebased.validation.errors.join(" ")}`);
    }
    if (shouldRejectRebasedPlan(rebased.summary, job.inventory, latestInventory)) {
      throw new Error(`标签页变化较多，请重新生成方案。变化标签页 ${rebased.summary.changedTabsCount} 个。`);
    }
    if (
      rebased.summary.changedTabsCount &&
      (!options.confirmChangedTabs || options.confirmationToken !== rebased.summary.confirmationToken)
    ) {
      return {
        requiresChangedTabsConfirmation: true,
        rebasedPlan: rebased.summary
      };
    }
    planForApply = rebased.plan;
    inventoryForApply = rebased.inventory;
    rebaseSummary = rebased.summary;
  }

  const rollbackSnapshot = await createRollbackSnapshot(chromeApi, inventoryForApply, job.settings);
  await setScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId, rollbackSnapshot);

  const { rollback, result } = await applyValidatedPlan(
    chromeApi,
    planForApply,
    inventoryForApply,
    job.settings,
    rollbackSnapshot,
    (nextRollback) => setScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId, nextRollback)
  );
  await setScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId, rollback);
  await removeScopedLocal(chromeApi, STORAGE_KEYS.lastJob, resolvedWindowId);
  return rebaseSummary ? { ...result, rebasedPlan: rebaseSummary } : result;
}

function rebasePlanForLatestInventory(plan, originalInventory, latestInventory, rawSettings = {}, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const originalEligibleIds = new Set((originalInventory?.tabs || []).map((tab) => tab.tabId));
  const originalPlannerIds = new Set((originalInventory?.plannerTabs || []).map((tab) => tab.tabId));
  const originalPlannerById = new Map((originalInventory?.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const includeUnpreviewedTabsInReview = Boolean(options.includeUnpreviewedTabsInReview);
  const changedPlannerTabs = (latestInventory.plannerTabs || []).filter((tab) => {
    const original = originalPlannerById.get(tab.tabId);
    return original && tabFingerprint(original) !== tabFingerprint(tab);
  });
  const changedPlannerIds = new Set(changedPlannerTabs.map((tab) => tab.tabId));
  const inventoryForApply = filterInventoryForApply(latestInventory, originalEligibleIds, originalPlannerIds, {
    includeUnpreviewedTabsInReview,
    changedPlannerIds
  });
  const latestTabsById = new Map((inventoryForApply.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const rawLatestTabsById = new Map((latestInventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const unpreviewedPlannerTabs = (latestInventory.plannerTabs || []).filter((tab) => !originalPlannerIds.has(tab.tabId));
  const seen = new Set();
  const summary = {
    removedTabIds: [],
    addedReviewTabIds: includeUnpreviewedTabsInReview ? unpreviewedPlannerTabs.map((tab) => tab.tabId) : [],
    changedReviewTabIds: includeUnpreviewedTabsInReview ? changedPlannerTabs.map((tab) => tab.tabId) : [],
    changedContentTabIds: changedPlannerTabs.map((tab) => tab.tabId),
    skippedNewTabIds: includeUnpreviewedTabsInReview ? [] : unpreviewedPlannerTabs.map((tab) => tab.tabId),
    duplicateTabIds: [],
    droppedGroupKeys: [],
    changedTabsCount: 0
  };

  const rebaseRef = (ref, owner) => {
    if (!ref || typeof ref.tabId !== "number") return null;
    if (changedPlannerIds.has(ref.tabId)) {
      return null;
    }
    const tab = latestTabsById.get(ref.tabId);
    if (!tab) {
      if (!rawLatestTabsById.has(ref.tabId)) {
        summary.removedTabIds.push(ref.tabId);
      }
      return null;
    }
    if (seen.has(ref.tabId)) {
      summary.duplicateTabIds.push(ref.tabId);
      return null;
    }
    seen.add(ref.tabId);
    return {
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: ref.reason || (owner === "review" ? "Kept for review after tabs changed since preview." : undefined)
    };
  };

  const groups = [];
  for (const group of Array.isArray(plan.groups) ? plan.groups : []) {
    const tabRefs = (Array.isArray(group?.tabRefs) ? group.tabRefs : [])
      .map((ref) => rebaseRef(ref, group.groupKey || group.title || "group"))
      .filter(Boolean);
    if (tabRefs.length) {
      groups.push({ ...group, tabRefs });
    } else {
      summary.droppedGroupKeys.push(group?.groupKey || group?.title || "<unknown>");
    }
  }

  const reviewTabs = (Array.isArray(plan.reviewTabs) ? plan.reviewTabs : [])
    .map((ref) => rebaseRef(ref, "review"))
    .filter(Boolean);

  if (includeUnpreviewedTabsInReview) {
    for (const tab of unpreviewedPlannerTabs) {
      if (seen.has(tab.tabId)) continue;
      seen.add(tab.tabId);
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: "Tab appeared after preview; user confirmed placing it in review."
      });
    }
    for (const tab of changedPlannerTabs) {
      if (seen.has(tab.tabId)) continue;
      seen.add(tab.tabId);
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: "Tab changed after preview; user confirmed placing it in review."
      });
    }
  }

  const rebasedPlan = {
    ...plan,
    mode: settings.organizeMode,
    targetWindow: rebaseTargetWindow(plan.targetWindow, inventoryForApply, settings),
    groups,
    reviewTabs,
    excludedTabs: (inventoryForApply.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason || "Excluded by current settings."
    }))
  };
  const normalizedRebasedPlan = normalizePlanForSettings(rebasedPlan, inventoryForApply, settings);

  summary.removedTabIds = uniqueNumbers(summary.removedTabIds);
  summary.addedReviewTabIds = uniqueNumbers(summary.addedReviewTabIds);
  summary.changedReviewTabIds = uniqueNumbers(summary.changedReviewTabIds);
  summary.changedContentTabIds = uniqueNumbers(summary.changedContentTabIds);
  summary.skippedNewTabIds = uniqueNumbers(summary.skippedNewTabIds);
  summary.duplicateTabIds = uniqueNumbers(summary.duplicateTabIds);
  summary.changedTabsCount = uniqueNumbers([
    ...summary.removedTabIds,
    ...summary.addedReviewTabIds,
    ...summary.skippedNewTabIds,
    ...summary.duplicateTabIds,
    ...summary.changedContentTabIds
  ]).length;
  summary.confirmationToken = rebaseConfirmationToken(summary);

  return {
    plan: normalizedRebasedPlan,
    inventory: inventoryForApply,
    validation: validatePlan(normalizedRebasedPlan, inventoryForApply, settings),
    summary
  };
}

function filterInventoryForApply(inventory, originalEligibleIds, originalPlannerIds, options = {}) {
  const includeUnpreviewedTabsInReview = Boolean(options.includeUnpreviewedTabsInReview);
  const changedPlannerIds = options.changedPlannerIds || new Set();
  const latestPlannerIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  const shouldIncludeTab = (tab) =>
    (originalEligibleIds.has(tab.tabId) && !changedPlannerIds.has(tab.tabId)) ||
    (includeUnpreviewedTabsInReview && latestPlannerIds.has(tab.tabId));
  const stablePlannerTabs = includeUnpreviewedTabsInReview
    ? inventory.plannerTabs || []
    : (inventory.plannerTabs || []).filter((tab) => originalPlannerIds.has(tab.tabId) && !changedPlannerIds.has(tab.tabId));
  return {
    ...inventory,
    tabs: (inventory.tabs || []).filter(shouldIncludeTab),
    plannerTabs: stablePlannerTabs,
    lockedGroups: (inventory.lockedGroups || [])
      .map((group) => ({
        ...group,
        tabIds: (group.tabIds || []).filter((tabId) => shouldIncludeTab({ tabId }))
      }))
      .filter((group) => group.tabIds.length),
    excludedTabs: inventory.excludedTabs || []
  };
}

function rebaseTargetWindow(targetWindow, inventory, settings) {
  if (settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.CURRENT_WINDOW,
      windowId: inventory.scope?.currentWindowId ?? targetWindow?.windowId ?? null,
      title: targetWindow?.title || "Current Window"
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.CURRENT_WINDOW,
      windowId: inventory.scope?.invocationWindowId ?? targetWindow?.windowId ?? null,
      title: targetWindow?.title || "Current Window"
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.SELECTED_WINDOW,
      windowId: settings.selectedTargetWindowId,
      title: targetWindow?.title || "Selected Window"
    };
  }

  return { ...(targetWindow || {}), kind: TARGET_WINDOW_MODES.NEW_WINDOW };
}

function shouldRejectRebasedPlan(summary, originalInventory, latestInventory) {
  const changed = summary.changedTabsCount || 0;
  if (!changed) return false;
  const eligible = Math.max(1, (originalInventory?.plannerTabs || latestInventory.plannerTabs || []).length);
  const allowedChanges = Math.max(5, Math.min(APPLY_REBASE_MAX_CHANGED_TABS, Math.ceil(eligible * APPLY_REBASE_MAX_CHANGED_RATIO)));
  return changed > allowedChanges;
}

function hasPlannerTabDrift(originalInventory, latestInventory) {
  const originalById = new Map((originalInventory?.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  for (const tab of latestInventory?.plannerTabs || []) {
    const original = originalById.get(tab.tabId);
    if (original && tabFingerprint(original) !== tabFingerprint(tab)) return true;
  }
  return false;
}

function tabFingerprint(tab = {}) {
  return JSON.stringify([
    tab.title || "",
    tab.hostname || "",
    tab.sanitizedUrl || "",
    tab.urlKind || "",
    tab.groupTitle || "",
    Boolean(tab.discarded)
  ]);
}

function rebaseConfirmationToken(summary = {}) {
  const payload = {
    removed: uniqueNumbers(summary.removedTabIds || []).sort((a, b) => a - b),
    added: uniqueNumbers([...(summary.addedReviewTabIds || []), ...(summary.skippedNewTabIds || [])]).sort((a, b) => a - b),
    changed: uniqueNumbers(summary.changedContentTabIds || []).sort((a, b) => a - b),
    duplicate: uniqueNumbers(summary.duplicateTabIds || []).sort((a, b) => a - b),
    dropped: [...new Set(summary.droppedGroupKeys || [])].sort()
  };
  return `rebase_${hashString(JSON.stringify(payload))}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => typeof value === "number"))];
}

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function extractProgressCopyText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeProgressCopyMessages(text) {
  const parsed = parseJsonObjectFromText(text);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const normalized = [];
  const seen = new Set();

  for (const message of messages) {
    const clean = cleanProgressCopyMessage(message);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
    if (normalized.length >= PROGRESS_COPY_COUNT) break;
  }

  if (normalized.length < 12) {
    throw new Error("Progress copy generation returned too few usable messages.");
  }
  return normalized;
}

function localProgressCopyResult(languageMode, phase) {
  return {
    model: PROGRESS_COPY_MODEL,
    source: "local_fallback",
    messages: localProgressCopyMessages(languageMode, phase)
  };
}

function localProgressCopyMessages(languageMode, phase) {
  const zh = {
    coarse_planning: ["快速扫一遍", "寻找跨窗口主题", "拆出主题方向", "标记模糊标签", "压缩相近线索"],
    refining: ["拆开过大的组", "复核模糊边界", "合并同一任务", "保留原始顺序", "校对分组命名"],
    cleanup_planning: ["排序清理清单", "比较新旧任务", "挑出低价值页面", "保留手动决定权", "检查关闭风险"],
    retrying: ["修正校验问题", "补齐遗漏标签", "移除重复分配", "重新检查结构", "确认可回退"],
    recapping: ["梳理时间线索", "合并本机活动", "对齐页面摘要", "提炼阶段重点", "保留人工判断"],
    planning: ["理解标题线索", "寻找相邻任务", "避开域名硬分组", "检查不确定页", "整理分组边界"]
  };
  const en = {
    coarse_planning: ["Scanning tabs", "Finding cross-window topics", "Shaping topic lanes", "Marking fuzzy tabs", "Compressing nearby clues"],
    refining: ["Splitting large groups", "Reviewing fuzzy edges", "Merging one task", "Keeping tab order", "Checking group names"],
    cleanup_planning: ["Ranking cleanup items", "Comparing old tasks", "Finding low-value pages", "Keeping manual control", "Checking close risk"],
    retrying: ["Fixing validation issues", "Filling missing tabs", "Removing duplicates", "Checking structure again", "Confirming rollback"],
    recapping: ["Reading the timeline", "Merging local activity", "Aligning page summaries", "Finding key phases", "Keeping review manual"],
    planning: ["Reading title clues", "Finding neighboring tasks", "Avoiding domain-only groups", "Checking uncertain pages", "Tightening group edges"]
  };
  const source = languageMode === "en-US" ? en : zh;
  const base = source[phase] || source.planning;
  return Array.from({ length: PROGRESS_COPY_COUNT }, (_, index) => base[index % base.length]);
}

function parseJsonObjectFromText(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Progress copy generation returned invalid JSON.");
  }
}

function cleanProgressCopyMessage(value) {
  return String(value || "")
    .replace(/^[\s\d.)、-]+/, "")
    .replace(/[。！？.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function normalizeProgressLanguage(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function enqueueBrowserMutation(fn) {
  const run = browserMutationQueue.catch(() => null).then(fn);
  browserMutationQueue = run.catch(() => null);
  return run;
}

function invocationForApply(job = {}) {
  const settings = normalizeSettings(job.settings || {});
  if (settings.organizeMode !== ORGANIZE_MODES.CURRENT_WINDOW) return job.invocation || {};
  const windowId = job.inventory?.scope?.currentWindowId ?? job.invocation?.windowId;
  return { ...(job.invocation || {}), windowId, strictWindowId: true };
}

export async function undoLastApply(chromeApi, windowId = null) {
  return enqueueBrowserMutation(() => undoLastApplyLocked(chromeApi, windowId));
}

async function undoLastApplyLocked(chromeApi, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  const rollback = await getScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId);
  if (!rollback) throw new Error("No rollback snapshot is available.");
  const result = await undoFromRollback(chromeApi, rollback);
  await removeScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId);
  return result;
}

export async function canUndoLastApply(chromeApi, windowId = null) {
  const resolvedWindowId = await resolveStateWindowId(chromeApi, windowId);
  const rollback = await getScopedLocal(chromeApi, STORAGE_KEYS.lastRollback, resolvedWindowId);
  return { canUndo: Boolean(rollback) };
}

function redactSettingsForJob(settings) {
  return { ...settings, gatewayApiKey: "" };
}

function sanitizeJobForStorage(job) {
  if (!job) return job;
  return {
    ...job,
    settings: job.settings ? redactSettingsForJob(job.settings) : job.settings,
    inventory: sanitizeInventoryForStorage(job.inventory)
  };
}

function normalizeStoredJobForPreview(job) {
  if (!job?.plan || !job?.inventory) return sanitizeJobForStorage(job);
  const settings = normalizeSettings(job.settings || {});
  const plan = normalizePlanForSettings(job.plan, job.inventory, settings);
  const validation = validatePlan(plan, job.inventory, settings);
  const preview = buildPreview(plan, job.inventory, validation, settings);
  return sanitizeJobForStorage({
    ...job,
    settings: redactSettingsForJob(settings),
    plan,
    validation,
    preview
  });
}

function sanitizeInventoryForStorage(inventory) {
  if (!inventory) return inventory;
  return {
    ...inventory,
    pageSamples: (inventory.pageSamples || []).map((sample) => ({
      tabId: sample.tabId,
      windowId: sample.windowId,
      status: sample.status,
      reason: sample.reason || ""
    }))
  };
}

function settingsForPersistence(settings) {
  const persisted = { ...settings };
  if (persisted.pageSamplingConsentMode === "acknowledged_for_session") {
    persisted.pageSamplingConsentMode = "not_acknowledged";
  }
  if (!persisted.rememberProviderKeys) {
    persisted.gatewayApiKey = "";
  }
  return persisted;
}

async function createValidatedPlan(inventory, settings, options = {}) {
  throwIfCanceled(options.signal);
  const plan = ensureCleanupPlan(
    normalizePlanForSettings(await createPlan(inventory, settings, options), inventory, settings),
    inventory,
    settings,
    options
  );
  await options.onProgress?.({ phase: "validation", progress: 88, message: "正在校验 AI 方案" });
  let validation = validatePlan(plan, inventory, settings);
  if (validation.ok || settings.plannerProvider === PLANNER_PROVIDERS.FAKE) {
    return { plan, validation };
  }

  await options.onProgress?.({
    phase: "retrying",
    progress: 90,
    message: "方案未通过校验，正在要求 AI 修正"
  });
  const retrySettings = {
    ...settings,
    customPrompt: [
      settings.customPrompt,
      "Previous planner output failed local validation. Return a corrected JSON plan only.",
      `Validation errors: ${validation.errors.join(" ")}`
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000)
  };
  const retryPlan = ensureCleanupPlan(
    normalizePlanForSettings(await createPlan(inventory, retrySettings, options), inventory, settings),
    inventory,
    settings,
    options
  );
  await options.onProgress?.({ phase: "validation", progress: 94, message: "正在校验修正方案" });
  validation = validatePlan(retryPlan, inventory, settings);
  return { plan: retryPlan, validation };
}

function ensureCleanupPlan(plan, inventory, settings, options = {}) {
  if (!settings.analyzeCleanup || plan?.cleanup) return plan;
  return {
    ...plan,
    cleanup: createLocalCleanupAnalysis(inventory, options.activityOverview || {}, settings)
  };
}

async function collectCleanupActivityOverview(chromeApi, settings, rangeMs = CLEANUP_ACTIVITY_RANGE_MS) {
  await reconcileTabLifecycle(chromeApi, { includeIncognitoTabs: settings.includeIncognitoTabs }).catch(() => null);
  return getActivityOverview(chromeApi, {
    rangeMs,
    includeIncognitoTabs: settings.includeIncognitoTabs
  });
}

async function attachPageSamples(chromeApi, inventory, settings, options = {}) {
  inventory.pageSamples = [];
  const cachedTabIds = await attachCachedPageSamples(chromeApi, inventory, settings, options);
  const totalTabsForCopy = inventory.plannerTabs?.length || 0;
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) {
    await options.onProgress?.({
      phase: "sampling",
      progress: 24,
      message: cachedTabIds.size ? pageSamplingCachedMessage(cachedTabIds.size, totalTabsForCopy) : "页面摘要已关闭"
    });
    return inventory;
  }

  const candidates = selectSamplingCandidates(inventory, settings).filter((tab) => !cachedTabIds.has(tab.tabId));
  if (!candidates.length) {
    await options.onProgress?.({
      phase: "sampling",
      progress: 30,
      message: cachedTabIds.size ? pageSamplingCachedMessage(cachedTabIds.size, totalTabsForCopy) : "没有需要补充页面线索"
    });
    return inventory;
  }

  let sampledOk = 0;
  let sampledBlocked = 0;
  let completed = 0;
  let nextIndex = 0;
  const runnableCandidates = [];
  const candidateOrder = new Map(candidates.map((tab, index) => [tab.tabId, index]));

  for (const tab of candidates) {
    throwIfCanceled(options.signal);
    if (shouldSkipPageSample(tab)) {
      sampledBlocked += 1;
      completed += 1;
      inventory.pageSamples.push(skippedPageSampleForTab(tab));
    } else {
      runnableCandidates.push(tab);
    }
  }

  const workerCount = Math.min(PAGE_SAMPLE_CONCURRENCY, runnableCandidates.length);
  const totalTabsForProgress = totalTabsForCopy || candidates.length;

  await options.onProgress?.({
    phase: "sampling",
    progress: 20 + Math.round((completed / candidates.length) * 16),
    message: pageSamplingProgressMessage(sampledOk, totalTabsForProgress)
  });

  const sampleOne = async (tab) => {
    await options.onProgress?.({
      phase: "sampling",
      progress: 20 + Math.round((completed / candidates.length) * 16),
      message: pageSamplingProgressMessage(sampledOk, totalTabsForProgress)
    });
    const liveTab = await getLiveTab(chromeApi, tab.tabId);
    const sampleResult = liveTab
      ? await requestPageSampleWithTimeout(chromeApi, liveTab, settings, options.signal, `Improve semantic grouping for tab ${tab.tabId}.`)
      : { status: "missing", reason: "Tab disappeared before sampling." };
    if (sampleResult.status === "ok") {
      sampledOk += 1;
      if (settings.continuousPageSummaries && liveTab) {
        await rememberPageSummary(chromeApi, liveTab, sampleResult, {
          includeIncognitoTabs: settings.includeIncognitoTabs
        }).catch(() => null);
      }
    } else {
      sampledBlocked += 1;
    }
    inventory.pageSamples.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      status: sampleResult.status,
      origin: sampleResult.origin || "",
      reason: sampleResult.reason || "",
      sample: sampleResult.sample || null
    });
    completed += 1;
    await options.onProgress?.({
      phase: "sampling",
      progress: 20 + Math.round((completed / candidates.length) * 16),
      message: pageSamplingProgressMessage(sampledOk, totalTabsForProgress)
    });
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < runnableCandidates.length) {
        throwIfCanceled(options.signal);
        const tab = runnableCandidates[nextIndex];
        nextIndex += 1;
        await sampleOne(tab);
      }
    })
  );

  inventory.pageSamples.sort((left, right) => {
    return (candidateOrder.get(left.tabId) ?? 0) - (candidateOrder.get(right.tabId) ?? 0);
  });
  await options.onProgress?.({
    phase: "sampling",
    progress: 36,
    message: pageSamplingDoneMessage(sampledOk, totalTabsForProgress)
  });
  return inventory;
}

function pageSamplingCachedMessage(cachedCount, totalTabs) {
  return shouldShowPageSampleCount(cachedCount, totalTabs) ? `使用已缓存页面摘要 ${cachedCount} 个` : "使用已缓存页面线索";
}

function pageSamplingProgressMessage(sampledOk, totalTabs) {
  return shouldShowPageSampleCount(sampledOk, totalTabs) ? `正在补充页面线索，已补充 ${sampledOk} 个` : "正在补充页面线索";
}

function pageSamplingDoneMessage(sampledOk, totalTabs) {
  if (shouldShowPageSampleCount(sampledOk, totalTabs)) return `已补充 ${sampledOk} 个页面摘要`;
  if (sampledOk > 0) return "已补充部分页面线索";
  return "继续参考标题、网址和原始顺序";
}

async function attachCachedPageSamples(chromeApi, inventory, settings, options = {}) {
  if (!settings.continuousPageSummaries) return new Set();

  throwIfCanceled(options.signal);
  const sampleableTabs = (inventory.plannerTabs || []).filter((tab) => tab.sampleable);
  const cachedSamples = await cachedPageSamplesForTabs(chromeApi, sampleableTabs, {
    includeIncognitoTabs: settings.includeIncognitoTabs
  }).catch(() => []);
  const cachedTabIds = new Set();
  for (const cached of cachedSamples) {
    inventory.pageSamples.push(cached);
    cachedTabIds.add(cached.tabId);
  }
  return cachedTabIds;
}

function shouldSkipPageSample(tab) {
  return Boolean(tab.discarded);
}

function skippedPageSampleForTab(tab) {
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    status: "discarded",
    origin: "",
    reason: "Tab is sleeping; page summary was skipped to avoid waking it.",
    sample: null
  };
}

async function requestPageSampleWithTimeout(chromeApi, tab, settings, signal, reason) {
  const timeoutMs = Number(globalThis.__semanticTabAgentPageSampleTimeoutMs) || PAGE_SAMPLE_TIMEOUT_MS;
  try {
    return await raceWithTimeoutAndAbort(
      requestPageSample(chromeApi, tab, settings, reason),
      timeoutMs,
      signal
    );
  } catch (error) {
    throwIfCanceled(signal);
    const rawUrl = tab.url || tab.pendingUrl || "";
    return {
      status: "blocked",
      origin: safeOriginPattern(rawUrl),
      reason: /timed out/i.test(String(error?.message || ""))
        ? "Timed out while reading page summary."
        : "Page summary could not be read in time."
    };
  }
}

function raceWithTimeoutAndAbort(promise, timeoutMs, signal) {
  if (signal?.aborted) return Promise.reject(new Error("已停止生成。"));

  let timeoutId;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Page sampling timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(new Error("已停止生成。"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([promise, timeoutPromise, abortPromise]).finally(() => {
    clearTimeout(timeoutId);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  });
}

function safeOriginPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function assertNoRunningAnalysis(chromeApi, windowId = null) {
  const job = await getActiveJob(chromeApi, windowId);
  if (job && !ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    throw new Error("已有整理任务正在运行，请先取消或等待它完成。");
  }
}

function createOperationId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getOrCreateInstallId(chromeApi) {
  const existing = await getLocal(chromeApi, STORAGE_KEYS.installId, "");
  if (isValidInstallId(existing)) return existing;

  const installId = createInstallId();
  await setLocal(chromeApi, STORAGE_KEYS.installId, installId);
  return installId;
}

function createInstallId() {
  if (globalThis.crypto?.randomUUID) {
    return `install_${globalThis.crypto.randomUUID()}`;
  }
  return `install_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function isValidInstallId(value) {
  return /^install_[a-zA-Z0-9_-]{8,80}$/.test(String(value || ""));
}

async function updateActiveJob(chromeApi, operationId, patch, windowId = null) {
  const current = await getScopedLocal(chromeApi, STORAGE_KEYS.activeJob, windowId, {});
  if (current?.operationId && current.operationId !== operationId) return current;
  if (ACTIVE_JOB_TERMINAL_STATUSES.has(current?.status)) return current;

  const nextPatch = { ...patch };
  if (current?.status === "canceling") {
    if (nextPatch.status === "complete") {
      nextPatch.status = "canceled";
      nextPatch.phase = "canceled";
      nextPatch.message = "已停止生成。";
      nextPatch.error = "";
      nextPatch.finishedAt = nextPatch.finishedAt || new Date().toISOString();
    } else if (!ACTIVE_JOB_TERMINAL_STATUSES.has(nextPatch.status)) {
      nextPatch.status = "canceling";
      nextPatch.phase = "canceling";
      nextPatch.message = "正在停止生成";
    }
  }
  if (
    typeof current?.progress === "number" &&
    typeof nextPatch.progress === "number" &&
    nextPatch.progress < current.progress &&
    !ACTIVE_JOB_TERMINAL_STATUSES.has(nextPatch.status)
  ) {
    nextPatch.progress = current.progress;
  }

  return writeActiveJob(chromeApi, {
    ...current,
    operationId,
    status: current?.status || "running",
    ...nextPatch,
    updatedAt: new Date().toISOString()
  }, windowId);
}

async function writeActiveJob(chromeApi, job, windowId = null) {
  return setScopedLocal(chromeApi, STORAGE_KEYS.activeJob, windowId, sanitizeActiveJob(job));
}

function sanitizeActiveJob(job) {
  const { inventory, plan, preview, validation, ...safeJob } = job || {};
  if (safeJob.settings) safeJob.settings = redactSettingsForJob(safeJob.settings);
  if (typeof safeJob.progress !== "number") {
    delete safeJob.progress;
  } else {
    safeJob.progress = Math.max(0, Math.min(100, Math.round(safeJob.progress)));
  }
  if (safeJob.error) safeJob.error = redactActiveJobText(safeJob.error).slice(0, 500);
  if (safeJob.message) safeJob.message = redactActiveJobText(safeJob.message).slice(0, 160);
  return safeJob;
}

function redactActiveJobText(value) {
  return redactSensitiveText(value, { redactUrls: true });
}

function throwIfCanceled(signal) {
  if (signal?.aborted) {
    throw new Error("已停止生成。");
  }
}

function selectSamplingCandidates(inventory, settings) {
  const tabs = (inventory.plannerTabs || []).filter((tab) => tab.sampleable);
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY) {
    return tabs.filter((tab) => tab.active);
  }
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS) {
    return tabs;
  }
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.AMBIGUOUS_WITH_PERMISSION) {
    return tabs.filter(isAmbiguousTab);
  }
  return [];
}

function isAmbiguousTab(tab) {
  const title = String(tab.title || "").trim().toLowerCase();
  return !title || title.length < 18 || ["home", "new tab", "untitled", "login", "sign in"].some((term) => title.includes(term));
}

async function getLiveTab(chromeApi, tabId) {
  try {
    return await chromeApi.tabs.get(tabId);
  } catch {
    return null;
  }
}
