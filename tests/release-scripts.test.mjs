import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findSecretPatternMatches, matchesSecretPattern } from "../scripts/lib/secret-patterns.mjs";

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
  assert.match(auditScript, /开发版功能/);
  assert.match(auditScript, /商店版/);
  assert.match(auditScript, /Tab Tidy/);
  assert.match(auditScript, /TabTidy/);
  assert.match(auditScript, /tab_tidy_/);
  assert.match(auditScript, /tab-tidy/);
});

test("secret scanners cover model, alert email, and common cloud key shapes", () => {
  const providerKey = ["sk", "provider-token-1234567890"].join("-");
  const resendKey = ["re", "alert-token-1234567890"].join("_");
  const githubClassicToken = ["ghp", "A".repeat(36)].join("_");
  const githubFineGrainedToken = ["github", "pat", "B".repeat(80)].join("_");
  const googleApiKey = `AIza${"C".repeat(35)}`;
  const awsAccessKeyId = `AKIA${"D".repeat(16)}`;
  const pemPrivateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

  assert.equal(matchesSecretRule("provider_api_key", providerKey), true);
  assert.equal(matchesSecretRule("resend_api_key", resendKey), true);
  assert.equal(matchesSecretRule("github_classic_token", githubClassicToken), true);
  assert.equal(matchesSecretRule("github_fine_grained_token", githubFineGrainedToken), true);
  assert.equal(matchesSecretRule("google_api_key", googleApiKey), true);
  assert.equal(matchesSecretRule("aws_access_key_id", awsAccessKeyId), true);
  assert.equal(matchesSecretRule("pem_private_key", pemPrivateKeyHeader), true);
});

test("secret pattern helper is safe to call repeatedly with global regex rules", () => {
  const providerKey = ["sk", "provider-token-1234567890"].join("-");

  assert.equal(matchesSecretPattern("provider_api_key", providerKey), true);
  assert.equal(matchesSecretPattern("provider_api_key", providerKey), true);
  assert.deepEqual(
    findSecretPatternMatches(`left ${providerKey} right`).map((finding) => ({
      rule: finding.rule,
      value: finding.value,
      offset: finding.offset
    })),
    [{ rule: "provider_api_key", value: providerKey, offset: 5 }]
  );
});

test("secret scanner success copy stays generic across secret provider types", async () => {
  const currentScanner = await readFile("scripts/scan-secrets.mjs", "utf8");
  const historyScanner = await readFile("scripts/scan-secrets-history.mjs", "utf8");

  assert.match(currentScanner, /No secret patterns found/);
  assert.match(historyScanner, /No secret patterns found in git history/);
  assert.doesNotMatch(currentScanner, /No provider-key patterns found/);
  assert.doesNotMatch(historyScanner, /No provider-key patterns found/);
});

test("history secret scanner only allowlists exact known old fake secret fixtures", async () => {
  const historyScanner = await readFile("scripts/scan-secrets-history.mjs", "utf8");

  assert.match(historyScanner, /allowedHistoricalFixtureValues = new Set/);
  assert.match(historyScanner, /private-secret-token/);
  assert.match(historyScanner, /allowedHistoricalFixtureValues\.has\(value\)/);
  assert.doesNotMatch(historyScanner, /\b(?:sk-proj|sk-ant|sk-or|sk)-[A-Za-z0-9_-]{20,}\b/);
  assert.doesNotMatch(historyScanner, /resend_api_key[^]*allowedHistoricalFixtureFragments/);
});

test("release artifact audit fails built artifacts that contain legacy product name variants", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-audit-dist-"));
  try {
    const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
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

    const extensionDir = join(tempDist, "extension");
    const pollutedScript = join(extensionDir, "src/sidepanel/sidepanel.js");
    await writeFile(
      pollutedScript,
      `${await readFile(pollutedScript, "utf8")}\n// TabTidy must not ship.\n// 开发版功能 must not ship.\n`
    );
    const zip = spawnSync("zip", ["-qr", join(tempDist, `tab-recap-${manifest.version}.zip`), "."], {
      cwd: extensionDir,
      encoding: "utf8"
    });
    assert.equal(zip.status, 0, zip.stderr || zip.stdout);

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /obsolete\/internal product copy "TabTidy"/);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /obsolete\/internal product copy "开发版功能"/);
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});

test("release artifact audit fails built artifacts that contain secret patterns", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-audit-secret-dist-"));
  try {
    const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
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

    const extensionDir = join(tempDist, "extension");
    const pollutedScript = join(extensionDir, "src/sidepanel/sidepanel.js");
    const fakeGithubToken = ["ghp", "A".repeat(36)].join("_");
    await writeFile(pollutedScript, `${await readFile(pollutedScript, "utf8")}\n// ${fakeGithubToken}\n`);
    const zip = spawnSync("zip", ["-qr", join(tempDist, `tab-recap-${manifest.version}.zip`), "."], {
      cwd: extensionDir,
      encoding: "utf8"
    });
    assert.equal(zip.status, 0, zip.stderr || zip.stdout);

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /contains secret pattern "github_classic_token"/);
    assert.doesNotMatch(`${audit.stdout}\n${audit.stderr}`, new RegExp(fakeGithubToken));
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});

test("release artifact audit fails when zip contents drift from the unpacked extension", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-audit-zip-dist-"));
  const zipWork = await mkdtemp(join(tmpdir(), "tab-recap-audit-zip-work-"));
  try {
    const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
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

    const zipPath = join(tempDist, `tab-recap-${manifest.version}.zip`);
    const unzip = spawnSync("unzip", ["-q", zipPath, "-d", zipWork], { encoding: "utf8" });
    assert.equal(unzip.status, 0, unzip.stderr || unzip.stdout);
    const pollutedScript = join(zipWork, "src/sidepanel/sidepanel.js");
    await writeFile(pollutedScript, `${await readFile(pollutedScript, "utf8")}\n// zip-only drift\n`);
    await rm(zipPath, { force: true });
    const zip = spawnSync("zip", ["-qr", zipPath, "."], { cwd: zipWork, encoding: "utf8" });
    assert.equal(zip.status, 0, zip.stderr || zip.stdout);

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /zip content differs from unpacked file src\/sidepanel\/sidepanel\.js/);
  } finally {
    await rm(tempDist, { recursive: true, force: true });
    await rm(zipWork, { recursive: true, force: true });
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

function matchesSecretRule(ruleName, value) {
  assert.equal(matchesSecretPattern(ruleName, value), true, `Missing secret scanner rule ${ruleName}`);
  return true;
}
