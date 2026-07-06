import { monitorTokenHelp, resolveMonitorToken } from "./lib/monitor-token.mjs";

const token = resolveMonitorToken();

if (!token.token) {
  console.error("MONITOR_TOKEN is required for live release checks.");
  console.error(monitorTokenHelp());
  process.exit(1);
}
