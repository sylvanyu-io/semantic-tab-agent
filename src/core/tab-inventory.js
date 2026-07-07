import { EXISTING_GROUP_MODES, ORGANIZE_MODES, normalizeSettings } from "../shared/settings.js";
import { getTabActivationFlowContext } from "./tab-lifecycle-log.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const NO_GROUP_ID = -1;

export async function collectTabInventory(chromeApi, rawSettings, invocation = {}) {
  const settings = normalizeSettings(rawSettings);
  const windows =
    settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
      ? await chromeApi.windows.getAll({ populate: true, windowTypes: ["normal"] })
      : [await resolveCurrentWindow(chromeApi, invocation.windowId, { strict: Boolean(invocation.strictWindowId) })];

  const normalWindows = windows.filter((window) => window?.type === "normal");
  if (!normalWindows.length) {
    throw new Error("No normal browser window is available for organization.");
  }

  const groupsById = await collectGroupsById(chromeApi, normalWindows);
  const tabs = [];
  const excludedTabs = [];
  let sequenceIndex = 0;

  for (const window of normalWindows) {
    for (const tab of window.tabs || []) {
      const descriptor = buildTabDescriptor(tab, window, groupsById, settings, sequenceIndex);
      sequenceIndex += 1;
      const exclusionReason = getExclusionReason(tab, window, settings);
      if (exclusionReason) {
        excludedTabs.push({ ...descriptor, exclusionReason });
      } else {
        tabs.push(descriptor);
      }
    }
  }

  const lockedGroups = collectLockedGroups(tabs, groupsById, settings);
  const lockedTabIds = new Set(lockedGroups.flatMap((group) => group.tabIds));
  const plannerTabs =
    settings.existingGroupMode === EXISTING_GROUP_MODES.PRESERVE
      ? tabs.filter((tab) => !lockedTabIds.has(tab.tabId))
      : tabs;
  const activationFlowTabs = [...tabs, ...excludedTabs];
  const activationFlow = await getTabActivationFlowContext(chromeApi, activationFlowTabs).catch(() => ({
    tabActivity: [],
    runs: [],
    transitions: [],
    evidence: []
  }));

  return {
    schemaVersion: 1,
    mode: settings.organizeMode,
    scope: {
      kind: settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW ? "all_normal_windows" : "current_window",
      currentWindowId: settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW ? normalWindows[0].id : null,
      invocationWindowId: Number.isInteger(invocation.windowId) ? invocation.windowId : null,
      windowIds: normalWindows.map((window) => window.id)
    },
    windows: normalWindows.map((window) => ({
      windowId: window.id,
      type: window.type,
      focused: Boolean(window.focused),
      incognito: Boolean(window.incognito),
      tabCount: (window.tabs || []).length
    })),
    tabs,
    plannerTabs,
    excludedTabs,
    lockedGroups,
    activationFlow,
    collectedAt: new Date().toISOString()
  };
}

async function resolveCurrentWindow(chromeApi, windowId, options = {}) {
  if (Number.isInteger(windowId) && windowId > 0) {
    const requestedWindow = await chromeApi.windows.get(windowId, { populate: true }).catch(() => null);
    if (requestedWindow?.type === "normal") return requestedWindow;
    if (options.strict) {
      throw new Error("预览中的当前窗口已关闭，请重新生成方案。");
    }
  }

  if (chromeApi.windows.getLastFocused) {
    return chromeApi.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
  }

  return chromeApi.windows.getCurrent({ populate: true });
}

async function collectGroupsById(chromeApi, windows) {
  if (!chromeApi.tabGroups?.query) return new Map();

  const groups = [];
  for (const window of windows) {
    const windowGroups = await chromeApi.tabGroups.query({ windowId: window.id });
    groups.push(...windowGroups);
  }

  return new Map(groups.map((group) => [group.id, group]));
}

function buildTabDescriptor(tab, window, groupsById, settings, sequenceIndex) {
  const rawUrl = getTabUrl(tab);
  const urlInfo = sanitizeTabUrl(rawUrl, settings.urlPrivacyMode);
  const group = tab.groupId !== undefined && tab.groupId !== NO_GROUP_ID ? groupsById.get(tab.groupId) : null;

  return {
    tabId: tab.id,
    windowId: window.id,
    index: tab.index,
    sequenceIndex,
    title: tab.title || "",
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    incognito: Boolean(tab.incognito || window.incognito),
    groupId: tab.groupId ?? NO_GROUP_ID,
    groupTitle: group?.title || "",
    groupColor: group?.color || "",
    groupCollapsed: Boolean(group?.collapsed),
    favIconUrl: tab.favIconUrl || "",
    sampleable: canSampleUrl(rawUrl),
    ...urlInfo
  };
}

function getExclusionReason(tab, window, settings) {
  if (window.type && window.type !== "normal") return "Only normal browser windows are supported.";
  if ((tab.incognito || window.incognito) && !settings.includeIncognitoTabs) {
    return "Incognito tabs are excluded by policy.";
  }
  if (tab.pinned && !settings.includePinnedTabs) {
    return "Pinned tabs are excluded by policy.";
  }
  if (typeof tab.id !== "number") {
    return "Tab is missing a stable id.";
  }
  return "";
}

function collectLockedGroups(tabs, groupsById, settings) {
  if (settings.existingGroupMode !== EXISTING_GROUP_MODES.PRESERVE) return [];

  const byGroup = new Map();
  for (const tab of tabs) {
    if (tab.groupId === NO_GROUP_ID) continue;
    if (!byGroup.has(tab.groupId)) {
      const group = groupsById.get(tab.groupId);
      byGroup.set(tab.groupId, {
        groupId: tab.groupId,
        windowId: tab.windowId,
        title: group?.title || tab.groupTitle || "Existing Group",
        color: group?.color || tab.groupColor || "grey",
        collapsed: Boolean(group?.collapsed ?? tab.groupCollapsed),
        tabIds: []
      });
    }
    byGroup.get(tab.groupId).tabIds.push(tab.tabId);
  }

  return [...byGroup.values()];
}
