import { spawnSync } from "node:child_process";

export function artifactZipName(rootDir, version, channel, env = process.env) {
  const normalizedChannel = channel === "store" ? "store" : "dev";
  const channelSuffix = normalizedChannel === "store" ? "-store" : "";
  const identity = resolveBuildIdentity(rootDir, version, env);
  return `tab-recap-${version}${channelSuffix}${identity.release ? "" : `-dev-${identity.label}`}.zip`;
}

export function resolveBuildIdentity(rootDir, version, env = process.env) {
  const explicitBuildId = sanitizeBuildId(env.EXTENSION_BUILD_ID);
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  const shortHead = head ? head.slice(0, 12) : "local";
  const dirty = Boolean(git(rootDir, ["status", "--porcelain", "--untracked-files=normal"]));
  const taggedCommit = git(rootDir, ["rev-parse", "-q", "--verify", `refs/tags/v${version}^{commit}`]);
  const release = !explicitBuildId && !dirty && Boolean(head) && taggedCommit === head;
  const baseLabel = explicitBuildId || shortHead;
  return {
    release,
    label: `${baseLabel}${dirty ? "-dirty" : ""}`
  };
}

function git(rootDir, args) {
  const result = spawnSync("git", ["-C", rootDir, ...args], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function sanitizeBuildId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
