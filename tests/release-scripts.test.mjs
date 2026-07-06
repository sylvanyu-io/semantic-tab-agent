import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public release scripts include real extension stress and live gateway gates", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = manifest.scripts || {};

  assert.match(scripts["release:check:full"], /npm run release:check/);
  assert.match(scripts["release:check:full"], /npm run stress:extension/);

  assert.match(scripts["release:check:live"], /node scripts\/require-monitor-token\.mjs/);
  assert.match(scripts["release:check:live"], /npm run release:check:full/);
  assert.match(scripts["release:check:live"], /GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway/);

  assert.equal(scripts["stress:summary"], "node scripts/summarize-stress-artifact.mjs");
});

test("dist cleanup removes stale release and stress artifacts", async () => {
  const cleanScript = await readFile("scripts/clean-dist.mjs", "utf8");

  assert.match(cleanScript, /join\(distDir, "extension"\)/);
  assert.match(cleanScript, /join\(distDir, "extension-store"\)/);
  assert.match(cleanScript, /join\(distDir, "stress"\)/);
  assert.match(cleanScript, /entry\.endsWith\("\.zip"\)/);
});

test("real extension stress writes machine and human readable artifacts", async () => {
  const stressScript = await readFile("scripts/stress-extension.mjs", "utf8");

  assert.match(stressScript, /formatStressSummaryMarkdown/);
  assert.match(stressScript, /summarizeStressArtifact/);
  assert.match(stressScript, /`\$\{runId\}\.json`/);
  assert.match(stressScript, /`\$\{runId\}\.md`/);
});
