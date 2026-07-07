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
