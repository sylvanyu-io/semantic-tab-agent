import { URL_PRIVACY_MODES } from "../shared/settings.js";
import { STORAGE_KEYS, getLocal, setLocal } from "./storage.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const LOG_VERSION = 1;
const MAX_EVENTS = 1800;
const MAX_SESSIONS = 1800;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RECONCILE_EVENT = "reconcile_snapshot";

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
