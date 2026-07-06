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
  assert.match(html, /data-recap-preset="today">本日<\/button>/);
  assert.doesNotMatch(html, /根据本机活动、标题、网址和可用页面摘要生成/);
  assert.doesNotMatch(html, /data-recap-preset="today">今天<\/button>/);
});
