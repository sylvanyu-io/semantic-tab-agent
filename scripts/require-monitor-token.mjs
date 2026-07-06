const token = String(process.env.MONITOR_TOKEN || "").trim();

if (!token) {
  console.error("MONITOR_TOKEN is required for live release checks.");
  console.error("Load it from the local CLIProxyAPI runtime secret before running this gate:");
  console.error('  TOKEN="$(cat /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-secrets/cliproxy-monitor-token)"');
  console.error('  MONITOR_TOKEN="$TOKEN" npm run release:check:live');
  process.exit(1);
}
