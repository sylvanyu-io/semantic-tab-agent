import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

const rootDir = resolve(".");
const assetDir = resolve(rootDir, "docs/assets");
const storeAssetDir = resolve(assetDir, "store");
const storeOnly = process.argv.includes("--store");
await mkdir(assetDir, { recursive: true });
await mkdir(storeAssetDir, { recursive: true });

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
  if (storeOnly) {
    await renderStoreAssets();
  } else {
    await renderPanelShot("readme-panel.png", { preview: false });
    await renderPanelShot("readme-preview.png", { preview: true });
    await renderCleanupResultShot("readme-cleanup.png");
    await renderRecapShot("readme-recap.png");
    await renderRecapResultShot("readme-recap-result.png");
    await renderScreenshotShowcase();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`Generated ${storeOnly ? "Chrome Web Store" : "README"} assets in ${storeOnly ? storeAssetDir : assetDir}`);

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

async function renderCleanupResultShot(filename) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 680 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "zh-CN"
  });
  const page = await context.newPage();
  await installChromeMock(page, {
    settings: {
      analyzeGrouping: false,
      analyzeCleanup: true
    },
    preview: {
      analysisFeatures: { grouping: false, cleanup: true },
      groups: [],
      groupedTabsCount: 0,
      reviewTabsCount: 0,
      reviewGroupWillBeCreated: false
    }
  });
  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
  await page.evaluate(() => document.fonts?.ready);
  await focusCapturePage(page);
  await waitForPrimaryActionPaint(page, "#analyzeBtn");
  await page.locator("#analyzeBtn").click();
  await page.locator(".cleanup-preview").waitFor({ state: "visible" });
  await page.locator(".cleanup-preview-row").first().waitFor({ state: "visible" });
  await focusCapturePage(page);
  await page.waitForTimeout(160);
  await page.screenshot({ path: resolve(assetDir, filename) });
  await context.close();
}

async function renderRecapResultShot(filename) {
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
  await page.locator("#analyzeBtn").click();
  await page.locator(".recap-summary-card").waitFor({ state: "visible" });
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
    viewport: { width: 1540, height: 820 },
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
            width: 1480px;
            height: 660px;
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
            grid-template-columns: repeat(5, minmax(0, 1fr));
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
            align-self: center;
            min-height: 0;
            aspect-ratio: 390 / 680;
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
            <p class="lead">整理、清理和回顾都有完整结果页；先看方案，再决定下一步。</p>
          </section>

          <section class="shot-grid" aria-label="TabRecap screenshots">
            <article class="shot-card" style="--tone:#1f55ff">
              <div class="shot-title"><span><i></i>整理设置</span><small>范围、摘要、偏好</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-panel.png')" role="img" aria-label="TabRecap 整理设置完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#d94a32">
              <div class="shot-title"><span><i></i>分组结果</span><small>先预览，再整理</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-preview.png')" role="img" aria-label="TabRecap 分组结果完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#c9ff4a">
              <div class="shot-title"><span><i></i>清理建议</span><small>定位或手动关闭</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-cleanup.png')" role="img" aria-label="TabRecap 清理建议结果完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#2fa37c">
              <div class="shot-title"><span><i></i>回顾设置</span><small>时间范围和本机线索</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-recap.png')" role="img" aria-label="TabRecap 近期回顾完整截图"></div></div>
            </article>
            <article class="shot-card" style="--tone:#8b5cf6">
              <div class="shot-title"><span><i></i>回顾结果</span><small>文字总结、时间线、下一步</small></div>
              <div class="shot-wrap"><div class="shot" style="--shot:url('${baseUrl}/docs/assets/readme-recap-result.png')" role="img" aria-label="TabRecap 回顾结果完整截图"></div></div>
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

function storeLocales() {
  return Object.freeze({
  "en-US": {
    directory: "en",
    brandLine: "AI tab organizer and work recap",
    scenes: [
      {
        key: "01-groups",
        visual: "groups",
        eyebrow: "GROUP",
        title: "Review the grouping plan\nbefore anything moves.",
        description: "AI combines page meaning, tab order, and local activity clues into a plan you can inspect first.",
        points: ["See every proposed group", "Undo after organizing"]
      },
      {
        key: "02-cleanup",
        visual: "cleanup",
        eyebrow: "CLEAN UP",
        title: "Let AI surface tabs\nworth reviewing.",
        description: "See likely duplicates, stale searches, and low-value pages with a clear reason for each suggestion.",
        points: ["Review higher-confidence candidates first", "Tabs are never closed automatically"]
      },
      {
        key: "03-recap",
        visual: "recap",
        eyebrow: "RECAP",
        title: "Choose a period.\nSee what kept you busy.",
        description: "Turn local tab activity and available page summaries into a readable account of your recent work and life.",
        points: ["Uses visits, time spent, and tab history", "Summary, timeline, and next steps"]
      }
    ]
  },
  "zh-CN": {
    directory: "zh_CN",
    brandLine: "AI 标签页整理、清理与工作回顾",
    scenes: [
      {
        key: "01-groups",
        visual: "groups",
        eyebrow: "分组",
        title: "先看分组方案，\n再决定是否整理。",
        description: "AI 结合页面语义、标签页顺序和本机活动线索生成方案，移动前可以逐组检查。",
        points: ["完整查看每个建议分组", "整理后仍然可以撤销"]
      },
      {
        key: "02-cleanup",
        visual: "cleanup",
        eyebrow: "清理",
        title: "让 AI 找出值得复查的标签页。",
        description: "可能重复、长期闲置或价值较低的页面会被集中列出，并附上判断理由。",
        points: ["优先复查更明确的候选", "绝不会自动关闭标签页"]
      },
      {
        key: "03-recap",
        visual: "recap",
        eyebrow: "回顾",
        title: "选一段时间，\n看清最近在忙什么。",
        description: "根据本机标签页活动和可用页面摘要，生成一份同时包含工作与生活线索的回顾。",
        points: ["参考打开次数、停留时长和历史记录", "总结主线、时间线与下一步"]
      }
    ]
  }
  });
}

async function renderStoreAssets() {
  for (const [locale, localeCopy] of Object.entries(storeLocales())) {
    const localeDirectory = resolve(storeAssetDir, localeCopy.directory);
    await rm(localeDirectory, { recursive: true, force: true });
    await mkdir(localeDirectory, { recursive: true });
    const mockOptions = storeMockOptions(locale);
    for (const scene of localeCopy.scenes) {
      const productShot = await captureStorePanel({ locale, visual: scene.visual, mockOptions });
      await renderStoreScreenshot({
        locale,
        copy: { ...scene, brandLine: localeCopy.brandLine },
        productShot,
        outputPath: resolve(localeDirectory, `${scene.key}.png`)
      });
    }
  }

  const globalDirectory = resolve(storeAssetDir, "global");
  await mkdir(globalDirectory, { recursive: true });
  await renderGlobalPromoAssets(globalDirectory);
}

async function captureStorePanel({ locale, visual, mockOptions }) {
  const context = await browser.newContext({
    viewport: { width: 540, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale
  });
  const page = await context.newPage();

  try {
    await installChromeMock(page, mockOptions);
    await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
    await page.evaluate(() => document.fonts?.ready);
    await focusCapturePage(page);
    await waitForPrimaryActionPaint(page, "#analyzeBtn");

    if (visual === "recap") {
      await page.locator('[data-panel-mode="recap"]').click();
      await page.locator("#analyzeBtn").click();
      await page.locator(".recap-summary-card").waitFor({ state: "visible" });
      await focusCapturePage(page);
      await page.waitForTimeout(160);
      const buffer = await page.screenshot({
        type: "png",
        animations: "disabled",
        clip: { x: 0, y: 0, width: 540, height: 730 }
      });
      return `data:image/png;base64,${buffer.toString("base64")}`;
    }

    await page.locator("#analyzeBtn").click();
    await page.locator("#previewSection").waitFor({ state: "visible" });
    await page.locator(".preview-result-tabs").waitFor({ state: "visible" });
    if (visual === "cleanup") {
      await page.locator("#preview-result-tab-cleanup").click();
      await page.locator('#preview-result-panel-cleanup:not([hidden]) .cleanup-preview-row').first().waitFor({ state: "visible" });
    }
    await focusCapturePage(page);
    await page.waitForTimeout(160);

    const bounds = await page.locator("#previewSection").boundingBox();
    if (!bounds) throw new Error(`Unable to capture ${visual} store screenshot.`);
    const x = Math.max(0, bounds.x);
    const buffer = await page.screenshot({
      type: "png",
      animations: "disabled",
      clip: {
        x,
        y: Math.max(0, bounds.y),
        width: Math.min(bounds.width, 540 - x),
        height: Math.min(730, bounds.height)
      }
    });
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } finally {
    await context.close();
  }
}

async function renderStoreScreenshot({ locale, copy, productShot, outputPath }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale
  });
  const page = await context.newPage();
  const pointMarkup = copy.points.map((point, index) => `<li><i data-tone="${index}"></i>${escapeHtml(point)}</li>`).join("");
  await page.setContent(
    `<!doctype html>
    <html lang="${locale}">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; }
          body {
            color: #211e19;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
            background-color: #f8f3e8;
            background-image:
              linear-gradient(rgba(48, 43, 34, 0.045) 1px, transparent 1px),
              linear-gradient(90deg, rgba(48, 43, 34, 0.045) 1px, transparent 1px);
            background-size: 52px 52px;
          }
          main {
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: minmax(0, 620px) 516px;
            gap: 48px;
            align-items: center;
            padding: 48px;
          }
          .copy { min-width: 0; }
          .brand {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 72px;
          }
          .brand img { width: 58px; height: 58px; display: block; }
          .brand strong { display: block; font-size: 26px; line-height: 1; font-weight: 900; }
          .brand small { display: block; margin-top: 7px; color: #746b5c; font-size: 14px; font-weight: 700; }
          .eyebrow {
            margin: 0 0 15px;
            color: #1f55ff;
            font-size: 18px;
            line-height: 1.2;
            font-weight: 850;
          }
          h1 {
            margin: 0;
            font-size: 46px;
            line-height: 1.14;
            font-weight: 920;
            letter-spacing: 0;
            white-space: pre-line;
          }
          .description {
            margin: 25px 0 30px;
            color: #625a4d;
            font-size: 20px;
            line-height: 1.5;
            font-weight: 620;
          }
          ul { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
          li { display: flex; align-items: center; gap: 11px; color: #342f28; font-size: 17px; font-weight: 760; }
          li i { width: 12px; height: 12px; flex: 0 0 auto; border-radius: 3px; background: #1f55ff; }
          li i[data-tone="1"] { background: #d94a32; }
          li i[data-tone="2"] { background: #2fa37c; }
          .product-shot {
            width: 100%;
            height: 704px;
            overflow: hidden;
            border: 1px solid rgba(45, 40, 32, 0.32);
            border-radius: 24px;
            background: #f8f3e8;
            box-shadow: 0 24px 56px rgba(45, 40, 32, 0.18);
          }
          .product-shot img {
            display: block;
            width: 100%;
            height: auto;
          }
        </style>
      </head>
      <body>
        <main>
          <section class="copy">
            <div class="brand">
              <img src="${baseUrl}/icons/icon128.png" alt="" />
              <div><strong>TabRecap</strong><small>${escapeHtml(copy.brandLine)}</small></div>
            </div>
            <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
            <h1>${escapeHtml(copy.title)}</h1>
            <p class="description">${escapeHtml(copy.description)}</p>
            <ul>${pointMarkup}</ul>
          </section>
          <section class="product-shot" aria-label="${escapeHtml(copy.title)}">
            <img src="${productShot}" alt="" />
          </section>
        </main>
      </body>
    </html>`,
    { waitUntil: "load" }
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: outputPath, type: "png" });
  await context.close();
}

async function renderGlobalPromoAssets(globalDirectory) {
  await renderPromoCanvas({
    width: 440,
    height: 280,
    outputPath: resolve(globalDirectory, "small-promo-440x280.png"),
    content: `
      <div class="small-brand"><img src="${baseUrl}/icons/icon128.png" alt="" /><strong>TabRecap</strong></div>
      <p>Organize. Review. Recap.</p>
      <div class="tab-bars"><i></i><i></i><i></i><i></i></div>`
  });
  await renderPromoCanvas({
    width: 1400,
    height: 560,
    outputPath: resolve(globalDirectory, "marquee-1400x560.png"),
    wide: true,
    content: `
      <section class="marquee-copy">
        <div class="wide-brand"><img src="${baseUrl}/icons/icon128.png" alt="" /><strong>TabRecap</strong></div>
        <h1>Make sense of your tabs.</h1>
        <p>AI grouping, cleanup review, and work recaps in one side panel.</p>
      </section>
      <section class="group-visual" aria-hidden="true">
        <div class="group-card blue"><strong>AI &amp; Tools</strong><span>12 tabs</span><i></i><i></i><i></i></div>
        <div class="group-card red"><strong>Design Research</strong><span>8 tabs</span><i></i><i></i></div>
        <div class="group-card green"><strong>Current Projects</strong><span>16 tabs</span><i></i><i></i><i></i></div>
      </section>`
  });
}

async function renderPromoCanvas({ width, height, outputPath, content, wide = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8" /><style>
      * { box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; }
      body {
        position: relative;
        display: ${wide ? "grid" : "flex"};
        grid-template-columns: ${wide ? "1fr 560px" : "none"};
        align-items: center;
        justify-content: center;
        gap: ${wide ? "72px" : "0"};
        padding: ${wide ? "70px 92px" : "34px"};
        color: #211e19;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
        background-color: #f8f3e8;
        background-image:
          linear-gradient(rgba(48,43,34,.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(48,43,34,.045) 1px, transparent 1px);
        background-size: ${wide ? "56px 56px" : "32px 32px"};
      }
      body::before { content: ""; position: absolute; inset: 0; border: 10px solid #1f55ff; pointer-events: none; }
      body:not(.wide) { flex-direction: column; }
      .small-brand { display: flex; align-items: center; justify-content: center; gap: 15px; }
      .small-brand img { width: 72px; height: 72px; }
      .small-brand strong { font-size: 42px; font-weight: 920; }
      body:not(.wide) p { margin: 22px 0 17px; text-align: center; color: #625a4d; font-size: 21px; font-weight: 760; }
      .tab-bars { display: flex; justify-content: center; gap: 10px; }
      .tab-bars i { width: 54px; height: 13px; border-radius: 4px; background: #1f55ff; }
      .tab-bars i:nth-child(2) { width: 35px; background: #d94a32; }
      .tab-bars i:nth-child(3) { width: 44px; background: #2fa37c; }
      .tab-bars i:nth-child(4) { width: 28px; background: #c9ff4a; border: 1px solid rgba(33,30,25,.25); }
      .wide-brand { display: flex; align-items: center; gap: 18px; }
      .wide-brand img { width: 82px; height: 82px; }
      .wide-brand strong { font-size: 43px; font-weight: 920; }
      .marquee-copy h1 { max-width: 650px; margin: 40px 0 18px; font-size: 65px; line-height: 1.04; font-weight: 930; letter-spacing: 0; }
      .marquee-copy p { max-width: 650px; margin: 0; color: #625a4d; font-size: 25px; line-height: 1.45; font-weight: 650; }
      .group-visual { display: grid; gap: 16px; transform: rotate(-2deg); }
      .group-card { display: grid; grid-template-columns: 1fr auto; gap: 13px; padding: 20px 22px; border: 2px solid #211e19; border-radius: 18px; background: #fffaf1; box-shadow: 8px 8px 0 rgba(33,30,25,.12); }
      .group-card strong { font-size: 23px; }
      .group-card span { align-self: center; color: #625a4d; font-size: 17px; font-weight: 760; }
      .group-card i { height: 8px; border-radius: 4px; background: #1f55ff; }
      .group-card i:nth-of-type(2) { width: 78%; }
      .group-card i:nth-of-type(3) { width: 58%; }
      .group-card.red i { background: #d94a32; }
      .group-card.green i { background: #2fa37c; }
    </style></head><body class="${wide ? "wide" : ""}">${content}</body></html>`,
    { waitUntil: "load" }
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: outputPath, type: "png" });
  await context.close();
}

function storeMockOptions(locale) {
  const english = locale === "en-US";
  const groups = english
    ? [
        { title: "AI Coding & Agents", reason: "Claude, ChatGPT, Codex, and agent tooling research.", tabCount: 12 },
        { title: "Product Design & Frontend", reason: "UI references, repositories, and implementation notes.", tabCount: 9 },
        { title: "Current Project Workflow", reason: "Issues, pull requests, documentation, and test pages.", tabCount: 14 },
        { title: "Research & Reading", reason: "Papers, long-form articles, and saved references.", tabCount: 8 }
      ]
    : [
        { title: "AI 编程与 Agent", reason: "Claude、ChatGPT、Codex 与智能体工具调研。", tabCount: 12 },
        { title: "产品设计与前端", reason: "界面参考、代码仓库和实现记录。", tabCount: 9 },
        { title: "当前项目工作流", reason: "Issue、PR、文档和测试页面。", tabCount: 14 },
        { title: "研究与稍后阅读", reason: "论文、长文和待整理参考资料。", tabCount: 8 }
      ];
  const cleanupCandidates = english
    ? [
        {
          tabId: 301,
          windowId: 42,
          title: "render bucket - Google Search",
          hostname: "www.google.com",
          currentGroupTitle: "Product Design & Frontend",
          ageMs: 8 * 24 * 60 * 60 * 1000,
          idleMs: 6 * 24 * 60 * 60 * 1000,
          activeCount: 0,
          priority: "high",
          reason: "A broad search page that has already led to more specific implementation references.",
          evidence: ["Search results page", "More specific pages are open", "Rarely revisited"]
        },
        {
          tabId: 302,
          windowId: 42,
          title: "Duplicate project dashboard",
          hostname: "app.example.com",
          currentGroupTitle: "Current Project Workflow",
          ageMs: 5 * 24 * 60 * 60 * 1000,
          idleMs: 4 * 24 * 60 * 60 * 1000,
          activeCount: 1,
          priority: "medium",
          reason: "Another open tab points to the same project dashboard and has been used more recently.",
          evidence: ["Possible duplicate", "Idle for 4 days"]
        },
        {
          tabId: 303,
          windowId: 42,
          title: "Weekly AI newsletter",
          hostname: "substack.com",
          currentGroupTitle: "Research & Reading",
          ageMs: 18 * 24 * 60 * 60 * 1000,
          idleMs: 10 * 24 * 60 * 60 * 1000,
          activeCount: 0,
          priority: "low",
          reason: "An older reading item that is easy to find again if it becomes relevant.",
          evidence: ["Idle for 10 days", "Easy to find again"]
        }
      ]
    : [
        {
          tabId: 301,
          windowId: 42,
          title: "render bucket - Google 搜索",
          hostname: "www.google.com",
          currentGroupTitle: "产品设计与前端",
          ageMs: 8 * 24 * 60 * 60 * 1000,
          idleMs: 6 * 24 * 60 * 60 * 1000,
          activeCount: 0,
          priority: "high",
          reason: "这是一次较泛的搜索结果，后面已经打开了更具体的实现资料。",
          evidence: ["搜索结果页", "已有更具体页面", "很少回看"]
        },
        {
          tabId: 302,
          windowId: 42,
          title: "重复的项目仪表盘",
          hostname: "app.example.com",
          currentGroupTitle: "当前项目工作流",
          ageMs: 5 * 24 * 60 * 60 * 1000,
          idleMs: 4 * 24 * 60 * 60 * 1000,
          activeCount: 1,
          priority: "medium",
          reason: "另一个标签页指向同一项目仪表盘，而且最近使用得更多。",
          evidence: ["可能重复", "闲置约 4 天"]
        },
        {
          tabId: 303,
          windowId: 42,
          title: "每周 AI Newsletter",
          hostname: "substack.com",
          currentGroupTitle: "研究与稍后阅读",
          ageMs: 18 * 24 * 60 * 60 * 1000,
          idleMs: 10 * 24 * 60 * 60 * 1000,
          activeCount: 0,
          priority: "low",
          reason: "这是一条较早的稍后阅读内容，需要时也很容易重新找到。",
          evidence: ["闲置约 10 天", "需要时容易找回"]
        }
      ];

  return {
    locale,
    settings: {
      languageMode: locale,
      privacyDisclosureDismissed: true,
      customPrompt: english
        ? "Keep current projects, AI research, and reading references separate."
        : "当前项目、AI 调研和稍后阅读分开整理。"
    },
    preview: {
      languageMode: locale,
      groups,
      totalTabsCount: 55,
      eligibleTabsCount: 54,
      groupedTabsCount: 43,
      reviewTabsCount: 11,
      reviewGroupWillBeCreated: true,
      reviewGroupTitle: english ? "Needs Review" : "待分类",
      reviewGroupReason: english ? "Pages without a clear shared topic stay together for review." : "暂时拿不准共同主题的页面先集中放好。",
      pageSampling: { requested: 18, ok: 9, permissionRequired: 0, blocked: 9 },
      cleanup: {
        summary: english
          ? "Review likely duplicates, stale searches, and pages that are easy to recover later."
          : "优先复查可能重复、已经闲置或需要时容易重新找到的页面。",
        candidateCount: cleanupCandidates.length,
        candidates: cleanupCandidates
      }
    },
    recapResult: storeRecapResult(locale)
  };
}

function storeRecapResult(locale) {
  const english = locale === "en-US";
  const now = new Date();
  return {
    source: "ai",
    input: {
      schema: "tab_recap_time_recap_input_v1",
      range: {
        preset: "7d",
        from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString()
      },
      coverage: { includedPages: 65, sampledEntries: 18, currentOpenTabs: 42 },
      pages: [
        { id: 1, tabId: 31, windowId: 42, title: english ? "Store listing checklist" : "商店发布检查清单", hostname: "github.com", open: true },
        { id: 2, tabId: 32, windowId: 42, title: english ? "Side panel design review" : "侧边栏设计复查", hostname: "figma.com", open: true },
        { id: 3, tabId: 33, windowId: 42, title: english ? "Release notes draft" : "版本说明草稿", hostname: "github.com", open: false },
        { id: 4, tabId: 34, windowId: 42, title: english ? "Hangzhou weekend itinerary" : "杭州周末路线", hostname: "maps.google.com", open: true },
        { id: 5, tabId: 35, windowId: 42, title: english ? "Hotels near West Lake" : "西湖附近酒店", hostname: "trip.com", open: false },
        { id: 6, tabId: 36, windowId: 42, title: english ? "Camera rental comparison" : "相机租赁对比", hostname: "example.com", open: true }
      ]
    },
    recap: {
      schema: "tab_recap_time_recap_v1",
      language: locale,
      headline: english
        ? "This week, you moved a product release forward and planned a weekend trip."
        : "这周，你一边推进产品发布，一边规划周末出行。",
      summary: english
        ? "At work, you repeatedly returned to store assets, interface details, and release checks, suggesting the product is close to shipping. Between those sessions, you compared Hangzhou routes, hotels, and camera rentals, gradually shaping a weekend plan."
        : "工作上，你反复回到商店素材、界面细节和发布检查，说明产品已经进入收口阶段。空档时，你持续比较杭州路线、酒店和相机租赁，周末计划也在逐渐成形。",
      themes: english
        ? [
            { title: "Product release", description: "Polished store assets, interface details, and the final release checklist.", confidence: "high", pageIds: [1, 2, 3], evidence: ["Store listing", "Release checks"] },
            { title: "Weekend in Hangzhou", description: "Compared routes, hotels, and camera rentals for a short trip.", confidence: "high", pageIds: [4, 5, 6], evidence: ["Travel route", "Hotels", "Camera rental"] }
          ]
        : [
            { title: "产品发布收口", description: "完善商店素材、界面细节和最终发布检查。", confidence: "high", pageIds: [1, 2, 3], evidence: ["商店资料", "发布检查"] },
            { title: "杭州周末出行", description: "对比路线、酒店和相机租赁，逐步确定短途计划。", confidence: "high", pageIds: [4, 5, 6], evidence: ["旅行路线", "酒店", "相机租赁"] }
          ],
      timeline: english
        ? [
            { label: "Today", description: "Focused on store assets, release checks, and side-panel polish.", pageIds: [1, 2, 3] },
            { label: "Yesterday", description: "Compared Hangzhou routes and shortlisted places to stay.", pageIds: [4, 5] },
            { label: "Earlier", description: "Checked camera rental options and kept a few trip references open.", pageIds: [4, 6] }
          ]
        : [
            { label: "今天", description: "集中处理商店素材、发布检查和侧边栏体验。", pageIds: [1, 2, 3] },
            { label: "昨天", description: "比较杭州周末路线，并筛选合适的住宿。", pageIds: [4, 5] },
            { label: "更早", description: "查看相机租赁方案，并保留了几条出行参考。", pageIds: [4, 6] }
          ],
      followUps: english
        ? [
            { title: "Finish the store listing", reason: "The product and release checks are ready for the final listing pass.", pageIds: [1, 3] },
            { title: "Confirm the weekend itinerary", reason: "The route and hotel shortlist are already taking shape.", pageIds: [4, 5, 6] }
          ]
        : [
            { title: "完成商店资料", reason: "产品和发布检查已经进入最后一轮。", pageIds: [1, 3] },
            { title: "确认周末行程", reason: "路线和住宿备选已经逐渐清晰。", pageIds: [4, 5, 6] }
          ],
      coverageNote: english ? "Used local activity plus available page summaries." : "已结合本机活动和可用页面摘要。"
    }
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function installChromeMock(page, mockOptions = {}) {
  await page.addInitScript((options) => {
    const uiLanguage = options.locale === "en-US" ? "en-US" : "zh-CN";
    const navigatorLanguages = uiLanguage === "en-US" ? ["en-US", "en"] : ["zh-CN", "zh"];
    localStorage.setItem("tabRecap.uiLanguage", uiLanguage);
    Object.defineProperty(navigator, "language", { get: () => uiLanguage });
    Object.defineProperty(navigator, "languages", { get: () => navigatorLanguages });

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
      languageMode: uiLanguage,
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
      customPrompt: "找工作、AI 论文、当前项目分开；拿不准的先放到待分类。",
      ...(options.settings || {})
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
    const defaultPreview = {
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
            evidence: ["搜索结果页", "后面已有更具体页面", "最近没有再打开"]
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
          },
          {
            tabId: 303,
            windowId: 42,
            title: "Yachts for Sale - YachtWorld",
            hostname: "www.yachtworld.com",
            currentGroupTitle: "旅行与生活资料",
            ageMs: 18 * 24 * 60 * 60 * 1000,
            idleMs: 10 * 24 * 60 * 60 * 1000,
            activeCount: 0,
            priority: "low",
            reason: "这类参考页和当前主要工作线索关系较弱，可以回头判断是否还要保留。",
            evidence: ["闲置约10天", "需要时容易找回"]
          }
        ]
      },
      warnings: []
    };
    const preview = {
      ...defaultPreview,
      ...(options.preview || {}),
      cleanup: {
        ...defaultPreview.cleanup,
        ...((options.preview || {}).cleanup || {})
      }
    };
    const job = {
      operationId: activeJob.operationId,
      status: "complete",
      settings,
      validation: { ok: true, warnings: [] },
      preview
    };
    const now = new Date();
    const recapResult = options.recapResult || {
      source: "ai",
      input: {
        schema: "tab_recap_time_recap_input_v1",
        range: {
          preset: "7d",
          from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          to: now.toISOString()
        },
        coverage: { includedPages: 65, sampledEntries: 18, currentOpenTabs: 42 },
        pages: [
          { id: 1, tabId: 31, windowId: 42, title: "Claude Code MCP 工具链调研", hostname: "github.com", open: true },
          { id: 2, tabId: 32, windowId: 42, title: "SPH+SDF 流体变形实践总结", hostname: "bilibili.com", open: true },
          { id: 3, tabId: 33, windowId: 42, title: "美股投资清单与入金流程", hostname: "github.com", open: true }
        ]
      },
      recap: {
        schema: "tab_recap_time_recap_v1",
        language: "zh-CN",
        headline: "最近主要在打磨 AI 标签页整理，同时穿插技术美术和投资资料整理。",
        summary: "你把大部分注意力放在 TabRecap 的产品收口上：验证侧边栏交互、README 素材、AI 网关稳定性和发布流程；中间反复回到技术美术渲染学习，以及美股资料整理。",
        themes: [
          {
            title: "AI 标签页整理产品收口",
            description: "围绕侧边栏、清理建议、回顾结果和发布素材持续打磨。",
            confidence: "high",
            pageIds: [1],
            evidence: ["README 素材", "AI 网关", "侧边栏体验"]
          },
          {
            title: "技术美术与渲染学习",
            description: "继续看 SDF、流体变形和 Blender 相关资料，像是长期学习线索。",
            confidence: "medium",
            pageIds: [2],
            evidence: ["SDF", "Blender", "渲染"]
          },
          {
            title: "投资资料整理",
            description: "整理美股投资清单、入金流程和账户资料，适合沉淀成固定笔记。",
            confidence: "medium",
            pageIds: [3],
            evidence: ["投资清单", "入金流程"]
          }
        ],
        timeline: [
          { label: "今天", description: "主要处理 TabRecap 的 README 图、侧边栏结果页和发布准备。", pageIds: [1] },
          { label: "昨天", description: "回到技术美术与渲染学习，补看 SDF 和流体变形资料。", pageIds: [2] },
          { label: "更早", description: "整理投资清单和入金资料，留下了几条后续可继续的线索。", pageIds: [3] }
        ],
        followUps: [
          { title: "确认 TabRecap 发布素材", reason: "README、截图和 release 文案已经接近收口。", pageIds: [1] },
          { title: "沉淀渲染学习笔记", reason: "SDF 与流体变形资料反复出现，值得整理成一页笔记。", pageIds: [2] },
          { title: "整理投资流程清单", reason: "账户、入金和资料清单可以转成长期可复用文档。", pageIds: [3] }
        ],
        coverageNote: "已结合本机活动、打开次数、保留时长、现有分组和可用页面摘要。"
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
          if (message.type === "activity:generateTimeRecap") return { ok: true, result: recapResult };
          if (message.type === "activity:cancelTimeRecap") return { ok: true, result: { canceled: true } };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: [] } };
          return { ok: true, result: null };
        }
      }
    };
  }, mockOptions);
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
