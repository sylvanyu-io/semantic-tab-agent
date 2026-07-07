import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlanForSettings, normalizePlanOrder } from "../src/core/plan-normalizer.js";
import { validatePlan } from "../src/core/plan-validator.js";
import { DEFAULT_SETTINGS, EXISTING_GROUP_MODES, ORGANIZE_MODES, REVIEW_GROUP_MODES, TARGET_WINDOW_MODES } from "../src/shared/settings.js";

test("current-window mode rejects tabs from another window", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 2 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /outside the current window|window mismatch/);
});

test("preserve existing groups rejects reassignment of locked tabs", () => {
  const settings = { ...DEFAULT_SETTINGS, existingGroupMode: EXISTING_GROUP_MODES.PRESERVE };
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [],
    lockedGroups: [{ groupId: 88, windowId: 1, tabIds: [10] }],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, settings);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /locked existing group|Preserved existing group/);
});

test("group confidence below apply threshold is invalid", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [{ groupKey: "weak", title: "Weak", color: "blue", confidence: 0.2, tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /below the apply threshold/);
});

test("missing group confidence is invalid", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [{ groupKey: "unknown", title: "Unknown", color: "blue", tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /valid confidence/);
});

test("groups above the tab limit are invalid", () => {
  const plannerTabs = Array.from({ length: 3 }, (_, index) => ({
    tabId: index + 10,
    windowId: 1,
    pinned: false,
    incognito: false
  }));
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs,
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [
      {
        groupKey: "huge",
        title: "Huge",
        color: "blue",
        confidence: 0.9,
        reason: "Still too large.",
        tabRefs: plannerTabs.map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId }))
      }
    ],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, { ...DEFAULT_SETTINGS, maxTabsPerGroup: 2 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /above the limit 2/);
});

test("legacy selected target window setting is ignored in consolidate mode", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.SELECTED_WINDOW,
    selectedTargetWindowId: 2
  };
  const inventory = {
    scope: { kind: "all_normal_windows", currentWindowId: null, invocationWindowId: 1, windowIds: [1, 2, 3] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "consolidate_one_window",
    targetWindow: { kind: "selected_window", windowId: 3, title: "Wrong Window" },
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, settings);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /does not match setting current_window/);
});

test("current target window in consolidate mode must be the invocation window", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW
  };
  const inventory = {
    scope: { kind: "all_normal_windows", currentWindowId: null, invocationWindowId: 2, windowIds: [1, 2] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "consolidate_one_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Wrong Window" },
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, settings);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /targetWindow\.windowId must be 2/);
});

test("review-like groups are hoisted into review tabs before preview and apply", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [
      { groupKey: "needs-review", title: "待确认", color: "grey", confidence: 0.9, tabRefs: [{ tabId: 10, windowId: 1 }] },
      { groupKey: "work", title: "当前项目", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] }
    ],
    reviewTabs: [],
    excludedTabs: []
  };

  const normalized = normalizePlanForSettings(plan, inventory, DEFAULT_SETTINGS);

  assert.deepEqual(
    normalized.groups.map((group) => group.title),
    ["当前项目"]
  );
  assert.deepEqual(
    normalized.reviewTabs.map((ref) => ref.tabId),
    [10]
  );
  assert.equal(validatePlan(normalized, inventory, DEFAULT_SETTINGS).ok, true);
});

test("review tabs are assigned to closest groups when separate review is disabled", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false },
      { tabId: 12, windowId: 1, sequenceIndex: 2, pinned: false, incognito: false },
      { tabId: 20, windowId: 1, sequenceIndex: 20, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [
      { groupKey: "docs", title: "技术文档", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 10, windowId: 1 }] },
      { groupKey: "review", title: "待分类", color: "grey", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] },
      { groupKey: "media", title: "视频资料", color: "green", confidence: 0.9, tabRefs: [{ tabId: 20, windowId: 1 }] }
    ],
    reviewTabs: [{ tabId: 12, windowId: 1, reason: "不确定" }],
    excludedTabs: []
  };

  const normalized = normalizePlanForSettings(plan, inventory, {
    ...DEFAULT_SETTINGS,
    reviewGroupMode: REVIEW_GROUP_MODES.LEAVE_UNGROUPED
  });

  assert.deepEqual(
    normalized.groups.map((group) => group.title),
    ["技术文档", "视频资料"]
  );
  assert.deepEqual(normalized.groups[0].tabRefs.map((ref) => ref.tabId), [10, 11, 12]);
  assert.deepEqual(normalized.reviewTabs, []);
  assert.equal(validatePlan(normalized, inventory, DEFAULT_SETTINGS).ok, true);
});

test("invalid plan collections are rejected without throwing", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const malformedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: { bad: true },
    reviewTabs: { bad: true },
    excludedTabs: { bad: true }
  };

  const normalized = normalizePlanOrder(malformedPlan, inventory);
  const result = validatePlan(normalized, inventory, DEFAULT_SETTINGS);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /groups must be an array/);
  assert.match(result.errors.join("\n"), /reviewTabs must be an array/);
  assert.match(result.errors.join("\n"), /excludedTabs must be an array/);
  assert.match(result.errors.join("\n"), /Eligible tab 10 is missing/);
});

test("invalid group tabRefs are rejected without throwing", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    groups: [{ groupKey: "bad", title: "Bad", color: "blue", confidence: 0.9, tabRefs: { tabId: 10 } }],
    reviewTabs: [],
    excludedTabs: []
  };

  const normalized = normalizePlanOrder(plan, inventory);
  const result = validatePlan(normalized, inventory, DEFAULT_SETTINGS);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing tabRefs/);
  assert.match(result.errors.join("\n"), /Eligible tab 10 is missing/);
});
