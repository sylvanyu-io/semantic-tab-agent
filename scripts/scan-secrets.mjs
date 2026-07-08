import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecretPatternMatches } from "./lib/secret-patterns.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirs = new Set([".git", "node_modules", "dist", "test-results", "playwright-report", "coverage"]);

const findings = [];
for (const filePath of walk(rootDir)) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  for (const match of findSecretPatternMatches(text)) {
    findings.push({
      file: relative(rootDir, filePath),
      rule: match.rule,
      offset: match.offset
    });
  }
}

if (findings.length) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.rule} at ${finding.offset})`);
  }
  process.exit(1);
}

console.log("No secret patterns found.");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      yield* walk(filePath);
    } else if (stat.isFile()) {
      yield filePath;
    }
  }
}
