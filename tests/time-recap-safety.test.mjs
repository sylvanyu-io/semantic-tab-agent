import assert from "node:assert/strict";
import test from "node:test";

import { isGenericRecapThemeTitle, stripCleanupRecommendationsFromRecapText } from "../src/shared/time-recap-safety.js";

test("recap safety strips cleanup recommendations without removing evidence wording", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    "主要围绕发布检查推进。这个旧标签页可以关闭。已结合打开/关闭状态和活动记录。Review whether to keep stale tabs. Continue the release checklist."
  );

  assert.equal(cleaned.includes("主要围绕发布检查推进"), true);
  assert.equal(cleaned.includes("打开/关闭状态"), true);
  assert.equal(cleaned.includes("Continue the release checklist"), true);
  assert.equal(cleaned.includes("可以关闭"), false);
  assert.equal(cleaned.includes("Review whether"), false);
});

test("recap safety detects generic browser group names as invalid theme titles", () => {
  assert.equal(isGenericRecapThemeTitle("待分类"), true);
  assert.equal(isGenericRecapThemeTitle("「General Workbench」"), true);
  assert.equal(isGenericRecapThemeTitle("page"), true);
  assert.equal(isGenericRecapThemeTitle("网页"), true);
  assert.equal(isGenericRecapThemeTitle("AI 编程代理工具调研"), false);
});

test("recap safety strips cleanup clauses without dropping useful recap clauses", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    "权限、发布和回顾体验是主线，YachtWorld 页面是否保留可以回头判断。Release QA stayed central, but these tabs can be closed later. 已结合打开次数和停留时长。"
  );

  assert.equal(cleaned.includes("权限、发布和回顾体验是主线"), true);
  assert.equal(cleaned.includes("Release QA stayed central"), true);
  assert.equal(cleaned.includes("打开次数和停留时长"), true);
  assert.equal(cleaned.includes("YachtWorld"), false);
  assert.equal(cleaned.includes("是否保留"), false);
  assert.equal(cleaned.includes("can be closed"), false);
});

test("recap safety keeps stale and duplicate when they describe actual work", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    "上午排查重复请求导致的账单 bug。下午修了重复标签页创建问题。Afternoon work focused on stale cache behavior and duplicate webhook events. 这些都是主要工作线索。"
  );

  assert.equal(cleaned.includes("重复请求"), true);
  assert.equal(cleaned.includes("重复标签页创建问题"), true);
  assert.equal(cleaned.includes("stale cache behavior"), true);
  assert.equal(cleaned.includes("duplicate webhook events"), true);
  assert.equal(cleaned.includes("主要工作线索"), true);
});

test("recap safety still strips stale or duplicate tab cleanup copy", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    "主要在排查发布流程。Stale tabs can be reviewed later. Duplicate pages no longer needed. 这些重复标签页适合清理。"
  );

  assert.equal(cleaned.includes("主要在排查发布流程"), true);
  assert.equal(cleaned.includes("Stale tabs"), false);
  assert.equal(cleaned.includes("Duplicate pages"), false);
  assert.equal(cleaned.includes("重复标签页"), false);
});

test("recap safety strips conversational tab cleanup copy", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    [
      "主要在研究回顾布局。",
      "这些页面后面可以删掉。",
      "这几个标签页不用留着。",
      "回头看下要不要留着这些旧页。",
      "These pages are safe to drop later.",
      "You can get rid of these tabs.",
      "No need to keep these old pages.",
      "Work focused on timeline layout."
    ].join(" ")
  );

  assert.equal(cleaned.includes("主要在研究回顾布局"), true);
  assert.equal(cleaned.includes("Work focused on timeline layout"), true);
  assert.equal(cleaned.includes("可以删掉"), false);
  assert.equal(cleaned.includes("不用留着"), false);
  assert.equal(cleaned.includes("要不要留着"), false);
  assert.equal(cleaned.includes("safe to drop"), false);
  assert.equal(cleaned.includes("get rid of"), false);
  assert.equal(cleaned.includes("No need to keep"), false);
});

test("recap safety strips keep-open and later-review wording", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    [
      "主要在研究回顾布局。",
      "这个页面未必需要一直挂着。",
      "这几个页面没必要继续开着。",
      "这个旧页不用开着。",
      "这些旧页回头判断是不是还要保留。",
      "后面可以收掉这几个标签页。",
      "That page is not worth keeping open.",
      "Check later whether to keep these tabs.",
      "Work focused on timeline layout."
    ].join(" ")
  );

  assert.equal(cleaned.includes("主要在研究回顾布局"), true);
  assert.equal(cleaned.includes("Work focused on timeline layout"), true);
  assert.equal(cleaned.includes("未必需要一直挂着"), false);
  assert.equal(cleaned.includes("没必要继续开着"), false);
  assert.equal(cleaned.includes("不用开着"), false);
  assert.equal(cleaned.includes("是不是还要保留"), false);
  assert.equal(cleaned.includes("收掉这几个标签页"), false);
  assert.equal(cleaned.includes("worth keeping open"), false);
  assert.equal(cleaned.includes("whether to keep"), false);
});

test("recap safety strips short cleanup-only labels", () => {
  assert.equal(stripCleanupRecommendationsFromRecapText("回头处理"), "");
  assert.equal(stripCleanupRecommendationsFromRecapText("稍后复查"), "");
  assert.equal(stripCleanupRecommendationsFromRecapText("后面检查"), "");

  const useful = stripCleanupRecommendationsFromRecapText("后面处理告警系统故障，继续验证恢复邮件。");
  assert.equal(useful.includes("后面处理告警系统故障"), true);
  assert.equal(useful.includes("恢复邮件"), true);
});

test("recap safety strips direct English tab review and keep recommendations", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    [
      "Morning work focused on prompt tuning and gateway diagnostics.",
      "Review these tabs later.",
      "Keep these pages open for tomorrow.",
      "Revisit old pages tomorrow.",
      "Afternoon work covered page performance review and release notes."
    ].join(" ")
  );

  assert.equal(cleaned.includes("prompt tuning"), true);
  assert.equal(cleaned.includes("page performance review"), true);
  assert.equal(cleaned.includes("Review these tabs later"), false);
  assert.equal(cleaned.includes("Keep these pages open"), false);
  assert.equal(cleaned.includes("Revisit old pages tomorrow"), false);
});

test("recap safety keeps cleanup words when they are work topics", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    [
      "上午删掉缓存策略 bug 的错误分支。",
      "下午讨论保留字段设计和归档策略。",
      "晚上让本地服务继续挂着跑稳定性监控。",
      "Evening work covered drop-down interaction polish.",
      "We fixed discard-state recovery in the local queue.",
      "The worker stayed open while alerts were tested."
    ].join(" ")
  );

  assert.equal(cleaned.includes("删掉缓存策略 bug"), true);
  assert.equal(cleaned.includes("保留字段设计"), true);
  assert.equal(cleaned.includes("本地服务继续挂着"), true);
  assert.equal(cleaned.includes("drop-down interaction"), true);
  assert.equal(cleaned.includes("discard-state recovery"), true);
  assert.equal(cleaned.includes("worker stayed open"), true);
});
