import { ORGANIZE_MODES, REVIEW_GROUP_MODES, normalizeSettings } from "../shared/settings.js";
import { reviewGroupReason, reviewGroupTitle } from "../shared/language.js";

export function buildPreview(plan, inventory, validation, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const groupedTabIds = new Set((plan.groups || []).flatMap((group) => (group.tabRefs || []).map((ref) => ref.tabId)));
  const reviewTabIds = new Set((plan.reviewTabs || []).map((ref) => ref.tabId));
  const movedTabsCount =
    settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
      ? new Set([...(inventory.tabs || []).map((tab) => tab.tabId)]).size
      : 0;

  return {
    mode: settings.organizeMode,
    analysisFeatures: {
      grouping: Boolean(settings.analyzeGrouping),
      cleanup: Boolean(settings.analyzeCleanup)
    },
    targetWindow: plan.targetWindow || null,
    requiresConfirmation: settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    canApply: Boolean(validation?.ok),
    totalTabsCount: (inventory.tabs || []).length + (inventory.excludedTabs || []).length,
    eligibleTabsCount: (inventory.plannerTabs || []).length,
    windowCount: (inventory.windows || []).length,
    groupedTabsCount: groupedTabIds.size,
    reviewTabsCount: reviewTabIds.size,
    excludedTabsCount: (inventory.excludedTabs || []).length,
    lockedGroupsCount: (inventory.lockedGroups || []).length,
    movedTabsCount,
    reviewGroupWillBeCreated: settings.reviewGroupMode === REVIEW_GROUP_MODES.CREATE && reviewTabIds.size > 0,
    reviewGroupTitle: reviewGroupTitle(settings.languageMode),
    reviewGroupReason: reviewGroupReason(settings.languageMode),
    languageMode: settings.languageMode,
    pageSampling: summarizePageSamples(inventory.pageSamples || []),
    cleanup: summarizeCleanup(plan.cleanup, settings),
    groups: (plan.groups || []).map((group) => ({
      groupKey: group.groupKey,
      title: group.title,
      color: group.color,
      confidence: group.confidence,
      reason: group.reason,
      tabCount: (group.tabRefs || []).length
    })),
    warnings: [
      ...(validation?.warnings || []),
      ...((inventory.lockedGroups || []).length
        ? [`${inventory.lockedGroups.length} existing group(s) are locked by current settings.`]
        : []),
      ...(settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? [`${movedTabsCount} eligible tab(s) will be moved into one target window.`]
        : [])
    ]
  };
}

function summarizeCleanup(cleanup, settings) {
  if (!settings.analyzeCleanup || !cleanup) return null;
  const candidates = Array.isArray(cleanup.candidates) ? cleanup.candidates : [];
  return {
    schema: cleanup.schema || "tab_recap_cleanup_v1",
    summary: String(cleanup.summary || "").slice(0, 220),
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      tabId: candidate.tabId,
      windowId: candidate.windowId,
      index: candidate.index,
      sequenceIndex: candidate.sequenceIndex,
      title: String(candidate.title || "").slice(0, 160),
      hostname: String(candidate.hostname || "").slice(0, 120),
      sanitizedUrl: String(candidate.sanitizedUrl || "").slice(0, 180),
      currentGroupTitle: String(candidate.currentGroupTitle || "").slice(0, 80),
      ageMs: Number(candidate.ageMs || 0),
      idleMs: Number(candidate.idleMs || 0),
      activeCount: Number(candidate.activeCount || 0),
      priority: candidate.priority || "medium",
      reason: String(candidate.reason || "").slice(0, 220),
      evidence: Array.isArray(candidate.evidence) ? candidate.evidence.slice(0, 4).map((item) => String(item || "").slice(0, 120)) : [],
      summary: candidate.summary || null
    }))
  };
}

function summarizePageSamples(results) {
  return {
    requested: results.length,
    ok: results.filter((result) => result.status === "ok").length,
    permissionRequired: results.filter((result) => result.status === "permission_required").length,
    blocked: results.filter((result) => ["blocked", "discarded", "permission_denied", "unsupported_url", "missing"].includes(result.status)).length
  };
}
