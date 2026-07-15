import { chromium } from "playwright";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { STORAGE_KEYS } from "../src/core/storage.js";

const extensionDir = resolve("dist/extension");
const delayMs = positiveInteger(process.env.LONG_RECAP_DELAY_MS, 35_000);

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error("Missing dist/extension. Run npm run build:extension first.");
  process.exit(2);
}

let chatRequests = 0;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/page") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Long recap lifecycle evidence</title><main>Chrome extension lifecycle verification page.</main>");
    return;
  }
  if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
    chatRequests += 1;
    await readRequestBody(request);
    await delay(delayMs);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            schema: "tab_recap_time_recap_v1",
            language: "zh-CN",
            headline: "长请求生命周期验证完成",
            summary: "真实扩展在延迟响应期间保持了回顾任务。",
            themes: [],
            timeline: [],
            coverageNote: ""
          })
        }
      }]
    }));
    return;
  }
  response.writeHead(404).end("not found");
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const runtimeExtensionDir = await prepareExtension(extensionDir, baseUrl);
const userDataDir = await mkdtemp(join(tmpdir(), "tab-recap-long-recap-"));
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${runtimeExtensionDir}`, `--load-extension=${runtimeExtensionDir}`, "--no-first-run"]
  });
  context.setDefaultTimeout(delayMs + 30_000);

  const control = await openExtensionControl(context);
  const defaults = await sendRuntime(control, { type: "settings:get" });
  await sendRuntime(control, {
    type: "settings:save",
    settings: {
      ...defaults,
      plannerProvider: "gateway",
      gatewayProviderMode: "custom",
      gatewayBaseUrl: `${baseUrl}/v1`,
      gatewayApiKey: "",
      gatewayCustomModel: "lifecycle-smoke-model",
      gatewayCustomAuxiliaryModel: "",
      languageMode: "zh-CN",
      pageContextMode: "off",
      continuousPageSummaries: false
    }
  });

  const sourceWindow = await control.evaluate(async (url) => chrome.windows.create({ url, focused: true }), `${baseUrl}/page`);
  await control.waitForFunction(
    async (windowId) => (await chrome.windows.get(windowId, { populate: true })).tabs?.every((tab) => tab.status === "complete"),
    sourceWindow.id
  );
  await control.evaluate(async (windowId) => {
    const window = await chrome.windows.get(windowId, { populate: true });
    await chrome.windows.update(windowId, { focused: true });
    if (window.tabs?.[0]?.id) await chrome.tabs.update(window.tabs[0].id, { active: true });
  }, sourceWindow.id);
  await control.waitForTimeout(1_500);
  await sendRuntime(control, { type: "activity:getOverview", rangeMs: 7 * 24 * 60 * 60 * 1000 });
  await control.evaluate(({ storageKey, activityKey, pageUrl, tabId, windowId, now }) => chrome.storage.local.set({
    [storageKey]: {
      version: 1,
      entries: {
        [activityKey]: {
          key: activityKey,
          title: "Long recap lifecycle evidence",
          hostname: new URL(pageUrl).hostname,
          sanitizedUrl: pageUrl,
          sampleable: true,
          firstSeenAt: now,
          lastObservedAt: now,
          observedCount: 1,
          lastSeenAt: now,
          seenCount: 1,
          lastTabId: tabId,
          lastWindowId: windowId,
          lastKnownState: { discarded: false, pinned: false, audible: false, incognito: false }
        }
      }
    }
  }), {
    storageKey: STORAGE_KEYS.pageActivityCache,
    activityKey: pageActivityKey(`${baseUrl}/page`),
    pageUrl: `${baseUrl}/page`,
    tabId: sourceWindow.tabs?.[0]?.id || null,
    windowId: sourceWindow.id,
    now: new Date().toISOString()
  });
  const overview = await sendRuntime(control, { type: "activity:getOverview", rangeMs: 7 * 24 * 60 * 60 * 1000 });
  if (!overview?.cache?.entries) {
    throw new Error(`Failed to seed lifecycle smoke activity: ${JSON.stringify(overview)}`);
  }
  await control.goto(await control.evaluate(
    (windowId) => chrome.runtime.getURL(`src/sidepanel/index.html?sourceWindowId=${windowId}`),
    sourceWindow.id
  ));
  await control.locator('.mode-tab[data-panel-mode="recap"]').click();

  const startedAt = Date.now();
  await control.getByRole("button", { name: "生成回顾" }).click();
  try {
    await control.locator(".recap-summary-card").getByText("长请求生命周期验证完成").waitFor();
  } catch (error) {
    const diagnostics = await control.evaluate(async () => ({
      status: document.querySelector("#statusText")?.textContent || "",
      recapText: document.querySelector("#recapResult")?.textContent || "",
      settings: (await chrome.runtime.sendMessage({ type: "settings:get" }))?.result || null,
      windows: await chrome.windows.getAll({ populate: true }),
      activityCache: (await chrome.storage.local.get("semanticTabAgent.pageActivityCache"))["semanticTabAgent.pageActivityCache"] || null
    })).catch(() => null);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}; chatRequests=${chatRequests}`);
  }
  const elapsedMs = Date.now() - startedAt;

  if (chatRequests !== 1) throw new Error(`Expected one delayed chat request, received ${chatRequests}.`);
  if (elapsedMs < delayMs) throw new Error(`Recap completed before the configured delay: ${elapsedMs}ms < ${delayMs}ms.`);
  console.log(JSON.stringify({ ok: true, delayMs, elapsedMs, chatRequests }));
} finally {
  await context?.close().catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true });
  await rm(runtimeExtensionDir, { recursive: true, force: true });
}

async function openExtensionControl(browserContext) {
  const worker = browserContext.serviceWorkers()[0] || (await browserContext.waitForEvent("serviceworker", { timeout: 10_000 }));
  const pagePromise = browserContext.waitForEvent("page");
  await worker.evaluate(async () => chrome.windows.create({
    url: chrome.runtime.getURL("src/sidepanel/index.html"),
    type: "popup",
    focused: true,
    width: 420,
    height: 720
  }));
  const page = await pagePromise;
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function prepareExtension(sourceDir, serverBaseUrl) {
  const targetDir = await mkdtemp(join(tmpdir(), "tab-recap-long-recap-extension-"));
  await cp(sourceDir, targetDir, { recursive: true });
  const manifestPath = join(targetDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const serverUrl = new URL(serverBaseUrl);
  manifest.host_permissions = [
    ...new Set([...(manifest.host_permissions || []), `${serverUrl.protocol}//${serverUrl.hostname}/*`])
  ];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return targetDir;
}

async function sendRuntime(page, message) {
  const response = await page.evaluate(async (payload) => chrome.runtime.sendMessage(payload), message);
  if (!response?.ok) throw new Error(response?.error || "Extension runtime request failed.");
  return response.result;
}

async function readRequestBody(request) {
  for await (const _chunk of request) {
    // Drain the request so Chromium can reuse the connection normally.
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function pageActivityKey(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `u_${stableHash(`${url.protocol}//${url.hostname}${url.pathname}`)}`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
