import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { samplePage } from "../src/core/page-sampler.js";

const rootDir = resolve(".");
let server;
let baseUrl;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
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
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 680 });
  if (!testInfo.title.includes("auto-selects English UI")) {
    await page.addInitScript(() => {
      localStorage.setItem("tabRecap.uiLanguage", "zh-CN");
    });
  }
});

test("page sampler extracts forum discussion content instead of page chrome", async ({ page }) => {
  await page.setContent(`
    <html lang="zh-CN">
      <head>
        <title>模型部署讨论 - Example Forum</title>
        <meta name="description" content="关于模型部署和网关稳定性的讨论">
      </head>
      <body>
        <header>首页 登录 注册 搜索 菜单</header>
        <aside>广告 推荐阅读 友情链接</aside>
        <main class="thread discussion">
          <div>Welcome to Reddit. Come for the cats, stay for the empathy. BECOME A REDDITOR and start exploring. × 21</div>
          <div>all 120 comments sorted by: best</div>
          <h1>模型部署后网关偶发 502 怎么排查？</h1>
          <article class="post topic-body">
            <p>我把 LLM 网关放在 Cloudflare 后面，最近在高并发请求时偶尔返回 502。</p>
            <p>已经确认本地服务还活着，怀疑是 tunnel 和上游超时之间的配合问题。</p>
          </article>
          <section class="comment reply">
            <p>建议先记录每次请求的 upstream latency、HTTP status 和 model name，再按时间窗口聚合。</p>
          </section>
          <section class="comment reply">
            <p>如果是长文本规划任务，最好把 coarse planning 和 refine planning 的耗时分开看。</p>
          </section>
        </main>
        <footer>隐私 条款 联系我们</footer>
      </body>
    </html>
  `);

  const sample = await page.evaluate(samplePage, "test forum extraction");

  expect(sample.contentKind).toBe("discussion");
  expect(sample.visibleText).toContain("LLM 网关放在 Cloudflare 后面");
  expect(sample.visibleText).toContain("coarse planning 和 refine planning");
  expect(sample.visibleText).not.toContain("首页 登录 注册");
  expect(sample.visibleText).not.toContain("广告 推荐阅读");
  expect(sample.visibleText).not.toContain("Welcome to Reddit");
  expect(sample.visibleText).not.toContain("all 120 comments sorted");
});

test("control surface renders settings and mock preview", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.getByRole("heading", { name: "TabRecap" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".app-shell")).not.toHaveCSS("box-shadow", "none");
  await expect(page.locator(".topbar")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".actions")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".actions")).toHaveCSS("position", "relative");
  await expect(page.locator(".actions")).toHaveCSS("display", "grid");
  await expect(page.locator(".scroll-region")).toHaveCSS("overflow-y", "auto");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollRegion = document.querySelector(".scroll-region")?.getBoundingClientRect();
        return Boolean(scrollRegion && scrollRegion.right >= window.innerWidth - 3);
      })
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.getBoundingClientRect().height)).toBe(680);
  await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(680);
  await expect(page.locator("#analyzeBtn")).toHaveCSS("background-color", "rgb(31, 85, 255)");
  await expect(page.locator("#analyzeBtn")).toHaveCSS("border-radius", "10px");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollRegion = document.querySelector(".scroll-region")?.getBoundingClientRect();
        const actions = document.querySelector(".actions")?.getBoundingClientRect();
        return Boolean(scrollRegion && actions && actions.top >= scrollRegion.bottom - 1 && document.body.scrollHeight <= window.innerHeight);
      })
    )
    .toBe(true);
  await expect(page.locator(".segmented")).toHaveCount(0);
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator("#samplingRisk")).toBeVisible();
  await expect(page.locator("#samplingRisk svg")).toBeVisible();
  await expect(page.locator("#samplingRisk")).toHaveAttribute("data-tooltip", /不会读取密码/);
  await expect(page.locator("#privacyDisclosure")).toBeVisible();
  await expect(page.locator("#privacyDisclosure")).toContainText("只在需要时读取，始终由你决定");
  await expect(page.locator("#privacyDisclosure")).toContainText("AI 只生成整理、清理和回顾建议，不会自动关闭标签页");
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.locator("#privacyDisclosure")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollRegion = document.querySelector(".scroll-region")?.getBoundingClientRect();
        const actions = document.querySelector(".actions")?.getBoundingClientRect();
        return Boolean(scrollRegion && actions && actions.top >= scrollRegion.bottom - 1 && document.body.scrollHeight <= window.innerHeight);
      })
    )
    .toBe(true);
  await expect(page.locator("#analyzeGrouping")).toBeChecked();
  await expect(page.locator("#analyzeCleanup")).toBeChecked();
  await expect(page.getByRole("button", { name: "整理 + 清理" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "只整理" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "只清理" })).toHaveCount(0);
  await expect(page.locator("#analysisModeSelect")).not.toBeVisible();
  await page.getByText("更多选项").click();
  await expect(page.locator("#analysisModeSelect")).toBeVisible();
  await expect(page.locator("#analysisModeSelect")).toHaveValue("both");
  await expect(page.locator("#analysisModeHint")).toContainText("一次分析，同时给出分组方案和建议先检查的标签页");
  await expect(page.getByText("会读取页面文字摘要")).toHaveCount(0);
  await expect(page.getByText("会在后台保存短摘要")).toHaveCount(0);
  await expect(page.getByText("整理偏好")).toHaveCount(0);
  await expect(page.getByText("开发版功能")).toHaveCount(0);
  await expect(page.getByText("商店版")).toHaveCount(0);
  await expect(page.getByText("调整", { exact: true })).toHaveCount(0);
  await expect(page.locator("#settingsSummaryBtn")).toHaveCount(0);
  await expect(page.locator("#closeWindowBtn")).toHaveCount(0);
  await expect(page.locator("#uiLanguageToggle")).toHaveText("");
  await expect(page.locator("#uiLanguageToggle svg")).toBeVisible();
  await expect(page.getByLabel("整理方式")).toHaveValue("conservative");
  await expect(page.getByLabel("分组数量")).toHaveValue("balanced");
  await expect.poll(() =>
    page.locator("#promptPreset option").evaluateAll((options) =>
      options.map((option) => ({ value: option.value, text: option.textContent?.trim() }))
    )
  ).toEqual([
    { value: "conservative", text: "智能整理" },
    { value: "media_type", text: "媒体类型" },
    { value: "read_later", text: "稍后阅读" },
    { value: "aggressive_cleanup", text: "强力归纳" }
  ]);
  await expect.poll(() =>
    page.locator("#groupingGranularity option").evaluateAll((options) =>
      options.map((option) => ({ value: option.value, text: option.textContent?.trim() }))
    )
  ).toEqual([
    { value: "compact", text: "更少分组" },
    { value: "balanced", text: "平衡" },
    { value: "detailed", text: "更多分组" }
  ]);

  await page.locator("#ackSampling").check();
  await expect(page.locator("#samplingRisk")).toBeVisible();
  await expect(page.getByText("读取少量网页文字，并在本机保存短摘要")).toBeVisible();
  await expect(page.locator("#pageContextMode")).toHaveValue("ambiguous_with_permission");
  await expect(page.locator("#continuousPageSummaries")).toBeChecked();
  await expect(page.locator("#pageSummaryMemoryMode")).toHaveCount(0);
  await expect(page.locator("#hostPermissionRequestMode")).toHaveValue("ask_for_all_visible_origins");
  await expect(page.locator("#pageContextMode option[value='active_tab_only']")).toHaveCount(0);

  await expect(page.getByLabel("页面摘要读取范围")).toHaveValue("ambiguous_with_permission");
  await expect(page.locator("#pageContextMode")).toContainText("尽量读取已授权页面");
  await expect(page.locator("#gatewayProviderMode")).toHaveValue("builtin");
  await expect(page.locator("#gatewayModel")).toHaveValue("gpt-5.4");
  await expect(page.locator("#gatewayAuxiliaryModel")).toHaveValue("gpt-5.3-codex-spark");
  await expect(page.locator("#gatewayCustomModelField")).toBeHidden();
  await expect(page.locator("#gatewayBaseUrl")).toBeHidden();
  await expect(page.locator("#gatewayApiKey")).toBeHidden();
  await expect(page.getByRole("button", { name: "测试连接" })).toBeHidden();
  await page.locator("#gatewayProviderMode").selectOption("custom");
  await expect(page.locator("#gatewayModel")).toBeHidden();
  await expect(page.locator("#gatewayAuxiliaryModel")).toBeHidden();
  await expect(page.locator("#gatewayCustomModelField")).toBeVisible();
  await expect(page.locator("#gatewayCustomAuxiliaryModel")).toBeVisible();
  await expect(page.locator("#gatewayCustomModel")).toHaveAttribute("placeholder", "留空则使用默认模型 gpt-5.4");
  await expect(page.locator("#gatewayCustomAuxiliaryModel")).toHaveAttribute("placeholder", "留空则跟随主模型");
  await expect(page.locator("#gatewayBaseUrl")).toBeVisible();
  await expect(page.locator("#gatewayBaseUrl")).toHaveAttribute("placeholder", "例如：https://api.deepseek.com/v1");
  await expect(page.locator("#gatewayApiKey")).toHaveAttribute("placeholder", "没有密钥可留空");
  await page.locator("#gatewayBaseUrl").fill("https://api.deepseek.com/v1");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator("#statusText")).toContainText("自定义 API 可用：gpt-5.4");
  await page.locator("#gatewayCustomModel").fill("glm-5.2");
  await expect(page.locator("#gatewayCustomModel")).toHaveValue("glm-5.2");
  await page.locator("#gatewayCustomAuxiliaryModel").fill("gpt-5.4-mini");
  await expect(page.locator("#gatewayCustomAuxiliaryModel")).toHaveValue("gpt-5.4-mini");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator("#statusText")).toContainText("自定义 API 可用：glm-5.2 / gpt-5.4-mini");
  await page.locator("#gatewayProviderMode").selectOption("builtin");
  await expect(page.locator("#gatewayModel")).toBeVisible();
  await expect(page.locator("#gatewayModel")).toHaveValue("gpt-5.4");
  await expect(page.locator("#gatewayCustomModelField")).toBeHidden();
  await expect(page.locator("#gatewayCustomAuxiliaryModel")).toBeHidden();
  await expect(page.locator("#gatewayBaseUrl")).toBeHidden();
  await expect(page.locator("#gatewayThinkingIntensity")).toHaveValue("high");
  await expect(page.locator("#languageMode")).toHaveValue("auto");
  await expect(page.locator("#languageMode")).toContainText("跟随界面");
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("leave_empty_target_window");
  await expect(page.locator("#hostPermissionRequestMode")).toContainText("一次授权可见站点");
  await expect(page.locator("#existingGroupMode")).toBeHidden();
  await expect(page.locator("#reviewGroupMode")).toBeHidden();
  await expect(page.locator("#undoTargetWindowMode")).toBeHidden();
  await expect(page.locator(".settings-transfer-row")).toContainText("设置迁移");
  await expect(page.locator(".settings-transfer-row")).toContainText("导出偏好和模型配置，不包含自定义密钥");
  await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入" })).toBeVisible();
  await expect(page.locator(".diagnostics-row")).toContainText("诊断包");
  await expect(page.locator(".diagnostics-row")).toContainText("不包含密钥、页面网址或页面正文");
  await expect(page.getByRole("button", { name: "下载诊断包" })).toBeVisible();
  await expect(page.locator(".advanced-switch-list .compact-switch")).toHaveCount(5);
  await expect(page.locator(".advanced-switch-list")).toContainText("包含固定标签页");
  await expect(page.locator(".advanced-switch-list")).toContainText("整理后收起分组");
  await expect(page.locator(".advanced-switch-list")).not.toContainText("合并到当前窗口");
  await expect(page.locator(".advanced-switch-list")).not.toContainText("撤销后关闭空窗口");
  await expect(page.locator(".advanced-select-list .setting-select-row")).toHaveCount(9);
  await expect(page.locator("#urlPrivacyMode").locator("xpath=ancestor::*[contains(@class, 'advanced-select-list')]")).toHaveCount(1);
  await expect(page.locator("#dissolveExistingGroupsToggle")).toBeVisible();
  await expect(page.locator("#createReviewGroupToggle")).toBeVisible();
  await expect(page.locator("#dissolveExistingGroupsToggle")).not.toBeChecked();
  await expect(page.locator("#createReviewGroupToggle")).toBeChecked();
  await expect(page.getByText("整理后收起分组")).toBeVisible();
  await expect(page.locator("#collapseGroupsAfterApply")).toBeChecked();

  await page.locator("#dissolveExistingGroupsToggle").check();
  await expect(page.locator("#existingGroupMode")).toHaveValue("dissolve_existing_groups");
  await page.locator("#createReviewGroupToggle").uncheck();
  await expect(page.locator("#reviewGroupMode")).toHaveValue("leave_review_ungrouped");
  await page.getByRole("button", { name: "所有窗口" }).click();
  await expect(page.locator("#targetWindowCurrentToggle")).toHaveCount(0);
  await expect(page.locator("#targetWindowMode")).toBeHidden();
  await expect(page.locator("#targetWindowMode")).toHaveValue("current_window");
  await page.getByRole("button", { name: "当前窗口" }).click();
  await page.locator("#dissolveExistingGroupsToggle").uncheck();
  await expect(page.locator("#existingGroupMode")).toHaveValue("preserve_existing_groups");
  await page.locator("#createReviewGroupToggle").check();
  await expect(page.locator("#reviewGroupMode")).toHaveValue("create_review_group");
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("leave_empty_target_window");

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("当前项目", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("待分类", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".preview .group-title").allTextContents()).toEqual(["AI 研究", "当前项目", "待分类"]);
  await expect(
    page.locator(".preview").getByText("AI 已梳理 23 个标签页，识别出 2 个主题；20 个已自动归类，3 个留到「待分类」。")
  ).toBeVisible();
  await expect(page.locator(".preview").getByText("已补充部分页面线索，并结合标题、网址和原始顺序整理。")).toBeVisible();
  await expect(page.locator(".preview").getByText("另有 1 个固定、无痕或受限标签页未参与整理。")).toBeVisible();
  await expect(page.locator(".activity-panel")).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByText("建议先检查", { exact: true })).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("旧方案对比笔记")).toBeVisible();
  await expect(page.locator(".cleanup-row-actions .icon-action").first()).toBeVisible();
  await expect(page.locator(".cleanup-row-actions").first().locator(".icon-action")).toHaveText(["定位", "关闭"]);
  await expect(page.locator(".cleanup-row-actions").first().locator(".cleanup-priority")).toHaveText("优先检查");
  await expect(page.locator(".cleanup-title-line").first().locator(".cleanup-priority")).toHaveCount(0);
  await expect(page.locator(".cleanup-row-actions").first()).toHaveCSS("float", "right");
  await expect(page.locator(".cleanup-row-actions").first()).toHaveCSS("position", "static");
  await expect(page.locator(".cleanup-row-actions").first()).toHaveCSS("shape-outside", "inset(0px round 999px)");
  await expect(page.locator(".cleanup-reason").first()).toHaveCSS("display", "block");
  await expect(page.locator(".cleanup-preview-actions")).toHaveCount(0);
  await expect(page.locator(".cleanup-select")).toHaveCount(0);
  await expect(page.getByText("待确认")).toHaveCount(0);
  await expect(page.locator(".preview-stats")).toHaveCount(0);
  await expect(page.locator(".stat-chip")).toHaveCount(0);
  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#previewCount")).toHaveText("3 groups");
  await expect(page.locator(".cleanup-row-actions").first().locator(".cleanup-priority")).toHaveText("Check first");
  await expect(page.locator(".cleanup-row-actions").first().locator(".icon-action")).toHaveText(["Find", "Close"]);
  await expect(
    page
      .locator(".preview")
      .getByText('AI reviewed 23 tabs, found 2 topic groups; 20 tabs will be grouped automatically, with 3 tabs set aside for "Needs Review".')
  ).toBeVisible();
  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#previewCount")).toHaveText("3 组");
  await expect(page.getByRole("button", { name: "开始整理" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "撤销" })).toBeHidden();
  await expect(page.getByText("调整", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "返回上级" }).click();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始整理" })).toBeHidden();

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "开始整理" }).click();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
});

test("time recap mode renders a first-class recap surface", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await page.getByRole("button", { name: "回顾" }).click();
  await expect(page.locator("#timeRecapPanel")).toBeVisible();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.locator("#ackSampling")).toBeVisible();
  await expect(page.locator("#continuousPageSummaries")).toBeHidden();
  await expect(page.getByText("读取少量网页文字，并在本机保存短摘要")).toBeVisible();
  await expect(page.locator(".actions")).toBeVisible();
  await expect(page.locator(".advanced-settings")).toBeVisible();
  await expect(page.locator("#gatewayModel")).toHaveValue("gpt-5.4");
  await expect(page.locator("#gatewayAuxiliaryModel")).toHaveValue("gpt-5.3-codex-spark");
  await expect(page.locator("#gatewayThinkingIntensity")).toHaveValue("high");
  await expect(page.getByRole("button", { name: "生成回顾" })).toBeVisible();
  await expect(page.locator(".actions #progressBar")).toBeHidden();
  await expect(page.getByText("看看最近主要在忙什么")).toBeVisible();
  await expect(page.locator("#recapRangePreset")).toHaveValue("7d");
  await expect(page.locator("#recapCustomRange")).toBeVisible();
  await expect(page.locator("#recapFromDate")).toBeVisible();
  await expect(page.locator("#recapToDate")).toBeVisible();

  await page.locator(".advanced-settings > summary").click();
  await expect(page.locator("#urlPrivacyMode")).toBeVisible();
  await expect(page.locator("#languageMode")).toBeVisible();
  await expect(page.locator("#gatewayProviderMode")).toBeVisible();
  await expect(page.locator("#gatewayModel")).toBeVisible();
  await expect(page.locator("#gatewayAuxiliaryModel")).toBeVisible();
  await expect(page.locator("#gatewayThinkingIntensity")).toBeVisible();
  await expect(page.locator("#gatewayBaseUrl")).toBeHidden();
  await page.locator("#gatewayProviderMode").selectOption("custom");
  await expect(page.locator("#gatewayModel")).toBeHidden();
  await expect(page.locator("#gatewayBaseUrl")).toBeVisible();
  await page.locator("#gatewayProviderMode").selectOption("builtin");
  await expect(page.locator("#includeIncognitoTabs")).toBeVisible();
  await expect(page.locator("#dissolveExistingGroupsToggle")).toBeHidden();
  await expect(page.locator("#createReviewGroupToggle")).toBeHidden();
  await expect(page.locator("#includePinnedTabs")).toBeHidden();
  await expect(page.locator("#collapseGroupsAfterApply")).toBeHidden();
  await expect(page.locator("#pageContextMode")).toBeVisible();
  await expect(page.locator("#minConfidenceToApply")).toBeHidden();
  await page.locator(".advanced-settings > summary").click();

  await page.getByRole("button", { name: "过去 24 小时" }).click();
  await expect(page.locator("#recapRangePreset")).toHaveValue("1d");
  await expect(page.locator("#recapFromDate")).toHaveAttribute("type", "datetime-local");
  await expect(page.locator("#recapFromDate")).toHaveValue(/T\d{2}:\d{2}$/);
  await expect(page.locator("#recapRangeHint")).toContainText("24 小时");
  await page.getByRole("button", { name: "本日" }).click();
  await expect(page.locator("#recapRangePreset")).toHaveValue("today");
  await expect(page.locator("#recapFromDate")).toHaveValue(/T00:00$/);
  await page.getByRole("button", { name: "最近 7 天" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator("#statusText")).toHaveText("回顾已生成");
  await expect(page.locator(".actions #progressBar")).toBeHidden();
  await expect(page.getByRole("button", { name: "返回上级" })).toBeVisible();
  await expect(page.locator(".launch-panel")).toBeHidden();
  await expect(page.locator(".advanced-settings")).toBeHidden();
  await expect(page.locator(".recap-controls")).toBeHidden();
  await expect(page.locator(".recap-summary-card")).toContainText("这段时间主要在忙什么");
  await expect(page.locator(".recap-summary-card")).toContainText("主要精力");
  await expect(page.locator(".recap-summary-card")).toContainText("反复回到");
  await expect(page.locator(".recap-summary-card")).not.toContainText("可以继续");
  await expect(page.locator(".recap-summary-card")).toContainText("最近主要在打磨扩展体验和验证 AI 整理策略。");
  await expect(page.locator(".recap-section-title").first()).toHaveText("时间线");
  await expect(page.locator(".recap-card").getByText("扩展产品打磨", { exact: true })).toBeVisible();
  await expect(page.locator(".recap-card").getByText("整理策略验证", { exact: true })).toBeVisible();
  await expect(page.locator(".recap-result")).not.toContainText("值得复查");
  await expect(page.locator(".recap-result")).not.toContainText("发布完成后，这个检查清单可能可以关闭。");
  await expect(page.locator("#recapDetailsRoot")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollRegion = document.querySelector(".scroll-region");
        return {
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          contentFits: scrollRegion ? scrollRegion.scrollWidth <= scrollRegion.clientWidth + 1 : false,
          topicColumns: getComputedStyle(document.querySelector(".recap-topic-grid")).gridTemplateColumns.split(" ").length
        };
      })
    )
    .toEqual({ pageFits: true, contentFits: true, topicColumns: 1 });

  await page.getByRole("button", { name: "返回上级" }).click();
  await expect(page.getByRole("button", { name: "生成回顾" })).toBeVisible();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.locator(".recap-controls")).toBeVisible();
  await expect(page.locator(".recap-summary-card")).toHaveCount(0);

  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.locator("#timeRecapPanel")).toBeHidden();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
});

test("time recap display ignores runtime follow-ups because recap is recap-only", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "activity:generateTimeRecap") {
            return {
              ok: true,
              result: {
                source: "ai",
                input: {
                  pages: [
                    { id: 1, tabId: 10, windowId: 1, title: "TabRecap release checklist", hostname: "github.com", open: true },
                    { id: 2, tabId: 11, windowId: 1, title: "Old cleanup note", hostname: "docs.example", open: true }
                  ],
                  coverage: { includedPages: 2, sampledEntries: 0 }
                },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "这段时间主要在做扩展发布",
                  summary: "主要围绕 TabRecap 发布检查和权限研究推进。这个旧标签页可以关闭。",
                  themes: [
                    {
                      title: "发布检查",
                      description: "权限、发布和回顾体验是主线。Old cleanup note 是否保留可以回头判断。",
                      pageIds: [1],
                      evidence: ["发布检查", "建议关闭旧页面"]
                    }
                  ],
                  timeline: [
                    {
                      label: "周末",
                      description: "集中做发布验证。Review whether to keep stale tabs.",
                      pageIds: [1]
                    }
                  ],
                  followUps: [
                    {
                      title: "关闭旧标签页",
                      reason: "这个页面已经过期，值得复查是否保留。",
                      pageIds: [2]
                    },
                    {
                      title: "继续整理发布检查",
                      reason: "把 release checklist 的剩余步骤顺着做完。",
                      pageIds: [1]
                    }
                  ],
                  coverageNote: "使用本地线索。"
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator(".recap-result")).toContainText("主要围绕 TabRecap 发布检查和权限研究推进。");
  await expect(page.locator(".recap-result")).toContainText("权限、发布和回顾体验是主线。");
  await expect(page.locator(".recap-result")).toContainText("集中做发布验证。");
  await expect(page.locator(".recap-result")).not.toContainText("继续整理发布检查");
  await expect(page.locator(".recap-result")).not.toContainText("把 release checklist 的剩余步骤顺着做完。");
  await expect(page.locator(".recap-result")).not.toContainText("关闭旧标签页");
  await expect(page.locator(".recap-result")).not.toContainText("值得复查");
  await expect(page.locator(".recap-result")).not.toContainText("可以关闭");
  await expect(page.locator(".recap-result")).not.toContainText("是否保留");
  await expect(page.locator(".recap-result")).not.toContainText("建议关闭");
  await expect(page.locator(".recap-result")).not.toContainText("Review whether");
  await expect(page.locator(".recap-result")).not.toContainText("stale tabs");
  await expect(page.locator("#recapDetailsText")).not.toContainText("Old cleanup note");
});

test("time recap summary does not invent a continuation row from AI follow-ups", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "activity:generateTimeRecap") {
            return {
              ok: true,
              result: {
                source: "ai",
                input: {
                  pages: [{ id: 1, tabId: 10, windowId: 1, title: "发布检查页", hostname: "github.com", open: true }],
                  coverage: { includedPages: 1, sampledEntries: 0 }
                },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "这段时间主要在做扩展发布",
                  summary: "主要围绕发布检查推进。",
                  themes: [],
                  timeline: [],
                  followUps: [
                    {
                      title: "关闭发布检查页",
                      reason: "这个页面已经过期，值得复查是否保留。",
                      pageIds: [1]
                    }
                  ],
                  coverageNote: "使用本地线索。"
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator(".recap-summary-card")).toContainText("主要精力");
  await expect(page.locator(".recap-summary-card")).not.toContainText("可以继续");
  await expect(page.locator(".recap-result")).not.toContainText("下次继续");
  await expect(page.locator(".recap-result")).not.toContainText("关闭发布检查页");
  await expect(page.locator(".recap-result")).not.toContainText("值得复查");
});

test("time recap exposes page summary permission controls and sends enabled summary settings", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__savedSettings = [];
    window.__recapMessages = [];
    window.__grantedPermissions = new Set(["https://cliproxy.sylvanyu.io/*"]);
    window.chrome = {
      permissions: {
        contains: async (request) => {
          if (request.permissions?.includes("scripting") && !window.__grantedPermissions.has("scripting")) return false;
          return (request.origins || []).every(
            (origin) =>
              window.__grantedPermissions.has(origin) ||
              (origin.startsWith("https://") && window.__grantedPermissions.has("https://*/*")) ||
              (origin.startsWith("http://") && window.__grantedPermissions.has("http://*/*"))
          );
        },
        request: async (request) => {
          window.__permissionRequests.push(request);
          for (const permission of request.permissions || []) window.__grantedPermissions.add(permission);
          for (const origin of request.origins || []) window.__grantedPermissions.add(origin);
          return true;
        }
      },
      windows: {
        get: async () => ({
          id: 17,
          type: "normal",
          tabs: [
            { id: 101, windowId: 17, title: "Recap source", url: "https://example.com/thread", active: true },
            { id: 102, windowId: 17, title: "Docs", url: "https://docs.example/page" }
          ]
        }),
        getLastFocused: async () => ({ id: 17, type: "normal" })
      },
      runtime: {
        getManifest: () => ({
          optional_permissions: ["scripting"],
          optional_host_permissions: ["https://*/*", "http://*/*"]
        }),
        sendMessage: async (message) => {
          window.__recapMessages.push(message);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            window.__savedSettings.push(settings);
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: ["梳理时间线索"] } };
          if (message.type === "activity:generateTimeRecap") {
            return {
              ok: true,
              result: {
                source: "ai",
                input: { pages: [], coverage: { includedPages: 2, sampledEntries: 1 } },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "摘要权限已用于回顾。",
                  summary: "回顾生成会带上页面摘要设置。",
                  timeline: [],
                  themes: [],
                  followUps: [],
                  coverageNote: ""
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=17`);
  await page.getByRole("button", { name: "回顾" }).click();
  await expect(page.locator("#ackSampling")).toBeVisible();
  await page.locator("#ackSampling").click();
  await expect(page.locator("#ackSampling")).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.at(-1))).toEqual({
    permissions: ["scripting"],
    origins: ["https://*/*", "http://*/*"]
  });

  await page.getByRole("button", { name: "生成回顾" }).click();
  await expect(page.locator(".recap-summary-card")).toContainText("回顾生成会带上页面摘要设置。");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const message = window.__recapMessages.find((item) => item.type === "activity:generateTimeRecap");
        return {
          pageContextMode: message?.settings?.pageContextMode,
          pageSamplingConsentMode: message?.settings?.pageSamplingConsentMode,
          hostPermissionRequestMode: message?.settings?.hostPermissionRequestMode
        };
      })
    )
    .toEqual({
      pageContextMode: "ambiguous_with_permission",
      pageSamplingConsentMode: "acknowledged_persistently",
      hostPermissionRequestMode: "never"
    });
});

test("time recap generation uses the shared bottom progress controls", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.__recapMessages = [];
    window.__recapPromise = new Promise((resolve) => {
      window.__resolveRecap = resolve;
    });
    window.chrome = {
      windows: {
        get: async (windowId) => ({ id: windowId, type: "normal" })
      },
      runtime: {
        sendMessage: async (message) => {
          window.__recapMessages.push(message);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "progressCopy:generate") {
            return { ok: true, result: { messages: ["梳理时间线索", "合并本机活动"] } };
          }
          if (message.type === "activity:generateTimeRecap") return { ok: true, result: await window.__recapPromise };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.locator(".advanced-settings > summary").click();
  await page.locator("#languageMode").selectOption("en-US");
  await page.locator("#gatewayModel").selectOption("claude-sonnet-4-6");
  await page.locator("#gatewayAuxiliaryModel").selectOption("same_as_primary");
  await page.locator("#gatewayThinkingIntensity").selectOption("medium");
  await page.locator(".advanced-settings > summary").click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator(".actions #progressBar")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.locator("#progressPercent")).not.toHaveText("0%");

  await page.evaluate(() => {
    window.__resolveRecap({
      source: "ai",
      input: { pages: [], coverage: { includedPages: 12 } },
      recap: {
        schema: "tab_recap_time_recap_v1",
        headline: "这段时间主要在打磨回顾功能。",
        summary: "回顾流程正在接入统一进度条和底部按钮。",
        timeline: [{ label: "刚才", description: "验证回顾生成进度。", pageIds: [] }],
        themes: [],
        followUps: [],
        coverageNote: "已参考本机活动。"
      }
    });
  });

  await expect(page.locator("#statusText")).toHaveText("回顾已生成");
  await expect(page.locator(".actions #progressBar")).toBeHidden();
  await expect(page.getByRole("button", { name: "返回上级" })).toBeVisible();
  await expect(page.locator(".recap-summary-card")).toContainText("这段时间主要在打磨回顾功能。");
  await expect
    .poll(() =>
      page.evaluate(() => window.__recapMessages.some((message) => message.type === "activity:generateTimeRecap" && message.timeoutMs === 300000))
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const message = window.__recapMessages.find((item) => item.type === "activity:generateTimeRecap");
        return {
          windowId: message?.windowId,
          languageMode: message?.languageMode,
          gatewayModel: message?.settings?.gatewayModel,
          gatewayAuxiliaryModel: message?.settings?.gatewayAuxiliaryModel,
          gatewayThinkingIntensity: message?.settings?.gatewayThinkingIntensity
        };
      })
    )
    .toEqual({
      windowId: 42,
      languageMode: "en-US",
      gatewayModel: "claude-sonnet-4-6",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayThinkingIntensity: "medium"
    });
  await expect
    .poll(() =>
      page.evaluate(() => window.__recapMessages.some((message) => message.type === "progressCopy:generate" && message.windowId === 42))
    )
    .toBe(true);
});

test("time recap and organize generation can run in parallel", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    const runningJob = {
      operationId: "parallel_analysis",
      status: "running",
      phase: "planning",
      progress: 42,
      message: "正在请求 AI 规划",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const completeJob = {
      ...runningJob,
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      finishedAt: new Date().toISOString()
    };
    const completedPlan = {
      operationId: "parallel_analysis",
      settings,
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "并行整理", reason: "回顾生成时仍可整理。", tabCount: 3 }],
        totalTabsCount: 3,
        eligibleTabsCount: 3,
        groupedTabsCount: 3,
        reviewTabsCount: 0,
        reviewGroupWillBeCreated: false,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        analysisFeatures: { grouping: true, cleanup: true },
        cleanup: { summary: "", candidateCount: 0, candidates: [] },
        warnings: []
      }
    };
    window.__messages = [];
    window.__analysisStarted = false;
    window.__analysisPolls = 0;
    window.__recapPromise = new Promise((resolve) => {
      window.__resolveRecap = resolve;
    });
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          window.__messages.push(message);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "tabs:startAnalyze") {
            window.__analysisStarted = true;
            window.__analysisPolls = 0;
            return { ok: true, result: { operationId: runningJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") {
            if (!window.__analysisStarted) return { ok: true, result: null };
            window.__analysisPolls += 1;
            return { ok: true, result: window.__analysisPolls < 2 ? runningJob : completeJob };
          }
          if (message.type === "tabs:getLastJob") return { ok: true, result: completedPlan };
          if (message.type === "activity:generateTimeRecap") return { ok: true, result: await window.__recapPromise };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: ["整理另一条任务", "回顾仍在生成"] } };
          return { ok: true, result: null };
        }
      },
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      tabs: {
        query: async () => [{ id: 1, windowId: 7, active: true }]
      },
      windows: {
        get: async (windowId) => ({ id: windowId, type: "normal" }),
        getLastFocused: async () => ({ id: 7, type: "normal" })
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=7`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();

  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeEnabled();
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("并行整理", { exact: true })).toBeVisible();
  await expect(page.locator("#statusText")).toHaveText("方案好了，可以先检查");

  await page.getByRole("button", { name: "回顾" }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.locator("#statusText")).toContainText("回顾");
  await page.evaluate(() => {
    window.__resolveRecap({
      source: "ai",
      input: { pages: [], coverage: { includedPages: 3, sampledEntries: 0 } },
      recap: {
        schema: "tab_recap_time_recap_v1",
        headline: "回顾也完成了。",
        summary: "整理和回顾可以同时进行。",
        timeline: [],
        themes: [],
        followUps: [],
        coverageNote: ""
      }
    });
  });
  await expect(page.getByRole("button", { name: "返回上级" })).toBeVisible();
  await expect(page.locator(".recap-summary-card")).toContainText("整理和回顾可以同时进行。");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        recap: window.__messages.filter((message) => message.type === "activity:generateTimeRecap").length,
        analyze: window.__messages.filter((message) => message.type === "tabs:startAnalyze").length
      }))
    )
    .toEqual({ recap: 1, analyze: 1 });
});

test("time recap cancellation restores the shared bottom controls immediately", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.__recapMessages = [];
    window.__recapPromise = new Promise(() => {});
    window.__cancelRecapPromise = new Promise(() => {});
    window.chrome = {
      windows: {
        get: async (windowId) => ({ id: windowId, type: "normal" })
      },
      runtime: {
        sendMessage: async (message) => {
          window.__recapMessages.push(message);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: ["梳理时间线索"] } };
          if (message.type === "activity:generateTimeRecap") return { ok: true, result: await window.__recapPromise };
          if (message.type === "activity:cancelTimeRecap") return { ok: true, result: await window.__cancelRecapPromise };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=43`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();
  await expect(page.locator(".actions #progressBar")).toBeVisible();

  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.locator("#statusText")).toHaveText("已停止生成回顾。");
  await expect(page.locator(".actions #progressBar")).toBeHidden();
  await expect(page.getByRole("button", { name: "生成回顾" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__recapMessages.some((message) => message.type === "activity:cancelTimeRecap" && message.windowId === 43)))
    .toBe(true);
});

test("time recap fallback keeps raw AI errors out of the visible product copy", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "activity:generateTimeRecap") {
            return {
              ok: true,
              result: {
                source: "local_fallback",
                error: "AI gateway time recap timed out after 300 seconds.",
                input: { pages: [], coverage: { includedPages: 65 } },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "这段时间主要在整理标签页。",
                  summary: "本机线索显示最近集中在扩展发布和工作流回顾。",
                  timeline: [],
                  themes: [],
                  followUps: [],
                  coverageNote: "已参考本机活动。"
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator(".recap-summary-card")).toContainText("已先根据本机线索完成回顾。");
  await expect(page.locator(".recap-summary-card")).not.toContainText("timed out");
  await expect(page.locator(".recap-summary-card")).not.toContainText("300 seconds");
  await expect(page.locator("#recapDetailsText")).toContainText("已整理 65 个本机页面线索");
  await expect(page.locator("#recapDetailsText")).toContainText("本次已先根据本机线索完成回顾，稍后重新生成可能会补充更完整的表达。");
  await expect(page.locator("#recapDetailsText")).not.toContainText("timed out");
  await expect(page.locator("#recapDetailsText")).not.toContainText("300 seconds");
  await expect(page.locator("#recapDetailsText")).not.toContainText("tabId");
  await expect(page.locator("#recapDetailsText")).not.toContainText("activeCount");
  await expect(page.locator("#recapDetailsText")).not.toContainText("sampleable");
});

test("time recap fallback surfaces friendly model errors without raw gateway copy", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "activity:generateTimeRecap") {
            return {
              ok: true,
              result: {
                source: "local_fallback",
                error: "This model is not available on the free gateway.",
                input: { pages: [], coverage: { includedPages: 12, sampledEntries: 4 } },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "这段时间主要在做模型路由。",
                  summary: "本机线索显示最近集中在扩展发布和模型测试。",
                  timeline: [],
                  themes: [],
                  followUps: [],
                  coverageNote: "已参考本机活动。"
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();

  await expect(page.locator("#statusText")).toHaveText("默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。");
  await expect(page.locator(".recap-summary-card")).toContainText("已先根据本机线索完成回顾。");
  await expect(page.locator(".recap-summary-card")).toContainText("默认 AI 服务暂时不支持这个模型。");
  await expect(page.locator("#recapDetailsText")).toContainText("默认 AI 服务暂时不支持这个模型。");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("free gateway");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("This model is not available");
});

test("time recap error state does not resurrect the previous recap", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
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
      customPrompt: ""
    };
    window.__failNextRecap = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:canUndo") return { ok: true, result: { canUndo: false } };
          if (message.type === "activity:generateTimeRecap") {
            if (window.__failNextRecap) {
              return { ok: false, error: "AI gateway time recap timed out after 300 seconds." };
            }
            return {
              ok: true,
              result: {
                source: "ai",
                input: { pages: [], coverage: { includedPages: 8, sampledEntries: 2 } },
                recap: {
                  schema: "tab_recap_time_recap_v1",
                  headline: "第一次回顾结果",
                  summary: "这是一段旧的成功回顾。",
                  timeline: [],
                  themes: [],
                  followUps: [],
                  coverageNote: "已参考本机活动。"
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "回顾" }).click();
  await page.getByRole("button", { name: "生成回顾" }).click();
  await expect(page.locator(".recap-summary-card")).toContainText("第一次回顾结果");

  await page.evaluate(() => {
    window.__failNextRecap = true;
  });
  await page.getByRole("button", { name: "返回上级" }).click();
  await expect(page.getByRole("button", { name: "生成回顾" })).toBeVisible();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.locator(".recap-summary-card")).toHaveCount(0);
  await expect(page.locator("#timeRecapPanel")).not.toContainText("第一次回顾结果");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("300 seconds");

  await page.getByRole("button", { name: "生成回顾" }).click();
  await expect(page.locator(".recap-card")).toContainText("已先生成本机回顾；AI 增强可稍后重试。");
  await expect(page.locator(".launch-panel")).toBeHidden();
  await expect(page.locator("#timeRecapPanel")).not.toContainText("第一次回顾结果");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("300 seconds");

  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator(".recap-card")).toContainText("Local recap is ready. You can retry AI enhancement later.");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("第一次回顾结果");
  await expect(page.locator("#timeRecapPanel")).not.toContainText("300 seconds");
});

test("cleanup candidates are returned with the generated plan and can be closed manually", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.locator(".activity-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "生成方案" }).click();

  await expect(page.locator("#previewSection")).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("建议先检查", { exact: true })).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText(/旧方案对比笔记/)).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("分组：技术调研", { exact: false })).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("上一轮对比调研留下的页面", { exact: false })).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("判断", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByText("依据", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByText("基本没再打开", { exact: true })).toBeVisible();
  await expect(page.locator(".cleanup-preview").getByText("已放约 22 天", { exact: true })).toBeVisible();
  await expect(page.locator(".cleanup-preview")).not.toContainText("activeCount");
  await expect(page.locator(".cleanup-preview")).not.toContainText("active_count");
  await expect(page.locator(".cleanup-preview")).not.toContainText("ageDays");
  await expect(page.locator(".cleanup-preview")).not.toContainText("age-days");
  await expect(page.locator(".cleanup-preview")).not.toContainText("page_id");
  await expect(page.locator(".cleanup-preview")).not.toContainText("tab_ids");
  await expect(page.locator(".cleanup-preview")).not.toContainText("sample_able");
  await expect(page.locator(".cleanup-preview")).not.toContainText("标题为");

  await expect(page.locator(".cleanup-preview-actions")).toHaveCount(0);
  await expect(page.locator(".cleanup-select")).toHaveCount(0);
  await expect(page.locator(".cleanup-selected-count")).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByRole("button", { name: "全选清理建议" })).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByRole("button", { name: "取消全选清理建议" })).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByRole("button", { name: "关闭选中的标签页" })).toHaveCount(0);
  await page.evaluate(() => {
    window.__mockFailNextFocusTab = true;
  });
  await page.locator(".cleanup-preview").getByRole("button", { name: "定位这个标签页" }).first().click();
  await expect(page.locator("#statusText")).toHaveText("标签页可能已经关闭，请刷新清理建议。");
  await expect(page.locator("#statusText")).not.toContainText("No tab with id");
  const transientStatus = await page
    .locator(".cleanup-preview")
    .getByRole("button", { name: "关闭这个标签页" })
    .first()
    .evaluate((button) => {
      button.click();
      return document.querySelector("#statusText")?.textContent || "";
    });
  expect(transientStatus).toBe("正在关闭标签页");
  await expect(page.locator("#statusText")).toHaveText("已关闭 1 个标签页，方案已同步更新");
  await page.locator(".cleanup-preview").getByRole("button", { name: "关闭这个标签页" }).first().click();
  await expect(page.locator(".cleanup-preview").getByText("旧方案对比笔记")).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByText("上轮调研资料")).toHaveCount(0);
  await expect(page.locator("#statusText")).toHaveText("已关闭 1 个标签页，方案已同步更新");
});

test("cleanup-only mode renders cleanup copy without fake grouping", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await page.getByText("更多选项").click();
  await page.locator("#analysisModeSelect").selectOption("cleanup");
  await expect(page.locator("#analyzeGrouping")).not.toBeChecked();
  await expect(page.locator("#analyzeCleanup")).toBeChecked();
  await expect(page.locator("#analysisModeHint")).toContainText("列出建议先检查的标签页");

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview .step-label")).toHaveText("清理预览");
  await expect(page.locator(".preview .section-heading h2")).toHaveText("建议先检查的标签页");
  await expect(page.locator("#previewCount")).toHaveText("2 项");
  await expect(page.locator(".preview")).not.toContainText("即将创建的分组");
  await expect(page.locator("#previewRoot")).not.toContainText("本次按要求不自动分组");
  await expect(page.locator(".preview .group-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始整理" })).toBeHidden();
  await expect(page.locator(".cleanup-preview-actions")).toHaveCount(0);
  await expect(page.locator(".cleanup-select")).toHaveCount(0);
  await expect(page.locator(".cleanup-preview").getByRole("button", { name: "关闭选中的标签页" })).toHaveCount(0);
});

test("auto-selects English UI and can manually switch back", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("tabRecap.uiLanguage");
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.locator("#statusText")).toHaveText("AI tab organizer & recap");
  await expect(page.getByText("Scope", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeVisible();
  await expect(page.locator("#customPrompt")).toHaveAttribute(
    "placeholder",
    "Example: keep job search, AI papers, and current projects separate; put uncertain pages in review."
  );
  await expect.poll(() =>
    page.locator("#promptPreset option").evaluateAll((options) =>
      options.map((option) => ({ value: option.value, text: option.textContent?.trim() }))
    )
  ).toEqual([
    { value: "conservative", text: "Smart organize" },
    { value: "media_type", text: "Media type" },
    { value: "read_later", text: "Read later" },
    { value: "aggressive_cleanup", text: "Bold grouping" }
  ]);
  await expect.poll(() =>
    page.locator("#groupingGranularity option").evaluateAll((options) =>
      options.map((option) => ({ value: option.value, text: option.textContent?.trim() }))
    )
  ).toEqual([
    { value: "compact", text: "Fewer groups" },
    { value: "balanced", text: "Balanced" },
    { value: "detailed", text: "More groups" }
  ]);
  await expect(page.locator("#uiLanguageToggle")).toHaveText("");
  await expect(page.locator("#uiLanguageToggle")).toHaveAttribute("aria-label", "Switch UI to Chinese");
  await expect(page.locator("#closeWindowBtn")).toHaveCount(0);

  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#statusText")).toHaveText("AI 标签页整理与回顾");
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
  await expect(page.locator("#uiLanguageToggle")).toHaveText("");
});

test("default result language follows the English UI when generating", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("tabRecap.uiLanguage");
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_follow_ui_language",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "Plan ready to review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    const job = {
      settings: { ...settings, languageMode: "en-US" },
      validation: { ok: true, warnings: [] },
      preview: {
        languageMode: "en-US",
        requiresConfirmation: false,
        groups: [{ title: "AI Tools", reason: "Related tools.", tabCount: 2 }],
        eligibleTabsCount: 2,
        groupedTabsCount: 2,
        reviewTabsCount: 0,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__startedSettings = null;
    window.__persistedSettings = null;
    window.__analysisStarted = false;
    window.chrome = {
      runtime: {
        getManifest: () => ({ optional_permissions: ["scripting"], optional_host_permissions: ["https://*/*", "http://*/*"] }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__analysisStarted ? activeJob : null };
          if (message.type === "tabs:startAnalyze") {
            window.__startedSettings = message.settings;
            window.__persistedSettings = message.persistedSettings;
            window.__analysisStarted = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          return { ok: true, result: null };
        }
      },
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      tabs: {
        query: async () => [{ id: 1, windowId: 1, active: true }]
      },
      windows: {
        get: async () => ({ id: 1, type: "normal" }),
        getLastFocused: async () => ({ id: 1, type: "normal" })
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#languageMode")).toHaveValue("auto");
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect.poll(() => page.evaluate(() => window.__startedSettings?.languageMode)).toBe("en-US");
  await expect.poll(() => page.evaluate(() => window.__persistedSettings?.languageMode)).toBe("auto");
});

test("side panel restores a completed background preview after reopening", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "en-US",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const wasCleared = localStorage.getItem("tabRecapClearedPreview") === "1";
    let activeJob = wasCleared
      ? null
      : {
      operationId: "job_en_preview",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    let job = wasCleared
      ? null
      : {
      settings,
      validation: { ok: true, warnings: [] },
      preview: {
        languageMode: "en-US",
        requiresConfirmation: false,
        groups: [{ title: "AI Research", reason: "Models and papers.", tabCount: 2 }],
        eligibleTabsCount: 3,
        groupedTabsCount: 2,
        reviewTabsCount: 1,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__messages = [];
    window.__messageTypes = [];
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          window.__messages.push(message);
          window.__messageTypes.push(message.type);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            return { ok: true, result: { operationId: activeJob?.operationId || "new_job" } };
          }
          if (message.type === "tabs:clearAnalysisState") {
            localStorage.setItem("tabRecapClearedPreview", "1");
            activeJob = null;
            job = null;
            return { ok: true, result: { cleared: true } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await expect(page.locator("#languageMode")).toHaveValue("en-US");
  await expect(page.getByRole("button", { name: "开始整理" })).toBeEnabled();
  await expect(page.locator("#previewCount")).toHaveText("2 组");
  await expect(page.locator(".preview").getByText("AI Research", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("Needs Review", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".preview")
      .getByText("AI 已梳理 3 个标签页，识别出 1 个主题；2 个已自动归类，1 个留到「Needs Review」。")
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__messageTypes.includes("tabs:startAnalyze"))).toBe(false);

  await page.getByRole("button", { name: "返回上级" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__messages.find((message) => message.type === "tabs:clearAnalysisState")?.windowId))
    .toBe(77);
  await expect(page.locator("#previewSection")).toBeHidden();
  await page.reload();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
});

test("side panel restores a background planning error after reopening", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    let activeJob = {
      operationId: "job_gateway_model_error",
      status: "error",
      phase: "error",
      progress: 100,
      message: "This model is not available on the free gateway.",
      error: "This model is not available on the free gateway.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    window.__retryStarted = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:startAnalyze") {
            window.__retryStarted = true;
            activeJob = {
              operationId: "job_retry_running",
              status: "running",
              phase: "planning",
              progress: 18,
              message: "正在请求 AI 规划",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#statusText")).toHaveText("默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。");
  await expect(page.locator("#previewSection")).toBeVisible();
  await expect(page.locator(".preview .step-label")).toHaveText("出错");
  await expect(page.locator(".preview .section-heading h2")).toHaveText("生成失败");
  await expect(page.locator(".error-panel")).toContainText("默认 AI 服务暂时不支持这个模型。");
  await expect(page.locator(".error-panel")).not.toContainText("free gateway");
  await expect(page.locator("#detailsText")).toContainText("This model is not available on the free gateway.");
  await expect(page.locator(".launch-panel")).toBeHidden();
  await expect(page.getByText("整理预览")).toBeHidden();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeEnabled();
  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#statusText")).toHaveText("The default AI service does not support this model right now. Try again later, or switch models in More options.");
  await expect(page.locator(".error-panel")).toContainText("The default AI service does not support this model right now.");
  await expect(page.locator(".error-panel")).not.toContainText("free gateway");
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect.poll(() => page.evaluate(() => window.__retryStarted)).toBe(true);
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.locator(".error-panel")).toHaveCount(0);
});

test("side panel translates stored core model errors", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayAuxiliaryModel: "gpt-5.3-codex-spark",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_core_model_error",
      status: "error",
      phase: "error",
      progress: 100,
      message: "默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。",
      error: "默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#statusText")).toHaveText("默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。");
  await expect(page.locator(".error-panel")).toContainText("默认 AI 服务暂时不支持这个模型。");
  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#statusText")).toHaveText("The default AI service does not support this model right now. Try again later, or switch models in More options.");
  await expect(page.locator(".error-panel")).toContainText("The default AI service does not support this model right now.");
});

test("custom provider model errors use custom API copy", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      gatewayProviderMode: "custom",
      rememberProviderKeys: false,
      gatewayBaseUrl: "https://api.example.test/v1",
      gatewayModel: "custom",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayCustomModel: "unknown-model",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "test-key",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_custom_model_error",
      status: "error",
      phase: "error",
      progress: 100,
      message: "自定义 AI 网关这次没有完成请求（400）。model_not_allowed",
      error: "自定义 AI 网关这次没有完成请求（400）。model_not_allowed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#statusText")).toHaveText("自定义 API 不支持这个模型。请检查模型名，或先点「测试连接」。");
  await expect(page.locator(".error-panel")).toContainText("自定义 API 不支持这个模型。");
  await expect(page.locator(".error-panel")).not.toContainText("默认 AI 服务");
  await page.locator("#uiLanguageToggle").click();
  await expect(page.locator("#statusText")).toHaveText("The custom API does not support this model. Check the model name or run Test connection first.");
});

test("error diagnostic details redact secrets and tokenized urls", async ({ page }) => {
  await page.addInitScript(() => {
    const providerKey = ["sk", "private-secret-token-1234567890"].join("-");
    const tokenizedUrl = "https://private.example.com/secret/project?token=abc123";
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      gatewayProviderMode: "custom",
      rememberProviderKeys: true,
      gatewayBaseUrl: "https://api.example.test/v1",
      gatewayModel: "custom",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayCustomModel: "deepseek-v4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: providerKey,
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_sensitive_error",
      status: "error",
      phase: "error",
      progress: 100,
      message: `AI gateway failed for ${tokenizedUrl} with ${providerKey}`,
      error: `AI gateway failed for ${tokenizedUrl} with ${providerKey}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator(".error-panel")).toBeVisible();
  await expect(page.locator("#detailsText")).toContainText("[redacted-key]");
  await expect(page.locator("#detailsText")).toContainText("https://private.example.com/...");
  await expect(page.locator("#detailsText")).not.toContainText(["sk", "private-secret-token"].join("-"));
  await expect(page.locator("#detailsText")).not.toContainText(["token", "abc123"].join("="));
  await expect(page.locator("#detailsText")).not.toContainText(["", "secret", "project"].join("/"));
});

test("preview keeps review-like groups at the bottom", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "auto",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_review_like_order",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groupedTabsCount: 6,
        eligibleTabsCount: 6,
        groups: [
          { groupKey: "needs-review", title: "待分类", reason: "AI 暂时拿不准。", tabCount: 2 },
          { groupKey: "project-work", title: "当前项目", reason: "Issue、PR 和文档。", tabCount: 4 }
        ],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect.poll(() => page.locator(".preview .group-title").allTextContents()).toEqual(["当前项目", "待分类"]);
});

test("side panel shows optimistic progress while waiting for AI", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_waiting",
      status: "running",
      phase: "planning",
      progress: 45,
      message: "正在请求 AI 规划",
      createdAt: new Date(Date.now() - 12000).toISOString(),
      updatedAt: new Date(Date.now() - 12000).toISOString(),
      tabCount: 252,
      windowCount: 4
    };
    window.__progressCopyRequests = [];
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "progressCopy:generate") {
            window.__progressCopyRequests.push(message);
            return {
              ok: true,
              result: {
                messages: ["清点主题边界", "压缩相近任务", "分离模糊页面", "校对分组命名", "铺开待分类线索"]
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#statusText")).toHaveText(
    /(理解标题线索|寻找相邻任务|避开域名硬分组|检查不确定页|整理分组边界|清点主题边界|压缩相近任务|分离模糊页面|校对分组命名|铺开待分类线索) · \d+秒/
  );
  await expect(page.locator(".actions #progressBar")).toBeVisible();
  await expect(page.locator("#progressLabel")).toHaveText(
    /(理解标题线索|寻找相邻任务|避开域名硬分组|检查不确定页|整理分组边界|清点主题边界|压缩相近任务|分离模糊页面|校对分组命名|铺开待分类线索) · \d+秒/
  );
  await expect.poll(() => page.evaluate(() => window.__progressCopyRequests)).toEqual([
    {
      type: "progressCopy:generate",
      operationId: "job_waiting",
      phase: "planning",
      tabCount: 252,
      windowCount: 4,
      languageMode: "zh-CN"
    }
  ]);
  await expect(page.locator("#progressLabel")).toHaveText(
    /(清点主题边界|压缩相近任务|分离模糊页面|校对分组命名|铺开待分类线索) · \d+秒/
  );
  await expect(page.locator("#progressPercent")).toContainText("%");
  const displayedProgress = await page.locator("#progressFill").evaluate((element) => Number.parseFloat(element.style.width));
  expect(displayedProgress).toBeGreaterThan(45);
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
});

test("English UI localizes known background progress messages", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("tabRecap.uiLanguage");
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "tabs:getActiveJob") {
            return {
              ok: true,
              result: {
                operationId: "job_topic_lanes",
                status: "running",
                phase: "coarse_planning",
                progress: 55,
                message: "已找到 6 个主题方向",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                tabCount: 180,
                windowCount: 3
              }
            };
          }
          if (message.type === "progressCopy:generate") return { ok: false, error: "skip generated copy" };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#progressLabel")).toContainText("Found 6 topic lanes");
  await expect(page.locator("#progressLabel")).not.toContainText("候选");
  await expect(page.locator("#progressLabel")).not.toContainText("candidate");
});

test("default gateway permission request is narrow and compact", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__started = false;
    const activeJob = {
      operationId: "job_default_gateway",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "资料整理", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      windows: {
        getCurrent: async () => ({ id: 999, type: "popup" }),
        getLastFocused: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("资料整理", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toEqual([{ origins: ["https://cliproxy.sylvanyu.io/*"] }]);
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(77);
});

test("custom provider can use a manual model name", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayProviderMode: "custom",
      gatewayBaseUrl: "https://api.deepseek.com/v1",
      gatewayModel: "custom",
      gatewayCustomModel: "deepseek-v4",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayCustomAuxiliaryModel: "gpt-5.4-mini",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "test-key",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__startAnalyzeSettings = null;
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:startAnalyze") {
            window.__startAnalyzeSettings = message.settings;
            return { ok: true, result: { operationId: "custom_model_job" } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toEqual([{ origins: ["https://api.deepseek.com/*"] }]);
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeSettings?.gatewayCustomModel)).toBe("deepseek-v4");
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeSettings?.gatewayCustomAuxiliaryModel)).toBe("gpt-5.4-mini");
});

test("custom provider can use the default model when the model field is blank", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayProviderMode: "custom",
      gatewayBaseUrl: "https://proxy.example.test/v1",
      gatewayModel: "gpt-5.4",
      gatewayCustomModel: "",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayCustomAuxiliaryModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__startAnalyzeSettings = null;
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:startAnalyze") {
            window.__startAnalyzeSettings = message.settings;
            return { ok: true, result: { operationId: "custom_default_model_job" } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByText("更多选项").click();
  await expect(page.locator("#gatewayProviderMode")).toHaveValue("custom");
  await expect(page.locator("#gatewayBaseUrl")).toBeVisible();
  await expect(page.locator("#gatewayBaseUrl")).toHaveValue("https://proxy.example.test/v1");
  await expect(page.locator("#gatewayCustomModel")).toHaveValue("");
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toEqual([{ origins: ["https://proxy.example.test/*"] }]);
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeSettings?.gatewayModel)).toBe("gpt-5.4");
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeSettings?.gatewayCustomModel)).toBe("");
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeSettings?.gatewayAuxiliaryModel)).toBe("same_as_primary");
});

test("current-window generation without sourceWindowId uses the focused normal window", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_focused_window",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "当前窗口", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__analyzeWindowId = null;
    window.__started = false;
    window.chrome = {
      windows: {
        getLastFocused: async () => ({ id: 42, type: "normal" }),
        getCurrent: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("当前窗口", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(42);
});

test("current-window generation ignores a stale sourceWindowId", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_stale_source_window",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "回退窗口", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__analyzeWindowId = null;
    window.__started = false;
    window.chrome = {
      windows: {
        get: async (windowId) => {
          if (windowId === 77) throw new Error("No window with id: 77.");
          return { id: windowId, type: "normal" };
        },
        getLastFocused: async () => ({ id: 42, type: "normal" }),
        getCurrent: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("回退窗口", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(42);
});

test("review-only previews are shown as a pending classification group", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_review_only",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [],
        reviewTabsCount: 3,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__started = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#previewCount")).toHaveText("1 组");
  await expect(page.locator(".preview").getByText("AI 已梳理 3 个标签页，没有找到足够稳定的主题，3 个留到「待分类」。")).toBeVisible();
  await expect(page.locator(".preview").getByText("待分类", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("AI 暂时拿不准这些页面的共同主题，不会硬塞进其他分组。")).toBeVisible();
  await expect(page.getByText("不会创建新分组")).toHaveCount(0);
  await expect(page.getByText("待确认")).toHaveCount(0);
});

test("apply confirms changed tabs before adding them to review", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_changed_tabs_apply",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "AI 编程", reason: "Mock plan.", tabCount: 1 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__confirmMessages = [];
    window.__applyMessages = [];
    window.__started = false;
    window.confirm = (message) => {
      window.__confirmMessages.push(message);
      return true;
    };
    window.chrome = {
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          if (message.type === "tabs:applyLastPlan") {
            window.__applyMessages.push(message);
            if (!message.confirmChangedTabs) {
              return {
                ok: true,
                result: {
                  requiresChangedTabsConfirmation: true,
                  rebasedPlan: {
                    changedTabsCount: 2,
                    removedTabIds: [11],
                    skippedNewTabIds: [12],
                    addedReviewTabIds: [],
                    confirmationToken: "changed-token-1",
                    duplicateTabIds: []
                  }
                }
              };
            }
            return {
              ok: true,
              result: {
                createdGroupIds: [501, 502],
                rebasedPlan: {
                  changedTabsCount: 2,
                  removedTabIds: [11],
                  skippedNewTabIds: [],
                  addedReviewTabIds: [12],
                  duplicateTabIds: []
                }
              }
            };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 编程", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始整理" }).click();
  await expect(page.locator("#statusText")).toHaveText("已创建 2 个分组；已处理 2 个变化标签页，1 个放进「待分类」");
  await expect.poll(() => page.evaluate(() => window.__confirmMessages)).toEqual([
    "标签页在预览后发生了变化。\n1 个新增标签页会放进「待分类」。\n1 个已关闭的标签页会跳过。\n确认继续整理吗？"
  ]);
  await expect.poll(() => page.evaluate(() => window.__applyMessages)).toEqual([
    { type: "tabs:applyLastPlan", confirmMultiWindow: false },
    {
      type: "tabs:applyLastPlan",
      confirmChangedTabs: true,
      confirmationToken: "changed-token-1",
      confirmMultiWindow: false
    }
  ]);
});

test("page summary main toggle requests persistent summary access", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_page_origin_permissions",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "需要授权", reason: "Mock plan.", tabCount: 1 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    const grantedPermissions = new Set();
    const grantedOrigins = new Set(["https://cliproxy.sylvanyu.io/*"]);
    window.__permissionRequests = [];
    window.__savedSettings = [];
    window.__started = false;
    window.chrome = {
      permissions: {
        contains: async (request) =>
          (request.permissions || []).every((permission) => grantedPermissions.has(permission)) &&
          (request.origins || []).every(
            (origin) =>
              grantedOrigins.has(origin) ||
              (origin.startsWith("https://") && grantedOrigins.has("https://*/*")) ||
              (origin.startsWith("http://") && grantedOrigins.has("http://*/*"))
          ),
        request: async (request) => {
          window.__permissionRequests.push(request);
          (request.permissions || []).forEach((permission) => grantedPermissions.add(permission));
          (request.origins || []).forEach((origin) => grantedOrigins.add(origin));
          return true;
        }
      },
      windows: {
        get: async () => ({
          id: 77,
          type: "normal",
          tabs: [
            { id: 10, title: "Login", url: "https://example.com/signin", active: true },
            { id: 11, title: "Specific documentation article with clear title", url: "https://docs.example.org/page" }
          ]
        }),
        getCurrent: async () => ({ id: 77, type: "normal" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            window.__savedSettings.push(settings);
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.locator("#ackSampling").click();
  await expect(page.locator("#ackSampling")).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageContextMode)).toBe("ambiguous_with_permission");
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.hostPermissionRequestMode)).toBe(
    "ask_for_all_visible_origins"
  );
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.continuousPageSummaries)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageSamplingConsentMode)).toBe(
    "acknowledged_persistently"
  );
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toContainEqual({
    permissions: ["scripting"],
    origins: ["https://*/*", "http://*/*"]
  });
  const requestsAfterToggle = await page.evaluate(() => window.__permissionRequests.length);

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("需要授权", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.length)).toBe(requestsAfterToggle);
});

test("page summary range can be changed while the main toggle is off", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "ambiguous_with_permission",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__savedSettings = [];
    window.chrome = {
      runtime: {
        getManifest: () => ({
          optional_permissions: ["scripting"],
          optional_host_permissions: ["https://*/*", "http://*/*"]
        }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            window.__savedSettings.push(settings);
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByText("更多选项").click();
  await expect(page.locator("#ackSampling")).not.toBeChecked();
  await expect(page.getByLabel("页面摘要读取范围")).toHaveValue("ambiguous_with_permission");

  await page.getByLabel("页面摘要读取范围").selectOption("all_granted_origins");

  await expect(page.locator("#ackSampling")).not.toBeChecked();
  await expect(page.getByLabel("页面摘要读取范围")).toHaveValue("all_granted_origins");
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageContextMode)).toBe("all_granted_origins");
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageSamplingConsentMode)).toBe(
    "not_acknowledged"
  );
});

test("continuous summaries request broad optional access once", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__savedSettings = [];
    window.__events = [];
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__events.push({
            type: "permission_request",
            savedContinuous: window.__savedSettings.at(-1)?.continuousPageSummaries,
            savedConsent: window.__savedSettings.at(-1)?.pageSamplingConsentMode
          });
          window.__permissionRequests.push(request);
          return true;
        }
      },
      windows: {
        get: async () => ({
          id: 1,
          type: "normal",
          tabs: [
            { id: 10, windowId: 1, title: "Docs", url: "https://docs.example/page", active: true },
            { id: 11, windowId: 1, title: "Shop", url: "https://shop.example/cart" }
          ]
        }),
        getCurrent: async () => ({ id: 1, type: "normal" })
      },
      runtime: {
        getManifest: () => ({
          optional_permissions: ["scripting"],
          optional_host_permissions: ["https://*/*", "http://*/*"]
        }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            window.__savedSettings.push(settings);
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.locator("#ackSampling").check();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.at(-1))).toEqual({
    permissions: ["scripting"],
    origins: ["https://*/*", "http://*/*"]
  });
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.continuousPageSummaries)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageSamplingConsentMode)).toBe(
    "acknowledged_persistently"
  );
  await expect(page.locator("#continuousPageSummaries")).toBeChecked();
  await expect(page.locator("#pageSummaryMemoryMode")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__events.at(0))).toEqual({
    type: "permission_request",
    savedContinuous: undefined,
    savedConsent: undefined
  });
});

test("store manifest hides content-reading controls", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.chrome = {
      runtime: {
        getManifest: () => ({ optional_permissions: [], optional_host_permissions: [] }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#ackSampling")).toBeHidden();
  await expect(page.locator("#continuousPageSummaries")).toBeHidden();
  await page.getByText("更多选项").click();
  await expect(page.locator("#pageContextMode")).toBeHidden();
  await expect(page.locator("#pageSummaryMemoryMode")).toHaveCount(0);
});

test("page summary permission denial rolls back the toggle before generation", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__startAnalyzeCalled = false;
    window.chrome = {
      permissions: {
        contains: async (request) => Boolean(request.origins?.includes("https://cliproxy.sylvanyu.io/*")),
        request: async (request) => {
          window.__permissionRequests.push(request);
          return false;
        }
      },
      windows: {
        get: async () => ({
          id: 77,
          type: "normal",
          tabs: [{ id: 10, title: "Login", url: "https://example.com/signin", active: true }]
        })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:startAnalyze") {
            window.__startAnalyzeCalled = true;
            return { ok: true, result: { operationId: "should_not_start" } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.locator("#ackSampling").click();
  await expect(page.locator("#ackSampling")).not.toBeChecked();
  await expect(page.locator("#statusText")).toHaveText("需要授权网页读取权限后，才能保存页面摘要。");
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeCalled)).toBe(false);
});

test("generation progress follows the background job after start", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const runningJob = {
      operationId: "job_background_progress",
      status: "running",
      phase: "planning",
      progress: 40,
      message: "正在生成 AI 方案",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const completeJob = {
      ...runningJob,
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查"
    };
    const finalJob = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "后台进度", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__messageTypes = [];
    window.__activeJobPolls = 0;
    window.__started = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          window.__messageTypes.push(message.type);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: runningJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") {
            if (!window.__started) return { ok: true, result: null };
            window.__activeJobPolls += 1;
            return { ok: true, result: window.__activeJobPolls < 2 ? runningJob : completeJob };
          }
          if (message.type === "tabs:getLastJob") return { ok: true, result: finalJob };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#progressLabel")).toContainText("正在生成 AI 方案");
  await expect(page.locator("#progressPercent")).not.toHaveText("16%");
  await expect(page.locator(".preview").getByText("后台进度", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__messageTypes.includes("tabs:analyze"))).toBe(false);
});

test("canceling generation returns to setup without error preview", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const runningJob = {
      operationId: "job_cancel_progress",
      status: "running",
      phase: "sampling",
      progress: 24,
      message: "正在补充页面线索",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const canceledJob = {
      ...runningJob,
      status: "canceled",
      phase: "canceled",
      message: "已停止生成。",
      finishedAt: new Date().toISOString()
    };
    window.__started = false;
    window.__canceled = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: runningJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") {
            if (!window.__started) return { ok: true, result: null };
            return { ok: true, result: window.__canceled ? canceledJob : runningJob };
          }
          if (message.type === "tabs:cancelActiveJob") {
            window.__canceled = true;
            return { ok: true, result: { canceled: true, job: canceledJob } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#progressLabel")).toContainText("正在补充页面线索");
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.locator("#statusText")).toHaveText("已停止生成。");
  await expect(page.locator("#cancelBtn")).toBeHidden();
  await expect(page.locator("#previewSection")).toBeHidden();
});

test("canceling generation stays canceled when the background job is already gone", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const runningJob = {
      operationId: "job_cancel_missing",
      status: "running",
      phase: "planning",
      progress: 56,
      message: "正在生成 AI 方案",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    window.__started = false;
    window.__canceled = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: runningJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") {
            if (!window.__started || window.__canceled) return { ok: true, result: null };
            return { ok: true, result: runningJob };
          }
          if (message.type === "tabs:cancelActiveJob") {
            window.__canceled = true;
            return { ok: true, result: { canceled: false, job: null } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#progressLabel")).toContainText("正在生成 AI 方案");
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.locator("#statusText")).toHaveText("已停止生成。");
  await expect(page.locator("#cancelBtn")).toBeHidden();
  await page.waitForTimeout(800);
  await expect(page.locator("#statusText")).toHaveText("已停止生成。");
  await expect(page.locator("#previewSection")).toBeHidden();
});

test("generation does not request page sampling permissions from a stale enabled state", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "all_granted_origins",
      hostPermissionRequestMode: "ask_for_all_visible_origins",
      pageSamplingConsentMode: "acknowledged_for_session",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.4",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__started = false;
    const activeJob = {
      operationId: "job_page_sampling",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "页面摘要辅助", reason: "Mock plan.", tabCount: 1 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      permissions: {
        contains: async (request) =>
          (request.permissions || []).length === 0 && Boolean(request.origins?.includes("https://cliproxy.sylvanyu.io/*")),
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__started ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#statusText")).toHaveText("需要先打开「页面摘要增强」并完成授权，才能读取页面摘要。");
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toEqual([]);
});

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
