import { LANGUAGE_MODES, LANGUAGE_MODE_VALUES, normalizeLanguageMode } from "./language.js";

export { LANGUAGE_MODES } from "./language.js";

export const ORGANIZE_MODES = Object.freeze({
  CURRENT_WINDOW: "current_window",
  CONSOLIDATE_ONE_WINDOW: "consolidate_one_window"
});

export const TARGET_WINDOW_MODES = Object.freeze({
  NEW_WINDOW: "new_window",
  CURRENT_WINDOW: "current_window",
  SELECTED_WINDOW: "selected_window"
});

export const EXISTING_GROUP_MODES = Object.freeze({
  PRESERVE: "preserve_existing_groups",
  DISSOLVE: "dissolve_existing_groups"
});

export const REVIEW_GROUP_MODES = Object.freeze({
  CREATE: "create_review_group",
  LEAVE_UNGROUPED: "leave_review_ungrouped"
});

export const PAGE_CONTEXT_MODES = Object.freeze({
  OFF: "off",
  ACTIVE_TAB_ONLY: "active_tab_only",
  AMBIGUOUS_WITH_PERMISSION: "ambiguous_with_permission",
  ALL_GRANTED_ORIGINS: "all_granted_origins"
});

export const HOST_PERMISSION_REQUEST_MODES = Object.freeze({
  NEVER: "never",
  ASK_PER_ORIGIN: "ask_per_origin",
  ASK_FOR_ALL_VISIBLE_ORIGINS: "ask_for_all_visible_origins"
});

export const PAGE_SAMPLING_CONSENT_MODES = Object.freeze({
  NOT_ACKNOWLEDGED: "not_acknowledged",
  ACKNOWLEDGED_FOR_SESSION: "acknowledged_for_session",
  ACKNOWLEDGED_PERSISTENTLY: "acknowledged_persistently"
});

export const UNDO_TARGET_WINDOW_MODES = Object.freeze({
  LEAVE_EMPTY: "leave_empty_target_window",
  CLOSE_EMPTY_CREATED: "close_empty_created_target_window"
});

export const URL_PRIVACY_MODES = Object.freeze({
  TITLE_ONLY: "title_only",
  SANITIZED_URL: "sanitized_url",
  FULL_URL: "full_url"
});

export const PROMPT_PRESETS = Object.freeze({
  CONSERVATIVE: "conservative",
  MEDIA_TYPE: "media_type",
  READ_LATER: "read_later",
  AGGRESSIVE_CLEANUP: "aggressive_cleanup"
});

export const GROUPING_GRANULARITIES = Object.freeze({
  COMPACT: "compact",
  BALANCED: "balanced",
  DETAILED: "detailed"
});

export const PLANNER_PROVIDERS = Object.freeze({
  FAKE: "fake",
  GATEWAY: "gateway"
});

export const GATEWAY_PROVIDER_MODES = Object.freeze({
  BUILTIN: "builtin",
  CUSTOM: "custom"
});

export const BUILTIN_GATEWAY_BASE_URL = "https://cliproxy.sylvanyu.io/v1";
export const DEFAULT_GATEWAY_BASE_URL = "";
const LEGACY_DEFAULT_GATEWAY_BASE_URLS = new Set([BUILTIN_GATEWAY_BASE_URL]);

export const GATEWAY_MODELS = Object.freeze(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "claude-opus-4-8", "claude-sonnet-4-6"]);
export const GATEWAY_CUSTOM_MODEL_VALUE = "custom";
export const GATEWAY_AUXILIARY_MODELS = Object.freeze(["gpt-5.3-codex-spark", "gpt-5.4-mini", "same_as_primary"]);
const MAX_CUSTOM_GATEWAY_MODEL_LENGTH = 160;

export const THINKING_INTENSITIES = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  ULTRA: "ultra"
});

export const PROMPT_PRESET_TEXT = Object.freeze({
  conservative:
    "Default smart organization. Group by semantic topic, current task, and user intent. Use original tab adjacency as context. Avoid domain-only groups unless the platform itself is the task. Keep unknown or mixed pages in Review.",
  media_type:
    "Media-type organization. Use page or information shape as the primary axis: documentation, code/issues/PRs, papers, videos, articles/news, dashboards, shopping/finance, search results, mail/chat, and local tools. Keep the same media type together across domains and projects; only split when the group would be too large or pages are clearly different media types.",
  read_later:
    "Best for reading queues. Group articles, videos, papers, docs, newsletters, and tutorials by topic and intended action. Separate quick reads, deep reads, watch later, reference docs, and items that look like follow-up tasks.",
  aggressive_cleanup:
    "Use bolder grouping. Merge small related groups when the intent is close, while still placing low-confidence tabs in Review."
});

export const DEFAULT_SETTINGS = Object.freeze({
  organizeMode: ORGANIZE_MODES.CURRENT_WINDOW,
  targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW,
  existingGroupMode: EXISTING_GROUP_MODES.PRESERVE,
  reviewGroupMode: REVIEW_GROUP_MODES.CREATE,
  pageContextMode: PAGE_CONTEXT_MODES.OFF,
  hostPermissionRequestMode: HOST_PERMISSION_REQUEST_MODES.NEVER,
  pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED,
  urlPrivacyMode: URL_PRIVACY_MODES.SANITIZED_URL,
  includePinnedTabs: false,
  includeIncognitoTabs: false,
  collapseGroupsAfterApply: true,
  continuousPageSummaries: false,
  analyzeGrouping: true,
  analyzeCleanup: true,
  minConfidenceToApply: 0.65,
  maxTabsPerGroup: 40,
  undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.LEAVE_EMPTY,
  languageMode: LANGUAGE_MODES.AUTO,
  promptPreset: PROMPT_PRESETS.CONSERVATIVE,
  groupingGranularity: GROUPING_GRANULARITIES.BALANCED,
  customPrompt: "",
  selectedTargetWindowId: null,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  gatewayProviderMode: GATEWAY_PROVIDER_MODES.BUILTIN,
  rememberProviderKeys: false,
  gatewayBaseUrl: DEFAULT_GATEWAY_BASE_URL,
  gatewayModel: "gpt-5.4",
  gatewayAuxiliaryModel: "gpt-5.3-codex-spark",
  gatewayCustomModel: "",
  gatewayCustomAuxiliaryModel: "",
  gatewayThinkingIntensity: THINKING_INTENSITIES.HIGH,
  gatewayApiKey: ""
});

const enumValues = {
  organizeMode: Object.values(ORGANIZE_MODES),
  targetWindowMode: Object.values(TARGET_WINDOW_MODES),
  existingGroupMode: Object.values(EXISTING_GROUP_MODES),
  reviewGroupMode: Object.values(REVIEW_GROUP_MODES),
  pageContextMode: Object.values(PAGE_CONTEXT_MODES),
  hostPermissionRequestMode: Object.values(HOST_PERMISSION_REQUEST_MODES),
  pageSamplingConsentMode: Object.values(PAGE_SAMPLING_CONSENT_MODES),
  undoTargetWindowMode: Object.values(UNDO_TARGET_WINDOW_MODES),
  urlPrivacyMode: Object.values(URL_PRIVACY_MODES),
  languageMode: LANGUAGE_MODE_VALUES,
  promptPreset: Object.values(PROMPT_PRESETS),
  groupingGranularity: Object.values(GROUPING_GRANULARITIES),
  plannerProvider: Object.values(PLANNER_PROVIDERS),
  gatewayProviderMode: Object.values(GATEWAY_PROVIDER_MODES),
  gatewayAuxiliaryModel: GATEWAY_AUXILIARY_MODELS,
  gatewayThinkingIntensity: Object.values(THINKING_INTENSITIES)
};

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };

  for (const [key, values] of Object.entries(enumValues)) {
    if (!values.includes(merged[key])) {
      merged[key] = DEFAULT_SETTINGS[key];
    }
  }
  merged.targetWindowMode = TARGET_WINDOW_MODES.CURRENT_WINDOW;
  merged.undoTargetWindowMode = UNDO_TARGET_WINDOW_MODES.LEAVE_EMPTY;

  merged.includePinnedTabs = Boolean(merged.includePinnedTabs);
  merged.includeIncognitoTabs = Boolean(merged.includeIncognitoTabs);
  merged.collapseGroupsAfterApply = Boolean(merged.collapseGroupsAfterApply);
  merged.continuousPageSummaries = Boolean(merged.continuousPageSummaries);
  merged.analyzeGrouping = Boolean(merged.analyzeGrouping);
  merged.analyzeCleanup = Boolean(merged.analyzeCleanup);
  if (!merged.analyzeGrouping && !merged.analyzeCleanup) {
    merged.analyzeGrouping = true;
  }
  merged.rememberProviderKeys = Boolean(merged.rememberProviderKeys);
  merged.minConfidenceToApply = clampNumber(merged.minConfidenceToApply, 0, 1, DEFAULT_SETTINGS.minConfidenceToApply);
  merged.maxTabsPerGroup = Math.max(1, Number.parseInt(merged.maxTabsPerGroup, 10) || DEFAULT_SETTINGS.maxTabsPerGroup);
  merged.languageMode = normalizeLanguageMode(merged.languageMode);
  merged.customPrompt = String(merged.customPrompt || "").slice(0, 4000);
  merged.gatewayBaseUrl = normalizeOptionalBaseUrl(merged.gatewayBaseUrl);
  merged.gatewayCustomModel = normalizeGatewayCustomModel(merged.gatewayCustomModel);
  merged.gatewayCustomAuxiliaryModel = normalizeGatewayCustomModel(merged.gatewayCustomAuxiliaryModel);
  merged.gatewayModel = normalizeGatewayModel(merged.gatewayModel);
  if (shouldPreferManualGatewayModel(merged) || merged.gatewayProviderMode === GATEWAY_PROVIDER_MODES.CUSTOM) {
    merged.gatewayProviderMode = GATEWAY_PROVIDER_MODES.CUSTOM;
    merged.gatewayModel = GATEWAY_CUSTOM_MODEL_VALUE;
    merged.gatewayAuxiliaryModel = "same_as_primary";
  }
  merged.gatewayApiKey = String(merged.gatewayApiKey || "").trim();
  if (!merged.gatewayBaseUrl) {
    merged.gatewayApiKey = "";
    merged.rememberProviderKeys = false;
  }
  const selectedTargetWindowId =
    merged.selectedTargetWindowId === null || merged.selectedTargetWindowId === ""
      ? null
      : Number(merged.selectedTargetWindowId);
  merged.selectedTargetWindowId = Number.isInteger(selectedTargetWindowId) && selectedTargetWindowId > 0 ? selectedTargetWindowId : null;

  return merged;
}

function clampNumber(value, min, max, fallback) {
  if (typeof value === "string" && !value.trim()) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeOptionalBaseUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    const url = new URL(rawValue);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    const normalized = url.toString().replace(/\/$/, "");
    return LEGACY_DEFAULT_GATEWAY_BASE_URLS.has(normalized) ? "" : normalized;
  } catch {
    return "";
  }
}

function normalizeGatewayModel(value) {
  const model = String(value || "").trim();
  if (model === GATEWAY_CUSTOM_MODEL_VALUE) return GATEWAY_CUSTOM_MODEL_VALUE;
  return GATEWAY_MODELS.includes(model) ? model : DEFAULT_SETTINGS.gatewayModel;
}

function normalizeGatewayCustomModel(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_CUSTOM_GATEWAY_MODEL_LENGTH);
}

export function resolveGatewayModel(settings = DEFAULT_SETTINGS) {
  if (usesManualGatewayModel(settings)) {
    return settings.gatewayCustomModel || "";
  }
  return settings.gatewayModel || DEFAULT_SETTINGS.gatewayModel;
}

function shouldPreferManualGatewayModel(settings = {}) {
  return Boolean(settings.gatewayBaseUrl && settings.gatewayCustomModel);
}

function usesManualGatewayModel(settings = {}) {
  return (
    settings.gatewayProviderMode === GATEWAY_PROVIDER_MODES.CUSTOM ||
    settings.gatewayModel === GATEWAY_CUSTOM_MODEL_VALUE ||
    shouldPreferManualGatewayModel(settings)
  );
}

export function isCustomGatewayProvider(settings = DEFAULT_SETTINGS) {
  return settings.gatewayProviderMode === GATEWAY_PROVIDER_MODES.CUSTOM || Boolean(settings.gatewayBaseUrl);
}

export function resolveGatewayAuxiliaryModel(settings = DEFAULT_SETTINGS) {
  if (usesManualGatewayModel(settings)) {
    return settings.gatewayCustomAuxiliaryModel || resolveGatewayModel(settings);
  }
  if (settings.gatewayAuxiliaryModel === "same_as_primary") {
    return resolveGatewayModel(settings);
  }
  return GATEWAY_AUXILIARY_MODELS.includes(settings.gatewayAuxiliaryModel)
    ? settings.gatewayAuxiliaryModel
    : DEFAULT_SETTINGS.gatewayAuxiliaryModel;
}
