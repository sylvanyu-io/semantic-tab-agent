import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findSecretPatternMatches, matchesSecretPattern } from "../scripts/lib/secret-patterns.mjs";
import { artifactZipName } from "../scripts/lib/release-artifacts.mjs";

test("public release scripts include real extension stress and live gateway gates", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = manifest.scripts || {};

  assert.equal(scripts.build, "npm run build:extension");
  assert.match(scripts["release:check:full"], /npm run release:check/);
  assert.match(scripts["release:check:full"], /npm run stress:extension/);
  assert.match(scripts["release:publish-check"], /verify-release-version\.mjs/);
  assert.match(scripts["release:publish-check"], /release:check:full/);

  assert.match(scripts["release:check:live"], /node scripts\/require-monitor-token\.mjs/);
  assert.match(scripts["release:check:live"], /npm run release:check:full/);
  assert.match(scripts["release:check:live"], /GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway/);

  assert.equal(scripts["stress:summary"], "node scripts/summarize-stress-artifact.mjs");
});

test("long recap lifecycle smoke uses a delayed real extension gateway", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const script = await readFile("scripts/smoke-long-recap-lifecycle.mjs", "utf8");

  assert.equal(packageJson.scripts["smoke:long-recap"], "node scripts/smoke-long-recap-lifecycle.mjs");
  assert.match(script, /LONG_RECAP_DELAY_MS/);
  assert.match(script, /launchPersistentContext/);
  assert.match(script, /task:keepAlive|长请求生命周期验证完成/);
});

test("release version gate rejects reuse of a tag on newer source", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tab-recap-version-gate-"));
  try {
    await writeFile(join(tempRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(join(tempRoot, "manifest.json"), JSON.stringify({ version: "1.2.3" }));
    runGit(tempRoot, ["init", "-q"]);
    runGit(tempRoot, ["config", "user.email", "release-test@example.com"]);
    runGit(tempRoot, ["config", "user.name", "Release Test"]);
    runGit(tempRoot, ["add", "."]);
    runGit(tempRoot, ["commit", "-qm", "release 1.2.3"]);
    runGit(tempRoot, ["tag", "v1.2.3"]);

    const tagged = runReleaseVersionGate(tempRoot);
    assert.equal(tagged.status, 0, tagged.stderr || tagged.stdout);

    await writeFile(join(tempRoot, "change.txt"), "new source");
    runGit(tempRoot, ["add", "."]);
    runGit(tempRoot, ["commit", "-qm", "new source"]);
    const reused = runReleaseVersionGate(tempRoot);
    assert.notEqual(reused.status, 0);
    assert.match(`${reused.stdout}\n${reused.stderr}`, /already points to/);

    await writeFile(join(tempRoot, "package.json"), JSON.stringify({ version: "1.2.4" }));
    await writeFile(join(tempRoot, "manifest.json"), JSON.stringify({ version: "1.2.4" }));
    const bumped = runReleaseVersionGate(tempRoot);
    assert.equal(bumped.status, 0, bumped.stderr || bumped.stdout);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("release version gate rejects a tagged commit outside main", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tab-recap-main-gate-"));
  try {
    await writeFile(join(tempRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(join(tempRoot, "manifest.json"), JSON.stringify({ version: "1.2.3" }));
    runGit(tempRoot, ["init", "-q"]);
    runGit(tempRoot, ["config", "user.email", "release-test@example.com"]);
    runGit(tempRoot, ["config", "user.name", "Release Test"]);
    runGit(tempRoot, ["checkout", "-qb", "main"]);
    runGit(tempRoot, ["add", "."]);
    runGit(tempRoot, ["commit", "-qm", "main release base"]);
    runGit(tempRoot, ["checkout", "-qb", "unmerged-release"]);
    await writeFile(join(tempRoot, "feature.txt"), "not merged to main");
    runGit(tempRoot, ["add", "."]);
    runGit(tempRoot, ["commit", "-qm", "unmerged release"]);
    runGit(tempRoot, ["tag", "v1.2.3"]);

    const result = runReleaseVersionGate(tempRoot, { REQUIRE_RELEASE_TAG: "1" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /outside refs\/heads\/main/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

test("README asset mock copy avoids raw implementation field names", async () => {
  const generator = await readFile("scripts/generate-readme-assets.mjs", "utf8");
  const rawFieldStringLiteral =
    /["'][^"'\n]*(?:activeCount|active_count|ageDays|age-days|idleDays|nearbyIds|activationFlow|dwellSeconds|returnedToCount|fromId|toId|tab_ids|page_id|sample_able)[^"'\n]*["']/i;

  assert.doesNotMatch(generator, rawFieldStringLiteral);
});

test("dist cleanup removes stale release and stress artifacts", async () => {
  const cleanScript = await readFile("scripts/clean-dist.mjs", "utf8");

  assert.match(cleanScript, /EXTENSION_DIST_DIR/);
  assert.match(cleanScript, /join\(distDir, "extension"\)/);
  assert.match(cleanScript, /join\(distDir, "extension-store"\)/);
  assert.match(cleanScript, /join\(distDir, "stress"\)/);
  assert.match(cleanScript, /entry\.endsWith\("\.zip"\)/);
});

test("extension build rejects unknown release channels", () => {
  const result = spawnSync(process.execPath, ["scripts/build-extension.mjs"], {
    encoding: "utf8",
    env: { ...process.env, EXTENSION_CHANNEL: "stroe" }
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unknown extension channel: stroe/);
});

test("untagged extension packages include source identity", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const name = artifactZipName(process.cwd(), manifest.version, "dev");

  assert.match(name, new RegExp(`^tab-recap-${manifest.version.replaceAll(".", "\\.")}-dev-[a-f0-9]{12}(?:-dirty)?\\.zip$`));
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

test("release artifact audit fails when package and manifest versions drift", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tab-recap-audit-root-"));
  try {
    await writeFile(join(tempRoot, "package.json"), JSON.stringify({ version: "9.9.9" }));
    await writeFile(join(tempRoot, "manifest.json"), JSON.stringify({ version: "9.9.8" }));

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_ROOT_DIR: tempRoot }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(
      `${audit.stdout}\n${audit.stderr}`,
      /package\.json version 9\.9\.9 does not match manifest\.json version 9\.9\.8/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("secret scanners cover model, alert email, and common cloud key shapes", () => {
  const providerKey = ["sk", "provider-token-1234567890"].join("-");
  const resendKey = ["re", "alert-token-1234567890"].join("_");
  const githubClassicToken = ["ghp", "A".repeat(36)].join("_");
  const githubFineGrainedToken = ["github", "pat", "B".repeat(80)].join("_");
  const gitlabPersonalAccessToken = ["glpat", "C".repeat(24)].join("-");
  const groqApiKey = ["gsk", "D".repeat(28)].join("_");
  const huggingFaceToken = ["hf", "E".repeat(28)].join("_");
  const xaiApiKey = ["xai", "F".repeat(28)].join("-");
  const googleApiKey = `AIza${"G".repeat(35)}`;
  const awsAccessKeyId = `AKIA${"H".repeat(16)}`;
  const pemPrivateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

  assert.equal(matchesSecretRule("provider_api_key", providerKey), true);
  assert.equal(matchesSecretRule("resend_api_key", resendKey), true);
  assert.equal(matchesSecretRule("github_classic_token", githubClassicToken), true);
  assert.equal(matchesSecretRule("github_fine_grained_token", githubFineGrainedToken), true);
  assert.equal(matchesSecretRule("gitlab_personal_access_token", gitlabPersonalAccessToken), true);
  assert.equal(matchesSecretRule("groq_api_key", groqApiKey), true);
  assert.equal(matchesSecretRule("huggingface_token", huggingFaceToken), true);
  assert.equal(matchesSecretRule("xai_api_key", xaiApiKey), true);
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

  assert.match(historyScanner, /--is-shallow-repository/);
  assert.match(historyScanner, /Refusing to scan a shallow clone/);
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
    const zip = spawnSync("zip", ["-qr", join(tempDist, artifactZipName(process.cwd(), manifest.version, "dev")), "."], {
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
    const zip = spawnSync("zip", ["-qr", join(tempDist, artifactZipName(process.cwd(), manifest.version, "dev")), "."], {
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

    const zipPath = join(tempDist, artifactZipName(process.cwd(), manifest.version, "dev"));
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

test("release artifact audit fails store artifacts with required content-reading permissions", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-audit-store-permissions-"));
  try {
    const sourceManifest = JSON.parse(await readFile("manifest.json", "utf8"));
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

    const storeExtensionDir = join(tempDist, "extension-store");
    const storeManifestPath = join(storeExtensionDir, "manifest.json");
    const storeManifest = JSON.parse(await readFile(storeManifestPath, "utf8"));
    storeManifest.permissions = [...new Set([...(storeManifest.permissions || []), "scripting"])];
    await writeFile(storeManifestPath, `${JSON.stringify(storeManifest, null, 2)}\n`);
    const zip = spawnSync("zip", ["-qr", join(tempDist, artifactZipName(process.cwd(), sourceManifest.version, "store")), "."], {
      cwd: storeExtensionDir,
      encoding: "utf8"
    });
    assert.equal(zip.status, 0, zip.stderr || zip.stdout);

    const audit = spawnSync(process.execPath, ["scripts/audit-release-artifacts.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_DIST_DIR: tempDist }
    });
    assert.notEqual(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(`${audit.stdout}\n${audit.stderr}`, /store: store build must not request scripting/);
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});

test("release artifact audit locks store host permissions to the default gateway", async () => {
  const auditScript = await readFile("scripts/audit-release-artifacts.mjs", "utf8");

  assert.match(auditScript, /storeHostPermissions/);
  assert.match(auditScript, /storeOptionalHostPermissions/);
  assert.match(auditScript, /https:\/\/cliproxy\.sylvanyu\.io\/\*/);
  assert.match(auditScript, /store build must only request the default AI gateway host permission/);
  assert.match(auditScript, /store build must not request optional extension permissions/);
  assert.match(auditScript, /store build must keep optional host permissions for custom AI API origins/);
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

    const storeManifest = JSON.parse(await readFile(join(tempDist, "extension-store", "manifest.json"), "utf8"));
    assert.equal((storeManifest.permissions || []).includes("activeTab"), false);
    assert.equal((storeManifest.permissions || []).includes("scripting"), false);
    assert.deepEqual(storeManifest.host_permissions, ["https://cliproxy.sylvanyu.io/*"]);
    assert.equal(Object.hasOwn(storeManifest, "optional_permissions"), false);
    assert.deepEqual(storeManifest.optional_host_permissions, ["https://*/*", "http://*/*"]);

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

test("release scripts derive filesystem paths without URL-encoded pathnames", async () => {
  const scripts = [
    "scripts/build-extension.mjs",
    "scripts/clean-dist.mjs",
    "scripts/generate-icons.mjs",
    "scripts/scan-secrets.mjs"
  ];

  for (const scriptPath of scripts) {
    const source = await readFile(scriptPath, "utf8");
    assert.match(source, /fileURLToPath\(new URL\("..", import\.meta\.url\)\)/, `${scriptPath} should decode file URLs`);
    assert.doesNotMatch(source, /new URL\("..", import\.meta\.url\)\.pathname/, `${scriptPath} should not use URL pathname`);
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

test("real extension stress can find UI sampling jobs across scoped storage", async () => {
  const stressScript = await readFile("scripts/stress-extension.mjs", "utf8");

  assert.match(stressScript, /STORAGE_KEYS/);
  assert.match(stressScript, /findStoredLastSamplingJob/);
  assert.match(stressScript, /createdAfterMs/);
  assert.match(stressScript, /key === lastJobBaseKey \|\| key\.startsWith\(`\$\{lastJobBaseKey\}:`\)/);
  assert.match(stressScript, /tabs:clearAnalysisState[^]*page\.reload\(\{ waitUntil: "domcontentloaded" \}\)/);
});

test("live release gate explicitly enables the keyless built-in gateway stress branch", async () => {
  const stressScript = await readFile("scripts/stress-extension.mjs", "utf8");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const readme = await readFile("README.md", "utf8");

  assert.match(stressScript, /gatewayStressEnabled = process\.env\.STRESS_GATEWAY === "1"/);
  assert.doesNotMatch(stressScript, /gatewayStressEnabled = .*Boolean\(gatewayKey\)/);
  assert.match(stressScript, /gatewayTabs: gatewayStressEnabled \? gatewayTabs : 0/);
  assert.doesNotMatch(stressScript, /gatewayTabs: gatewayKey \? gatewayTabs : 0/);
  assert.match(stressScript, /type: "activity:generateTimeRecap"/);
  assert.match(stressScript, /gatewayRecap\.source === "ai"/);
  assert.match(stressScript, /reason: "STRESS_GATEWAY is not enabled"/);
  assert.match(packageJson.scripts["release:check:live"], /STRESS_GATEWAY=1 npm run release:check:full/);
  assert.match(readme, /STRESS_GATEWAY=1 STRESS_GATEWAY_TABS=60 npm run stress:extension/);
  assert.doesNotMatch(readme, /GATEWAY_BASE_URL=http:\/\/127\.0\.0\.1:8317\/v1 STRESS_GATEWAY_TABS=60/);
});

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runReleaseVersionGate(root, extraEnv = {}) {
  return spawnSync(process.execPath, ["scripts/verify-release-version.mjs"], {
    encoding: "utf8",
    env: { ...process.env, RELEASE_ROOT_DIR: root, ...extraEnv }
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesSecretRule(ruleName, value) {
  assert.equal(matchesSecretPattern(ruleName, value), true, `Missing secret scanner rule ${ruleName}`);
  return true;
}
