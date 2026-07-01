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
  await renderShowcase();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`Generated README assets in ${assetDir}`);

async function renderPanelShot(filename, { preview }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 560 },
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

  await page.screenshot({
    path: resolve(assetDir, filename),
    clip: { x: 0, y: 0, width: 390, height: 560 }
  });
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

async function renderShowcase() {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 640 },
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
            width: 1120px;
            height: 590px;
            display: grid;
            grid-template-rows: auto minmax(0, 1fr) auto;
            gap: 12px;
            padding: 26px;
            border: 2px solid rgba(42, 38, 31, 0.18);
            border-radius: 34px;
            background:
              radial-gradient(circle at 18% 16%, rgba(201, 255, 74, 0.18), transparent 26%),
              radial-gradient(circle at 82% 12%, rgba(31, 85, 255, 0.13), transparent 28%),
              linear-gradient(180deg, #fffdf7, #f7f1e5);
            box-shadow:
              0 30px 70px rgba(42, 38, 31, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.82);
          }
          .hero-top {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: start;
            gap: 24px;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .brand img {
            width: 54px;
            height: 54px;
            display: block;
            border-radius: 15px;
          }
          h1 {
            margin: 0;
            max-width: 560px;
            font-size: 42px;
            line-height: 1.03;
            letter-spacing: 0;
          }
          p {
            margin: 0;
            color: #706755;
            font-size: 17px;
            line-height: 1.4;
            font-weight: 700;
          }
          .brand-name {
            margin: 0;
            font-size: 28px;
            line-height: 1;
            font-weight: 950;
          }
          .brand-subtitle {
            margin-top: 4px;
            color: #706755;
            font-size: 14px;
            font-weight: 800;
          }
          .headline {
            display: grid;
            gap: 8px;
          }
          .headline p {
            max-width: 520px;
          }
          .workspace {
            display: grid;
            grid-template-columns: 1.05fr 1.1fr 1fr;
            gap: 12px;
            align-items: stretch;
            min-height: 0;
          }
          .module {
            position: relative;
            display: grid;
            grid-template-rows: auto 1fr;
            gap: 10px;
            min-height: 0;
            padding: 15px 16px;
            border: 1.5px solid rgba(42, 38, 31, 0.18);
            border-radius: 26px;
            background: rgba(255, 252, 245, 0.78);
            box-shadow:
              0 18px 36px rgba(42, 38, 31, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.78);
            overflow: hidden;
          }
          .module::before {
            content: "";
            position: absolute;
            inset: 0 auto 0 0;
            width: 5px;
            background: var(--tone);
          }
          .module-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .module-title {
            margin: 0;
            font-size: 22px;
            line-height: 1.12;
            font-weight: 950;
          }
          .module-kicker {
            display: block;
            margin-bottom: 4px;
            color: #706755;
            font-size: 12px;
            font-weight: 850;
            letter-spacing: 0.08em;
          }
          .pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 28px;
            padding: 4px 12px;
            border: 1.5px solid color-mix(in srgb, var(--tone) 44%, #2a261f);
            border-radius: 999px;
            color: color-mix(in srgb, var(--tone) 70%, #1c1914);
            background: color-mix(in srgb, var(--tone) 14%, #ffffff);
            font-size: 13px;
            font-weight: 900;
            white-space: nowrap;
          }
          .stack {
            display: grid;
            gap: 8px;
            align-content: start;
          }
          .group-row,
          .cleanup-row,
          .timeline-row {
            display: grid;
            gap: 4px;
            padding: 9px 10px;
            border: 1px solid rgba(42, 38, 31, 0.14);
            border-radius: 16px;
            background: rgba(255, 250, 240, 0.8);
          }
          .group-row {
            grid-template-columns: auto 1fr auto;
            align-items: center;
          }
          .bar {
            width: 4px;
            height: 34px;
            border-radius: 999px;
            background: var(--row);
          }
          .row-title {
            color: #1c1914;
            font-size: 14px;
            font-weight: 930;
            line-height: 1.15;
          }
          .row-sub {
            color: #706755;
            font-size: 11px;
            font-weight: 760;
            line-height: 1.2;
          }
          .count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 44px;
            height: 30px;
            border-radius: 999px;
            color: #1f55ff;
            background: #e8eeff;
            font-size: 13px;
            font-weight: 950;
          }
          .cleanup-row {
            grid-template-columns: 1fr auto;
            align-items: start;
          }
          .cleanup-actions {
            display: flex;
            gap: 6px;
          }
          .mini-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 28px;
            padding: 0 10px;
            border: 1.5px solid #2b4484;
            border-radius: 999px;
            color: #1f55ff;
            background: #e8eeff;
            font-size: 12px;
            font-weight: 920;
          }
          .cleanup-reason {
            grid-column: 1 / -1;
            padding-left: 10px;
            border-left: 4px solid var(--tone);
            color: #1c1914;
            font-size: 12px;
            font-weight: 780;
            line-height: 1.35;
          }
          .recap-card {
            display: grid;
            gap: 11px;
            padding: 14px;
            border-radius: 20px;
            background: linear-gradient(180deg, #eef3ff, #f7f9ff);
            border: 1px solid rgba(31, 85, 255, 0.2);
          }
          .recap-line {
            display: grid;
            grid-template-columns: 70px 1fr;
            gap: 10px;
            align-items: start;
            font-size: 13px;
            line-height: 1.35;
            font-weight: 800;
          }
          .recap-line strong {
            color: var(--tone);
            white-space: nowrap;
          }
          .timeline-row {
            grid-template-columns: auto 1fr;
            align-items: start;
          }
          .time {
            color: #1f55ff;
            font-size: 12px;
            font-weight: 950;
            white-space: nowrap;
          }
          .feature-strip {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            justify-content: center;
          }
          .feature {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            min-height: 29px;
            padding: 4px 11px;
            border: 1px solid rgba(42, 38, 31, 0.12);
            border-radius: 999px;
            background: rgba(255, 250, 240, 0.72);
            color: #706755;
            font-size: 13px;
            font-weight: 850;
            box-shadow: 0 10px 20px rgba(42, 38, 31, 0.05);
          }
          .feature i {
            display: block;
            width: 9px;
            height: 9px;
            border-radius: 999px;
            background: var(--tone);
          }
        </style>
      </head>
      <body>
        <main class="showcase">
          <section class="hero-top">
            <div class="headline">
              <div class="brand">
                <img src="${baseUrl}/icons/icon128.png" alt="" aria-hidden="true" />
                <div>
                  <div class="brand-name">TabRecap</div>
                  <div class="brand-subtitle">AI 标签页整理、清理与工作回顾</div>
                </div>
              </div>
              <h1>从成堆标签页里，找回你的工作脉络。</h1>
              <p>一次分析同时给出分组方案、清理建议和时间回顾；你先检查，确认后再整理或手动关闭。</p>
            </div>
            <div class="recap-card" style="--tone:#1f55ff">
              <div class="recap-line">
                <strong>已梳理</strong>
                <span>252 个标签页，识别 6 个主题，30 个留到待确认。</span>
              </div>
              <div class="recap-line">
                <strong>已参考</strong>
                <span>打开次数、停留时长、最近活跃、页面摘要和原始顺序。</span>
              </div>
            </div>
          </section>

          <section class="workspace" aria-label="TabRecap feature overview">
            <article class="module" style="--tone:#1f55ff">
              <div class="module-head">
                <div>
                  <span class="module-kicker">ORGANIZE</span>
                  <h2 class="module-title">整理成主题</h2>
                </div>
                <span class="pill">6 组</span>
              </div>
              <div class="stack">
                <div class="group-row" style="--row:#1f55ff">
                  <i class="bar"></i>
                  <div>
                    <div class="row-title">AI 编程与 Agent</div>
                    <div class="row-sub">MCP、Claude Code、工具链调试</div>
                  </div>
                  <span class="count">39</span>
                </div>
                <div class="group-row" style="--row:#d94a32">
                  <i class="bar"></i>
                  <div>
                    <div class="row-title">模型与论文研究</div>
                    <div class="row-sub">LLM、评测、论文和实验记录</div>
                  </div>
                  <span class="count">34</span>
                </div>
                <div class="group-row" style="--row:#2fa37c">
                  <i class="bar"></i>
                  <div>
                    <div class="row-title">当前项目工作流</div>
                    <div class="row-sub">Issue、PR、文档和本地调试页</div>
                  </div>
                  <span class="count">31</span>
                </div>
              </div>
            </article>

            <article class="module" style="--tone:#d94a32">
              <div class="module-head">
                <div>
                  <span class="module-kicker">CLEANUP</span>
                  <h2 class="module-title">挑出可清理项</h2>
                </div>
                <span class="pill">手动关闭</span>
              </div>
              <div class="stack">
                <div class="cleanup-row">
                  <div>
                    <div class="row-title">旧搜索结果页</div>
                    <div class="row-sub">上次打开约 18 天前 · 很少回看</div>
                  </div>
                  <div class="cleanup-actions">
                    <span class="mini-btn">定位</span>
                    <span class="mini-btn">关闭</span>
                  </div>
                  <div class="cleanup-reason">已有更具体页面替代，保留价值低。</div>
                </div>
                <div class="cleanup-row">
                  <div>
                    <div class="row-title">空白页 / 入口页</div>
                    <div class="row-sub">信息不足 · 容易重新找到</div>
                  </div>
                  <div class="cleanup-actions">
                    <span class="mini-btn">定位</span>
                    <span class="mini-btn">关闭</span>
                  </div>
                  <div class="cleanup-reason">适合先复查，不会自动清理。</div>
                </div>
              </div>
            </article>

            <article class="module" style="--tone:#2fa37c">
              <div class="module-head">
                <div>
                  <span class="module-kicker">RECAP</span>
                  <h2 class="module-title">回顾最近在忙什么</h2>
                </div>
                <span class="pill">7 天</span>
              </div>
              <div class="stack">
                <div class="recap-line" style="--tone:#1f55ff">
                  <strong>主要精力</strong>
                  <span>集中在扩展发布、AI 网关稳定性和侧边栏体验打磨。</span>
                </div>
                <div class="recap-line" style="--tone:#d94a32">
                  <strong>反复回到</strong>
                  <span>页面摘要、清理建议、README 素材和模型路由验证。</span>
                </div>
                <div class="timeline-row">
                  <span class="time">今天</span>
                  <div><div class="row-title">发布收口</div><div class="row-sub">构建、测试、release 与截图更新</div></div>
                </div>
                <div class="timeline-row">
                  <span class="time">本周</span>
                  <div><div class="row-title">产品扩展</div><div class="row-sub">整理 + 清理 + 回顾并行工作流</div></div>
                </div>
              </div>
            </article>
          </section>

          <section class="feature-strip" aria-label="TabRecap capabilities">
            <span class="feature" style="--tone:#1f55ff"><i></i>跨窗口整理</span>
            <span class="feature" style="--tone:#d94a32"><i></i>可回退</span>
            <span class="feature" style="--tone:#c9ff4a"><i></i>页面摘要增强</span>
            <span class="feature" style="--tone:#2fa37c"><i></i>本机活动记录</span>
            <span class="feature" style="--tone:#8b5cf6"><i></i>多语言结果</span>
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
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "zh-CN",
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
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
