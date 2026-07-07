import { ORGANIZE_MODES } from "../src/shared/settings.js";

export const BENCHMARK_SCENARIOS = Object.freeze({
  task_bursts: {
    label: "Task bursts with natural tab order",
    description: "Adjacent tabs are often part of the same work burst, with semantic topics spread across domains."
  },
  domain_traps: {
    label: "Domain traps",
    description: "The same public platforms host many unrelated topics, so domain-only grouping should score poorly."
  },
  low_signal_samples: {
    label: "Low-signal titles with page samples",
    description: "Titles are generic and the useful signal lives in optional page summary snippets."
  },
  media_type: {
    label: "Media type preference",
    description: "Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages."
  },
  old_tabs: {
    label: "Old-tab cleanup mix",
    description: "Includes age and activity signals for cleanup-oriented evaluation while preserving semantic grouping truth."
  },
  multi_window: {
    label: "Multi-window context",
    description: "Related topics are split across browser windows and should still be grouped together."
  },
  behavior_flow: {
    label: "Behavior flow evidence",
    description: "Simulates user activation runs, dwell time, and return-to-anchor behavior without leaking fixture truth labels."
  }
});

const TOPICS = Object.freeze([
  {
    slug: "ai-coding",
    title: "AI coding agents",
    hosts: ["github.com", "docs.anthropic.com", "openai.com"],
    sampleText: "Codex, Claude Code, MCP tools, agent harnesses, tool calls, and automated code review workflows.",
    variants: [
      { slug: "codex", title: "Codex task orchestration notes", genericTitle: "Agent workbench", mediaType: "docs" },
      { slug: "mcp", title: "MCP server integration docs", genericTitle: "Tooling reference", mediaType: "docs" },
      { slug: "review", title: "Automated code review benchmark", genericTitle: "Evaluation page", mediaType: "paper" }
    ]
  },
  {
    slug: "chrome-extension",
    title: "Chrome extension APIs",
    hosts: ["developer.chrome.com", "chromium.googlesource.com", "github.com"],
    sampleText: "Chrome extension side panel, tabs API, tabGroups API, optional host permissions, and MV3 service workers.",
    variants: [
      { slug: "tabs", title: "tabs and tabGroups API reference", genericTitle: "API docs", mediaType: "docs" },
      { slug: "sidepanel", title: "side panel lifecycle guide", genericTitle: "Extension guide", mediaType: "docs" },
      { slug: "permissions", title: "optional host permissions behavior", genericTitle: "Permissions notes", mediaType: "docs" }
    ]
  },
  {
    slug: "llm-evals",
    title: "LLM evaluation research",
    hosts: ["arxiv.org", "paperswithcode.com", "github.com"],
    sampleText: "Model evaluation, agent benchmark design, leaderboard methodology, dataset construction, and scoring metrics.",
    variants: [
      { slug: "benchmarks", title: "agent benchmark paper", genericTitle: "Research paper", mediaType: "paper" },
      { slug: "datasets", title: "task dataset discussion", genericTitle: "Dataset notes", mediaType: "paper" },
      { slug: "leaderboard", title: "model leaderboard comparison", genericTitle: "Model comparison", mediaType: "dashboard" }
    ]
  },
  {
    slug: "design",
    title: "Product UI design",
    hosts: ["figma.com", "mobbin.com", "linear.app"],
    sampleText: "Compact panel UI, information hierarchy, switches, preview cards, README visuals, and consumer-facing copy.",
    variants: [
      { slug: "sidepanel", title: "compact side panel examples", genericTitle: "UI reference", mediaType: "image" },
      { slug: "switches", title: "settings switch patterns", genericTitle: "Interaction examples", mediaType: "image" },
      { slug: "readme", title: "open source README visual layout", genericTitle: "Showcase ideas", mediaType: "article" }
    ]
  },
  {
    slug: "cloudflare",
    title: "Cloudflare Worker gateway",
    hosts: ["developers.cloudflare.com", "dash.cloudflare.com", "github.com"],
    sampleText: "Cloudflare Workers, tunnel diagnostics, model allowlists, token quotas, request shape checks, and abuse prevention.",
    variants: [
      { slug: "workers", title: "Worker routing and secrets", genericTitle: "Gateway docs", mediaType: "docs" },
      { slug: "tunnel", title: "Cloudflare tunnel diagnostics", genericTitle: "Tunnel notes", mediaType: "docs" },
      { slug: "limits", title: "rate limit and abuse prevention", genericTitle: "Security checklist", mediaType: "docs" }
    ]
  },
  {
    slug: "frontend",
    title: "Frontend implementation",
    hosts: ["react.dev", "developer.mozilla.org", "github.com"],
    sampleText: "State machines, CSS layout, Playwright smoke tests, side panel rendering, and UI regression debugging.",
    variants: [
      { slug: "state", title: "state machine bug analysis", genericTitle: "Bug thread", mediaType: "issue" },
      { slug: "css", title: "CSS panel layout refinement", genericTitle: "Layout notes", mediaType: "docs" },
      { slug: "tests", title: "Playwright smoke test fixture", genericTitle: "Test plan", mediaType: "issue" }
    ]
  },
  {
    slug: "data",
    title: "Database and SQL work",
    hosts: ["postgresql.org", "supabase.com", "stackoverflow.com"],
    sampleText: "SQL query plans, indexes, migrations, rollback checklists, and database debugging notes.",
    variants: [
      { slug: "query", title: "query plan optimization", genericTitle: "SQL reference", mediaType: "docs" },
      { slug: "index", title: "index strategy discussion", genericTitle: "Database notes", mediaType: "forum" },
      { slug: "migration", title: "migration rollback checklist", genericTitle: "Schema checklist", mediaType: "issue" }
    ]
  },
  {
    slug: "reading",
    title: "Read later queue",
    hosts: ["medium.com", "substack.com", "wikipedia.org"],
    sampleText: "Long-form essays, newsletters, background references, product thinking, and saved reading material.",
    variants: [
      { slug: "article", title: "long-form product essay", genericTitle: "Article", mediaType: "article" },
      { slug: "newsletter", title: "weekly AI newsletter", genericTitle: "Newsletter", mediaType: "article" },
      { slug: "reference", title: "background reference page", genericTitle: "Reference", mediaType: "docs" }
    ]
  },
  {
    slug: "video",
    title: "Video and media queue",
    hosts: ["youtube.com", "bilibili.com", "vimeo.com"],
    sampleText: "Video tutorials, recorded product talks, playlists, transcripts, and visual learning materials.",
    variants: [
      { slug: "tutorial", title: "browser extension tutorial", genericTitle: "Video", mediaType: "video" },
      { slug: "talk", title: "AI product talk transcript", genericTitle: "Talk", mediaType: "video" },
      { slug: "playlist", title: "design teardown playlist", genericTitle: "Playlist", mediaType: "video" }
    ]
  },
  {
    slug: "finance",
    title: "Shopping and finance",
    hosts: ["stripe.com", "amazon.com", "bank.example"],
    sampleText: "Billing portals, subscription pricing, checkout comparison, receipts, and account pages.",
    variants: [
      { slug: "invoice", title: "invoice and billing portal", genericTitle: "Account page", mediaType: "account" },
      { slug: "checkout", title: "purchase comparison", genericTitle: "Shopping page", mediaType: "shopping" },
      { slug: "pricing", title: "subscription pricing review", genericTitle: "Pricing page", mediaType: "shopping" }
    ]
  }
]);

const SHARED_PLATFORMS = Object.freeze(["github.com", "docs.google.com", "notion.so", "reddit.com", "youtube.com", "stackoverflow.com"]);
const BASE_TIME = Date.parse("2026-06-01T08:00:00.000Z");

export function parseBenchmarkScenarios(value) {
  const raw = String(value || "").trim();
  if (!raw) return ["task_bursts"];
  if (raw === "all") return Object.keys(BENCHMARK_SCENARIOS);
  const selected = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = selected.filter((item) => !BENCHMARK_SCENARIOS[item]);
  if (unknown.length) {
    throw new Error(`Unknown BENCHMARK_SCENARIOS value(s): ${unknown.join(", ")}. Known values: ${Object.keys(BENCHMARK_SCENARIOS).join(", ")}.`);
  }
  return selected;
}

export function buildBenchmarkInventory(tabCount, options = {}) {
  const scenario = options.scenario || "task_bursts";
  const windowCount = scenario === "multi_window" ? Math.max(4, options.windowCount || 4) : options.windowCount || 4;
  const windows = Array.from({ length: windowCount }, (_, index) => ({
    windowId: index + 1,
    type: "normal",
    focused: index === 0,
    incognito: false,
    tabCount: 0
  }));
  const tabs = [];
  const pageSamples = [];
  const truth = {
    schema: "tab_recap_benchmark_truth_v1",
    scenario,
    topicByTabId: {},
    familyByTabId: {},
    mediaTypeByTabId: {},
    staleCandidateByTabId: {},
    dimensions: scenarioDimensions(scenario)
  };

  for (let index = 0; index < tabCount; index += 1) {
    const topic = topicForIndex(index, scenario);
    const variant = topic.variants[index % topic.variants.length];
    const window = windowForIndex(index, windows, tabCount, scenario);
    const sequenceIndex = sequenceIndexFor(index, tabCount, scenario);
    const tab = buildBenchmarkTab({ index, sequenceIndex, topic, variant, window, scenario });
    window.tabCount += 1;
    tabs.push(tab);
    truth.topicByTabId[tab.tabId] = expectedTopicFor({ scenario, topic, variant });
    truth.familyByTabId[tab.tabId] = expectedFamilyFor({ scenario, topic, variant });
    truth.mediaTypeByTabId[tab.tabId] = variant.mediaType;
    truth.staleCandidateByTabId[tab.tabId] = staleSignalFor(index, tabCount, scenario).isStale;

    if (scenario === "low_signal_samples") {
      pageSamples.push(buildPageSample(tab, topic, variant));
    }
  }

  tabs.sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  for (const window of windows) {
    let nextIndex = 0;
    for (const tab of tabs.filter((item) => item.windowId === window.windowId).sort((left, right) => left.sequenceIndex - right.sequenceIndex)) {
      tab.index = nextIndex;
      nextIndex += 1;
    }
    window.tabCount = nextIndex;
  }

  const activationFlow = options.includeActivationFlow === false ? emptyActivationFlow() : buildBenchmarkActivationFlow(tabs, truth, scenario);

  return {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    scope: {
      kind: "all_normal_windows",
      currentWindowId: null,
      invocationWindowId: 1,
      windowIds: windows.map((window) => window.windowId)
    },
    windows,
    tabs,
    plannerTabs: tabs,
    excludedTabs: [],
    lockedGroups: [],
    activationFlow,
    pageSamples,
    benchmarkTruth: truth,
    collectedAt: new Date(BASE_TIME + tabCount * 1000).toISOString()
  };
}

function scenarioDimensions(scenario) {
  const common = ["semantic_topic", "original_tab_order", "multi_domain"];
  if (scenario === "domain_traps") return [...common, "domain_trap"];
  if (scenario === "low_signal_samples") return [...common, "page_summary_signal", "generic_titles"];
  if (scenario === "media_type") return ["media_type", "semantic_topic", "cross_domain"];
  if (scenario === "old_tabs") return [...common, "age_signal", "cleanup_signal"];
  if (scenario === "multi_window") return [...common, "cross_window"];
  if (scenario === "behavior_flow") return [...common, "activation_flow", "dwell_time", "return_to_anchor"];
  return common;
}

function buildBenchmarkTab({ index, sequenceIndex, topic, variant, window, scenario }) {
  const stale = staleSignalFor(index, 0, scenario);
  const host = hostFor({ index, topic, scenario });
  const title = titleFor({ index, topic, variant, scenario });
  const path = pathFor({ index, topic, variant, scenario });
  return {
    tabId: 10_000 + index,
    windowId: window.windowId,
    index: window.tabCount,
    sequenceIndex,
    title,
    audible: false,
    discarded: scenario === "old_tabs" ? stale.isStale && index % 3 === 0 : index % 17 === 0,
    pinned: false,
    active: window.tabCount === 0,
    incognito: false,
    groupId: -1,
    groupTitle: "",
    groupColor: "",
    groupCollapsed: false,
    favIconUrl: "",
    sampleable: true,
    hostname: host,
    sanitizedUrl: `https://${host}/${path}`,
    urlKind: "web",
    origin: `https://${host}`,
    firstSeenAt: stale.firstSeenAt,
    lastSeenAt: stale.lastSeenAt,
    activeCount: stale.activeCount
  };
}

function buildPageSample(tab, topic, variant) {
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    status: "ok",
    origin: tab.origin,
    sample: {
      title: `${topic.title}: ${variant.title}`,
      metaDescription: topic.sampleText,
      language: "en",
      contentKind: variant.mediaType,
      headings: [topic.title, variant.title],
      visibleText: `${topic.sampleText} This page belongs to ${topic.title} and should not be grouped by hostname alone.`,
      reason: ""
    }
  };
}

function topicForIndex(index, scenario) {
  if (scenario === "multi_window") return TOPICS[(index * 5 + Math.floor(index / 8)) % TOPICS.length];
  if (scenario === "domain_traps") return TOPICS[(index + Math.floor(index / SHARED_PLATFORMS.length)) % TOPICS.length];
  if (scenario === "media_type") return TOPICS[(index * 3 + Math.floor(index / 5)) % TOPICS.length];
  if (scenario === "behavior_flow") {
    const burst = Math.floor(index / 4);
    return TOPICS[(burst * 3 + Math.floor(burst / 2)) % TOPICS.length];
  }
  const session = Math.floor(index / 12);
  return TOPICS[(session * 7 + Math.floor(index / 3) + index) % TOPICS.length];
}

function expectedTopicFor({ scenario, topic, variant }) {
  return scenario === "media_type" ? variant.mediaType : topic.slug;
}

function expectedFamilyFor({ scenario, topic, variant }) {
  if (scenario === "media_type") return variant.mediaType;
  const families = {
    "ai-coding": "ai-work",
    "llm-evals": "ai-work",
    "chrome-extension": "extension-build",
    frontend: "extension-build",
    cloudflare: "infra-data",
    data: "infra-data",
    design: "product-reference",
    reading: "product-reference",
    video: "product-reference",
    finance: "account-work"
  };
  return families[topic.slug] || topic.slug;
}

function hostFor({ index, topic, scenario }) {
  if (scenario === "domain_traps") return SHARED_PLATFORMS[index % SHARED_PLATFORMS.length];
  if (scenario === "behavior_flow") return SHARED_PLATFORMS[(index + Math.floor(index / 4)) % SHARED_PLATFORMS.length];
  if (scenario === "media_type") {
    const byMedia = {
      docs: ["developer.mozilla.org", "docs.google.com"],
      paper: ["arxiv.org", "paperswithcode.com"],
      dashboard: ["linear.app", "grafana.example"],
      image: ["figma.com", "mobbin.com"],
      article: ["medium.com", "substack.com"],
      issue: ["github.com", "jira.example"],
      forum: ["reddit.com", "stackoverflow.com"],
      video: ["youtube.com", "bilibili.com"],
      account: ["stripe.com", "bank.example"],
      shopping: ["amazon.com", "stripe.com"]
    };
    const hosts = byMedia[topic.variants[index % topic.variants.length].mediaType] || topic.hosts;
    return hosts[index % hosts.length];
  }
  return topic.hosts[index % topic.hosts.length];
}

function titleFor({ index, topic, variant, scenario }) {
  const suffix = String(index).padStart(3, "0");
  if (scenario === "low_signal_samples") return `${variant.genericTitle} ${suffix}`;
  if (scenario === "domain_traps" && index % 5 === 0) return `${variant.genericTitle} ${suffix}`;
  if (scenario === "behavior_flow" && index % 4 !== 0) return `${variant.genericTitle} ${suffix}`;
  if (scenario === "media_type") return `${mediaTitle(variant.mediaType)} - ${variant.title} ${suffix}`;
  return index % 11 === 0 ? `${variant.genericTitle} ${suffix}` : `${topic.title} - ${variant.title} ${suffix}`;
}

function mediaTitle(mediaType) {
  const titles = {
    docs: "Documentation",
    paper: "Research paper",
    dashboard: "Dashboard",
    image: "Visual reference",
    article: "Article",
    issue: "Issue thread",
    forum: "Forum discussion",
    video: "Video",
    account: "Account page",
    shopping: "Shopping page"
  };
  return titles[mediaType] || "Page";
}

function pathFor({ index, topic, variant, scenario }) {
  if (scenario === "domain_traps") return `${variant.slug}/${topic.slug}/${index}`;
  if (scenario === "low_signal_samples") return `page/${index}`;
  if (scenario === "behavior_flow") return `flow/${variant.slug}/${index}`;
  if (scenario === "media_type") return `${variant.mediaType}/${topic.slug}/${variant.slug}/${index}`;
  return `${topic.slug}/${variant.slug}/${index}`;
}

function windowForIndex(index, windows, tabCount, scenario) {
  if (scenario === "multi_window") return windows[(index * 3 + Math.floor(index / 9)) % windows.length];
  const perWindow = Math.ceil(tabCount / windows.length);
  return windows[Math.min(windows.length - 1, Math.floor(index / perWindow))];
}

function sequenceIndexFor(index, tabCount, scenario) {
  if (scenario === "old_tabs") {
    const oldBlockSize = Math.ceil(tabCount * 0.45);
    if (index < oldBlockSize) return index;
    return oldBlockSize + ((index * 13) % Math.max(1, tabCount - oldBlockSize));
  }
  if (scenario === "multi_window") return (index * 11) % tabCount;
  if (scenario === "behavior_flow") return index;
  return index;
}

function buildBenchmarkActivationFlow(tabs, truth, scenario) {
  if (scenario !== "behavior_flow") return emptyActivationFlow();
  const activityByTabId = new Map(tabs.map((tab) => [tab.tabId, createBenchmarkTabActivity(tab)]));
  const runs = [];
  const evidence = [];
  let runIndex = 0;

  for (const chunk of behaviorFlowChunks(tabs, truth)) {
    if (chunk.length < 2) continue;
    const anchor = chunk[0];
    const ids = chunk.length >= 3 ? [anchor.tabId, chunk[1].tabId, chunk[2].tabId, anchor.tabId] : [anchor.tabId, chunk[1].tabId, anchor.tabId];
    const dwellSeconds = ids.length === 4 ? [1800 + (runIndex % 3) * 300, 120, 45] : [900, 60];
    const startedAtMs = BASE_TIME + runIndex * 45 * 60 * 1000;
    const endedAtMs = startedAtMs + dwellSeconds.reduce((sum, seconds) => sum + seconds, 0) * 1000;
    const uniqueIds = uniqueOrdered(ids);
    const repeatedIds = [anchor.tabId];
    const run = {
      windowId: anchor.windowId,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      spanSeconds: Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000)),
      ids,
      dwellSeconds,
      returnToId: anchor.tabId,
      repeatedIds
    };
    runs.push(run);
    updateBenchmarkActivity(activityByTabId, run);
    evidence.push({
      ids: uniqueIds,
      strength: 0.71,
      count: 1,
      lastAt: run.endedAt,
      clues: ["same activation run", "returned to an earlier tab", "quick handoff", "long anchor then short checks"]
    });
    runIndex += 1;
  }

  return {
    tabActivity: [...activityByTabId.values()].filter(
      (activity) => activity.activeCount || activity.totalActiveSeconds || activity.appearedInRuns || activity.nearbyIds.length
    ),
    runs: runs.slice(0, 24),
    transitions: buildBenchmarkTransitions(runs).slice(0, 120),
    evidence: evidence.slice(0, 80)
  };
}

function emptyActivationFlow() {
  return { tabActivity: [], runs: [], transitions: [], evidence: [] };
}

function buildBenchmarkTransitions(runs) {
  const byPair = new Map();
  for (const run of runs) {
    for (let index = 0; index < run.ids.length - 1; index += 1) {
      const fromId = run.ids[index];
      const toId = run.ids[index + 1];
      if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) continue;
      const key = `${fromId}:${toId}`;
      const dwellSeconds = Math.max(0, Number(run.dwellSeconds[index] || 0));
      const entry = byPair.get(key) || {
        fromId,
        toId,
        count: 0,
        totalDwellSeconds: 0,
        maxDwellSeconds: 0,
        lastAt: "",
        quickHandoff: false,
        longSourceDwell: false,
        returnedToSource: false
      };
      entry.count += 1;
      entry.totalDwellSeconds += dwellSeconds;
      entry.maxDwellSeconds = Math.max(entry.maxDwellSeconds, dwellSeconds);
      if (!entry.lastAt || Date.parse(run.endedAt || "") > Date.parse(entry.lastAt || "")) entry.lastAt = run.endedAt;
      entry.quickHandoff = entry.quickHandoff || (dwellSeconds > 0 && dwellSeconds <= 180);
      entry.longSourceDwell = entry.longSourceDwell || dwellSeconds >= 20 * 60;
      entry.returnedToSource = entry.returnedToSource || (run.repeatedIds || []).includes(fromId);
      byPair.set(key, entry);
    }
  }
  return [...byPair.values()].map((entry) => ({
    fromId: entry.fromId,
    toId: entry.toId,
    count: entry.count,
    avgDwellSeconds: Math.round(entry.totalDwellSeconds / Math.max(1, entry.count)),
    maxDwellSeconds: Math.round(entry.maxDwellSeconds),
    lastAt: entry.lastAt,
    clues: [
      entry.quickHandoff ? "quick handoff" : "",
      entry.longSourceDwell ? "long source dwell" : "",
      entry.returnedToSource ? "returned to source later" : "",
      entry.count > 1 ? "repeated transition" : ""
    ].filter(Boolean)
  }));
}

function behaviorFlowChunks(tabs, truth) {
  const byTopicAndWindow = new Map();
  for (const tab of tabs) {
    const topic = truth.topicByTabId[tab.tabId];
    const key = `${topic}:${tab.windowId}`;
    const group = byTopicAndWindow.get(key) || [];
    group.push(tab);
    byTopicAndWindow.set(key, group);
  }
  return [...byTopicAndWindow.values()]
    .map((group) => group.sort((left, right) => left.sequenceIndex - right.sequenceIndex))
    .filter((group) => group.length >= 2)
    .sort((left, right) => left[0].sequenceIndex - right[0].sequenceIndex);
}

function createBenchmarkTabActivity(tab) {
  return {
    id: tab.tabId,
    activeCount: 0,
    totalActiveSeconds: 0,
    maxActiveSeconds: 0,
    lastActivatedAt: "",
    appearedInRuns: 0,
    returnedToCount: 0,
    nearbyIds: []
  };
}

function updateBenchmarkActivity(activityByTabId, run) {
  const seen = new Set();
  for (let index = 0; index < run.ids.length; index += 1) {
    const id = run.ids[index];
    const activity = activityByTabId.get(id);
    if (!activity) continue;
    activity.activeCount += 1;
    activity.lastActivatedAt = run.endedAt;
    if (!seen.has(id)) activity.appearedInRuns += 1;
    if (seen.has(id)) activity.returnedToCount += 1;
    seen.add(id);
    const seconds = Number(run.dwellSeconds[index] || 0);
    activity.totalActiveSeconds += seconds;
    activity.maxActiveSeconds = Math.max(activity.maxActiveSeconds, seconds);
  }
  const uniqueIds = uniqueOrdered(run.ids);
  for (const id of uniqueIds) {
    const activity = activityByTabId.get(id);
    if (!activity) continue;
    activity.nearbyIds = uniqueIds.filter((nearbyId) => nearbyId !== id).slice(0, 6);
  }
}

function uniqueOrdered(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    if (!Number.isInteger(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function staleSignalFor(index, tabCount, scenario) {
  const isOldScenario = scenario === "old_tabs";
  const oldCutoff = tabCount ? Math.ceil(tabCount * 0.55) : Number.POSITIVE_INFINITY;
  const isStale = isOldScenario && index < oldCutoff && index % 4 !== 0;
  const ageDays = isStale ? 30 + (index % 10) : index % 5;
  const lastSeenDays = isStale ? 14 + (index % 7) : index % 3;
  return {
    isStale,
    firstSeenAt: new Date(BASE_TIME - ageDays * 86_400_000).toISOString(),
    lastSeenAt: new Date(BASE_TIME - lastSeenDays * 86_400_000).toISOString(),
    activeCount: isStale ? 1 + (index % 2) : 3 + (index % 9)
  };
}
