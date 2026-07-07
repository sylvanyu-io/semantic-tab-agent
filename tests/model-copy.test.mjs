import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING, normalizeModelProductText } from "../src/shared/model-copy.js";

test("model product copy removes internal identity fields and localizes common signals", () => {
  const zh = normalizeModelProductText(
    "activeCount=0，pageId 42，sampleable false，ageDays 18，currentGroupTitle 是旧分组。",
    { languageMode: "zh-CN" },
    200
  );

  assert.doesNotMatch(zh, /\b(?:activeCount|pageId|sampleable|ageDays|currentGroupTitle)\b/i);
  assert.match(zh, /基本没再打开/);
  assert.match(zh, /页面摘要不可用/);
  assert.match(zh, /已放约 18 天/);
  assert.match(zh, /现有分组/);
});

test("model product copy keeps English product wording for custom gateway output", () => {
  const en = normalizeModelProductText(
    "tabId 7 has activeCount=3, idleDays 4, sampleable true, and hostname example.com.",
    { languageMode: "en-US" },
    200
  );

  assert.doesNotMatch(en, /\b(?:tabId|activeCount|idleDays|sampleable|hostname)\b/i);
  assert.match(en, /opened 3 times/);
  assert.match(en, /idle about 4 days/);
  assert.match(en, /page summary available/);
  assert.match(en, /site/);
});

test("model product copy removes snake-case and kebab-case implementation fields", () => {
  const zh = normalizeModelProductText(
    "active_count=0，page_id 42，sample-able false，age-days 18，current_group_title 是旧分组，host_name example.com。",
    { languageMode: "zh-CN" },
    240
  );

  assert.doesNotMatch(zh, /\b(?:active_count|page_id|sample-able|age-days|current_group_title|host_name)\b/i);
  assert.match(zh, /基本没再打开/);
  assert.match(zh, /页面摘要不可用/);
  assert.match(zh, /已放约 18 天/);
  assert.match(zh, /现有分组/);
  assert.match(zh, /网站/);
});

test("model product copy removes spaced implementation fields in English", () => {
  const en = normalizeModelProductText(
    "tab id 7 has active-count=3, idle days 4, sample_able yes, and host name example.com.",
    { languageMode: "en-US" },
    240
  );

  assert.doesNotMatch(en, /\b(?:tab id|active-count|idle days|sample_able|host name)\b/i);
  assert.match(en, /opened 3 times/);
  assert.match(en, /idle about 4 days/);
  assert.match(en, /page summary available/);
  assert.match(en, /site/);
});

test("model product copy removes plural identity fields with list values", () => {
  const zh = normalizeModelProductText(
    "tabIds [1, 2]、page_ids: 3,4、window ids = [7]、sequenceIndex 9，active_count=0。",
    { languageMode: "zh-CN" },
    240
  );

  assert.doesNotMatch(zh, /\b(?:tabIds|page_ids|window ids|sequenceIndex)\b/i);
  assert.doesNotMatch(zh, /\[[^\]]+\]|(?:^|[^\d])(?:1|2|3|4|7|9)(?:[^\d]|$)/);
  assert.match(zh, /基本没再打开/);
});

test("model product copy replaces cache and lifecycle implementation wording", () => {
  const zh = normalizeModelProductText(
    "cache 显示这个页面已有记录，lifecycle 显示最近有活动。",
    { languageMode: "zh-CN" },
    200
  );
  const en = normalizeModelProductText(
    "cacheKey shows an existing page record and lifecycle status shows recent activity.",
    { languageMode: "en-US" },
    200
  );

  assert.doesNotMatch(zh, /\b(?:cache|lifecycle)\b/i);
  assert.match(zh, /本地记录/);
  assert.match(zh, /活动记录/);
  assert.doesNotMatch(en, /\b(?:cache|cacheKey|lifecycle|lifecycle status)\b/i);
  assert.match(en, /local record/);
  assert.match(en, /activity record/);
});

test("model product copy replaces activation flow implementation wording", () => {
  const zh = normalizeModelProductText(
    "activationFlow 里 nearbyIds 很近，returnToId 说明回到旧页，returnedToCount=2，dwellSeconds 较长，transition_count 高。",
    { languageMode: "zh-CN" },
    320
  );
  const en = normalizeModelProductText(
    "activation_flow shows nearby ids, repeatedIds, total active seconds, appeared in runs, fromId, to_id, startedAt, ended_at, and lastAt.",
    { languageMode: "en-US" },
    320
  );

  assert.doesNotMatch(zh, /\b(?:activationFlow|nearbyIds|returnToId|returnedToCount|dwellSeconds|transition_count)\b/i);
  assert.match(zh, /浏览轨迹/);
  assert.match(zh, /相邻标签页/);
  assert.match(zh, /回到前面的标签页/);
  assert.match(zh, /切回过 2 次/);
  assert.match(zh, /停留时长/);
  assert.match(zh, /标签页切换次数/);
  assert.doesNotMatch(en, /\b(?:activation_flow|nearby ids|repeatedIds|total active seconds|appeared in runs|fromId|to_id|startedAt|ended_at|lastAt)\b/i);
  assert.match(en, /browsing flow/);
  assert.match(en, /nearby tabs/);
  assert.match(en, /repeatedly revisited tabs/);
  assert.match(en, /active time/);
  assert.match(en, /same browsing run/);
  assert.match(en, /source tab/);
  assert.match(en, /next tab/);
  assert.match(en, /started/);
  assert.match(en, /ended/);
  assert.match(en, /last observed/);
});

test("model product copy warning covers behavior payload field variants", () => {
  for (const field of [
    "totalActiveSeconds",
    "maxActiveSeconds",
    "appearedInRuns",
    "returnedToCount",
    "avgDwellSeconds",
    "fromId",
    "toId",
    "startedAt",
    "endedAt",
    "lastAt",
    "ids",
    "strength",
    "count",
    "clues"
  ]) {
    assert.match(MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING, new RegExp(`\\b${field}\\b`));
  }
});

test("model product copy removes behavior field id values", () => {
  const en = normalizeModelProductText(
    "nearbyIds [10, 11] and repeatedIds [10] show returnToId 10. fromId 10 toId 11, lastAt 2026-06-25T00:03:00.000Z.",
    { languageMode: "en-US" },
    320
  );
  const zh = normalizeModelProductText(
    "nearby_ids: 10,11；repeated_ids: [10]；return_to_id: 10；from_id 10；to_id 11。",
    { languageMode: "zh-CN" },
    320
  );

  assert.doesNotMatch(en, /\b(?:10|11|2026-06-25T00:03:00\.000Z)\b/);
  assert.doesNotMatch(en, /\[[^\]]+\]/);
  assert.match(en, /nearby tabs/);
  assert.match(en, /repeatedly revisited tabs/);
  assert.match(en, /returned to an earlier tab/);
  assert.match(en, /source tab/);
  assert.match(en, /next tab/);
  assert.match(en, /last observed/);
  assert.doesNotMatch(zh, /\b(?:10|11)\b/);
  assert.doesNotMatch(zh, /\[[^\]]+\]/);
  assert.match(zh, /相邻标签页/);
  assert.match(zh, /反复切回的标签页/);
  assert.match(zh, /回到前面的标签页/);
  assert.match(zh, /来源标签页/);
  assert.match(zh, /下一个标签页/);
});

test("model product copy removes behavior evidence field values", () => {
  const en = normalizeModelProductText(
    "ids [10, 11], strength 0.69, count 2, clues quick handoff.",
    { languageMode: "en-US" },
    320
  );
  const zh = normalizeModelProductText(
    "证据 ids [10, 11]，strength 0.69，count 2，clues 是 quick handoff。",
    { languageMode: "zh-CN" },
    320
  );

  assert.doesNotMatch(en, /\b(?:ids|strength|count|clues|10|11|0\.69|2|quick handoff)\b/i);
  assert.doesNotMatch(en, /\[[^\]]+\]/);
  assert.match(en, /related tabs/);
  assert.match(en, /confidence signal/);
  assert.match(en, /repeated signal/);
  assert.match(en, /evidence note/);
  assert.doesNotMatch(zh, /\b(?:ids|strength|count|clues|10|11|0\.69|2|quick handoff)\b/i);
  assert.doesNotMatch(zh, /\[[^\]]+\]/);
  assert.match(zh, /相关标签页/);
  assert.match(zh, /信号强度/);
  assert.match(zh, /重复线索/);
  assert.match(zh, /依据线索/);
});
