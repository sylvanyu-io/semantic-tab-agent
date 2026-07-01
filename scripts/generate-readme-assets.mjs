import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

const rootDir = resolve(".");
const assetDir = resolve(rootDir, "docs/assets");
await mkdir(assetDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filePath = resolve(rootDir, pathname.slice(1));
    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403).end();
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();

try {
  await renderPanelShot("readme-panel.png", { preview: false });
  await renderPanelShot("readme-preview.png", { preview: true });
  await renderRecapShot("readme-recap.png");
  await renderScreenshotShowcase();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`Generated README assets in ${assetDir}`);

async function renderPanelShot(filename, { preview }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 680 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "zh-CN"
  });
  const page = await context.newPage();
  await installChromeMock(page);
  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
  await page.evaluate(() => document.fonts?.ready);
  await focusCapturePage(page);
  await waitForPrimaryActionPaint(page, "#analyzeBtn");

  if (preview) {
    await page.locator("#analyzeBtn").click();
    await page.locator("#previewSection").waitFor({ state: "visible" });
    await focusCapturePage(page);
    await waitForPrimaryActionPaint(page, "#applyBtn");
  }

  await page.screenshot({ path: resolve(assetDir, filename) });
  await context.close();
}

async function renderRecapShot(filename) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 680 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "zh-CN"
  });
  const page = await context.newPage();
  await installChromeMock(page);
  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
  await page.evaluate(() => document.fonts?.ready);
  await focusCapturePage(page);
  await waitForPrimaryActionPaint(page, "#analyzeBtn");
  await page.getByRole("button", { name: "回顾" }).click();
  await focusCapturePage(page);
  await waitForPrimaryActionPaint(page, "#analyzeBtn");
  await page.screenshot({ path: resolve(assetDir, filename) });
  await context.close();
}

async function focusCapturePage(page) {
  await page.bringToFront();
  await page.mouse.move(6, 6);
  await page.evaluate(() => {
    window.focus();
  });
  await page.waitForTimeout(80);
}

async function waitForPrimaryActionPaint(page, selector) {
  const button = page.locator(selector);
  await button.waitFor({ state: "visible" });
  await page.waitForTimeout(160);
}

async function renderScreenshotShowcase() {
  const context = await browser.newContext({
    viewport: { width: 1240, height: 780 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: transparent;
            color: #1c1914;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Avenir Next", "Segoe UI", sans-serif;
          }
          .showcase {
            width: 1180px;
            height: 720px;
            display: grid;
            grid-template-rows: auto minmax(0, 1fr) auto;
            gap: 14px;
            padding: 24px;
            border: 2px solid rgba(42, 38, 31, 0.18);
            border-radius: 34px;
            background:
              radial-gradient(circle at 14% 18%, rgba(201, 255, 74, 0.16), transparent 24%),
              radial-gradient(circle at 88% 12%, rgba(31, 85, 255, 0.12), transparent 28%),
              linear-gradient(180deg, #fffdf7, #f7f1e5);
            box-shadow:
              0 30px 70px rgba(42, 38, 31, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.84);
            overflow: hidden;
          }
          .hero {
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            gap: 18px;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .brand img {
            width: 54px;
            height: 54px;
            display: block;
            border-radius: 15px;
          }
          .brand-name {
            font-size: 29px;
            line-height: 1;
            font-weight: 950;
          }
          .brand-subtitle {
            margin-top: 4px;
            color: #706755;
            font-size: 14px;
            font-weight: 800;
          }
          h1 {
            margin: 0;
            font-size: 34px;
            line-height: 1.05;
            letter-spacing: 0;
            font-weight: 950;
          }
          .lead {
            max-width: 390px;
            margin: 0;
            color: #706755;
            font-size: 15px;
            line-height: 1.35;
            font-weight: 760;
          }
          .shot-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            min-height: 0;
          }
          .shot-card {
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
            gap: 8px;
            min-height: 0;
            padding: 10px;
            border: 1.5px solid rgba(42, 38, 31, 0.16);
            border-radius: 28px;
            background: rgba(255, 252, 245, 0.72);
            box-shadow:
              0 18px 36px rgba(42, 38, 31, 0.09),
              inset 0 1px 0 rgba(255, 255, 255, 0.86);
          }
          .shot-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            min-height: 28px;
            padding: 0 4px;
            font-size: 17px;
            font-weight: 950;
          }
          .shot-title small {
            color: #706755;
            font-size: 12px;
            font-weight: 800;
            white-space: nowrap;
          }
          .shot-title i {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: var(--tone);
            box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone) 16%, transparent);
          }
          .shot-title span {
            display: inline-flex;
            align-items: center;
            gap: 8px;
          }
          .shot-wrap {
            display: grid;
            place-items: center;
            min-height: 0;
            overflow: hidden;
            border-radius: 22px;
          }
          .shot {
            width: 100%;
            height: 100%;
            border: 1.5px solid rgba(42, 38, 31, 0.18);
            border-radius: 22px;
            background:
              #f7f1e5
              var(--shot)
              center / contain
              no-repeat;
            box-shadow: 0 12px 24px rgba(42, 38, 31, 0.12);
          }
          .features {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }
          .feature {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            min-height: 29px;
            padding: 4px 11px;
            border: 1px solid rgba(42, 38, 31, 0.12);
            border-radius: 999px;
            background: rgba(255, 250, 240, 0.76);
            color: #706755;
            font-size: 13px;
            font-weight: 850;
            box-shadow: 0 10px 20px rgba(42, 38, 31, 0.05);
          }
          .feature i {
            width: 9px;
            height: 9px;
            border-radius: 999px;
            background: var(--tone);
          }
        </style>
      </head>
      <body>
        <main class="showcase">
          <section class="hero">
            <div class="brand">
              <img src="${baseUrl}/icons/icon128.png" alt="" aria-hidden="true" />
              <div>
                <div class="brand-name">TabRecap</div>
                <div class="brand-subtitle">AI 标签页整理、清理与工作回顾</div>
              </div>
            </div>
            <h1>一个侧边栏，把混乱标签页收拾清楚。</h1>
            <p class="lead">整理分组、清理复查和近期回顾都先生成方案，确认后再动手。</p>
          </section>

          <section class="shot-grid" aria-label="TabRecap screenshots">
            <article class="shot-card" style="--tone:#1f55ff">
              <div class="shot-title"><span><i></i>整理设置</span><small>范围、摘要、偏好</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-panel.png')" role="img" aria-label="TabRecap 整理设置完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#d94a32">
              <div class="shot-title"><span><i></i>方案预览</span><small>分组与清理建议</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-preview.png')" role="img" aria-label="TabRecap 方案预览完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#2fa37c">
              <div class="shot-title"><span><i></i>近期回顾</span><small>时间范围和本机线索</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-recap.png')" role="img" aria-label="TabRecap 近期回顾完整截图"></div></div>
            </article>
          </section>

          <section class="features" aria-label="TabRecap capabilities">
            <span class="feature" style="--tone:#1f55ff"><i></i>跨窗口整理</span>
            <span class="feature" style="--tone:#d94a32"><i></i>手动清理</span>
            <span class="feature" style="--tone:#c9ff4a"><i></i>可回退</span>
            <span class="feature" style="--tone:#2fa37c"><i></i>页面摘要增强</span>
            <span class="feature" style="--tone:#8b5cf6"><i></i>本机活动回顾</span>
            <span class="feature" style="--tone:#f5b73b"><i></i>自定义 AI 网关</span>
          </section>
        </main>
      </body>
    </html>`,
    { waitUntil: "load" }
  );
  await page.locator(".showcase").screenshot({
    path: resolve(assetDir, "readme-hero-zh.png"),
    omitBackground: true
  });
  await context.close();
}

async function installChromeMock(page) {
  await page.addInitScript(() => {
    localStorage.setItem("tabTidy.uiLanguage", "zh-CN");
    Object.defineProperty(navigator, "language", { get: () => "zh-CN" });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh"] });

    const settings = {
      organizeMode: "consolidate_one_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "ambiguous_with_permission",
      hostPermissionRequestMode: "ask_for_all_visible_origins",
      pageSamplingConsentMode: "acknowledged_for_session",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "zh-CN",
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayAuxiliaryModel: "gpt-5.3-codex-spark",
      gatewayCustomModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: "找工作、AI 论文、当前项目分开；拿不准的先放到待分类。"
    };
    const activeJob = {
      operationId: "readme_252_tabs",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      tabCount: 252,
      windowCount: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    const job = {
      operationId: activeJob.operationId,
      status: "complete",
      settings,
      validation: { ok: true, warnings: [] },
      preview: {
        languageMode: "zh-CN",
        requiresConfirmation: true,
        analysisFeatures: { grouping: true, cleanup: true },
        groups: [
          { title: "AI 编程与 Agent", reason: "Claude Code、MCP、工具链和调试材料。", tabCount: 39 },
          { title: "模型与论文研究", reason: "LLM、评测、论文和实验记录。", tabCount: 34 },
          { title: "当前项目工作流", reason: "Issue、PR、文档、CI 和本地调试页面。", tabCount: 31 },
          { title: "产品与设计参考", reason: "竞品、截图、交互模式和发布素材。", tabCount: 48 },
          { title: "购物、账单与账户", reason: "购买记录、订阅、支付和账户设置。", tabCount: 42 },
          { title: "旅行与生活资料", reason: "地图、预订、攻略和日常待办。", tabCount: 28 }
        ],
        totalTabsCount: 253,
        eligibleTabsCount: 252,
        windowCount: 5,
        groupedTabsCount: 222,
        reviewTabsCount: 30,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
        pageSampling: {
          requested: 67,
          ok: 12,
          permissionRequired: 0,
          blocked: 55
        },
        cleanup: {
          summary: "AI 还挑出了可能过期、重复或已经完成任务的标签页，关闭前你可以逐个复查。",
          candidateCount: 6,
          candidates: [
            {
              tabId: 301,
              windowId: 42,
              title: "render bucket - Google 搜索",
              hostname: "www.google.com",
              currentGroupTitle: "技术美术与渲染学习",
              ageMs: 8 * 24 * 60 * 60 * 1000,
              idleMs: 6 * 24 * 60 * 60 * 1000,
              activeCount: 0,
              priority: "medium",
              reason: "这是一次较泛的搜索结果页，后面已经打开了更具体的渲染学习内容。",
              evidence: ["搜索结果页", "同组已有更具体页面", "activeCount 为0"]
            },
            {
              tabId: 302,
              windowId: 42,
              title: "扩展程序 - TabRecap",
              hostname: "extensions",
              currentGroupTitle: "待分类",
              ageMs: 2 * 24 * 60 * 60 * 1000,
              idleMs: 1 * 24 * 60 * 60 * 1000,
              activeCount: 1,
              priority: "high",
              reason: "这是浏览器扩展管理页，完成配置后通常不需要长期保留。",
              evidence: ["浏览器内部页面", "很少回看"]
            }
          ]
        },
        warnings: []
      }
    };
    window.__analysisStarted = false;

    window.chrome = {
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      windows: {
        get: async () => ({ id: 42, type: "normal", tabs: [] }),
        getCurrent: async () => ({ id: 42, type: "normal", tabs: [] }),
        getLastFocused: async () => ({ id: 42, type: "normal", tabs: [] }),
        getAll: async () => Array.from({ length: 5 }, (_, index) => ({ id: index + 1, type: "normal", tabs: [] }))
      },
      runtime: {
        getManifest: () => ({
          optional_permissions: ["scripting"],
          optional_host_permissions: ["https://*/*", "http://*/*"]
        }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: { ...settings, ...message.settings } };
          if (message.type === "tabs:startAnalyze") {
            window.__analysisStarted = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__analysisStarted ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: [] } };
          return { ok: true, result: null };
        }
      }
    };
  });
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
