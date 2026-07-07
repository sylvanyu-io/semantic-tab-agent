import assert from "node:assert/strict";
import test from "node:test";

import { filterRecapFollowUps, isCleanupLikeRecapFollowUp } from "../src/shared/time-recap-safety.js";

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
