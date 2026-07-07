import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = process.env.EXTENSION_DIST_DIR ? resolve(rootDir, process.env.EXTENSION_DIST_DIR) : join(rootDir, "dist");
const rootManifest = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));

const artifacts = [
  {
    channel: "dev",
    extensionDir: join(distDir, "extension"),
    zipPath: join(distDir, `tab-recap-${rootManifest.version}.zip`)
  },
  {
    channel: "store",
    extensionDir: join(distDir, "extension-store"),
    zipPath: join(distDir, `tab-recap-${rootManifest.version}-store.zip`)
  }
];

const allowedTopLevel = new Set(["manifest.json", "src", "icons"]);
const allowedExtensions = new Set([".css", ".html", ".js", ".json", ".png", ".svg"]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg"]);
const forbiddenProductCopy = ["Internal test", "Semantic Tab Agent", "Tab Tidy"];
const forbiddenEntryPatterns = [
  /^docs\//,
  /^tests?\//,
  /^worker\//,
  /^scripts\//,
  /^node_modules\//,
  /^dist\//,
  /^\.git\//,
  /^\.github\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)package(?:-lock)?\.json$/,
  /\.map$/,
  /\.md$/,
  /\.pem$/,
  /\.key$/,
  /\.env/
];

let failures = 0;

for (const artifact of artifacts) {
  auditExists(artifact.extensionDir, `${artifact.channel} unpacked extension`);
  auditExists(artifact.zipPath, `${artifact.channel} zip`);
  if (!existsSync(artifact.extensionDir) || !existsSync(artifact.zipPath)) continue;

  const manifest = JSON.parse(await readFile(join(artifact.extensionDir, "manifest.json"), "utf8"));
  const unpackedFiles = await listFiles(artifact.extensionDir);
  const zipFiles = listZipFiles(artifact.zipPath).filter((entry) => !entry.endsWith("/"));

  auditManifest(artifact.channel, manifest, unpackedFiles);
  auditEntries(artifact.channel, unpackedFiles, zipFiles);
  await auditSidePanelHtml(artifact.channel, artifact.extensionDir, manifest);
  await auditSidePanelRuntimeGuards(artifact.channel, artifact.extensionDir, unpackedFiles);
  await auditProductCopy(artifact.channel, artifact.extensionDir, unpackedFiles);
}

if (failures) {
  console.error(`Release artifact audit failed with ${failures} issue(s).`);
  process.exit(1);
}

console.log("Release artifact audit passed.");

function auditExists(path, label) {
  if (!existsSync(path)) fail(`${label} is missing: ${path}`);
}

function auditManifest(channel, manifest, files) {
  if (manifest.manifest_version !== 3) fail(`${channel}: manifest_version must be 3.`);
  if (manifest.name !== rootManifest.name) fail(`${channel}: manifest name changed unexpectedly.`);
  if (manifest.version !== rootManifest.version) fail(`${channel}: manifest version does not match package source.`);

  const requiredPaths = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  for (const path of requiredPaths) {
    if (!files.includes(path)) fail(`${channel}: manifest references missing file ${path}.`);
  }

  if (channel === "store") {
    assertNotIncludes(manifest.permissions, "activeTab", `${channel}: store build must not request activeTab.`);
    assertNotIncludes(manifest.optional_permissions, "scripting", `${channel}: store build must not request optional scripting.`);
    if (manifest.optional_host_permissions) fail(`${channel}: store build must not include optional_host_permissions.`);
  } else {
    assertIncludes(manifest.permissions, "activeTab", `${channel}: dev build should keep activeTab for local diagnostics.`);
    assertIncludes(manifest.optional_permissions, "scripting", `${channel}: dev build should keep optional scripting.`);
    assertIncludes(manifest.optional_host_permissions, "https://*/*", `${channel}: dev build should keep optional https host permissions.`);
    assertIncludes(manifest.optional_host_permissions, "http://*/*", `${channel}: dev build should keep optional http host permissions.`);
  }
}

function auditEntries(channel, unpackedFiles, zipFiles) {
  const unpackedSet = new Set(unpackedFiles);
  const zipSet = new Set(zipFiles);
  for (const file of unpackedSet) {
    if (!zipSet.has(file)) fail(`${channel}: zip is missing unpacked file ${file}.`);
  }
  for (const file of zipSet) {
    if (!unpackedSet.has(file)) fail(`${channel}: zip contains unexpected file ${file}.`);
    const topLevel = file.split("/")[0];
    if (!allowedTopLevel.has(topLevel)) fail(`${channel}: zip contains disallowed top-level entry ${file}.`);
    if (!allowedExtensions.has(extensionOf(file))) fail(`${channel}: zip contains disallowed extension ${file}.`);
    if (forbiddenEntryPatterns.some((pattern) => pattern.test(file))) fail(`${channel}: zip contains forbidden entry ${file}.`);
  }
}

async function auditSidePanelHtml(channel, extensionDir, manifest) {
  const sidePanelPath = manifest.side_panel?.default_path;
  if (!sidePanelPath) return;

  const html = await readFile(join(extensionDir, sidePanelPath), "utf8");
  if (html.includes("Internal test")) fail(`${channel}: side panel exposes internal fake provider copy.`);
  if (html.includes('value="fake"')) fail(`${channel}: side panel statically exposes fake planner provider.`);
}

async function auditSidePanelRuntimeGuards(channel, extensionDir, files) {
  const htmlPath = "src/sidepanel/index.html";
  const scriptPath = "src/sidepanel/sidepanel.js";
  const stylesPath = "src/sidepanel/styles.css";
  for (const requiredFile of [htmlPath, scriptPath, stylesPath]) {
    if (!files.includes(requiredFile)) {
      fail(`${channel}: side panel runtime guard file is missing ${requiredFile}.`);
      return;
    }
  }

  const html = await readFile(join(extensionDir, htmlPath), "utf8");
  const script = await readFile(join(extensionDir, scriptPath), "utf8");
  const styles = await readFile(join(extensionDir, stylesPath), "utf8");

  if (!html.includes("content-access-feature")) {
    fail(`${channel}: side panel content-reading controls are not marked as content-access-feature.`);
  }
  if (!script.includes("function hasContentAccessFeature()")) {
    fail(`${channel}: side panel is missing the content access feature detector.`);
  }
  if (!script.includes("nodes.appShell.dataset.contentAccess")) {
    fail(`${channel}: side panel does not expose content access state to CSS.`);
  }
  if (!styles.includes('.app-shell[data-content-access="off"] .content-access-feature')) {
    fail(`${channel}: side panel CSS no longer hides content-reading controls when unavailable.`);
  }
}

async function auditProductCopy(channel, extensionDir, files) {
  for (const file of files) {
    if (!textExtensions.has(extensionOf(file))) continue;

    const content = await readFile(join(extensionDir, file), "utf8");
    for (const copy of forbiddenProductCopy) {
      if (content.includes(copy)) fail(`${channel}: ${file} contains obsolete/internal product copy "${copy}".`);
    }
  }
}

async function listFiles(dir) {
  const files = [];
  await walk(dir, dir, files);
  return files.sort();
}

async function walk(root, dir, files) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
    } else if (entry.isFile()) {
      files.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
}

function listZipFiles(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`Could not list zip entries for ${zipPath}: ${result.stderr || result.stdout}`);
    return [];
  }
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).sort();
}

function extensionOf(file) {
  const name = file.split("/").pop() || "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function assertIncludes(values, expected, message) {
  if (!Array.isArray(values) || !values.includes(expected)) fail(message);
}

function assertNotIncludes(values, forbidden, message) {
  if (Array.isArray(values) && values.includes(forbidden)) fail(message);
}

function fail(message) {
  failures += 1;
  console.error(`- ${message}`);
}
