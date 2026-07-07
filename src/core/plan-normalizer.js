import { isReviewLikeGroup, localizedText } from "../shared/language.js";
import { REVIEW_GROUP_MODES, normalizeSettings } from "../shared/settings.js";

export function normalizePlanForSettings(plan, inventory, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const orderedPlan = normalizePlanOrder(plan, inventory);
  const reviewNormalizedPlan = hoistReviewLikeGroupsToReviewTabs(orderedPlan);
  if (settings.reviewGroupMode !== REVIEW_GROUP_MODES.LEAVE_UNGROUPED) {
    return normalizePlanOrder(reviewNormalizedPlan, inventory);
  }
  return normalizePlanOrder(assignReviewTabsToClosestGroups(reviewNormalizedPlan, inventory, settings), inventory);
}

export function normalizePlanOrder(plan, inventory) {
  if (!plan || typeof plan !== "object") return plan;

  return {
    ...plan,
    groups: Array.isArray(plan.groups)
      ? orderGroupsByOriginalPosition(
          plan.groups.map((group) => ({
            ...group,
            tabRefs: Array.isArray(group?.tabRefs) ? sortRefsByOriginalOrder(group.tabRefs, inventory) : group?.tabRefs
          })),
          inventory
        )
      : plan.groups,
    reviewTabs: Array.isArray(plan.reviewTabs) ? sortRefsByOriginalOrder(plan.reviewTabs, inventory) : plan.reviewTabs
  };
}

function assignReviewTabsToClosestGroups(plan, inventory, settings) {
  if (!plan || typeof plan !== "object") return plan;
  if (!Array.isArray(plan.groups) || !Array.isArray(plan.reviewTabs)) return plan;

  const groups = asArray(plan.groups).map((group) => ({
    ...group,
    tabRefs: Array.isArray(group?.tabRefs) ? [...group.tabRefs] : group?.tabRefs
  }));
  const reviewRefs = [];
  const topicGroups = [];
  const seenReviewTabIds = new Set();

  for (const group of groups) {
    if (isReviewLikeGroup(group)) {
      for (const ref of asArray(group.tabRefs)) {
        if (!isValidRef(ref) || seenReviewTabIds.has(ref.tabId)) continue;
        seenReviewTabIds.add(ref.tabId);
        reviewRefs.push(ref);
      }
      continue;
    }
    topicGroups.push(group);
  }

  for (const ref of asArray(plan.reviewTabs)) {
    if (!isValidRef(ref) || seenReviewTabIds.has(ref.tabId)) continue;
    seenReviewTabIds.add(ref.tabId);
    reviewRefs.push(ref);
  }

  if (!reviewRefs.length) {
    return { ...plan, groups: topicGroups, reviewTabs: [] };
  }

  const tabOrder = buildTabOrder(inventory);
  const maxTabsPerGroup = Math.max(1, Number(settings.maxTabsPerGroup) || 40);
  const orderedReviewRefs = sortRefsByOriginalOrder(reviewRefs, inventory);

  for (const ref of orderedReviewRefs) {
    const target = closestGroupWithRoom(topicGroups, ref, tabOrder, maxTabsPerGroup) || createFallbackGroup(topicGroups, settings);
    target.tabRefs = [...asArray(target.tabRefs), { tabId: ref.tabId, windowId: ref.windowId }];
  }

  return {
    ...plan,
    groups: topicGroups,
    reviewTabs: []
  };
}

function hoistReviewLikeGroupsToReviewTabs(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) return plan;

  const groups = [];
  const reviewTabs = Array.isArray(plan.reviewTabs) ? [...plan.reviewTabs] : [];
  const reviewIds = new Set(reviewTabs.filter(isValidRef).map((ref) => ref.tabId));

  for (const group of plan.groups) {
    if (!isReviewLikeGroup(group)) {
      groups.push(group);
      continue;
    }

    for (const ref of asArray(group.tabRefs)) {
      if (!isValidRef(ref) || reviewIds.has(ref.tabId)) continue;
      reviewIds.add(ref.tabId);
      reviewTabs.push({
        tabId: ref.tabId,
        windowId: ref.windowId,
        reason: ref.reason || group.reason || ""
      });
    }
  }

  return {
    ...plan,
    groups,
    reviewTabs
  };
}

function closestGroupWithRoom(groups, ref, tabOrder, maxTabsPerGroup) {
  const order = tabOrder(ref.tabId);
  let best = null;
  for (const group of groups) {
    const refs = asArray(group.tabRefs);
    if (!refs.length || refs.length >= maxTabsPerGroup) continue;
    const distance = Math.min(...refs.map((candidate) => Math.abs(tabOrder(candidate.tabId) - order)));
    const firstOrder = firstGroupOrder(group, tabOrder);
    if (!best || distance < best.distance || (distance === best.distance && firstOrder < best.firstOrder)) {
      best = { group, distance, firstOrder };
    }
  }
  return best?.group || null;
}

function createFallbackGroup(groups, settings) {
  const index = groups.filter((group) => String(group.groupKey || "").startsWith("closest-fit")).length + 1;
  const group = {
    groupKey: `closest-fit-${index}`,
    title: localizedText(settings.languageMode, "综合整理", "Closest Fit"),
    color: "blue",
    confidence: Math.max(settings.minConfidenceToApply || 0.65, 0.65),
    tabRefs: [],
    reason: localizedText(
      settings.languageMode,
      "这些页面没有更稳定的独立主题，已按设置归入最接近的整理组。",
      "These tabs did not form a stronger separate topic, so they were placed into the closest useful group."
    )
  };
  groups.push(group);
  return group;
}

function isValidRef(ref) {
  return ref && typeof ref.tabId === "number" && typeof ref.windowId === "number";
}

function sortRefsByOriginalOrder(refs, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(refs).sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(groups).sort((left, right) => {
    const leftReviewLike = isReviewLikeGroup(left);
    const rightReviewLike = isReviewLikeGroup(right);
    if (leftReviewLike !== rightReviewLike) return leftReviewLike ? 1 : -1;
    return firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder);
  });
}

function firstGroupOrder(group, tabOrder) {
  const orders = asArray(group?.tabRefs).map((ref) => tabOrder(ref.tabId));
  return orders.length ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
}

function buildTabOrder(inventory) {
  const order = new Map();
  for (const [fallbackIndex, tab] of (inventory.plannerTabs || []).entries()) {
    const value = Number.isInteger(tab.sequenceIndex) ? tab.sequenceIndex : fallbackIndex;
    order.set(tab.tabId, value);
  }
  return (tabId) => order.get(tabId) ?? Number.MAX_SAFE_INTEGER;
}

function asArray(value) {
  return Array.isArray(value) ? [...value] : [];
}
