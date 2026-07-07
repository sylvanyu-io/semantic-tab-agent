import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = new URL("..", import.meta.url).pathname;
const distDir = process.env.EXTENSION_DIST_DIR ? resolve(rootDir, process.env.EXTENSION_DIST_DIR) : join(rootDir, "dist");
const manifest = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));
const channel = process.env.EXTENSION_CHANNEL === "store" ? "store" : "dev";
const extensionDir = join(distDir, channel === "store" ? "extension-store" : "extension");
const zipName = `tab-recap-${manifest.version}${channel === "store" ? "-store" : ""}.zip`;
const zipPath = join(distDir, zipName);
const storeHostPermissions = ["https://cliproxy.sylvanyu.io/*"];

await rm(extensionDir, { recursive: true, force: true });
await mkdir(extensionDir, { recursive: true });

for (const path of ["manifest.json", "src", "icons"]) {
  const sourcePath = join(rootDir, path);
  if (existsSync(sourcePath)) {
    await cp(sourcePath, join(extensionDir, path), { recursive: true });
  }
}

if (channel === "store") {
  await writeStoreManifest(join(extensionDir, "manifest.json"));
}

await rm(zipPath, { force: true });
const zip = spawnSync("zip", ["-qr", zipPath, "."], { cwd: extensionDir, stdio: "inherit" });
if (zip.status !== 0) {
  console.error("Failed to create extension zip. Ensure the `zip` command is available.");
  process.exit(zip.status || 1);
}

if (!existsSync(zipPath)) {
  console.error(`Expected zip was not created: ${zipPath}`);
  process.exit(1);
}

console.log(`Built ${zipPath}`);
console.log(`Unpacked extension: ${extensionDir}`);
console.log(`Channel: ${channel}`);

async function writeStoreManifest(manifestPath) {
  const storeManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  storeManifest.permissions = (storeManifest.permissions || []).filter((permission) => permission !== "activeTab");
  storeManifest.host_permissions = (storeManifest.host_permissions || []).filter((permission) =>
    storeHostPermissions.includes(permission)
  );
  storeManifest.optional_permissions = (storeManifest.optional_permissions || []).filter((permission) => permission !== "scripting");
  if (!storeManifest.optional_permissions.length) delete storeManifest.optional_permissions;
  delete storeManifest.optional_host_permissions;
  await writeFile(manifestPath, `${JSON.stringify(storeManifest, null, 2)}\n`);
}
