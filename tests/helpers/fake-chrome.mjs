export function createFakeChrome(seed = {}) {
  const state = {
    windows: new Map(),
    groups: new Map(),
    storage: {},
    grantedOrigins: new Set(seed.grantedOrigins || []),
    nextWindowId: seed.nextWindowId || 100,
    nextGroupId: seed.nextGroupId || 500
  };

  for (const window of seed.windows || []) {
    state.windows.set(window.id, normalizeWindow(window));
  }
  for (const group of seed.groups || []) {
    state.groups.set(group.id, { collapsed: false, color: "grey", title: "", ...group });
  }
  reindexAll(state);

  const chrome = {
    __state: state,
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, state.storage[item]]));
          }
          if (typeof key === "string") return { [key]: state.storage[key] };
          if (key && typeof key === "object") {
            return Object.fromEntries(Object.entries(key).map(([item, fallback]) => [item, state.storage[item] ?? fallback]));
          }
          return { ...state.storage };
        },
        async set(values) {
          Object.assign(state.storage, structuredClone(values));
        },
        async remove(key) {
          for (const item of Array.isArray(key) ? key : [key]) delete state.storage[item];
        }
      }
    },
    windows: {
      async getAll(options = {}) {
        const windows = [...state.windows.values()].filter((window) => matchesWindowTypes(window, options.windowTypes));
        return windows.map((window) => cloneWindow(window, Boolean(options.populate)));
      },
      async get(windowId, options = {}) {
        const window = state.windows.get(windowId);
        if (!window) throw new Error(`No window with id ${windowId}`);
        return cloneWindow(window, Boolean(options.populate));
      },
      async getCurrent(options = {}) {
        const window = [...state.windows.values()].find((item) => item.focused) || [...state.windows.values()][0];
        if (!window) throw new Error("No current window");
        return cloneWindow(window, Boolean(options.populate));
      },
      async getLastFocused(options = {}) {
        const window =
          [...state.windows.values()].find((item) => item.focused && matchesWindowTypes(item, options.windowTypes)) ||
          [...state.windows.values()].find((item) => matchesWindowTypes(item, options.windowTypes));
        if (!window) throw new Error("No focused window");
        return cloneWindow(window, Boolean(options.populate));
      },
      async update(windowId, updateProperties = {}) {
        const window = state.windows.get(windowId);
        if (!window) throw new Error(`No window with id ${windowId}`);
        if (updateProperties.focused) {
          for (const item of state.windows.values()) item.focused = false;
          window.focused = true;
        }
        Object.assign(window, updateProperties);
        return cloneWindow(window, true);
      },
      async create(properties = {}) {
        const windowId = state.nextWindowId++;
        const newWindow = normalizeWindow({
          id: windowId,
          type: "normal",
          focused: Boolean(properties.focused),
          state: "normal",
          left: properties.left,
          top: properties.top,
          width: properties.width,
          height: properties.height,
          tabs: []
        });
        state.windows.set(windowId, newWindow);
        if (properties.tabId !== undefined) {
          moveTabs(state, [properties.tabId], windowId, -1);
        }
        reindexAll(state);
        return cloneWindow(newWindow, true);
      },
      async remove(windowId) {
        if (!state.windows.has(windowId)) throw new Error(`No window with id ${windowId}`);
        state.windows.delete(windowId);
        cleanupGroups(state);
      }
    },
    tabs: {
      async get(tabId) {
        const tab = findTab(state, tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return structuredClone(tab);
      },
      async move(tabIds, moveProperties) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const moved = moveTabs(state, ids, moveProperties.windowId, moveProperties.index);
        return Array.isArray(tabIds) ? moved.map((tab) => structuredClone(tab)) : structuredClone(moved[0]);
      },
      async group(options) {
        const ids = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
        const firstTab = findTab(state, ids[0]);
        if (!firstTab) throw new Error("Cannot group missing tab");
        const windowId = options.createProperties?.windowId ?? firstTab.windowId;
        const groupId = state.nextGroupId++;
        state.groups.set(groupId, { id: groupId, windowId, title: "", color: "grey", collapsed: false });
        for (const tabId of ids) {
          const tab = findTab(state, tabId);
          if (!tab) continue;
          tab.groupId = groupId;
          tab.windowId = windowId;
        }
        cleanupGroups(state);
        return groupId;
      },
      async ungroup(tabIds) {
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
          const tab = findTab(state, tabId);
          if (tab) tab.groupId = -1;
        }
        cleanupGroups(state);
      },
      async update(tabId, updateProperties) {
        const tab = findTab(state, tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        Object.assign(tab, updateProperties);
        return structuredClone(tab);
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const tabId of ids) {
          const ownerWindow = [...state.windows.values()].find((window) => window.tabs.some((tab) => tab.id === tabId));
          if (!ownerWindow) throw new Error(`No tab with id ${tabId}`);
          ownerWindow.tabs = ownerWindow.tabs.filter((tab) => tab.id !== tabId);
        }
        cleanupGroups(state);
        reindexAll(state);
      },
      async query(queryInfo = {}) {
        let tabs = [...state.windows.values()].flatMap((window) => window.tabs);
        if (queryInfo.groupId !== undefined) tabs = tabs.filter((tab) => tab.groupId === queryInfo.groupId);
        if (queryInfo.windowId !== undefined) tabs = tabs.filter((tab) => tab.windowId === queryInfo.windowId);
        if (queryInfo.active !== undefined) tabs = tabs.filter((tab) => tab.active === Boolean(queryInfo.active));
        return tabs.map((tab) => structuredClone(tab));
      }
    },
    tabGroups: {
      async query(queryInfo = {}) {
        return [...state.groups.values()]
          .filter((group) => queryInfo.windowId === undefined || group.windowId === queryInfo.windowId)
          .map((group) => structuredClone(group));
      },
      async update(groupId, updateProperties) {
        const group = state.groups.get(groupId);
        if (!group) throw new Error(`No group with id ${groupId}`);
        Object.assign(group, updateProperties);
        return structuredClone(group);
      }
    },
    permissions: {
      async contains(permission) {
        return (permission.origins || []).every((origin) => state.grantedOrigins.has(origin));
      },
      async request(permission) {
        for (const origin of permission.origins || []) state.grantedOrigins.add(origin);
        return true;
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: { title: "Sample", headings: ["Heading"], visibleText: "Visible page text" } }];
      }
    }
  };

  return chrome;
}

function normalizeWindow(window) {
  return {
    id: window.id,
    type: window.type || "normal",
    focused: Boolean(window.focused),
    incognito: Boolean(window.incognito),
    state: window.state || "normal",
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    tabs: (window.tabs || []).map((tab, index) => ({
      id: tab.id,
      windowId: window.id,
      index,
      title: tab.title || "",
      url: tab.url || "",
      pendingUrl: tab.pendingUrl,
      favIconUrl: tab.favIconUrl || "",
      active: Boolean(tab.active),
      highlighted: Boolean(tab.highlighted),
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
      discarded: Boolean(tab.discarded),
      incognito: Boolean(tab.incognito || window.incognito),
      groupId: tab.groupId ?? -1
    }))
  };
}

function cloneWindow(window, populate) {
  const clone = structuredClone(window);
  if (!populate) delete clone.tabs;
  return clone;
}

function matchesWindowTypes(window, windowTypes) {
  return !windowTypes?.length || windowTypes.includes(window.type);
}

function findTab(state, tabId) {
  for (const window of state.windows.values()) {
    const tab = window.tabs.find((item) => item.id === tabId);
    if (tab) return tab;
  }
  return null;
}

function findWindowForTab(state, tabId) {
  for (const window of state.windows.values()) {
    if (window.tabs.some((tab) => tab.id === tabId)) return window;
  }
  return null;
}

function moveTabs(state, tabIds, targetWindowId, index = -1) {
  const targetWindow = state.windows.get(targetWindowId);
  if (!targetWindow) throw new Error(`No target window with id ${targetWindowId}`);
  const moving = [];

  for (const tabId of tabIds) {
    const sourceWindow = findWindowForTab(state, tabId);
    if (!sourceWindow) throw new Error(`No tab with id ${tabId}`);
    const tabIndex = sourceWindow.tabs.findIndex((tab) => tab.id === tabId);
    const [tab] = sourceWindow.tabs.splice(tabIndex, 1);
    tab.windowId = targetWindowId;
    moving.push(tab);
    if (sourceWindow.id !== targetWindowId && !sourceWindow.tabs.length) state.windows.delete(sourceWindow.id);
  }

  const insertIndex = index === -1 ? targetWindow.tabs.length : Math.max(0, index);
  targetWindow.tabs.splice(insertIndex, 0, ...moving);
  reindexAll(state);
  cleanupGroups(state);
  return moving;
}

function reindexAll(state) {
  for (const window of state.windows.values()) {
    window.tabs.forEach((tab, index) => {
      tab.windowId = window.id;
      tab.index = index;
    });
  }
}

function cleanupGroups(state) {
  for (const [groupId, group] of state.groups) {
    const members = [...state.windows.values()].flatMap((window) => window.tabs).filter((tab) => tab.groupId === groupId);
    if (!members.length) {
      state.groups.delete(groupId);
    } else {
      group.windowId = members[0].windowId;
    }
  }
}
