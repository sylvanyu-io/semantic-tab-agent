import { URL_PRIVACY_MODES } from "../shared/settings.js";
import { STORAGE_KEYS, getLocal, setLocal } from "./storage.js";
import { getTabLifecycleStats } from "./tab-lifecycle-log.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1400;
const DEFAULT_RECAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OLD_TAB_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const OLD_TAB_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export async function rememberOpenTabActivity(chromeApi, tab, sampleResult = null, options = {}) {
  if (tab?.incognito && !options.includeIncognitoTabs) return null;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cache = pruneActivityCache(normalizeActivityCache(await getLocal(chromeApi, STORAGE_KEYS.pageActivityCache, null)), now);
  const key = upsertActivityEntry(cache, tab, sampleResult, now);
  if (!key) return null;

  const pruned = pruneActivityCache(cache, now);
  await setLocal(chromeApi, STORAGE_KEYS.pageActivityCache, pruned);
  return pruned.entries[key];
}

export async function rememberOpenTabsActivity(chromeApi, tabs = [], options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cache = pruneActivityCache(normalizeActivityCache(await getLocal(chromeApi, STORAGE_KEYS.pageActivityCache, null)), now);
  let stored = 0;
  for (const tab of tabs) {
    if (tab?.incognito && !options.includeIncognitoTabs) continue;
    if (upsertActivityEntry(cache, tab, null, now)) stored += 1;
  }
  if (stored) {
    await setLocal(chromeApi, STORAGE_KEYS.pageActivityCache, pruneActivityCache(cache, now));
  }
  return { stored };
}

function upsertActivityEntry(cache, tab, sampleResult, now) {
  const rawUrl = activityTabUrl(tab);
  const key = pageActivityCacheKey(rawUrl);
  if (!key) return "";

  const nowIso = new Date(now).toISOString();
  const urlInfo = sanitizeTabUrl(rawUrl, URL_PRIVACY_MODES.SANITIZED_URL);
  const existing = cache.entries[key];
  const sample = sampleResult?.status === "ok" ? normalizeActivitySample(sampleResult.sample) : existing?.sample || null;

  cache.entries[key] = {
    key,
    title: String(tab?.title || sample?.title || existing?.title || "").slice(0, 180),
    hostname: urlInfo.hostname || existing?.hostname || "",
    sanitizedUrl: urlInfo.sanitizedUrl || existing?.sanitizedUrl || "",
    sampleable: canSampleUrl(rawUrl),
    firstSeenAt: existing?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    seenCount: Math.min(9999, Number(existing?.seenCount || 0) + 1),
    lastTabId: typeof (tab?.id ?? tab?.tabId) === "number" ? tab.id ?? tab.tabId : existing?.lastTabId ?? null,
    lastWindowId: typeof tab?.windowId === "number" ? tab.windowId : existing?.lastWindowId ?? null,
    lastKnownState: {
      discarded: Boolean(tab?.discarded),
      pinned: Boolean(tab?.pinned),
      audible: Boolean(tab?.audible),
      incognito: Boolean(tab?.incognito)
    },
    ...(sample ? { sample } : {})
  };
  return key;
}

export async function getActivityOverview(chromeApi, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const rangeMs = normalizeRangeMs(options.rangeMs);
  const cache = pruneActivityCache(normalizeActivityCache(await getLocal(chromeApi, STORAGE_KEYS.pageActivityCache, null)), now);
  const currentTabs = await collectCurrentNormalTabs(chromeApi, options);
  const lifecycle = await getTabLifecycleStats(chromeApi, { now });
  const lifecycleByTabId = new Map((lifecycle.olderOpenTabs || []).map((tab) => [tab.tabId, tab]));
  const since = now - rangeMs;
  const entries = Object.values(cache.entries)
    .filter((entry) => activityTimeForRange(entry) >= since)
    .sort((left, right) => Date.parse(right.lastSeenAt || "") - Date.parse(left.lastSeenAt || ""));
  const openTabEntries = matchOpenTabsToActivity(currentTabs, cache.entries, now, lifecycleByTabId);
  const staleTabs = openTabEntries
    .filter((item) => item.ageMs >= OLD_TAB_AGE_MS || item.idleMs >= OLD_TAB_IDLE_MS)
    .sort((left, right) => right.ageMs - left.ageMs || right.idleMs - left.idleMs)
    .slice(0, 30);

  return {
    rangeMs,
    since: new Date(since).toISOString(),
    generatedAt: new Date(now).toISOString(),
    cache: {
      entries: Object.keys(cache.entries).length,
      sampledEntries: Object.values(cache.entries).filter((entry) => entry.sample).length
    },
    openTabs: {
      total: currentTabs.length,
      tracked: openTabEntries.length,
      staleCandidates: staleTabs.length
    },
    openTabSignals: openTabEntries,
    lifecycle,
    recap: buildLocalRecap(entries, rangeMs),
    staleTabs
  };
}

function buildLocalRecap(entries, rangeMs) {
  const hosts = new Map();
  const words = new Map();
  for (const entry of entries) {
    if (entry.hostname) hosts.set(entry.hostname, (hosts.get(entry.hostname) || 0) + 1);
    for (const token of titleTokens([entry.title, entry.sample?.title, entry.sample?.metaDescription, ...(entry.sample?.headings || [])].join(" "))) {
      words.set(token, (words.get(token) || 0) + 1);
    }
  }
  return {
    entries: entries.length,
    sampledEntries: entries.filter((entry) => entry.sample).length,
    label: rangeLabel(rangeMs),
    topHosts: topPairs(hosts, 6),
    topTerms: topPairs(words, 8),
    recentPages: entries.slice(0, 10).map((entry) => ({
      title: entry.title || entry.sample?.title || entry.hostname || "Untitled",
      hostname: entry.hostname,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      seenCount: entry.seenCount || 1,
      hasSummary: Boolean(entry.sample)
    }))
  };
}

function matchOpenTabsToActivity(tabs, entriesByKey, now, lifecycleByTabId = new Map()) {
  return tabs
    .map((tab) => {
      const key = pageActivityCacheKey(activityTabUrl(tab));
      const entry = key ? entriesByKey[key] : null;
      if (!entry) return null;
      const lifecycle = lifecycleByTabId.get(tab.id) || null;
      const firstSeenAt = lifecycle?.openedAt || entry.firstSeenAt || "";
      const lastSeenAt = latestIso(lifecycle?.lastObservedAt, entry.lastSeenAt) || entry.lastSeenAt || "";
      const firstSeen = Date.parse(firstSeenAt || "");
      const lastSeen = Date.parse(lastSeenAt || "");
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        index: Number.isFinite(tab.index) ? tab.index : null,
        title: String(tab.title || entry.title || "").slice(0, 180),
        hostname: entry.hostname || "",
        sanitizedUrl: entry.sanitizedUrl || "",
        firstSeenAt,
        lastSeenAt,
        firstSeenSource: lifecycle ? "tab_session" : "page_memory",
        ageMs: Number.isFinite(firstSeen) ? now - firstSeen : 0,
        idleMs: Number.isFinite(lastSeen) ? now - lastSeen : 0,
        activeCount: Number(lifecycle?.activeCount || 0),
        currentGroupTitle: tab.currentGroup?.title || "",
        currentGroupColor: tab.currentGroup?.color || "",
        summary: entry.sample
          ? {
              title: entry.sample.title || "",
              metaDescription: entry.sample.metaDescription || "",
              contentKind: entry.sample.contentKind || "",
              headings: Array.isArray(entry.sample.headings) ? entry.sample.headings.slice(0, 3) : []
            }
          : null,
        discarded: Boolean(tab.discarded),
        pinned: Boolean(tab.pinned)
      };
    })
    .filter(Boolean);
}

function latestIso(...values) {
  return values
    .map((value) => ({ value, time: Date.parse(value || "") }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => right.time - left.time)[0]?.value || "";
}

function activityTimeForRange(entry) {
  const times = [entry.sampledAt, entry.firstSeenAt, entry.lastSeenAt]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

async function collectCurrentNormalTabs(chromeApi, options = {}) {
  const windows = (await chromeApi.windows?.getAll?.({ populate: true, windowTypes: ["normal"] }).catch(() => [])) || [];
  const groupsById = await collectTabGroupsById(chromeApi, windows);
  return windows
    .flatMap((window) =>
      (window.tabs || []).map((tab) => ({
        ...tab,
        currentGroup: tab.groupId !== undefined && tab.groupId !== -1 ? groupsById.get(tab.groupId) || null : null
      }))
    )
    .filter((tab) => typeof tab.id === "number" && (!tab.incognito || options.includeIncognitoTabs) && canSampleUrl(activityTabUrl(tab)));
}

async function collectTabGroupsById(chromeApi, windows = []) {
  const groupsById = new Map();
  if (!chromeApi.tabGroups?.query) return groupsById;
  for (const window of windows) {
    const groups = await chromeApi.tabGroups.query({ windowId: window.id }).catch(() => []);
    for (const group of groups) groupsById.set(group.id, group);
  }
  return groupsById;
}

function normalizeActivitySample(sample = {}) {
  return {
    title: String(sample.title || "").slice(0, 180),
    metaDescription: String(sample.metaDescription || "").slice(0, 240),
    language: String(sample.language || "").slice(0, 32),
    contentKind: String(sample.contentKind || "").slice(0, 32),
    headings: Array.isArray(sample.headings)
      ? sample.headings.map((heading) => String(heading || "").slice(0, 120)).filter(Boolean).slice(0, 8)
      : []
  };
}

function normalizeActivityCache(value) {
  const entries = value?.version === CACHE_VERSION && value?.entries && typeof value.entries === "object" ? value.entries : {};
  return { version: CACHE_VERSION, entries: { ...entries } };
}

function pruneActivityCache(cache, now = Date.now()) {
  const freshEntries = Object.values(cache.entries)
    .filter((entry) => isFreshActivityEntry(entry, now))
    .sort((left, right) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0))
    .slice(0, CACHE_MAX_ENTRIES);
  return {
    version: CACHE_VERSION,
    entries: Object.fromEntries(freshEntries.map((entry) => [entry.key, entry]))
  };
}

function isFreshActivityEntry(entry, now) {
  if (!entry?.key) return false;
  const lastSeenAt = Date.parse(entry.lastSeenAt || "");
  return Number.isFinite(lastSeenAt) && now - lastSeenAt <= CACHE_TTL_MS;
}

function pageActivityCacheKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `u_${stableHash(`${url.protocol}//${url.hostname}${url.pathname}`)}`;
  } catch {
    return "";
  }
}

function activityTabUrl(tab) {
  return getTabUrl(tab) || tab?.sanitizedUrl || tab?.fullUrl || "";
}

function normalizeRangeMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_RECAP_WINDOW_MS;
  return Math.min(45 * 24 * 60 * 60 * 1000, Math.max(60 * 60 * 1000, numeric));
}

function rangeLabel(rangeMs) {
  const days = Math.round(rangeMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d`;
  return `${Math.round(rangeMs / (60 * 60 * 1000))}h`;
}

function titleTokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}+#.-]+/u)
    .filter((token) => token.length >= 2 && token.length <= 28 && !STOP_WORDS.has(token))
    .slice(0, 80);
}

function topPairs(map, limit) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "you",
  "your",
  "are",
  "com",
  "www",
  "https",
  "http",
  "一个",
  "这个",
  "那个",
  "以及",
  "关于",
  "页面"
]);
