import { BUILTIN_GATEWAY_BASE_URL } from "../../src/shared/settings.js";

const DEFAULT_REQUIRED_MONITOR_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function checkBuiltInGatewayService(options = {}) {
  const gatewayBaseUrl = options.gatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL;
  const configuredServiceBaseUrl = options.gatewayServiceBaseUrl || serviceBaseUrlFromGatewayBaseUrl(gatewayBaseUrl);
  const builtinServiceBaseUrl = serviceBaseUrlFromGatewayBaseUrl(options.builtinGatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const shouldCheckService =
    Boolean(options.forceServiceCheck) ||
    (!options.gatewayBaseUrlExplicit && gatewayBaseUrl === (options.builtinGatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL)) ||
    configuredServiceBaseUrl === builtinServiceBaseUrl;
  const requireMonitor = Boolean(options.requireMonitor);

  if (!shouldCheckService) {
    if (requireMonitor) throw new Error("Built-in gateway monitor check was required but service checks were skipped.");
    return { skipped: true, reason: "custom_gateway" };
  }

  const monitorToken = options.monitorToken || "";
  if (!monitorToken && requireMonitor) {
    throw new Error("Built-in gateway monitor check requires MONITOR_TOKEN or MONITOR_TOKEN_FILE.");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const healthz = await getJson(fetchImpl, `${configuredServiceBaseUrl}/healthz`);
  requireOk(healthz, "healthz");

  const readyz = await getJson(fetchImpl, `${configuredServiceBaseUrl}/readyz`);
  requireOk(readyz, "readyz");
  if (requireMonitor && readyz.json?.upstream?.code !== "ready") {
    throw new Error(`readyz upstream code is ${readyz.json?.upstream?.code || "unknown"}; expected ready.`);
  }

  const monitor = monitorToken ? await getJson(fetchImpl, `${configuredServiceBaseUrl}/monitor/status`, { "x-monitor-token": monitorToken }) : null;
  if (monitor) {
    requireOk(monitor, "monitor/status");
    if (monitor.json?.config?.stateStore !== "configured") throw new Error("monitor/status state store is not configured");
    if (monitor.json?.config?.email !== "configured") throw new Error(`monitor/status email is ${monitor.json?.config?.email || "unknown"}`);
    if (monitor.json?.config?.upstream !== "configured") throw new Error(`monitor/status upstream is ${monitor.json?.config?.upstream || "unknown"}`);
    const monitorStatus = monitor.json?.monitor?.status || "unknown";
    if (monitorStatus === "down" && requireMonitor) {
      throw new Error(
        `monitor/status reports down: readyz=${monitor.json?.monitor?.lastSummary?.readyzCode || "unknown"} llm=${
          monitor.json?.monitor?.lastSummary?.llmCode || "unknown"
        }`
      );
    }
    if (requireMonitor && monitorStatus !== "ok") {
      throw new Error(`monitor/status is ${monitorStatus}; the last scheduled monitor has not reported ok.`);
    }
    if (requireMonitor) {
      requireFreshMonitorStatus(monitor.json?.monitor?.lastStatusAt, {
        nowMs,
        maxAgeMs: positiveMs(options.maxMonitorAgeMs, DEFAULT_REQUIRED_MONITOR_MAX_AGE_MS)
      });
      requireHealthyMonitorSummary(monitor.json?.monitor?.lastSummary);
    }
  }

  return {
    skipped: false,
    baseUrl: configuredServiceBaseUrl,
    healthz: pickServiceCheck(healthz),
    readyz: {
      ...pickServiceCheck(readyz),
      upstreamCode: readyz.json?.upstream?.code || ""
    },
    monitor: monitor
      ? {
          ...pickServiceCheck(monitor),
          status: monitor.json?.monitor?.status || "unknown",
          lastStatusAt: monitor.json?.monitor?.lastStatusAt || "",
          lastStatusAgeMinutes: monitorStatusAgeMinutes(monitor.json?.monitor?.lastStatusAt, nowMs),
          readyzCode: monitor.json?.monitor?.lastSummary?.readyzCode || "",
          llmCode: monitor.json?.monitor?.lastSummary?.llmCode || "",
          email: monitor.json?.config?.email || "unknown"
        }
      : { skipped: true, reason: "MONITOR_TOKEN not set" }
  };
}

export function serviceBaseUrlFromGatewayBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function getJson(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, { headers });
  let json = null;
  let text = "";
  try {
    text = await response.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok && Boolean(json?.ok), status: response.status, json, text: text.slice(0, 160) };
}

function requireOk(check, name) {
  if (check.ok) return;
  throw new Error(`${name} failed with HTTP ${check.status}: ${check.text || "empty response"}`);
}

function pickServiceCheck(check) {
  return {
    ok: check.ok,
    status: check.status
  };
}

function requireFreshMonitorStatus(lastStatusAt, options) {
  const checkedAt = Date.parse(lastStatusAt || "");
  if (!Number.isFinite(checkedAt)) {
    throw new Error("monitor/status has no valid lastStatusAt; wait for the scheduled monitor to run.");
  }
  const ageMs = options.nowMs - checkedAt;
  if (ageMs < 0) return;
  if (ageMs > options.maxAgeMs) {
    const ageMinutes = Math.round(ageMs / 60000);
    const maxAgeMinutes = Math.round(options.maxAgeMs / 60000);
    throw new Error(`monitor/status is stale: last scheduled check was ${ageMinutes} minutes ago, max ${maxAgeMinutes} minutes.`);
  }
}

function monitorStatusAgeMinutes(lastStatusAt, nowMs) {
  const checkedAt = Date.parse(lastStatusAt || "");
  if (!Number.isFinite(checkedAt)) return null;
  return Math.round(Math.max(0, nowMs - checkedAt) / 60000);
}

function requireHealthyMonitorSummary(summary) {
  const readyzCode = summary?.readyzCode || "unknown";
  const llmCode = summary?.llmCode || "unknown";
  if (readyzCode !== "ready" || llmCode !== "llm_ready") {
    throw new Error(`monitor/status summary is not healthy: readyz=${readyzCode} llm=${llmCode}.`);
  }
}

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
