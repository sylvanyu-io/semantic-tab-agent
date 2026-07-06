import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("static side panel recap copy matches the product-facing runtime defaults", async () => {
  const html = await readFile(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");

  assert.match(
    html,
    /结合最近活跃、打开次数、保留时长、标题、网址、现有分组和可用页面摘要生成，不会自动关闭标签页。/
  );
  assert.match(html, /读取少量网页文字，并在本机保存短摘要/);
  assert.match(html, /只在需要时读取，始终由你决定/);
  assert.match(html, /AI 只生成整理、清理和回顾建议，不会自动关闭标签页/);
  assert.match(html, /清空活动记录、页面摘要和时间线记录，不会关闭标签页/);
  assert.match(html, /id="clearLocalMemoryBtn"/);
  assert.match(html, /设置迁移/);
  assert.match(html, /导出偏好和模型配置，不包含自定义密钥/);
  assert.match(html, /id="settingsExportBtn"/);
  assert.match(html, /id="settingsImportBtn"/);
  assert.match(html, /data-recap-preset="today">本日<\/button>/);
  assert.doesNotMatch(html, /根据本机活动、标题、网址和可用页面摘要生成/);
  assert.doesNotMatch(html, /data-recap-preset="today">今天<\/button>/);
});

test("side panel Chinese and English copy tables expose the same keys", async () => {
  const source = await readFile(new URL("../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const zhKeys = copyKeysForLocale(source, "zh-CN");
  const enKeys = copyKeysForLocale(source, "en-US");

  assert.deepEqual([...zhKeys].filter((key) => !enKeys.has(key)), []);
  assert.deepEqual([...enKeys].filter((key) => !zhKeys.has(key)), []);
});

test("side panel static copy references resolve to localized strings", async () => {
  const source = await readFile(new URL("../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const keys = copyKeysForLocale(source, "zh-CN");
  const referencedKeys = staticCopyReferenceKeys(source);

  assert.deepEqual([...referencedKeys].filter((key) => !keys.has(key)), []);
});

function staticCopyReferenceKeys(source) {
  const keys = new Set();
  const patterns = [
    /\bt\("([^"]+)"/g,
    /setStatusKey\("([^"]+)"/g,
    /setText\([^,]+,\s*t\("([^"]+)"/g,
    /setButtonLabel\([^,]+,\s*t\("([^"]+)"/g,
    /setOptionText\([^,]+,[^,]+,\s*t\("([^"]+)"/g,
    /setAttribute\([^,]+,[^,]+,\s*t\("([^"]+)"/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

function copyKeysForLocale(source, locale) {
  const block = extractObjectBlock(source, `"${locale}": {`);
  return new Set(
    [...block.matchAll(/^\s*"([^"]+)":/gm)]
      .map((match) => match[1])
      .sort()
  );
}

function extractObjectBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing ${marker}`);

  const openIndex = source.indexOf("{", markerIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      escaped = char === "\\" ? !escaped : false;
      if (char === "\"" && !escaped) inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex, index + 1);
  }
  throw new Error(`Unclosed ${marker}`);
}
