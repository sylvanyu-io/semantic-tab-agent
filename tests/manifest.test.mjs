import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("extension uses a native side panel", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extName__");
  assert.equal(manifest.short_name, "__MSG_extShortName__");
  assert.equal(manifest.description, "__MSG_extDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "src/sidepanel/index.html");
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal((manifest.permissions || []).includes("sidePanel"), true);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

test("manifest metadata has matching English and Simplified Chinese messages", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const english = JSON.parse(await readFile("_locales/en/messages.json", "utf8"));
  const simplifiedChinese = JSON.parse(await readFile("_locales/zh_CN/messages.json", "utf8"));
  const requiredKeys = [manifest.name, manifest.short_name, manifest.description, manifest.action.default_title].map(
    (value) => value.match(/^__MSG_([A-Za-z0-9_]+)__$/)?.[1]
  );

  assert.equal(requiredKeys.every(Boolean), true);
  assert.deepEqual(Object.keys(simplifiedChinese).sort(), Object.keys(english).sort());
  for (const key of requiredKeys) {
    assert.equal(typeof english[key]?.message, "string");
    assert.equal(english[key].message.trim().length > 0, true);
    assert.equal(typeof simplifiedChinese[key]?.message, "string");
    assert.equal(simplifiedChinese[key].message.trim().length > 0, true);
  }
  assert.equal([...english.extDescription.message].length <= 132, true);
  assert.equal([...simplifiedChinese.extDescription.message].length <= 132, true);
  assert.match(english.extDescription.message, /Sort crowded Chrome windows/);
  assert.match(simplifiedChinese.extDescription.message, /按任务整理杂乱标签页/);
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
    assert.equal((manifest.permissions || []).includes("scripting"), false);
    assert.equal((manifest.permissions || []).includes("sidePanel"), true);
    assert.equal(Object.hasOwn(manifest, "optional_permissions"), false);
    assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
    assert.deepEqual(manifest.host_permissions || [], []);
    assert.equal(manifest.default_locale, "en");
    assert.equal(manifest.name, "__MSG_extName__");
    assert.equal(
      JSON.parse(await readFile(join(tempDist, "extension-store/_locales/zh_CN/messages.json"), "utf8")).extName.message,
      "TabRecap"
    );
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(manifest.side_panel.default_path, "src/sidepanel/index.html");
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});
