import assert from "node:assert/strict";
import test from "node:test";

import {
  filterRecapFollowUps,
  isCleanupLikeRecapFollowUp,
  stripCleanupRecommendationsFromRecapText
} from "../src/shared/time-recap-safety.js";

test("recap safety identifies cleanup-like follow-ups in Chinese and English", () => {
  assert.equal(isCleanupLikeRecapFollowUp({ title: "关闭旧标签页", reason: "这些页面已经过期" }), true);
  assert.equal(isCleanupLikeRecapFollowUp({ title: "Review whether to keep old tabs", reason: "stale notes" }), true);
  assert.equal(isCleanupLikeRecapFollowUp({ title: "继续整理发布检查", reason: "把剩余步骤顺着做完" }), false);
});

test("recap safety filters cleanup recommendations while preserving continuation items", () => {
  const followUps = filterRecapFollowUps([
    { title: "值得复查旧页面", reason: "可能不再需要" },
    { title: "继续整理发布检查", reason: "把 release checklist 做完" },
    { title: "Clean up stale tabs", reason: "no longer needed" }
  ]);

  assert.deepEqual(followUps, [
    { title: "继续整理发布检查", reason: "把 release checklist 做完" }
  ]);
});

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
