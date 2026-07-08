import { spawnSync } from "node:child_process";
import { findSecretPatternMatches } from "./lib/secret-patterns.mjs";

const allowedHistoricalFixtureValues = new Set([
  ["sk", "private-secret-token-1234567890"].join("-"),
  ["sk", "private-secret-token"].join("-")
]);

const gitLog = spawnSync("git", ["log", "-p", "--all", "--", "."], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});

if (gitLog.status !== 0) {
  console.error(gitLog.stderr || "Unable to scan git history.");
  process.exit(gitLog.status || 1);
}

const findings = [];
for (const match of findSecretPatternMatches(gitLog.stdout)) {
  if (isAllowedHistoricalFixture(match.value)) continue;
  findings.push({ rule: match.rule, offset: match.offset });
}

if (findings.length) {
  console.error("Potential secrets found in git history:");
  for (const finding of findings.slice(0, 20)) {
    console.error(`- ${finding.rule} near history offset ${finding.offset}`);
  }
  if (findings.length > 20) {
    console.error(`- ${findings.length - 20} additional finding(s) omitted.`);
  }
  process.exit(1);
}

console.log("No secret patterns found in git history.");

function isAllowedHistoricalFixture(value) {
  return allowedHistoricalFixtureValues.has(value);
}
