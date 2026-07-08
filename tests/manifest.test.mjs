import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("extension uses a native side panel", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "src/sidepanel/index.html");
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal((manifest.permissions || []).includes("sidePanel"), true);
  assert.deepEqual(manifest.host_permissions, ["https://cliproxy.sylvanyu.io/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

test("release version stays synchronized across package and manifest sources", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));

  assert.equal(manifest.version, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.[""]?.version, packageJson.version);
});

test("store extension build strips content-reading permissions", async () => {
  const tempDist = await mkdtemp(join(tmpdir(), "tab-recap-store-build-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/build-extension.mjs"], {
      encoding: "utf8",
      env: { ...process.env, EXTENSION_CHANNEL: "store", EXTENSION_DIST_DIR: tempDist }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const manifest = JSON.parse(await readFile(join(tempDist, "extension-store/manifest.json"), "utf8"));
    assert.equal((manifest.permissions || []).includes("activeTab"), false);
    assert.equal((manifest.permissions || []).includes("sidePanel"), true);
    assert.equal(Object.hasOwn(manifest, "optional_permissions"), false);
    assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
    assert.deepEqual(manifest.host_permissions, ["https://cliproxy.sylvanyu.io/*"]);
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(manifest.side_panel.default_path, "src/sidepanel/index.html");
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});
