import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("README image assets are referenced by the README or its generator", async () => {
  const readme = await readFile("README.md", "utf8");
  const generator = await readFile("scripts/generate-readme-assets.mjs", "utf8");
  const referencedNames = `${readme}\n${generator}`;
  const assets = await readdir("docs/assets");

  for (const asset of assets) {
    if (!/\.(?:png|svg)$/i.test(asset)) continue;
    assert.match(referencedNames, new RegExp(escapeRegExp(asset)), `${asset} is not referenced`);
  }
});

test("dist cleanup removes stale release and stress artifacts", async () => {
  const cleanScript = await readFile("scripts/clean-dist.mjs", "utf8");

  assert.match(cleanScript, /EXTENSION_DIST_DIR/);
  assert.match(cleanScript, /join\(distDir, "extension"\)/);
  assert.match(cleanScript, /join\(distDir, "extension-store"\)/);
  assert.match(cleanScript, /join\(distDir, "stress"\)/);
  assert.match(cleanScript, /entry\.endsWith\("\.zip"\)/);
});

test("release artifact audit rejects obsolete product names and legacy extension keys", async () => {
  const auditScript = await readFile("scripts/audit-release-artifacts.mjs", "utf8");

  assert.match(auditScript, /Semantic Tab Agent/);
  assert.match(auditScript, /Tab Tidy/);
  assert.match(auditScript, /TabTidy/);
  assert.match(auditScript, /tab_tidy_/);
  assert.match(auditScript, /tab-tidy/);
});

test("release artifact audit fails built artifacts that contain legacy product name variants", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-audit-dist-"));
  try {
    for (const channel of ["dev", "store"]) {
      const build = spawnSync(process.execPath, ["scripts/build-extension.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          EXTENSION_DIST_DIR: tempDist,
          ...(channel === "store" ? { EXTENSION_CHANNEL: "store" } : {})
        }
      });
      assert.equal(build.status, 0, build.stderr || build.stdout);
    }

    const pollutedScript = join(tempDist, "extension", "src/sidepanel/sidepanel.js");
    await writeFile(pollutedScript, `${await readFile(pollutedScript, "utf8")}\n// TabTidy must not ship.\n`);

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /obsolete\/internal product copy "TabTidy"/);
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});

test("release artifact audit locks store host permissions to the default gateway", async () => {
  const auditScript = await readFile("scripts/audit-release-artifacts.mjs", "utf8");

  assert.match(auditScript, /storeHostPermissions/);
  assert.match(auditScript, /https:\/\/cliproxy\.sylvanyu\.io\/\*/);
  assert.match(auditScript, /store build must only request the default AI gateway host permission/);
});

test("release scripts honor custom extension dist directories", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-release-dist-"));
  try {
    await mkdir(join(tempDist, "extension"), { recursive: true });
    await mkdir(join(tempDist, "extension-store"), { recursive: true });
    await mkdir(join(tempDist, "stress"), { recursive: true });
    await writeFile(join(tempDist, "stale.zip"), "stale");

    const clean = spawnSync(process.execPath, ["scripts/clean-dist.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);
    assert.equal(existsSync(join(tempDist, "extension")), false);
    assert.equal(existsSync(join(tempDist, "extension-store")), false);
    assert.equal(existsSync(join(tempDist, "stress")), false);
    assert.equal(existsSync(join(tempDist, "stale.zip")), false);

    for (const channel of ["dev", "store"]) {
      const build = spawnSync(process.execPath, ["scripts/build-extension.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          EXTENSION_DIST_DIR: tempDist,
          ...(channel === "store" ? { EXTENSION_CHANNEL: "store" } : {})
        }
      });
      assert.equal(build.status, 0, build.stderr || build.stdout);
    }

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.equal(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(audit.stdout, /Release artifact audit passed/);
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});

test("real extension stress writes machine and human readable artifacts", async () => {
  const stressScript = await readFile("scripts/stress-extension.mjs", "utf8");

  assert.match(stressScript, /formatStressSummaryMarkdown/);
  assert.match(stressScript, /summarizeStressArtifact/);
  assert.match(stressScript, /`\$\{runId\}\.json`/);
  assert.match(stressScript, /`\$\{runId\}\.md`/);
});

test("real extension stress forces the UI sampling branch onto the fake planner", async () => {
  const stressScript = await readFile("scripts/stress-extension.mjs", "utf8");

  assert.match(stressScript, /ensureOption\("#plannerProvider", "fake", "Fake"\)/);
  assert.match(stressScript, /Stress harness failed to select the fake planner provider/);
  assert.match(stressScript, /assertEqual\(job\.settings\?\.plannerProvider, "fake", "UI sampling planner provider"\)/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
