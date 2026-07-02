import {
  EXISTING_GROUP_MODES,
  ORGANIZE_MODES,
  REVIEW_GROUP_MODES,
  TARGET_WINDOW_MODES,
  UNDO_TARGET_WINDOW_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { reviewGroupTitle } from "../shared/language.js";
import { normalizePlanForSettings } from "./plan-normalizer.js";
import { validatePlan } from "./plan-validator.js";

const NO_GROUP_ID = -1;

export async function applyValidatedPlan(chromeApi, plan, inventory, rawSettings = {}, rollbackSnapshot = null, onRollbackUpdate = null) {
  const settings = normalizeSettings(rawSettings);
  const orderedPlan = normalizePlanForSettings(plan, inventory, settings);
  const validation = validatePlan(orderedPlan, inventory, settings);
  if (!validation.ok) {
    throw new Error(`Cannot apply an invalid plan: ${validation.errors.join(" ")}`);
  }

  const rollback = rollbackSnapshot || (await createRollbackSnapshot(chromeApi, inventory, settings));
  await notifyRollbackUpdate(onRollbackUpdate, rollback);
  const operationJournal = [];
  const createdGroupIds = [];
  const createdWindowIds = [];
  const eligibleTabsCount = (inventory.tabs || []).length;
  let targetWindowId = inventory.scope.currentWindowId;

  if (!eligibleTabsCount && !(orderedPlan.groups || []).length && !(orderedPlan.reviewTabs || []).length) {
    return {
      rollback,
      result: {
        operationId: rollback.operationId,
        targetWindowId,
        createdGroupIds,
        createdWindowIds,
        movedTabsCount: 0,
        groupedTabsCount: 0,
        reviewTabsCount: 0
      }
    };
  }

  if (settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW) {
    const target = await resolveTargetWindow(chromeApi, orderedPlan, inventory, settings, operationJournal);
    targetWindowId = target.windowId;
    createdWindowIds.push(...target.createdWindowIds);
    rollback.createdWindowIds = createdWindowIds;
    rollback.operationJournal.push(...operationJournal);
    operationJournal.length = 0;
    await notifyRollbackUpdate(onRollbackUpdate, rollback);
    await moveTabsToTarget(chromeApi, inventory.tabs || [], targetWindowId, target.seedTabId, operationJournal);
    rollback.operationJournal.push(...operationJournal);
    operationJournal.length = 0;
    await notifyRollbackUpdate(onRollbackUpdate, rollback);
  }

  if (settings.existingGroupMode === EXISTING_GROUP_MODES.DISSOLVE) {
    await safeUngroup(chromeApi, (inventory.plannerTabs || []).map((tab) => tab.tabId));
  }

  if (
    settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW &&
    settings.existingGroupMode === EXISTING_GROUP_MODES.PRESERVE
  ) {
    for (const lockedGroup of inventory.lockedGroups || []) {
      const groupId = await recreateGroup(chromeApi, lockedGroup.tabIds, targetWindowId, lockedGroup, settings);
      if (groupId !== null) {
        createdGroupIds.push(groupId);
        operationJournal.push({ type: "recreate_locked_group", groupId, tabIds: lockedGroup.tabIds });
        rollback.createdGroupIds = createdGroupIds;
        rollback.operationJournal.push(...operationJournal);
        operationJournal.length = 0;
        await notifyRollbackUpdate(onRollbackUpdate, rollback);
      }
    }
  }

  await moveTabsToPlanOrder(chromeApi, orderedPlan, targetWindowId, operationJournal);
  if (operationJournal.length) {
    rollback.operationJournal.push(...operationJournal);
    operationJournal.length = 0;
    await notifyRollbackUpdate(onRollbackUpdate, rollback);
  }

  for (const group of orderedPlan.groups || []) {
    const tabIds = group.tabRefs.map((ref) => ref.tabId);
    const groupId = await recreateGroup(chromeApi, tabIds, targetWindowId, group, settings);
    if (groupId !== null) {
      createdGroupIds.push(groupId);
      operationJournal.push({ type: "create_semantic_group", groupId, tabIds, title: group.title });
      rollback.createdGroupIds = createdGroupIds;
      rollback.operationJournal.push(...operationJournal);
      operationJournal.length = 0;
      await notifyRollbackUpdate(onRollbackUpdate, rollback);
    }
  }

  if (settings.reviewGroupMode === REVIEW_GROUP_MODES.CREATE && (orderedPlan.reviewTabs || []).length) {
    const reviewTabIds = orderedPlan.reviewTabs.map((ref) => ref.tabId);
    const groupId = await recreateGroup(
      chromeApi,
      reviewTabIds,
      targetWindowId,
      { title: reviewGroupTitle(settings.languageMode), color: "grey", collapsed: settings.collapseGroupsAfterApply },
      settings
    );
    if (groupId !== null) {
      createdGroupIds.push(groupId);
      operationJournal.push({ type: "create_review_group", groupId, tabIds: reviewTabIds });
      rollback.createdGroupIds = createdGroupIds;
      rollback.operationJournal.push(...operationJournal);
      operationJournal.length = 0;
      await notifyRollbackUpdate(onRollbackUpdate, rollback);
    }
  }

  rollback.createdGroupIds = createdGroupIds;
  rollback.createdWindowIds = createdWindowIds;
  rollback.operationJournal.push(...operationJournal);
  await notifyRollbackUpdate(onRollbackUpdate, rollback);

  return {
    rollback,
    result: {
      operationId: rollback.operationId,
      targetWindowId,
      createdGroupIds,
      createdWindowIds,
      movedTabsCount: settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW ? (inventory.tabs || []).length : 0,
      groupedTabsCount: (orderedPlan.groups || []).reduce((sum, group) => sum + group.tabRefs.length, 0),
      reviewTabsCount: (orderedPlan.reviewTabs || []).length
    }
  };
}

async function notifyRollbackUpdate(onRollbackUpdate, rollback) {
  if (typeof onRollbackUpdate === "function") {
    await onRollbackUpdate(rollback);
  }
}

export async function createRollbackSnapshot(chromeApi, inventory, settings) {
  const sourceWindowIds = new Set(inventory.scope.windowIds || []);
  const windows = (await chromeApi.windows.getAll({ populate: true, windowTypes: ["normal"] })).filter((window) =>
    sourceWindowIds.has(window.id)
  );
  const sourceGroups = await queryGroupsForWindows(chromeApi, windows);

  return {
    operationId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    mode: settings.organizeMode,
    sourceWindows: windows.map((window) => ({
      windowId: window.id,
      type: window.type,
      incognito: Boolean(window.incognito),
      focused: Boolean(window.focused),
      state: window.state || "normal",
      bounds: {
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height
      },
      activeTabId: (window.tabs || []).find((tab) => tab.active)?.id || null,
      tabOrder: (window.tabs || []).map((tab) => tab.id).filter((id) => typeof id === "number")
    })),
    sourceGroups,
    tabs: windows.flatMap((window) =>
      (window.tabs || []).map((tab) => ({
        tabId: tab.id,
        windowId: window.id,
        index: tab.index,
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        highlighted: Boolean(tab.highlighted),
        groupId: tab.groupId ?? NO_GROUP_ID
      }))
    ),
    undoTargetWindowMode: settings.undoTargetWindowMode,
    createdWindowIds: [],
    createdGroupIds: [],
    operationJournal: []
  };
}

export async function undoFromRollback(chromeApi, rollback) {
  if (!rollback?.tabs?.length) {
    throw new Error("No rollback snapshot is available.");
  }

  const snapshotTabs = rollback.tabs.filter((tab) => typeof tab.tabId === "number");
  const existingTabs = await getExistingTabs(chromeApi, snapshotTabs.map((tab) => tab.tabId));
  const survivingIds = [...existingTabs.keys()];

  await safeUngroup(chromeApi, survivingIds);

  const restoredWindowIds = new Map();
  let restoredTabs = 0;

  for (const sourceWindow of rollback.sourceWindows || []) {
    const sourceTabs = snapshotTabs
      .filter((tab) => tab.windowId === sourceWindow.windowId && existingTabs.has(tab.tabId))
      .sort((left, right) => left.index - right.index);
    if (!sourceTabs.length) continue;

    const windowId = await ensureSourceWindow(chromeApi, sourceWindow, sourceTabs, existingTabs);
    restoredWindowIds.set(sourceWindow.windowId, windowId);
    restoredTabs += sourceTabs.length;

    await moveTabsInOrder(chromeApi, sourceTabs, windowId, existingTabs);
    await restoreTabState(chromeApi, sourceTabs);

    if (sourceWindow.activeTabId && existingTabs.has(sourceWindow.activeTabId)) {
      await safeTabUpdate(chromeApi, sourceWindow.activeTabId, { active: true });
    }
  }

  const recreatedGroupIds = [];
  for (const sourceGroup of rollback.sourceGroups || []) {
    const targetWindowId = restoredWindowIds.get(sourceGroup.windowId);
    const memberIds = (sourceGroup.tabOrder || []).filter((tabId) => existingTabs.has(tabId));
    if (!targetWindowId || !memberIds.length) continue;
    const groupId = await recreateGroup(
      chromeApi,
      memberIds,
      targetWindowId,
      sourceGroup,
      { collapseGroupsAfterApply: sourceGroup.collapsed },
      { requireAllTabs: false }
    );
    if (groupId !== null) recreatedGroupIds.push(groupId);
  }

  const closedCreatedWindowIds = await closeEmptyCreatedWindows(chromeApi, rollback);

  return {
    operationId: rollback.operationId,
    restoredTabs,
    recreatedGroupIds,
    closedCreatedWindowIds,
    missingTabs: snapshotTabs.length - restoredTabs
  };
}

async function closeEmptyCreatedWindows(chromeApi, rollback) {
  if (rollback.undoTargetWindowMode !== UNDO_TARGET_WINDOW_MODES.CLOSE_EMPTY_CREATED) return [];
  if (!chromeApi.windows?.remove) return [];

  const closedWindowIds = [];
  for (const windowId of rollback.createdWindowIds || []) {
    try {
      const window = await chromeApi.windows.get(windowId, { populate: true });
      if ((window.tabs || []).length) continue;
      await chromeApi.windows.remove(windowId);
      closedWindowIds.push(windowId);
    } catch {
      // Already closed windows are an acceptable rollback outcome.
    }
  }
  return closedWindowIds;
}

async function resolveTargetWindow(chromeApi, _plan, inventory, settings, journal) {
  const eligibleTabs = inventory.tabs || [];
  if (!eligibleTabs.length) throw new Error("No eligible tabs to move.");

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.NEW_WINDOW) {
    const seedTabId = eligibleTabs[0].tabId;
    const newWindow = await chromeApi.windows.create({ tabId: seedTabId, focused: true });
    journal.push({ type: "create_window", windowId: newWindow.id, seedTabId });
    return { windowId: newWindow.id, createdWindowIds: [newWindow.id], seedTabId };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    if (!Number.isInteger(settings.selectedTargetWindowId)) {
      throw new Error("Selected-window mode requires a configured target window.");
    }
    return { windowId: settings.selectedTargetWindowId, createdWindowIds: [], seedTabId: null };
  }

  const invocationWindowId = inventory.scope.invocationWindowId;
  if (Number.isInteger(invocationWindowId)) {
    return { windowId: invocationWindowId, createdWindowIds: [], seedTabId: null };
  }

  const focusedWindow = (inventory.windows || []).find((window) => window.focused) || inventory.windows?.[0];
  if (!focusedWindow) throw new Error("Unable to resolve target window.");
  return { windowId: focusedWindow.windowId, createdWindowIds: [], seedTabId: null };
}

async function moveTabsToTarget(chromeApi, tabs, targetWindowId, seedTabId, journal) {
  const tabIds = tabs.filter((tab) => tab.tabId !== seedTabId && tab.windowId !== targetWindowId).map((tab) => tab.tabId);
  if (!tabIds.length) return;
  await chromeApi.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
  journal.push({ type: "move_tabs", tabIds, toWindowId: targetWindowId });
}

async function moveTabsToPlanOrder(chromeApi, plan, targetWindowId, journal) {
  const orderedTabIds = planOrderTabIds(plan);
  if (orderedTabIds.length < 2) return;

  const targetTabs = await chromeApi.tabs.query({ windowId: targetWindowId });
  const targetTabIds = new Set(targetTabs.map((tab) => tab.id));
  const orderedLiveTabIds = orderedTabIds.filter((tabId) => targetTabIds.has(tabId));
  if (orderedLiveTabIds.length < 2) return;

  const orderedSet = new Set(orderedLiveTabIds);
  const insertionIndex = targetTabs.filter((tab) => !orderedSet.has(tab.id)).length;
  for (const [offset, tabId] of orderedLiveTabIds.entries()) {
    await chromeApi.tabs.move(tabId, { windowId: targetWindowId, index: insertionIndex + offset });
  }
  journal.push({ type: "order_tabs", tabIds: orderedLiveTabIds, toWindowId: targetWindowId });
}

function planOrderTabIds(plan) {
  const ids = [];
  const seen = new Set();
  for (const group of plan.groups || []) {
    for (const ref of group.tabRefs || []) {
      if (!seen.has(ref.tabId)) {
        seen.add(ref.tabId);
        ids.push(ref.tabId);
      }
    }
  }
  for (const ref of plan.reviewTabs || []) {
    if (!seen.has(ref.tabId)) {
      seen.add(ref.tabId);
      ids.push(ref.tabId);
    }
  }
  return ids;
}

async function recreateGroup(chromeApi, tabIds, windowId, groupLike, settings, options = {}) {
  const requireAllTabs = options.requireAllTabs !== false;
  const checks = await Promise.all(
    tabIds.map((tabId) =>
      chromeApi.tabs
        .get(tabId)
        .then(() => ({ tabId, exists: true }))
        .catch(() => ({ tabId, exists: false }))
    )
  );
  const existingTabIds = checks.filter((check) => check.exists).map((check) => check.tabId);
  const missingTabIds = checks.filter((check) => !check.exists).map((check) => check.tabId);
  if (requireAllTabs && missingTabIds.length) {
    throw new Error(`Cannot create group ${groupLike.title || "Untitled"} because tab(s) disappeared: ${missingTabIds.join(", ")}.`);
  }
  if (!existingTabIds.length) return null;

  await safeUngroup(chromeApi, existingTabIds);
  const groupId = await chromeApi.tabs.group({ tabIds: existingTabIds, createProperties: { windowId } });
  await chromeApi.tabGroups.update(groupId, {
    title: groupLike.title || "Untitled",
    color: groupLike.color || "grey",
    collapsed: Boolean(groupLike.collapsed ?? settings.collapseGroupsAfterApply)
  });
  return groupId;
}

async function safeUngroup(chromeApi, tabIds) {
  const uniqueIds = [...new Set(tabIds)].filter((id) => typeof id === "number");
  if (!uniqueIds.length) return;
  try {
    await chromeApi.tabs.ungroup(uniqueIds);
  } catch {
    // Ungroup can fail when every tab is already ungrouped; grouping below is still safe.
  }
}

async function queryGroupsForWindows(chromeApi, windows) {
  if (!chromeApi.tabGroups?.query) return [];
  const groups = [];
  for (const window of windows) {
    const windowGroups = await chromeApi.tabGroups.query({ windowId: window.id });
    for (const group of windowGroups) {
      const tabs = (window.tabs || [])
        .filter((tab) => tab.groupId === group.id)
        .sort((left, right) => left.index - right.index);
      groups.push({
        groupId: group.id,
        windowId: window.id,
        title: group.title || "Existing Group",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed),
        tabOrder: tabs.map((tab) => tab.id).filter((id) => typeof id === "number")
      });
    }
  }
  return groups;
}

async function getExistingTabs(chromeApi, tabIds) {
  // Closed tabs cannot be restored without session restore integration.
  const entries = await Promise.all(
    tabIds.map((tabId) =>
      chromeApi.tabs
        .get(tabId)
        .then((tab) => [tabId, tab])
        .catch(() => null)
    )
  );
  return new Map(entries.filter(Boolean));
}

async function ensureSourceWindow(chromeApi, sourceWindow, sourceTabs, existingTabs) {
  try {
    await chromeApi.windows.get(sourceWindow.windowId);
    return sourceWindow.windowId;
  } catch {
    const seedTabId = sourceTabs[0].tabId;
    const createProperties = { tabId: seedTabId, focused: false };
    if (sourceWindow.state === "normal") {
      Object.assign(createProperties, filterBounds(sourceWindow.bounds));
    }
    const newWindow = await chromeApi.windows.create(createProperties);
    existingTabs.set(seedTabId, await chromeApi.tabs.get(seedTabId));
    return newWindow.id;
  }
}

async function moveTabsInOrder(chromeApi, sourceTabs, windowId, existingTabs) {
  let nextIndex = 0;
  for (const snapshot of sourceTabs) {
    const current = existingTabs.get(snapshot.tabId);
    if (!current) continue;
    await chromeApi.tabs.move(snapshot.tabId, { windowId, index: nextIndex });
    nextIndex += 1;
  }
}

async function restoreTabState(chromeApi, sourceTabs) {
  for (const snapshot of sourceTabs) {
    await safeTabUpdate(chromeApi, snapshot.tabId, { pinned: snapshot.pinned, highlighted: snapshot.highlighted });
  }
}

async function safeTabUpdate(chromeApi, tabId, updateProperties) {
  try {
    await chromeApi.tabs.update(tabId, updateProperties);
  } catch {
    // Best-effort rollback should continue when one tab cannot be updated.
  }
}

function filterBounds(bounds = {}) {
  const result = {};
  for (const key of ["left", "top", "width", "height"]) {
    if (Number.isFinite(bounds[key])) result[key] = bounds[key];
  }
  return result;
}
