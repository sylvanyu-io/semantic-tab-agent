import { URL_PRIVACY_MODES } from "../shared/settings.js";
import { STORAGE_KEYS, getLocal, setLocal } from "./storage.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const LOG_VERSION = 1;
const MAX_EVENTS = 1800;
const MAX_SESSIONS = 1800;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RECONCILE_EVENT = "reconcile_snapshot";
const FLOW_RUN_BREAK_MS = 90 * 60 * 1000;
const FLOW_MAX_DWELL_MS = 60 * 60 * 1000;
const FLOW_MAX_RUNS = 24;
const FLOW_MAX_EVIDENCE = 80;
const FLOW_MAX_NEARBY_IDS = 6;
const FLOW_EVIDENCE_WINDOW_SIZE = 5;
const FLOW_EVIDENCE_WINDOW_STEP = 3;

let lifecycleWriteQueue = Promise.resolve();

export async function rememberTabLifecycle(chromeApi, type, tab, options = {}) {
  const normalizedTab = normalizeLifecycleTab(tab);
  if (!normalizedTab) return null;
  if (normalizedTab.incognito && !options.includeIncognitoTabs) return null;
  const now = normalizeNow(options.now);
  return mutateLifecycleLog(chromeApi, now, (log) => upsertOpenSession(log, normalizedTab, type || "tab_seen", now, options));
}

export async function rememberTabsLifecycle(chromeApi, tabs = [], options = {}) {
  const normalizedTabs = tabs
    .map(normalizeLifecycleTab)
    .filter((tab) => tab && (!tab.incognito || options.includeIncognitoTabs));
  if (!normalizedTabs.length) return { stored: 0 };
  const now = normalizeNow(options.now);
  return mutateLifecycleLog(chromeApi, now, (log) => {
    let stored = 0;
    for (const tab of normalizedTabs) {
      upsertOpenSession(log, tab, options.type || "tab_seen", now, options);
      stored += 1;
    }
    return { stored };
  });
}

export async function recordTabClosed(chromeApi, tabId, removeInfo = {}, options = {}) {
  if (!Number.isInteger(tabId)) return null;
  const now = normalizeNow(options.now);
  return mutateLifecycleLog(chromeApi, now, (log) => {
    const sessionId = log.tabIndex[String(tabId)];
    const session = sessionId ? log.sessions[sessionId] : null;
    if (!session || session.closedAt) {
      appendLifecycleEvent(log, {
        type: "tab_closed_unmatched",
        tabId,
        windowId: normalizeNumber(removeInfo.windowId),
        at: now,
        reason: removeInfo.isWindowClosing ? "window_closed" : "tab_closed"
      });
      return null;
    }

    closeSession(log, session, now, removeInfo.isWindowClosing ? "window_closed" : "tab_closed");
    return session;
  });
}

export async function reconcileTabLifecycle(chromeApi, options = {}) {
  const now = normalizeNow(options.now);
  const currentTabs = await collectCurrentLifecycleTabs(chromeApi, options);
  return mutateLifecycleLog(chromeApi, now, (log) => {
    const currentTabIds = new Set(currentTabs.map((tab) => String(tab.id)));
    let observed = 0;
    let inferredOpened = 0;
    let inferredClosed = 0;

    for (const tab of currentTabs) {
      const existingSessionId = log.tabIndex[String(tab.id)];
      if (!existingSessionId || log.sessions[existingSessionId]?.closedAt) inferredOpened += 1;
      upsertOpenSession(log, tab, existingSessionId ? "tab_seen" : "tab_opened_inferred", now, {
        inferred: !existingSessionId
      });
      observed += 1;
    }

    for (const session of Object.values(log.sessions)) {
      if (session.closedAt) continue;
      if (!currentTabIds.has(String(session.tabId))) {
        closeSession(log, session, now, "missing_after_reconcile");
        inferredClosed += 1;
      }
    }

    log.lastReconciledAt = new Date(now).toISOString();
    log.reconcileStats = {
      observed,
      inferredOpened,
      inferredClosed,
      checkedAt: log.lastReconciledAt
    };
    appendLifecycleEvent(log, {
      type: RECONCILE_EVENT,
      at: now,
      observed,
      inferredOpened,
      inferredClosed
    });
    return getLifecycleStatsFromLog(log, now);
  });
}

export async function getTabLifecycleStats(chromeApi, options = {}) {
  const now = normalizeNow(options.now);
  await lifecycleWriteQueue.catch(() => null);
  const log = normalizeLifecycleLog(await getLocal(chromeApi, STORAGE_KEYS.tabLifecycleLog, null));
  return getLifecycleStatsFromLog(log, now);
}

export async function getTabActivationFlowContext(chromeApi, tabs = [], options = {}) {
  await lifecycleWriteQueue.catch(() => null);
  const log = normalizeLifecycleLog(await getLocal(chromeApi, STORAGE_KEYS.tabLifecycleLog, null));
  return buildActivationFlowContext(log, tabs, options);
}

function mutateLifecycleLog(chromeApi, now, mutate) {
  const operation = lifecycleWriteQueue
    .catch(() => null)
    .then(async () => {
      const log = normalizeLifecycleLog(await getLocal(chromeApi, STORAGE_KEYS.tabLifecycleLog, null));
      const result = mutate(log);
      await persistLifecycleLog(chromeApi, log, now);
      return result;
    });
  lifecycleWriteQueue = operation.catch(() => null);
  return operation;
}

function upsertOpenSession(log, tab, type, now, options = {}) {
  const tabIndexKey = String(tab.id);
  const existingSessionId = log.tabIndex[tabIndexKey];
  const existing = existingSessionId ? log.sessions[existingSessionId] : null;
  const session = existing && !existing.closedAt ? existing : createSession(tab, now, Boolean(options.inferred));
  if (!existing || existing.closedAt) {
    log.sessions[session.id] = session;
    log.tabIndex[tabIndexKey] = session.id;
  }

  const previousActive = Boolean(session.active);
  const nextActive = Boolean(tab.active || type === "tab_activated");
  if (nextActive) deactivateOtherWindowSessions(log, session.id, tab.windowId);
  Object.assign(session, {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title || session.title,
    hostname: tab.hostname || session.hostname,
    sanitizedUrl: tab.sanitizedUrl || session.sanitizedUrl,
    urlKey: tab.urlKey || session.urlKey,
    lastObservedAt: new Date(now).toISOString(),
    active: nextActive,
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
    incognito: Boolean(tab.incognito)
  });

  if (!previousActive && nextActive) {
    session.activeCount = Math.min(9999, Number(session.activeCount || 0) + 1);
    session.lastActivatedAt = new Date(now).toISOString();
  }

  appendLifecycleEvent(log, {
    type,
    sessionId: session.id,
    tabId: tab.id,
    windowId: tab.windowId,
    at: now,
    active: nextActive,
    discarded: Boolean(tab.discarded),
    inferred: Boolean(options.inferred)
  });
  return session;
}

function deactivateOtherWindowSessions(log, activeSessionId, windowId) {
  for (const session of Object.values(log.sessions)) {
    if (session.id !== activeSessionId && !session.closedAt && session.windowId === windowId) {
      session.active = false;
    }
  }
}

function createSession(tab, now, inferred) {
  const nowIso = new Date(now).toISOString();
  const id = `s_${now.toString(36)}_${stableHash(`${tab.id}:${tab.windowId}:${tab.urlKey}:${tab.index}`)}`;
  return {
    id,
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title,
    hostname: tab.hostname,
    sanitizedUrl: tab.sanitizedUrl,
    urlKey: tab.urlKey,
    openedAt: nowIso,
    firstObservedAt: nowIso,
    lastObservedAt: nowIso,
    activeCount: tab.active ? 1 : 0,
    lastActivatedAt: tab.active ? nowIso : "",
    active: Boolean(tab.active),
    inferredOpen: inferred,
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
    incognito: Boolean(tab.incognito)
  };
}

function closeSession(log, session, now, reason) {
  session.closedAt = new Date(now).toISOString();
  session.closeReason = reason;
  session.active = false;
  delete log.tabIndex[String(session.tabId)];
  appendLifecycleEvent(log, {
    type: reason === "missing_after_reconcile" ? "tab_closed_inferred" : "tab_closed",
    sessionId: session.id,
    tabId: session.tabId,
    windowId: session.windowId,
    at: now,
    reason
  });
}

async function collectCurrentLifecycleTabs(chromeApi, options = {}) {
  const windows = (await chromeApi.windows?.getAll?.({ populate: true, windowTypes: ["normal"] }).catch(() => [])) || [];
  return windows
    .flatMap((window) => window.tabs || [])
    .map(normalizeLifecycleTab)
    .filter((tab) => tab && (!tab.incognito || options.includeIncognitoTabs));
}

function normalizeLifecycleTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) return null;
  const rawUrl = getTabUrl(tab);
  if (!rawUrl || !canSampleUrl(rawUrl)) return null;
  const urlInfo = sanitizeTabUrl(rawUrl, URL_PRIVACY_MODES.SANITIZED_URL);
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: normalizeNumber(tab.index),
    title: String(tab.title || "").slice(0, 180),
    hostname: urlInfo.hostname || "",
    sanitizedUrl: urlInfo.sanitizedUrl || "",
    urlKey: lifecycleUrlKey(rawUrl),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
    incognito: Boolean(tab.incognito)
  };
}

function normalizeLifecycleLog(value) {
  const sessions = value?.version === LOG_VERSION && value?.sessions && typeof value.sessions === "object" ? value.sessions : {};
  const tabIndex = value?.version === LOG_VERSION && value?.tabIndex && typeof value.tabIndex === "object" ? value.tabIndex : {};
  const events = Array.isArray(value?.events) ? value.events.slice(-MAX_EVENTS) : [];
  return {
    version: LOG_VERSION,
    nextSeq: Math.max(1, Number(value?.nextSeq || 1)),
    events,
    sessions: { ...sessions },
    tabIndex: { ...tabIndex },
    lastReconciledAt: value?.lastReconciledAt || "",
    reconcileStats: value?.reconcileStats || null
  };
}

function appendLifecycleEvent(log, event) {
  const { at, ...rest } = event;
  log.events.push({
    seq: log.nextSeq,
    at: new Date(at || Date.now()).toISOString(),
    ...rest
  });
  log.nextSeq += 1;
  if (log.events.length > MAX_EVENTS) log.events = log.events.slice(-MAX_EVENTS);
}

async function persistLifecycleLog(chromeApi, log, now) {
  const pruned = pruneLifecycleLog(log, now);
  await setLocal(chromeApi, STORAGE_KEYS.tabLifecycleLog, pruned);
  return pruned;
}

function pruneLifecycleLog(log, now) {
  let sessions = Object.values(log.sessions).filter((session) => isFreshSession(session, now));
  if (sessions.length > MAX_SESSIONS) {
    sessions = sessions
      .sort((left, right) => Date.parse(right.lastObservedAt || right.closedAt || "") - Date.parse(left.lastObservedAt || left.closedAt || ""))
      .slice(0, MAX_SESSIONS);
  }
  const sessionIds = new Set(sessions.map((session) => session.id));
  return {
    version: LOG_VERSION,
    nextSeq: Math.max(1, log.nextSeq),
    events: log.events.slice(-MAX_EVENTS),
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
    tabIndex: Object.fromEntries(Object.entries(log.tabIndex).filter(([, sessionId]) => sessionIds.has(sessionId))),
    lastReconciledAt: log.lastReconciledAt || "",
    reconcileStats: log.reconcileStats || null
  };
}

function isFreshSession(session, now) {
  const last = Date.parse(session.lastObservedAt || session.closedAt || session.openedAt || "");
  return Number.isFinite(last) && now - last <= SESSION_TTL_MS;
}

function getLifecycleStatsFromLog(log, now) {
  const sessions = Object.values(log.sessions);
  const openSessions = sessions.filter((session) => !session.closedAt);
  const closedSessions = sessions.filter((session) => session.closedAt);
  const inferredClosed = closedSessions.filter((session) => session.closeReason === "missing_after_reconcile").length;
  return {
    sessions: sessions.length,
    openSessions: openSessions.length,
    closedSessions: closedSessions.length,
    inferredClosed,
    events: log.events.length,
    lastReconciledAt: log.lastReconciledAt || "",
    reconcileStats: log.reconcileStats || null,
    olderOpenTabs: openSessions
      .map((session) => ({
        sessionId: session.id,
        tabId: session.tabId,
        windowId: session.windowId,
        title: session.title,
        hostname: session.hostname,
        openedAt: session.openedAt,
        lastObservedAt: session.lastObservedAt,
        activeCount: session.activeCount || 0,
        inferredOpen: Boolean(session.inferredOpen),
        ageMs: Math.max(0, now - Date.parse(session.openedAt || "")),
        idleMs: Math.max(0, now - Date.parse(session.lastObservedAt || session.openedAt || ""))
      }))
      .sort((left, right) => right.ageMs - left.ageMs)
      .slice(0, 50)
  };
}

function buildActivationFlowContext(log, tabs = [], options = {}) {
  const tabIds = new Set((tabs || []).map((tab) => tab?.tabId).filter(Number.isInteger));
  if (!tabIds.size) return emptyActivationFlowContext();
  const runBreakMs = Number.isFinite(options.runBreakMs) ? options.runBreakMs : FLOW_RUN_BREAK_MS;
  const maxDwellMs = Number.isFinite(options.maxDwellMs) ? options.maxDwellMs : FLOW_MAX_DWELL_MS;
  const maxRuns = Number.isFinite(options.maxRuns) ? options.maxRuns : FLOW_MAX_RUNS;
  const maxEvidence = Number.isFinite(options.maxEvidence) ? options.maxEvidence : FLOW_MAX_EVIDENCE;
  const activityByTabId = buildInitialTabActivity(log, tabIds);
  const runs = [];

  const eventsByWindow = new Map();
  for (const event of (log.events || [])
    .filter((event) => event.type === "tab_activated" && Number.isInteger(event.tabId) && Number.isInteger(event.windowId))
    .sort((left, right) => {
      const byTime = Date.parse(left.at || "") - Date.parse(right.at || "");
      return byTime || Number(left.seq || 0) - Number(right.seq || 0);
    })) {
    if (!tabIds.has(event.tabId)) continue;
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at)) continue;
    if (!eventsByWindow.has(event.windowId)) eventsByWindow.set(event.windowId, []);
    eventsByWindow.get(event.windowId).push({ tabId: event.tabId, windowId: event.windowId, at, atIso: event.at });
  }

  for (const events of eventsByWindow.values()) {
    let current = [];
    for (const event of events) {
      const previous = current[current.length - 1];
      if (!previous) {
        current = [event];
        continue;
      }
      const gap = event.at - previous.at;
      if (event.tabId === previous.tabId) continue;
      if (gap <= 0) continue;
      if (gap > runBreakMs) {
        appendActivationRun(runs, current, maxDwellMs);
        current = [event];
        continue;
      }
      current.push(event);
    }
    appendActivationRun(runs, current, maxDwellMs);
  }

  const recentRuns = runs
    .sort((left, right) => Date.parse(right.endedAt || "") - Date.parse(left.endedAt || ""))
    .slice(0, maxRuns)
    .sort((left, right) => Date.parse(left.startedAt || "") - Date.parse(right.startedAt || ""));
  const evidence = buildActivationEvidence(recentRuns, activityByTabId)
    .sort((left, right) => right.strength - left.strength || Date.parse(right.lastAt || "") - Date.parse(left.lastAt || ""))
    .slice(0, maxEvidence);

  return {
    tabActivity: [...activityByTabId.values()]
      .map((activity) => ({
        id: activity.id,
        activeCount: activity.activeCount,
        totalActiveSeconds: Math.round(activity.totalActiveSeconds),
        maxActiveSeconds: Math.round(activity.maxActiveSeconds),
        lastActivatedAt: activity.lastActivatedAt,
        appearedInRuns: activity.appearedInRuns,
        returnedToCount: activity.returnedToCount,
        nearbyIds: topNearbyIds(activity.nearbyCounts)
      }))
      .filter((activity) => activity.activeCount || activity.totalActiveSeconds || activity.appearedInRuns || activity.nearbyIds.length),
    runs: recentRuns.map(compactActivationRun),
    evidence
  };
}

function emptyActivationFlowContext() {
  return { tabActivity: [], runs: [], evidence: [] };
}

function buildInitialTabActivity(log, tabIds) {
  const byTabId = new Map([...tabIds].map((id) => [id, createTabActivity(id)]));
  for (const session of Object.values(log.sessions || {})) {
    if (!tabIds.has(session.tabId)) continue;
    const activity = byTabId.get(session.tabId) || createTabActivity(session.tabId);
    activity.activeCount = Math.max(activity.activeCount, Number(session.activeCount || 0));
    if (isAfter(session.lastActivatedAt, activity.lastActivatedAt)) activity.lastActivatedAt = session.lastActivatedAt || "";
    byTabId.set(session.tabId, activity);
  }
  return byTabId;
}

function createTabActivity(id) {
  return {
    id,
    activeCount: 0,
    totalActiveSeconds: 0,
    maxActiveSeconds: 0,
    lastActivatedAt: "",
    appearedInRuns: 0,
    returnedToCount: 0,
    nearbyCounts: new Map()
  };
}

function appendActivationRun(runs, events, maxDwellMs) {
  if ((events || []).length < 2) return;
  const steps = [];
  const seenIds = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const next = events[index + 1];
    const dwellMs = next ? Math.max(1, Math.min(maxDwellMs, next.at - event.at)) : 0;
    const appearedBefore = seenIds.has(event.tabId);
    steps.push({
      id: event.tabId,
      activeSeconds: next ? Math.max(1, Math.round(dwellMs / 1000)) : 0,
      returnToEarlier: appearedBefore
    });
    seenIds.add(event.tabId);
  }

  const ids = steps.map((step) => step.id);
  const repeatedIds = uniqueOrdered(ids.filter((id, index) => ids.indexOf(id) !== index));
  runs.push({
    windowId: events[0].windowId,
    startedAt: events[0].atIso,
    endedAt: events[events.length - 1].atIso,
    spanSeconds: Math.max(1, Math.round((events[events.length - 1].at - events[0].at) / 1000)),
    ids,
    dwellSeconds: steps.slice(0, -1).map((step) => step.activeSeconds),
    returnToId: repeatedIds[0] || null,
    repeatedIds,
    steps
  });
}

function compactActivationRun(run) {
  const ids = (run.ids || []).slice(0, 24);
  return {
    windowId: run.windowId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    spanSeconds: run.spanSeconds,
    ids,
    dwellSeconds: (run.dwellSeconds || []).slice(0, Math.max(0, ids.length - 1)),
    returnToId: run.returnToId,
    repeatedIds: (run.repeatedIds || []).slice(0, 8)
  };
}

function buildActivationEvidence(runs, activityByTabId) {
  const byIds = new Map();
  for (const run of runs) {
    const runIds = uniqueOrdered(run.ids);
    if (runIds.length < 2) continue;
    for (const id of runIds) {
      const activity = activityByTabId.get(id);
      if (activity) activity.appearedInRuns += 1;
    }
    for (const id of run.repeatedIds || []) {
      const activity = activityByTabId.get(id);
      if (activity) activity.returnedToCount += 1;
    }
    for (let index = 0; index < run.steps.length - 1; index += 1) {
      const step = run.steps[index];
      const activity = activityByTabId.get(step.id);
      if (!activity) continue;
      activity.totalActiveSeconds += Number(step.activeSeconds || 0);
      activity.maxActiveSeconds = Math.max(activity.maxActiveSeconds, Number(step.activeSeconds || 0));
    }
    for (const ids of evidenceWindowsForRun(run)) {
      const key = ids.slice().sort((left, right) => left - right).join(":");
      const entry = byIds.get(key) || {
        ids,
        count: 0,
        lastAt: "",
        returned: false,
        quickHandoff: false,
        longAnchorThenChecks: false
      };
      entry.count += 1;
      if (isAfter(run.endedAt, entry.lastAt)) entry.lastAt = run.endedAt;
      entry.returned = entry.returned || ids.some((id) => (run.repeatedIds || []).includes(id));
      entry.quickHandoff = entry.quickHandoff || hasQuickHandoff(run, ids);
      entry.longAnchorThenChecks = entry.longAnchorThenChecks || hasLongAnchorThenChecks(run, ids);
      byIds.set(key, entry);
      addNearbyCounts(activityByTabId, ids);
    }
  }

  return [...byIds.values()].map((entry) => ({
    ids: entry.ids,
    strength: activationEvidenceStrength(entry),
    count: entry.count,
    lastAt: entry.lastAt,
    clues: activationEvidenceClues(entry)
  }));
}

function evidenceWindowsForRun(run) {
  const uniqueIds = uniqueOrdered(run.ids);
  if (uniqueIds.length <= FLOW_EVIDENCE_WINDOW_SIZE + 1) return [uniqueIds];
  const windows = [];
  for (let index = 0; index < run.steps.length - 1; index += FLOW_EVIDENCE_WINDOW_STEP) {
    const ids = uniqueOrdered(run.steps.slice(index, index + FLOW_EVIDENCE_WINDOW_SIZE).map((step) => step.id));
    if (ids.length >= 2) windows.push(ids);
  }
  return windows;
}

function addNearbyCounts(activityByTabId, ids) {
  for (const id of ids) {
    const activity = activityByTabId.get(id);
    if (!activity) continue;
    for (const nearbyId of ids) {
      if (nearbyId === id) continue;
      activity.nearbyCounts.set(nearbyId, (activity.nearbyCounts.get(nearbyId) || 0) + 1);
    }
  }
}

function topNearbyIds(counts = new Map()) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, FLOW_MAX_NEARBY_IDS)
    .map(([id]) => id);
}

function hasQuickHandoff(run, ids) {
  const idSet = new Set(ids);
  return run.steps.some((step, index) => index < run.steps.length - 1 && idSet.has(step.id) && step.activeSeconds > 0 && step.activeSeconds <= 180);
}

function hasLongAnchorThenChecks(run, ids) {
  const idSet = new Set(ids);
  return run.steps.some((step, index) => {
    const next = run.steps[index + 1];
    return idSet.has(step.id) && step.activeSeconds >= 20 * 60 && next && idSet.has(next.id) && next.activeSeconds > 0 && next.activeSeconds <= 5 * 60;
  });
}

function activationEvidenceStrength(entry) {
  const score =
    0.35 +
    Math.min(0.25, Math.max(0, entry.count - 1) * 0.08) +
    (entry.returned ? 0.18 : 0) +
    (entry.quickHandoff ? 0.08 : 0) +
    (entry.longAnchorThenChecks ? 0.1 : 0);
  return Math.round(Math.min(0.95, score) * 100) / 100;
}

function activationEvidenceClues(entry) {
  return [
    "same activation run",
    entry.returned ? "returned to an earlier tab" : "",
    entry.quickHandoff ? "quick handoff" : "",
    entry.longAnchorThenChecks ? "long anchor then short checks" : "",
    entry.count > 1 ? "repeated together" : ""
  ].filter(Boolean);
}

function uniqueOrdered(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    if (!Number.isInteger(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isAfter(candidate, current) {
  const candidateTime = Date.parse(candidate || "");
  const currentTime = Date.parse(current || "");
  return Number.isFinite(candidateTime) && (!Number.isFinite(currentTime) || candidateTime > currentTime);
}

function lifecycleUrlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.search = "";
    return `u_${stableHash(`${url.protocol}//${url.hostname}${url.pathname.replace(/\/+$/, "") || "/"}`)}`;
  } catch {
    return "";
  }
}

function normalizeNow(value) {
  return Number.isFinite(value) ? value : Date.now();
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
