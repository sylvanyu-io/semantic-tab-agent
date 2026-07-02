import {
  HOST_PERMISSION_REQUEST_MODES,
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  URL_PRIVACY_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { rememberOpenTabActivity } from "./page-activity-cache.js";
import { requestPageSample } from "./page-sampler.js";
import { STORAGE_KEYS, getLocal, setLocal } from "./storage.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 800;
const BACKGROUND_SAMPLE_TIMEOUT_MS = 1800;

export async function cachedPageSampleForTab(chromeApi, tabDescriptor) {
  const cache = normalizeCache(await getLocal(chromeApi, STORAGE_KEYS.pageSummaryCache, null));
  return cachedSampleFromCache(cache, tabDescriptor);
}

export async function cachedPageSamplesForTabs(chromeApi, tabDescriptors = []) {
  if (!tabDescriptors.length) return [];
  const cache = normalizeCache(await getLocal(chromeApi, STORAGE_KEYS.pageSummaryCache, null));
  return tabDescriptors.map((tabDescriptor) => cachedSampleFromCache(cache, tabDescriptor)).filter(Boolean);
}

function cachedSampleFromCache(cache, tabDescriptor) {
  const key = pageSummaryCacheKey(tabDescriptor.sanitizedUrl || tabDescriptor.fullUrl || "");
  if (!key) return null;

  const entry = cache.entries[key];
  if (!isFreshEntry(entry)) return null;

  return {
    tabId: tabDescriptor.tabId,
    windowId: tabDescriptor.windowId,
    status: "ok",
    origin: entry.origin || "",
    reason: "Cached page summary.",
    sample: entry.sample
  };
}

export async function capturePageSummaryIfAllowed(chromeApi, tab, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.continuousPageSummaries) return { status: "disabled", reason: "Continuous summaries are off." };
  if (!isSafeBackgroundTab(tab)) return { status: "skipped", reason: "Tab is not eligible for background summary capture." };
  await rememberOpenTabActivity(chromeApi, tab).catch(() => null);
  if (!chromeApi.permissions?.contains || !chromeApi.scripting?.executeScript) {
    return { status: "blocked", reason: "Required permissions or scripting API are unavailable." };
  }

  const rawUrl = getTabUrl(tab);
  const origin = hostPermissionPattern(rawUrl);
  if (!origin) return { status: "unsupported_url", reason: "This URL cannot be sampled." };

  const hasAccess = await containsPageAccess(chromeApi, origin);
  if (!hasAccess) return { status: "permission_required", origin, reason: "Host permission is required." };

  const sampleSettings = {
    ...settings,
    pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
    hostPermissionRequestMode: HOST_PERMISSION_REQUEST_MODES.NEVER,
    pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_PERSISTENTLY
  };
  const result = await raceWithTimeout(
    requestPageSample(chromeApi, tab, sampleSettings, "Cache a short page summary for future tab organization."),
    BACKGROUND_SAMPLE_TIMEOUT_MS
  ).catch((error) => ({
    status: "blocked",
    origin,
    reason: /timed out/i.test(String(error?.message || "")) ? "Timed out while caching page summary." : "Could not cache page summary."
  }));

  if (result.status === "ok") {
    await rememberPageSummary(chromeApi, tab, result);
  }
  return result;
}

export async function rememberPageSummary(chromeApi, tab, sampleResult) {
  if (sampleResult?.status !== "ok" || !sampleResult.sample) return null;
  const rawUrl = getTabUrl(tab);
  const key = pageSummaryCacheKey(cacheComparableUrl(rawUrl));
  if (!key) return null;

  const now = Date.now();
  const cache = pruneCache(normalizeCache(await getLocal(chromeApi, STORAGE_KEYS.pageSummaryCache, null)), now);
  const existing = cache.entries[key];
  const nowIso = new Date(now).toISOString();
  cache.entries[key] = {
    key,
    origin: hostPermissionPattern(rawUrl),
    title: String(tab.title || sampleResult.sample.title || "").slice(0, 180),
    firstSeenAt: existing?.firstSeenAt || existing?.sampledAt || nowIso,
    lastSeenAt: nowIso,
    seenCount: Math.min(9999, Number(existing?.seenCount || 0) + 1),
    sampledAt: nowIso,
    lastUsedAt: nowIso,
    sample: normalizeCachedSample(sampleResult.sample)
  };

  const pruned = pruneCache(cache, now);
  await setLocal(chromeApi, STORAGE_KEYS.pageSummaryCache, pruned);
  await rememberOpenTabActivity(chromeApi, tab, sampleResult, { now }).catch(() => null);
  return pruned.entries[key];
}

function normalizeCachedSample(sample = {}) {
  return {
    title: String(sample.title || "").slice(0, 180),
    metaDescription: String(sample.metaDescription || "").slice(0, 360),
    language: String(sample.language || "").slice(0, 32),
    contentKind: String(sample.contentKind || "").slice(0, 32),
    headings: Array.isArray(sample.headings)
      ? sample.headings.map((heading) => String(heading || "").slice(0, 160)).filter(Boolean).slice(0, 12)
      : [],
    visibleText: String(sample.visibleText || "").slice(0, 2600)
  };
}

function normalizeCache(value) {
  const entries = value?.version === CACHE_VERSION && value?.entries && typeof value.entries === "object" ? value.entries : {};
  return { version: CACHE_VERSION, entries: { ...entries } };
}

function pruneCache(cache, now = Date.now()) {
  const freshEntries = Object.values(cache.entries)
    .filter(isFreshEntry)
    .sort((left, right) => Date.parse(right.lastUsedAt || right.sampledAt || 0) - Date.parse(left.lastUsedAt || left.sampledAt || 0))
    .slice(0, CACHE_MAX_ENTRIES);
  return {
    version: CACHE_VERSION,
    entries: Object.fromEntries(freshEntries.map((entry) => [entry.key, entry]))
  };
}

function isFreshEntry(entry) {
  if (!entry?.sample || !entry.key) return false;
  const sampledAt = Date.parse(entry.sampledAt || "");
  return Number.isFinite(sampledAt) && Date.now() - sampledAt <= CACHE_TTL_MS;
}

function isSafeBackgroundTab(tab) {
  if (!tab || typeof (tab.id ?? tab.tabId) !== "number") return false;
  if (tab.incognito) return false;
  if (tab.discarded || tab.frozen) return false;
  return canSampleUrl(getTabUrl(tab));
}

function pageSummaryCacheKey(rawUrl) {
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

function cacheComparableUrl(rawUrl) {
  return sanitizeTabUrl(rawUrl, URL_PRIVACY_MODES.SANITIZED_URL).sanitizedUrl || rawUrl;
}

function hostPermissionPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function containsPageAccess(chromeApi, origin) {
  const hasScripting = await chromeApi.permissions.contains({ permissions: ["scripting"] });
  if (!hasScripting) return false;
  if (await chromeApi.permissions.contains({ origins: [origin] })) return true;
  const broadOrigin = origin.startsWith("https://") ? "https://*/*" : origin.startsWith("http://") ? "http://*/*" : "";
  return Boolean(broadOrigin && (await chromeApi.permissions.contains({ origins: [broadOrigin] })));
}

function raceWithTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Page summary caching timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
