import { normalizeSettings } from "../shared/settings.js";
import { getActivityOverview } from "./page-activity-cache.js";
import { collectTabInventory } from "./tab-inventory.js";
import { buildTimeRecapInput, normalizeTimeRecapRange } from "./time-recap.js";

const SNAPSHOT_VERSION = 1;

export async function buildEvidenceSnapshot(chromeApi, rawSettings = {}, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const range = normalizeTimeRecapRange(options.range || { preset: "7d" }, now);
  const invocation = { windowId: options.windowId, strictWindowId: Boolean(options.strictWindowId) };
  const inventory = await collectTabInventory(chromeApi, settings, invocation);
  const scopedWindowId = inventory.scope?.kind === "current_window" ? inventory.scope.currentWindowId : null;
  const scopeOptions = Number.isInteger(scopedWindowId) ? { windowId: scopedWindowId } : {};
  const [recapInput, overview] = await Promise.all([
    buildTimeRecapInput(chromeApi, settings, { range, now, ...scopeOptions }),
    getActivityOverview(chromeApi, {
      rangeMs: range.rangeMs,
      includeIncognitoTabs: settings.includeIncognitoTabs,
      now,
      ...scopeOptions
    })
  ]);
  const activationFlow = inventory.activationFlow || { tabActivity: [], runs: [], transitions: [], evidence: [] };
  const includePrivateFields = Boolean(options.includePrivateFields);

  return {
    schema: "tab_recap_evidence_snapshot_v1",
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now).toISOString(),
    privacy: includePrivateFields ? "private_details" : "redacted_counts",
    scope: {
      kind: inventory.scope?.kind || "",
      currentWindowId: inventory.scope?.currentWindowId ?? null,
      invocationWindowId: inventory.scope?.invocationWindowId ?? null,
      windowCount: inventory.scope?.windowIds?.length || 0
    },
    range: recapInput.range,
    counts: {
      windows: inventory.windows?.length || 0,
      tabs: inventory.tabs?.length || 0,
      plannerTabs: inventory.plannerTabs?.length || 0,
      excludedTabs: inventory.excludedTabs?.length || 0,
      lockedGroups: inventory.lockedGroups?.length || 0,
      recapPages: recapInput.pages?.length || 0,
      recapSampledPages: recapInput.coverage?.sampledEntries || 0,
      activityEntries: recapInput.coverage?.activityEntries || 0,
      lifecycleSessions: recapInput.coverage?.lifecycleSessions || 0,
      lifecycleEvents: recapInput.coverage?.lifecycleEvents || 0,
      activationRuns: activationFlow.runs?.length || 0,
      activationTransitions: activationFlow.transitions?.length || 0,
      activationEvidence: activationFlow.evidence?.length || 0,
      activationTabs: activationFlow.tabActivity?.length || 0
    },
    coverage: {
      recap: recapInput.coverage,
      activity: overview.cache,
      openTabs: overview.openTabs,
      lifecycle: {
        sessions: overview.lifecycle?.sessions || 0,
        openSessions: overview.lifecycle?.openSessions || 0,
        closedSessions: overview.lifecycle?.closedSessions || 0,
        inferredClosed: overview.lifecycle?.inferredClosed || 0,
        events: overview.lifecycle?.events || 0,
        lastReconciledAt: overview.lifecycle?.lastReconciledAt || ""
      }
    },
    behavior: summarizeActivationFlow(activationFlow),
    tabState: summarizeTabState(inventory.plannerTabs || [], recapInput.pages || []),
    readiness: evidenceReadiness(inventory, recapInput, activationFlow),
    ...(includePrivateFields
      ? {
          privateDetails: {
            plannerTabs: compactPlannerTabs(inventory.plannerTabs || []),
            recapPages: compactRecapPages(recapInput.pages || []),
            activationFlow
          }
        }
      : {})
  };
}

function summarizeActivationFlow(activationFlow = {}) {
  const runs = activationFlow.runs || [];
  const evidence = activationFlow.evidence || [];
  const transitions = activationFlow.transitions || [];
  const tabActivity = activationFlow.tabActivity || [];
  const repeatedRuns = runs.filter((run) => (run.repeatedIds || []).length).length;
  const quickHandoffs = evidence.filter((item) => (item.clues || []).includes("quick handoff")).length;
  const longAnchorChecks = evidence.filter((item) => (item.clues || []).includes("long anchor then short checks")).length;
  const totalSpanSeconds = sum(runs.map((run) => run.spanSeconds));
  const totalRunTabs = sum(runs.map((run) => new Set(run.ids || []).size));
  const totalActiveSeconds = sum(tabActivity.map((item) => item.totalActiveSeconds));

  return {
    runs: runs.length,
    transitions: transitions.length,
    evidence: evidence.length,
    tabsWithActivity: tabActivity.length,
    repeatedRuns,
    quickHandoffs,
    longAnchorChecks,
    averageRunSpanSeconds: runs.length ? Math.round(totalSpanSeconds / runs.length) : 0,
    averageUniqueTabsPerRun: runs.length ? round1(totalRunTabs / runs.length) : 0,
    totalActiveSeconds,
    strongestTransitions: transitions
      .slice()
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0) || Number(right.avgDwellSeconds || 0) - Number(left.avgDwellSeconds || 0))
      .slice(0, 8)
      .map((item) => ({
        count: Number(item.count || 0),
        avgDwellSeconds: Number(item.avgDwellSeconds || 0),
        maxDwellSeconds: Number(item.maxDwellSeconds || 0),
        clues: item.clues || []
      })),
    strongestEvidence: evidence
      .slice()
      .sort((left, right) => Number(right.strength || 0) - Number(left.strength || 0))
      .slice(0, 8)
      .map((item) => ({
        size: item.ids?.length || 0,
        strength: Number(item.strength || 0),
        count: Number(item.count || 0),
        clues: item.clues || []
      }))
  };
}

function summarizeTabState(plannerTabs = [], recapPages = []) {
  const pagesByTabId = new Map(recapPages.filter((page) => Number.isInteger(page.tabId)).map((page) => [page.tabId, page]));
  const summarizedTabIds = new Set(recapPages.filter((page) => page.summary && Number.isInteger(page.tabId)).map((page) => page.tabId));
  return {
    plannerTabs: plannerTabs.length,
    activeTabs: plannerTabs.filter((tab) => tab.active).length,
    pinnedTabs: plannerTabs.filter((tab) => tab.pinned).length,
    discardedTabs: plannerTabs.filter((tab) => tab.discarded).length,
    groupedTabs: plannerTabs.filter((tab) => tab.groupId !== undefined && tab.groupId !== -1).length,
    sampleableTabs: plannerTabs.filter((tab) => tab.sampleable).length,
    tabsWithRecapRows: plannerTabs.filter((tab) => pagesByTabId.has(tab.tabId)).length,
    tabsWithSummaries: plannerTabs.filter((tab) => summarizedTabIds.has(tab.tabId)).length
  };
}

function evidenceReadiness(inventory, recapInput, activationFlow) {
  const plannerTabs = inventory.plannerTabs || [];
  const warnings = [];
  if (!plannerTabs.length) warnings.push("no_planner_tabs");
  if (!(recapInput.coverage?.lifecycleEvents > 0)) warnings.push("no_lifecycle_events");
  if (!(activationFlow.runs || []).length) warnings.push("no_activation_runs");
  if (!(recapInput.coverage?.sampledEntries > 0)) warnings.push("no_page_summaries");
  if ((inventory.excludedTabs || []).length) warnings.push("has_excluded_tabs");
  return {
    level: warnings.length <= 1 ? "good" : warnings.length <= 3 ? "partial" : "thin",
    warnings
  };
}

function compactPlannerTabs(tabs) {
  return tabs.map((tab) => ({
    tabId: tab.tabId,
    windowId: tab.windowId,
    index: tab.index,
    sequenceIndex: tab.sequenceIndex,
    title: tab.title,
    hostname: tab.hostname,
    sanitizedUrl: tab.sanitizedUrl,
    groupTitle: tab.groupTitle || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    sampleable: Boolean(tab.sampleable)
  }));
}

function compactRecapPages(pages) {
  return pages.map((page) => ({
    id: page.id,
    tabId: page.tabId,
    windowId: page.windowId,
    open: Boolean(page.open),
    title: page.title,
    hostname: page.hostname,
    sanitizedUrl: page.sanitizedUrl,
    firstSeenAt: page.firstSeenAt,
    lastSeenAt: page.lastSeenAt,
    lastActivatedAt: page.lastActivatedAt,
    closedAt: page.closedAt,
    seenCount: page.seenCount,
    activeCount: page.activeCount,
    currentGroupTitle: page.currentGroupTitle,
    summary: page.summary
  }));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
