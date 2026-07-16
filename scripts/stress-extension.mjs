import { chromium } from "playwright";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { BUILTIN_GATEWAY_BASE_URL, DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { formatStressSummaryMarkdown, summarizeStressArtifact } from "./summarize-stress-artifact.mjs";

const extensionDir = resolve("dist/extension");
const totalTabs = positiveInteger(process.env.STRESS_TABS, 240);
const windowCount = positiveInteger(process.env.STRESS_WINDOWS, 4);
const gatewayTabs = positiveInteger(process.env.STRESS_GATEWAY_TABS, Math.min(totalTabs, 180));
const gatewayKey = process.env.GATEWAY_API_KEY || "";
const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || BUILTIN_GATEWAY_BASE_URL;
const gatewayModel = process.env.GATEWAY_MODEL || DEFAULT_SETTINGS.gatewayModel;
const gatewayStressEnabled = process.env.STRESS_GATEWAY === "1";
const runId = `sta-stress-${Date.now().toString(36)}`;

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error("Missing dist/extension. Run npm run build:extension first.");
  process.exit(2);
}

const pages = buildPages(totalTabs, runId);
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
const urls = pages.map((page) => `${baseUrl}/page/${page.id}`);
const userDataDir = await mkdtemp(join(tmpdir(), "tab-recap-stress-"));
const runtimeExtensionDir = await prepareStressExtension(extensionDir, baseUrl);

const results = [];
let stressError = null;

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${runtimeExtensionDir}`, `--load-extension=${runtimeExtensionDir}`, "--no-first-run"]
  });
  context.setDefaultTimeout(300000);

  try {
    const control = await openExtensionControl(context);
    control.setDefaultTimeout(300000);

    const defaultSettings = await sendRuntime(control, { type: "settings:get" });
    const chunks = chunk(urls, Math.ceil(urls.length / windowCount));
    const createdWindows = await createTestWindows(control, chunks, baseUrl);
    await waitForTestTabs(control, baseUrl, totalTabs);
    const sourceWindowUrl = await control.evaluate(
      (windowId) => chrome.runtime.getURL(`src/sidepanel/index.html?sourceWindowId=${windowId}`),
      createdWindows[0].id
    );
    await control.goto(sourceWindowUrl);
    await control.waitForLoadState("domcontentloaded");
    const initial = await inspectTestTabs(control, baseUrl);
    assertEqual(initial.totalTestTabs, totalTabs, "test tab count after setup");
    assertDeepEqual(
      sortedCounts(initial.windowsWithTestTabs),
      sortedCountsFromChunks(chunks),
      "initial test tab distribution"
    );
    record("created random pages", {
      windows: createdWindows.length,
      tabs: initial.totalTestTabs,
      baseUrl
    });

    const fakeAllSettings = {
      ...defaultSettings,
      plannerProvider: "fake",
      organizeMode: "consolidate_one_window",
      targetWindowMode: "current_window",
      existingGroupMode: "dissolve_existing_groups",
      reviewGroupMode: "create_review_group",
      pageContextMode: "off",
      pageSamplingConsentMode: "not_acknowledged",
      hostPermissionRequestMode: "never",
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 80
    };
    const allJob = await timed("fake all-window analyze", () =>
      sendRuntime(control, { type: "tabs:analyze", settings: fakeAllSettings, windowId: createdWindows[0].id })
    );
    assert(allJob.validation.ok, `all-window fake plan invalid: ${allJob.validation.errors?.join(" ")}`);
    assertEqual(allJob.inventory.tabs.length, totalTabs, "all-window inventory size");
    assertEqual(allJob.preview.pageSampling.requested, 0, "metadata-only page sample count");

    const allApplyConfirmation = await timed("fake all-window confirmation gate", () =>
      sendRuntime(control, { type: "tabs:applyLastPlan", windowId: createdWindows[0].id })
    );
    assertEqual(allApplyConfirmation.requiresMultiWindowConfirmation, true, "all-window apply requires confirmation");
    const allApply = await timed("fake all-window apply", () =>
      sendRuntime(control, { type: "tabs:applyLastPlan", windowId: createdWindows[0].id, confirmMultiWindow: true })
    );
    assertEqual(allApply.movedTabsCount, totalTabs, "all-window moved tab count");
    const afterAllApply = await inspectTestTabs(control, baseUrl);
    assertEqual(afterAllApply.windowsWithTestTabs.length, 1, "all-window apply target window count");

    const allUndo = await timed("fake all-window undo", () => sendRuntime(control, { type: "tabs:undoLastApply", windowId: createdWindows[0].id }));
    assertEqual(allUndo.restoredTabs, totalTabs, "all-window undo restored tab count");
    const afterAllUndo = await inspectTestTabs(control, baseUrl);
    assertDeepEqual(
      sortedCounts(afterAllUndo.windowsWithTestTabs),
      sortedCountsFromChunks(chunks),
      "all-window undo distribution"
    );
    record("all-window apply and undo", {
      groups: allApply.createdGroupIds.length,
      restoredTabs: allUndo.restoredTabs
    });

    const currentWindow = afterAllUndo.windowsWithTestTabs[0];
    const fakeCurrentSettings = { ...fakeAllSettings, organizeMode: "current_window", targetWindowMode: "current_window" };
    const currentJob = await timed("fake current-window analyze", () =>
      sendRuntime(control, { type: "tabs:analyze", settings: fakeCurrentSettings, windowId: currentWindow.id })
    );
    assert(currentJob.validation.ok, `current-window fake plan invalid: ${currentJob.validation.errors?.join(" ")}`);
    assertEqual(currentJob.inventory.tabs.length, currentWindow.testTabCount, "current-window inventory size");
    assertEqual(currentJob.inventory.scope.windowIds.length, 1, "current-window scope size");

    const currentApply = await timed("fake current-window apply", () =>
      sendRuntime(control, { type: "tabs:applyLastPlan", windowId: currentWindow.id })
    );
    const currentUndo = await timed("fake current-window undo", () =>
      sendRuntime(control, { type: "tabs:undoLastApply", windowId: currentWindow.id })
    );
    assertEqual(currentUndo.restoredTabs, currentWindow.testTabCount, "current-window undo restored tab count");
    record("current-window apply and undo", {
      windowTabs: currentWindow.testTabCount,
      groups: currentApply.createdGroupIds.length
    });

    const blockedSamplingSettings = {
      ...fakeCurrentSettings,
      pageContextMode: "all_granted_origins",
      pageSamplingConsentMode: "not_acknowledged",
      hostPermissionRequestMode: "never"
    };
    const blockedSamplingJob = await timed("sampling blocked by risk gate", () =>
      sendRuntime(control, { type: "tabs:analyze", settings: blockedSamplingSettings, windowId: currentWindow.id })
    );
    assertEqual(blockedSamplingJob.preview.pageSampling.requested, currentWindow.testTabCount, "blocked sampling requested count");
    assertEqual(blockedSamplingJob.preview.pageSampling.blocked, currentWindow.testTabCount, "blocked sampling count");
    record("sampling risk gate", blockedSamplingJob.preview.pageSampling);

    const uiSamplingJob = await timed("UI-driven full page sampling", () =>
      runUiSamplingAnalyze(control, {
        expectedSamples: totalTabs,
        runId,
        organizeMode: "consolidate_one_window",
        sourceWindowId: createdWindows[0].id
      })
    );
    assert(uiSamplingJob.validation.ok, `UI sampling plan invalid: ${uiSamplingJob.validation.errors?.join(" ")}`);
    assertEqual(uiSamplingJob.preview.pageSampling.ok, totalTabs, "UI sampling ok count");
    assert(
      uiSamplingJob.inventory.pageSamples.every((sample) => !sample.sample?.visibleText),
      "UI details should not persist sampled page body text"
    );
    record("UI-driven page sampling", uiSamplingJob.preview.pageSampling);

    const activeSamplingSettings = {
      ...fakeAllSettings,
      pageContextMode: "active_tab_only",
      pageSamplingConsentMode: "acknowledged_for_session",
      hostPermissionRequestMode: "never"
    };
    const activeSamplingJob = await timed("active-tab page sampling", () =>
      sendRuntime(control, { type: "tabs:analyze", settings: activeSamplingSettings, windowId: currentWindow.id })
    );
    assertEqual(activeSamplingJob.preview.pageSampling.requested, windowCount, "active-tab sampling requested count");
    assertEqual(activeSamplingJob.preview.pageSampling.ok, windowCount, "active-tab sampling ok count");
    record("active-tab page sampling", activeSamplingJob.preview.pageSampling);

    if (gatewayStressEnabled) {
      const gatewayWindows = await resetForGateway(control, urls.slice(0, gatewayTabs), baseUrl, windowCount);
      const gatewaySettings = {
        ...fakeAllSettings,
        plannerProvider: "gateway",
        gatewayBaseUrl,
        gatewayApiKey: gatewayKey,
        gatewayModel,
        gatewayThinkingIntensity: "high",
        pageContextMode: "off",
        customPrompt: "Group these randomly generated test pages by semantic topic. Every eligible tab must appear exactly once."
      };
      const gatewayJob = await timed("gateway all-window analyze", () =>
        sendRuntime(control, { type: "tabs:analyze", settings: gatewaySettings, windowId: gatewayWindows[0].id })
      );
      assert(gatewayJob.validation.ok, `gateway plan invalid: ${gatewayJob.validation.errors?.join(" ")}`);
      assertEqual(gatewayJob.inventory.tabs.length, gatewayTabs, "gateway inventory size");
      assertEqual(gatewayJob.preview.groupedTabsCount + gatewayJob.preview.reviewTabsCount, gatewayTabs, "gateway covered tabs");
      record("gateway all-window analyze", {
        tabs: gatewayTabs,
        groups: gatewayJob.preview.groups.length,
        reviewTabs: gatewayJob.preview.reviewTabsCount,
        warnings: gatewayJob.preview.warnings.length
      });

      const gatewayRecap = await timed("gateway time recap", () =>
        sendRuntime(control, {
          type: "activity:generateTimeRecap",
          settings: {
            ...gatewaySettings,
            languageMode: "en",
            customPrompt: ""
          },
          range: { preset: "1d" },
          timeoutMs: 300_000,
          windowId: gatewayWindows[0].id
        })
      );
      assert(
        gatewayRecap.source === "ai",
        `gateway recap did not use AI: source=${gatewayRecap.source || "unknown"} error=${gatewayRecap.error || "none"}`
      );
      assert(Boolean(gatewayRecap.recap?.headline), "gateway recap headline is missing");
      assert(
        (gatewayRecap.recap?.themes?.length || 0) + (gatewayRecap.recap?.timeline?.length || 0) > 0,
        "gateway recap has no themes or timeline entries"
      );
      record("gateway time recap", {
        source: gatewayRecap.source,
        pages: gatewayRecap.input?.coverage?.includedPages || 0,
        themes: gatewayRecap.recap?.themes?.length || 0,
        timeline: gatewayRecap.recap?.timeline?.length || 0
      });
    } else {
      record("gateway all-window analyze skipped", { reason: "STRESS_GATEWAY is not enabled" });
    }
  } finally {
    await context.close();
  }
} catch (error) {
  stressError = error;
  throw error;
} finally {
  await writeStressSummary(stressError).catch((error) => {
    console.warn(`[stress] failed to write stress summary: ${error?.message || error}`);
  });
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(runtimeExtensionDir, { recursive: true, force: true });
  await rm(userDataDir, { recursive: true, force: true });
}

function buildPages(count, id) {
  const topics = [
    ["ai", "AI Research", "OpenAI model prompt agent paper benchmark embeddings"],
    ["chrome", "Chrome Extension Docs", "Chrome tabs tabGroups sidePanel scripting permissions API"],
    ["project", "Project Work", "GitHub pull request issue CI deploy localhost workflow"],
    ["reading", "Reading Notes", "article blog newsletter wikipedia essay reference"],
    ["media", "Media Queue", "YouTube podcast video playlist music transcript"],
    ["finance", "Shopping Finance", "invoice billing bank stripe paypal price cart"]
  ];
  return Array.from({ length: count }, (_, index) => {
    const topic = topics[(index * 17 + 11) % topics.length];
    const ambiguous = index % 9 === 0;
    return {
      id: index,
      runId: id,
      topicKey: topic[0],
      topicTitle: topic[1],
      signals: topic[2],
      title: ambiguous ? "Home" : `${topic[1]} ${index}`,
      bodyToken: `${id}-body-${index}`
    };
  });
}

function renderPage(page) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.topicTitle)} synthetic stress page">
  <link rel="canonical" href="https://stress.local/${page.topicKey}/${page.id}">
</head>
<body>
  <h1>${escapeHtml(page.topicTitle)}</h1>
  <h2>${escapeHtml(page.topicKey)} sample ${page.id}</h2>
  <main>
    <p>${escapeHtml(page.signals)}</p>
    <p>Unique page body marker ${escapeHtml(page.bodyToken)} for ${escapeHtml(page.runId)}.</p>
  </main>
</body>
</html>`;
}

async function openExtensionControl(context) {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const pagePromise = context.waitForEvent("page");
  // Harness entrypoint: production opens this document in Chrome's native
  // side panel. The stress runner opens it as an extension page so Playwright
  // can drive the controls directly.
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

async function prepareStressExtension(sourceDir, baseUrl) {
  const targetDir = await mkdtemp(join(tmpdir(), "tab-recap-extension-"));
  await cp(sourceDir, targetDir, { recursive: true });

  const manifestPath = join(targetDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const base = new URL(baseUrl);
  const originPattern = `${base.protocol}//${base.hostname}/*`;
  manifest.permissions = [...new Set([...(manifest.permissions || []), "scripting"])];
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), originPattern])];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return targetDir;
}

async function createTestWindows(page, urlChunks, base) {
  return page.evaluate(async ({ urlChunks, base }) => {
    const existing = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const created = [];
    for (const urls of urlChunks) {
      const window = await chrome.windows.create({ url: urls, focused: false, width: 1200, height: 900 });
      created.push({ id: window.id, expectedTabs: urls.length });
    }
    for (const window of existing) {
      const latest = await chrome.windows.get(window.id, { populate: true }).catch(() => null);
      if (latest && !(latest.tabs || []).some((tab) => String(tab.url || "").startsWith(base))) {
        await chrome.windows.remove(window.id).catch(() => {});
      }
    }
    return created;
  }, { urlChunks, base });
}

async function resetForGateway(page, gatewayUrls, base, windows) {
  await page.evaluate(async (base) => {
    const normalWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    for (const window of normalWindows) {
      if ((window.tabs || []).some((tab) => String(tab.url || "").startsWith(base))) {
        await chrome.windows.remove(window.id).catch(() => {});
      }
    }
  }, base);
  const chunks = chunk(gatewayUrls, Math.ceil(gatewayUrls.length / windows));
  const created = await createTestWindows(page, chunks, base);
  await waitForTestTabs(page, base, gatewayUrls.length);
  return created;
}

async function waitForTestTabs(page, base, expected) {
  await page.waitForFunction(
    async ({ base, expected }) => {
      const tabs = await chrome.tabs.query({});
      const matching = tabs.filter((tab) => String(tab.url || "").startsWith(base));
      return matching.length === expected && matching.every((tab) => tab.status === "complete");
    },
    { base, expected },
    { timeout: 120000 }
  );
}

async function inspectTestTabs(page, base) {
  return page.evaluate(async (base) => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const windowsWithTestTabs = windows
      .map((window) => {
        const testTabs = (window.tabs || []).filter((tab) => String(tab.url || "").startsWith(base));
        return {
          id: window.id,
          focused: Boolean(window.focused),
          testTabCount: testTabs.length,
          activeTestTabs: testTabs.filter((tab) => tab.active).length,
          groupIds: [...new Set(testTabs.map((tab) => tab.groupId).filter((id) => id !== -1))]
        };
      })
      .filter((window) => window.testTabCount > 0);
    return {
      totalTestTabs: windowsWithTestTabs.reduce((sum, window) => sum + window.testTabCount, 0),
      windowsWithTestTabs
    };
  }, base);
}

async function sendRuntime(page, message) {
  const response = await page.evaluate(async (message) => chrome.runtime.sendMessage(message), message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension runtime request failed.");
  }
  return response.result;
}

async function runUiSamplingAnalyze(page, options) {
  if (options.sourceWindowId) {
    await sendRuntime(page, { type: "tabs:clearAnalysisState", windowId: options.sourceWindowId }).catch(() => null);
  }
  // The clear above runs outside the panel UI. Reload so its in-memory preview
  // state matches scoped extension storage before the primary action is clicked.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#analyzeBtn");
  await page.evaluate(({ organizeMode }) => {
    window.__semanticTabAgentAllowFakeProvider = true;
    const ensureOption = (selector, value, label) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing select ${selector}.`);
      if (!element.querySelector(`option[value="${value}"]`)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        element.append(option);
      }
    };
    const set = (selector, value, dispatch = true) => {
      const element = document.querySelector(selector);
      element.value = value;
      if (dispatch) element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    ensureOption("#plannerProvider", "fake", "Fake");
    set("#organizeMode", organizeMode, false);
    set("#plannerProvider", "fake", false);
    set("#existingGroupMode", "dissolve_existing_groups", false);
    set("#pageContextMode", "all_granted_origins", false);
    set("#hostPermissionRequestMode", "ask_for_all_visible_origins", false);
    document.querySelector("#ackSampling").checked = true;
    document.querySelector("#pageContextMode").dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#hostPermissionRequestMode").dispatchEvent(new Event("change", { bubbles: true }));
    if (document.querySelector("#plannerProvider")?.value !== "fake") {
      throw new Error("Stress harness failed to select the fake planner provider.");
    }
  }, options);
  await page
    .waitForFunction(() => (window.__semanticTabAgentPageSamplingOrigins?.origins || []).length > 0, null, {
      timeout: 30000
    })
    .catch(async (error) => {
      const debug = await page.evaluate(() => ({
        cache: window.__semanticTabAgentPageSamplingOrigins || null,
        status: document.querySelector("#statusText")?.textContent || "",
        ackSampling: document.querySelector("#ackSampling")?.checked,
        organizeMode: document.querySelector("#organizeMode")?.value,
        pageContextMode: document.querySelector("#pageContextMode")?.value,
        hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode")?.value
      }));
      throw new Error(`Timed out waiting for page sampling origin cache: ${error.message}; ${JSON.stringify(debug)}`);
    });
  const startedAtMs = Date.now();
  await page.click("#analyzeBtn");
  const job = await waitForLastJob(page, options.sourceWindowId, 180000, { createdAfterMs: startedAtMs - 1000 });
  assertEqual(job.settings?.plannerProvider, "fake", "UI sampling planner provider");
  const statuses = countBy((job.inventory.pageSamples || []).map((sample) => sample.status));
  if (job.preview.pageSampling.ok !== options.expectedSamples) {
    const unsuccessfulSamples = job.inventory.pageSamples
      .filter((sample) => sample.status !== "ok")
      .slice(0, 20)
      .map(({ tabId, windowId, status, reason }) => ({ tabId, windowId, status, reason }));
    const uiDebug = await page.evaluate(async () => {
      const savedResponse = await chrome.runtime.sendMessage({ type: "settings:get" });
      return {
        savedSettings: savedResponse?.result || null,
        fields: {
          ackSampling: document.querySelector("#ackSampling")?.checked,
          pageContextMode: document.querySelector("#pageContextMode")?.value,
          hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode")?.value,
          organizeMode: document.querySelector("#organizeMode")?.value
        },
        originCache: window.__semanticTabAgentPageSamplingOrigins || null
      };
    });
    throw new Error(
      `UI page sample count: expected ${options.expectedSamples}, got ${job.preview.pageSampling.ok}; summary ${JSON.stringify(
        job.preview.pageSampling
      )}; statuses ${JSON.stringify(statuses)}; unsuccessfulSamples ${JSON.stringify(unsuccessfulSamples)}; jobSettings ${JSON.stringify(
        job.settings
      )}; ui ${JSON.stringify(uiDebug)}`
    );
  }
  assert(
    job.inventory.pageSamples.every((sample) => !sample.sample?.visibleText),
    "UI details should not include sampled page body text"
  );
  return job;
}

async function waitForLastJob(page, windowId, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const createdAfterMs = Number(options.createdAfterMs || 0);
  let lastError = null;
  while (Date.now() < deadline) {
    const [activeJob, lastJob] = await Promise.all([
      sendRuntime(page, { type: "tabs:getActiveJob", windowId }).catch((error) => {
        lastError = error;
        return null;
      }),
      sendRuntime(page, { type: "tabs:getLastJob", windowId }).catch((error) => {
        lastError = error;
        return null;
      })
    ]);
    if (isUiSamplingJob(lastJob, createdAfterMs)) {
      return lastJob;
    }
    const storedJob = await findStoredLastSamplingJob(page, { createdAfterMs }).catch((error) => {
      lastError = error;
      return null;
    });
    if (storedJob) return storedJob;
    if (activeJob?.status === "error") {
      throw new Error(`UI sampling job failed: ${activeJob.error || activeJob.message || "unknown error"}`);
    }
    await page.waitForTimeout(500);
  }

  const debug = await samplingUiDebug(page, windowId);
  throw new Error(
    `Timed out waiting for UI sampling result${lastError ? `: ${lastError.message}` : ""}; ${JSON.stringify(debug)}`
  );
}

async function samplingUiDebug(page, windowId) {
  return page.evaluate(async ({ sourceWindowId, lastJobBaseKey }) => {
    const activeJobResponse = await chrome.runtime
      .sendMessage({ type: "tabs:getActiveJob", windowId: sourceWindowId })
      .catch(() => null);
    const lastJobResponse = await chrome.runtime
      .sendMessage({ type: "tabs:getLastJob", windowId: sourceWindowId })
      .catch(() => null);
    const allStorage = await chrome.storage.local.get(null).catch(() => ({}));
    const storedLastJobs = Object.entries(allStorage)
      .filter(([key]) => key === lastJobBaseKey || key.startsWith(`${lastJobBaseKey}:`))
      .map(([key, job]) => ({
        key,
        operationId: job?.operationId || "",
        createdAt: job?.createdAt || "",
        hasPreview: Boolean(job?.preview),
        pageSampling: job?.preview?.pageSampling || null,
        pageSamples: Array.isArray(job?.inventory?.pageSamples) ? job.inventory.pageSamples.length : null,
        validationOk: job?.validation?.ok
      }));
    return {
      status: document.querySelector("#statusText")?.textContent || "",
      progress: document.querySelector("#progressLabel")?.textContent || "",
      details: document.querySelector("#detailsText")?.textContent?.slice(0, 500) || "",
      activeJob: activeJobResponse?.result || null,
      lastJob: lastJobResponse?.result
        ? {
            operationId: lastJobResponse.result.operationId || "",
            hasPreview: Boolean(lastJobResponse.result.preview),
            pageSampling: lastJobResponse.result.preview?.pageSampling || null,
            pageSamples: lastJobResponse.result.inventory?.pageSamples?.length || 0,
            validationOk: lastJobResponse.result.validation?.ok
          }
        : null,
      storedLastJobs,
      ackSampling: document.querySelector("#ackSampling")?.checked,
      pageContextMode: document.querySelector("#pageContextMode")?.value,
      hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode")?.value,
      organizeMode: document.querySelector("#organizeMode")?.value,
      originCache: window.__semanticTabAgentPageSamplingOrigins || null
    };
  }, { sourceWindowId: windowId, lastJobBaseKey: STORAGE_KEYS.lastJob });
}

async function findStoredLastSamplingJob(page, { createdAfterMs = 0 } = {}) {
  const entries = await page.evaluate(async (lastJobBaseKey) => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key === lastJobBaseKey || key.startsWith(`${lastJobBaseKey}:`))
      .map(([key, job]) => ({
        key,
        createdAt: job?.createdAt || "",
        hasPreview: Boolean(job?.preview),
        pageSampling: job?.preview?.pageSampling || null,
        pageSamples: Array.isArray(job?.inventory?.pageSamples) ? job.inventory.pageSamples.length : null,
        validationOk: job?.validation?.ok,
        job
      }));
  }, STORAGE_KEYS.lastJob);
  return entries
    .filter((entry) => isUiSamplingJob(entry.job, createdAfterMs))
    .sort((left, right) => jobCreatedAtMs(right.job) - jobCreatedAtMs(left.job))[0]?.job || null;
}

function isUiSamplingJob(job, createdAfterMs = 0) {
  if (!job?.preview?.pageSampling || !Array.isArray(job.inventory?.pageSamples)) return false;
  if (createdAfterMs > 0 && jobCreatedAtMs(job) < createdAfterMs) return false;
  return true;
}

function jobCreatedAtMs(job) {
  const createdAtMs = Date.parse(job?.createdAt || "");
  return Number.isFinite(createdAtMs) ? createdAtMs : 0;
}

async function writeStressSummary(error = null) {
  await mkdir("dist/stress", { recursive: true });
  const summaryPath = resolve("dist/stress", `${runId}.json`);
  const markdownPath = resolve("dist/stress", `${runId}.md`);
  const summary = {
    runId,
    totalTabs,
    windowCount,
    gatewayTabs: gatewayStressEnabled ? gatewayTabs : 0,
    summaryPath,
    status: error ? "failed" : "passed",
    ...(error
      ? {
          failure: {
            message: error?.message || String(error),
            stack: String(error?.stack || "").slice(0, 4000)
          }
        }
      : {}),
    results
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await writeFile(markdownPath, `${formatStressSummaryMarkdown(summarizeStressArtifact({ ...summary, artifactPath: summaryPath }))}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

async function timed(label, operation) {
  const started = Date.now();
  const result = await operation();
  results.push({ label, elapsedMs: Date.now() - started });
  return result;
}

function record(label, details) {
  results.push({ label, details });
  console.log(`[stress] ${label}: ${JSON.stringify(details)}`);
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sortedCounts(windows) {
  return windows.map((window) => window.testTabCount).sort((left, right) => left - right);
}

function sortedCountsFromChunks(chunks) {
  return chunks.map((items) => items.length).sort((left, right) => left - right);
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
