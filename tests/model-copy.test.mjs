import assert from "node:assert/strict";
import test from "node:test";

import { normalizeModelProductText } from "../src/shared/model-copy.js";

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
