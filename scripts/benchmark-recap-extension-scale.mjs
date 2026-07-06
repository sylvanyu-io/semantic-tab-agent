import { chromium } from "playwright";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS, URL_PRIVACY_MODES } from "../src/shared/settings.js";
import { STORAGE_KEYS } from "../src/core/storage.js";

const extensionDir = resolve("dist/extension");
const tabCounts = parseTabCounts(process.env.RECAP_BENCHMARK_TABS || "30,120,300");
const windowCount = positiveInteger(process.env.RECAP_BENCHMARK_WINDOWS, 4);
const runId = `time-recap-extension-scale-${new Date().toISOString().replace(/[:.]/g, "-")}-pid${process.pid}`;
const dataDir = resolve("docs/benchmarks/data");
const reportPath = resolve("docs/benchmarks/08-time-recap-extension-scale.md");

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error("Missing dist/extension. Run npm run build:extension first.");
  process.exit(2);
}

const maxTabs = Math.max(...tabCounts);
const pages = buildPages(maxTabs, runId);
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const match = url.pathname.match(/^\/page\/(\d+)$/);
  const page = match ? pages[Number(match[1])] : null;
  if (!page) {
    response.writeHead(404).end("not found");
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(renderPage(page));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const userDataDir = await mkdtemp(join(tmpdir(), "tab-recap-recap-bench-"));
const runtimeExtensionDir = await prepareExtension(extensionDir);
const startedAt = new Date().toISOString();
const results = [];

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${runtimeExtensionDir}`, `--load-extension=${runtimeExtensionDir}`, "--no-first-run"]
  });
  context.setDefaultTimeout(300000);

  try {
    const control = await openExtensionControl(context);
    control.setDefaultTimeout(300000);
    await removeBenchmarkWindows(control, baseUrl);

    for (const tabCount of tabCounts) {
      const result = await runRecapScale(control, { tabCount, baseUrl, pages });
      results.push(result);
      console.log(
        `[recap-benchmark] ${tabCount} tabs ok in ${formatMs(result.elapsedMs)}; included=${result.coverage.includedPages}; summaries=${result.coverage.sampledEntries}`
      );
    }
  } finally {
    await context.close();
  }

  const finishedAt = new Date().toISOString();
  const data = {
    schema: "tab_recap_time_recap_extension_scale_benchmark_v1",
    runId,
    startedAt,
    finishedAt,
    extensionDir: relativePath(extensionDir),
    tabCounts,
    windowCount,
    baseUrl: "http://127.0.0.1:<ephemeral>",
    note:
      "This benchmark uses a real Chromium extension runtime and synthetic local tab pages. It measures local recap input construction and fallback generation, not live AI gateway latency.",
    results
  };
  await mkdir(dataDir, { recursive: true });
  const dataPath = join(dataDir, `${runId}.json`);
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(reportPath, renderReport(data, dataPath));
  console.log(JSON.stringify({ runId, dataPath, reportPath, results }, null, 2));
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(runtimeExtensionDir, { recursive: true, force: true });
  await rm(userDataDir, { recursive: true, force: true });
}

async function runRecapScale(control, { tabCount, baseUrl, pages }) {
  await removeBenchmarkWindows(control, baseUrl);
  await settleExtensionRuntime(control);
  await clearRecapEvidence(control);
  const selectedPages = pages.slice(0, tabCount);
  const urls = selectedPages.map((page) => `${baseUrl}/page/${page.id}`);
  const chunks = chunk(urls, Math.ceil(urls.length / Math.min(windowCount, urls.length)));
  const windows = await createBenchmarkWindows(control, chunks, baseUrl);
  await waitForBenchmarkTabs(control, baseUrl, tabCount);
  const tabs = await collectBenchmarkTabs(control, baseUrl);
  if (tabs.length !== tabCount) {
    throw new Error(`Expected ${tabCount} benchmark tabs, got ${tabs.length}.`);
  }

  const now = Date.now();
  await settleExtensionRuntime(control);
  await seedRecapEvidence(control, {
    tabs,
    pagesById: new Map(selectedPages.map((page) => [page.id, page])),
    now,
    baseUrl
  });
  await settleExtensionRuntime(control);
  await seedRecapEvidence(control, {
    tabs,
    pagesById: new Map(selectedPages.map((page) => [page.id, page])),
    now,
    baseUrl
  });

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    languageMode: "zh-CN",
    urlPrivacyMode: URL_PRIVACY_MODES.SANITIZED_URL,
    pageContextMode: "off",
    pageSamplingConsentMode: "not_acknowledged",
    continuousPageSummaries: false,
    includeIncognitoTabs: false
  };
  const started = performance.now();
  const result = await sendRuntime(control, {
    type: "activity:generateTimeRecap",
    settings,
    range: { preset: "30d" },
    timeoutMs: 60_000,
    windowId: windows[0]?.id
  });
  const elapsedMs = Math.round(performance.now() - started);

  if (result.source !== "local") {
    throw new Error(`Expected local recap source, got ${result.source}.`);
  }
  if (result.input?.coverage?.currentOpenTabs !== tabCount) {
    throw new Error(`Expected currentOpenTabs ${tabCount}, got ${result.input?.coverage?.currentOpenTabs}.`);
  }
  if (result.input?.coverage?.includedPages !== tabCount) {
    throw new Error(`Expected includedPages ${tabCount}, got ${result.input?.coverage?.includedPages}.`);
  }
  if (result.input?.coverage?.lifecycleSessions !== tabCount) {
    throw new Error(`Expected lifecycleSessions ${tabCount}, got ${result.input?.coverage?.lifecycleSessions}.`);
  }

  return {
    tabCount,
    windowCount: windows.length,
    elapsedMs,
    source: result.source,
    coverage: result.input.coverage,
    recap: {
      headline: result.recap.headline,
      themeCount: result.recap.themes?.length || 0,
      timelineCount: result.recap.timeline?.length || 0,
      followUpCount: result.recap.followUps?.length || 0,
      coverageNote: result.recap.coverageNote
    }
  };
}

async function clearRecapEvidence(control) {
  await control.evaluate(
    async (keys) => {
      await chrome.storage.local.set({
        [keys.pageActivityCache]: { version: 1, generatedAt: new Date().toISOString(), entries: {} },
        [keys.pageSummaryCache]: { version: 1, generatedAt: new Date().toISOString(), entries: {} },
        [keys.tabLifecycleLog]: {
          version: 1,
          nextSeq: 1,
          events: [],
          sessions: {},
          tabIndex: {},
          lastReconciledAt: new Date().toISOString(),
          reconcileStats: {
            observed: 0,
            inferredOpened: 0,
            inferredClosed: 0,
            checkedAt: new Date().toISOString()
          }
        }
      });
    },
    {
      pageActivityCache: STORAGE_KEYS.pageActivityCache,
      pageSummaryCache: STORAGE_KEYS.pageSummaryCache,
      tabLifecycleLog: STORAGE_KEYS.tabLifecycleLog
    }
  );
}

async function settleExtensionRuntime(control) {
  await control.waitForTimeout(300);
}

async function seedRecapEvidence(control, { tabs, pagesById, now, baseUrl }) {
  const seeded = buildRecapEvidence({ tabs, pagesById, now, baseUrl });
  await control.evaluate(
    async ({ keys, seeded }) => {
      await chrome.storage.local.set({
        [keys.pageActivityCache]: seeded.activityCache,
        [keys.pageSummaryCache]: seeded.summaryCache,
        [keys.tabLifecycleLog]: seeded.lifecycleLog
      });
    },
    {
      keys: {
        pageActivityCache: STORAGE_KEYS.pageActivityCache,
        pageSummaryCache: STORAGE_KEYS.pageSummaryCache,
        tabLifecycleLog: STORAGE_KEYS.tabLifecycleLog
      },
      seeded
    }
  );
}

function buildRecapEvidence({ tabs, pagesById, now, baseUrl }) {
  const activityEntries = {};
  const summaryEntries = {};
  const sessions = {};
  const tabIndex = {};
  const events = [];
  let seq = 1;

  for (const tab of tabs) {
    const pageId = pageIdFromUrl(tab.url);
    const page = pagesById.get(pageId);
    if (!page) continue;
    const key = pageCacheKey(tab.url);
    const firstSeen = now - (pageId % 30) * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000;
    const lastSeen = now - (pageId % 18) * 45 * 60 * 1000;
    const firstSeenAt = new Date(firstSeen).toISOString();
    const lastSeenAt = new Date(lastSeen).toISOString();
    const url = new URL(tab.url);
    const sanitizedUrl = `${url.protocol}//${url.hostname}${url.pathname}`;
    const sample = pageId % 3 === 0 ? null : pageSample(page);

    activityEntries[key] = {
      key,
      title: tab.title || page.title,
      hostname: url.hostname,
      sanitizedUrl,
      sampleable: true,
      firstSeenAt,
      lastSeenAt,
      seenCount: 1 + (pageId % 9),
      lastTabId: tab.id,
      lastWindowId: tab.windowId,
      lastKnownState: {
        discarded: Boolean(tab.discarded),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible),
        incognito: false
      },
      ...(sample ? { sample } : {})
    };

    if (sample) {
      summaryEntries[key] = {
        key,
        title: tab.title || page.title,
        origin: `${url.protocol}//${url.host}/*`,
        firstSeenAt,
        lastSeenAt,
        sampledAt: lastSeenAt,
        lastUsedAt: lastSeenAt,
        seenCount: 1 + (pageId % 7),
        sample
      };
    }

    const sessionId = `s_${pageId}_${stableHash(`${tab.id}:${tab.windowId}:${key}`)}`;
    sessions[sessionId] = {
      id: sessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title || page.title,
      hostname: url.hostname,
      sanitizedUrl,
      urlKey: key,
      openedAt: firstSeenAt,
      firstObservedAt: firstSeenAt,
      lastObservedAt: lastSeenAt,
      activeCount: 1 + (pageId % 6),
      lastActivatedAt: lastSeenAt,
      active: Boolean(tab.active),
      inferredOpen: false,
      pinned: false,
      discarded: Boolean(tab.discarded),
      audible: false,
      incognito: false
    };
    tabIndex[String(tab.id)] = sessionId;
    events.push({
      seq: seq++,
      type: "tab_opened_inferred",
      sessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      at: firstSeenAt,
      active: Boolean(tab.active),
      inferred: true
    });
    if (pageId % 2 === 0) {
      events.push({
        seq: seq++,
        type: "tab_activated",
        sessionId,
        tabId: tab.id,
        windowId: tab.windowId,
        at: lastSeenAt,
        active: true,
        inferred: false
      });
    }
  }

  return {
    activityCache: {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      entries: activityEntries
    },
    summaryCache: {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      entries: summaryEntries
    },
    lifecycleLog: {
      version: 1,
      nextSeq: seq,
      events: events.slice(-1800),
      sessions,
      tabIndex,
      lastReconciledAt: new Date(now).toISOString(),
      reconcileStats: {
        observed: tabs.length,
        inferredOpened: 0,
        inferredClosed: 0,
        checkedAt: new Date(now).toISOString()
      }
    }
  };
}

function buildPages(count, id) {
  const topics = [
    ["ai", "AI 编程代理与工具调研", "对比 Claude Code、Codex、MCP、Paseo 与本地工作流。"],
    ["render", "技术美术与渲染学习", "研究 Blender、SDF、流体变形和 shader 案例。"],
    ["finance", "投资资料整理", "整理美股投资清单、加密入金流程和组合记录。"],
    ["travel", "旅行路线与证件准备", "查看航海课程、房车路线、自驾攻略和签证材料。"],
    ["product", "产品 UI 与扩展发布", "打磨 Chrome 扩展侧边栏、README、商店素材和发布流程。"],
    ["reading", "稍后阅读资料", "保留长文、论文、视频、教程和资料页。"]
  ];
  return Array.from({ length: count }, (_, index) => {
    const topic = topics[(index * 11 + 3) % topics.length];
    return {
      id: index,
      runId: id,
      topicKey: topic[0],
      topicTitle: topic[1],
      summary: topic[2],
      title: `${topic[1]} ${String(index + 1).padStart(3, "0")}`
    };
  });
}

function pageSample(page) {
  return {
    title: page.title,
    metaDescription: page.summary,
    language: "zh-CN",
    contentKind: "article",
    headings: [page.topicTitle, `${page.topicKey} 资料`, "下一步"],
    visibleText: `${page.summary} 这是 ${page.topicTitle} 的第 ${page.id + 1} 条合成页面线索，用于验证回顾在大量标签页下的输入构建和本地总结性能。`,
    reason: "benchmark_seed"
  };
}

function renderPage(page) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.summary)}">
</head>
<body>
  <article>
    <h1>${escapeHtml(page.topicTitle)}</h1>
    <h2>${escapeHtml(page.topicKey)} #${page.id + 1}</h2>
    <p>${escapeHtml(page.summary)}</p>
    <p>Benchmark marker ${escapeHtml(page.runId)}-${page.id}.</p>
  </article>
</body>
</html>`;
}

async function openExtensionControl(context) {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const pagePromise = context.waitForEvent("page");
  await worker.evaluate(async () =>
    chrome.windows.create({
      url: chrome.runtime.getURL("src/sidepanel/index.html"),
      type: "popup",
      focused: true,
      width: 420,
      height: 720
    })
  );
  const page = await pagePromise;
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function prepareExtension(sourceDir) {
  const targetDir = await mkdtemp(join(tmpdir(), "tab-recap-recap-extension-"));
  await cp(sourceDir, targetDir, { recursive: true });
  return targetDir;
}

async function createBenchmarkWindows(page, urlChunks, base) {
  return page.evaluate(async ({ urlChunks, base }) => {
    const controlWindow = await chrome.windows.getCurrent();
    const existing = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const created = [];
    for (const urls of urlChunks) {
      const window = await chrome.windows.create({ url: urls, focused: false, width: 1200, height: 900 });
      created.push({ id: window.id, expectedTabs: urls.length });
    }
    for (const window of existing) {
      if (window.id === controlWindow.id) continue;
      const latest = await chrome.windows.get(window.id, { populate: true }).catch(() => null);
      if (latest && !(latest.tabs || []).some((tab) => String(tab.url || "").startsWith(base))) {
        await chrome.windows.remove(window.id).catch(() => {});
      }
    }
    return created;
  }, { urlChunks, base });
}

async function removeBenchmarkWindows(page, base) {
  await page.evaluate(async (base) => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    for (const window of windows) {
      if ((window.tabs || []).some((tab) => String(tab.url || "").startsWith(base))) {
        await chrome.windows.remove(window.id).catch(() => {});
      }
    }
  }, base);
}

async function waitForBenchmarkTabs(page, base, expected) {
  await page.waitForFunction(
    async ({ base, expected }) => {
      const tabs = await chrome.tabs.query({});
      const matching = tabs.filter((tab) => String(tab.url || "").startsWith(base));
      return matching.length === expected && matching.every((tab) => tab.status === "complete");
    },
    { base, expected },
    { timeout: 180000 }
  );
}

async function collectBenchmarkTabs(page, base) {
  return page.evaluate(async (base) => {
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter((tab) => String(tab.url || "").startsWith(base))
      .map((tab) => ({
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title,
        url: tab.url,
        active: Boolean(tab.active),
        discarded: Boolean(tab.discarded),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible)
      }))
      .sort((left, right) => left.windowId - right.windowId || left.index - right.index);
  }, base);
}

async function sendRuntime(page, message) {
  const response = await page.evaluate(async (message) => chrome.runtime.sendMessage(message), message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension runtime request failed.");
  }
  return response.result;
}

function renderReport(data, dataPath) {
  const rows = data.results
    .map(
      (result) =>
        `| ${result.tabCount} | ${result.windowCount} | ${formatMs(result.elapsedMs)} | ${result.coverage.includedPages} | ${result.coverage.sampledEntries} | ${result.coverage.lifecycleSessions} | ${result.recap.themeCount} | ${result.recap.timelineCount} |`
    )
    .join("\n");
  const fastest = data.results.reduce((best, result) => (result.elapsedMs < best.elapsedMs ? result : best), data.results[0]);
  const slowest = data.results.reduce((best, result) => (result.elapsedMs > best.elapsedMs ? result : best), data.results[0]);
  return `# Time Recap Extension Scale Benchmark

Latest run: \`${data.runId}\`

Raw data: \`${relativePath(dataPath)}\`

This benchmark opens synthetic tab sessions in a real Chromium profile with the unpacked TabRecap extension loaded, seeds local activity/summary/lifecycle records, then calls the extension runtime message \`activity:generateTimeRecap\`.

It intentionally uses the local recap path (\`plannerProvider: fake\`) so the result measures browser/runtime/input-construction stability instead of live AI gateway latency.

| Tabs | Windows | Runtime | Included pages | Page summaries | Lifecycle sessions | Themes | Timeline |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Current Conclusion

- 30/120/300-tab recap input construction is covered by a repeatable real-extension benchmark.
- Latest local recap runtime ranged from ${formatMs(fastest.elapsedMs)} (${fastest.tabCount} tabs) to ${formatMs(slowest.elapsedMs)} (${slowest.tabCount} tabs).
- The benchmark proves local recap assembly and fallback rendering. It does not prove live AI model latency; use gateway live smoke and monitor logs for that layer.
`;
}

function parseTabCounts(value) {
  const counts = String(value || "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
  return counts.length ? counts : [30, 120, 300];
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function pageIdFromUrl(rawUrl) {
  const match = String(rawUrl || "").match(/\/page\/(\d+)/);
  return match ? Number(match[1]) : -1;
}

function pageCacheKey(rawUrl) {
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

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
