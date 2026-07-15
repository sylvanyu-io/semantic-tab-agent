import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.env.RELEASE_ROOT_DIR || process.cwd());
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const version = String(packageJson.version || "").trim();

if (!version || version !== String(manifest.version || "").trim()) {
  fail(`package.json version ${version || "<missing>"} does not match manifest.json version ${manifest.version || "<missing>"}.`);
}

const expectedTag = `v${version}`;
const head = git(["rev-parse", "HEAD"]);
const taggedCommit = git(["rev-parse", "-q", "--verify", `refs/tags/${expectedTag}^{commit}`], { allowFailure: true });
if (taggedCommit && taggedCommit !== head) {
  fail(`${expectedTag} already points to ${taggedCommit.slice(0, 12)}, but HEAD is ${head.slice(0, 12)}. Bump the package and manifest version before publishing.`);
}

const githubTag = process.env.GITHUB_REF_TYPE === "tag" ? String(process.env.GITHUB_REF_NAME || "") : "";
const requireTag = process.env.REQUIRE_RELEASE_TAG === "1" || Boolean(githubTag);
if (githubTag && githubTag !== expectedTag) {
  fail(`Git tag ${githubTag} does not match package version ${version}; expected ${expectedTag}.`);
}
if (requireTag && taggedCommit !== head) {
  fail(`Release tag ${expectedTag} must point to HEAD before publishing.`);
}
if (requireTag) {
  const mainRef = resolveMainRef();
  if (!mainRef) {
    fail("Unable to verify the release commit against main. Fetch main before publishing.");
  }
  if (!gitSucceeds(["merge-base", "--is-ancestor", head, mainRef.commit])) {
    fail(`Release tag ${expectedTag} points outside ${mainRef.name}; merge the release commit into main before publishing.`);
  }
}

console.log(`Release version verified: ${version}${taggedCommit === head ? ` (${expectedTag})` : " (not tagged yet)"}.`);

function git(args, options = {}) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    if (options.allowFailure) return "";
    fail((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return String(result.stdout || "").trim();
}

function gitSucceeds(args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).status === 0;
}

function resolveMainRef() {
  const candidates = [
    String(process.env.RELEASE_MAIN_REF || "").trim(),
    "refs/remotes/origin/main",
    "refs/heads/main"
  ].filter(Boolean);
  for (const name of candidates) {
    const commit = git(["rev-parse", "-q", "--verify", `${name}^{commit}`], { allowFailure: true });
    if (commit) return { name, commit };
  }
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
