import assert from "node:assert/strict";
import test from "node:test";

import { stripCleanupRecommendationsFromRecapText } from "../src/shared/time-recap-safety.js";

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

test("recap safety keeps stale and duplicate when they describe actual work", () => {
  const cleaned = stripCleanupRecommendationsFromRecapText(
    "上午排查重复请求导致的账单 bug。Afternoon work focused on stale cache behavior and duplicate webhook events. 这些都是主要工作线索。"
  );

  assert.equal(cleaned.includes("重复请求"), true);
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
