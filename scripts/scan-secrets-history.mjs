import { spawnSync } from "node:child_process";
import { SECRET_PATTERNS } from "./lib/secret-patterns.mjs";

const allowedHistoricalFixtureFragments = [
  ["sk", "private-provider-token"].join("-"),
  ["sk", "private-secret-token"].join("-")
];

const gitLog = spawnSync("git", ["log", "-p", "--all", "--", "."], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});

if (gitLog.status !== 0) {
  console.error(gitLog.stderr || "Unable to scan git history.");
  process.exit(gitLog.status || 1);
}

const findings = [];
for (const rule of SECRET_PATTERNS) {
  for (const match of gitLog.stdout.matchAll(rule.pattern)) {
    if (isAllowedHistoricalFixture(match[0])) continue;
    findings.push({ rule: rule.name, offset: match.index });
  }
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

console.log("No provider-key patterns found in git history.");

function isAllowedHistoricalFixture(value) {
  return allowedHistoricalFixtureFragments.some((fragment) => value.includes(fragment));
}
