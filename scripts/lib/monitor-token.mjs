import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MONITOR_TOKEN_FILE = join(homedir(), "Projects", "CLIProxyAPI", ".runtime-secrets", "cliproxy-monitor-token");

export function resolveMonitorToken(env = process.env) {
  const envToken = String(env.MONITOR_TOKEN || "").trim();
  if (envToken) return { token: envToken, source: "MONITOR_TOKEN" };

  const filePath = String(env.MONITOR_TOKEN_FILE || DEFAULT_MONITOR_TOKEN_FILE).trim();
  if (!filePath || !existsSync(filePath)) return { token: "", source: "", filePath };

  const fileToken = readFileSync(filePath, "utf8").trim();
  if (!fileToken) return { token: "", source: "", filePath };

  return { token: fileToken, source: env.MONITOR_TOKEN_FILE ? "MONITOR_TOKEN_FILE" : "default_token_file", filePath };
}

export function monitorTokenHelp() {
  return [
    "Set MONITOR_TOKEN or point MONITOR_TOKEN_FILE at the local runtime secret:",
    `  MONITOR_TOKEN_FILE="${DEFAULT_MONITOR_TOKEN_FILE}" npm run release:check:live`,
    "",
    "On this machine the default token file is used automatically when it exists:",
    "  npm run release:check:live"
  ].join("\n");
}
