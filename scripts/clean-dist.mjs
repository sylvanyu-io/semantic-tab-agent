import { readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const distDir = process.env.EXTENSION_DIST_DIR ? resolve(rootDir, process.env.EXTENSION_DIST_DIR) : join(rootDir, "dist");

if (!existsSync(distDir)) {
  console.log("dist is already clean.");
  process.exit(0);
}

await rm(join(distDir, "extension"), { recursive: true, force: true });
await rm(join(distDir, "extension-store"), { recursive: true, force: true });
await rm(join(distDir, "stress"), { recursive: true, force: true });

for (const entry of await readdir(distDir)) {
  if (entry.endsWith(".zip")) {
    await rm(join(distDir, entry), { force: true });
  }
}

console.log("Cleaned extension build artifacts.");
