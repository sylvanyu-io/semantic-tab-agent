import { BUILTIN_GATEWAY_BASE_URL } from "../../src/shared/settings.js";

export async function checkBuiltInGatewayService(options = {}) {
  const gatewayBaseUrl = options.gatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL;
  const configuredServiceBaseUrl = options.gatewayServiceBaseUrl || serviceBaseUrlFromGatewayBaseUrl(gatewayBaseUrl);
  const builtinServiceBaseUrl = serviceBaseUrlFromGatewayBaseUrl(options.builtinGatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL);
  const shouldCheckService =
    Boolean(options.forceServiceCheck) ||
    (!options.gatewayBaseUrlExplicit && gatewayBaseUrl === (options.builtinGatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL)) ||
    configuredServiceBaseUrl === builtinServiceBaseUrl;

  if (!shouldCheckService) {
    return { skipped: true, reason: "custom_gateway" };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const healthz = await getJson(fetchImpl, `${configuredServiceBaseUrl}/healthz`);
  requireOk(healthz, "healthz");

  const readyz = await getJson(fetchImpl, `${configuredServiceBaseUrl}/readyz`);
  requireOk(readyz, "readyz");

  const monitorToken = options.monitorToken || "";
  const monitor = monitorToken ? await getJson(fetchImpl, `${configuredServiceBaseUrl}/monitor/status`, { "x-monitor-token": monitorToken }) : null;
  if (monitor) {
    requireOk(monitor, "monitor/status");
    if (monitor.json?.config?.stateStore !== "configured") throw new Error("monitor/status state store is not configured");
    if (monitor.json?.config?.email !== "configured") throw new Error(`monitor/status email is ${monitor.json?.config?.email || "unknown"}`);
    if (monitor.json?.config?.upstream !== "configured") throw new Error(`monitor/status upstream is ${monitor.json?.config?.upstream || "unknown"}`);
    if (monitor.json?.monitor?.status === "down") {
      throw new Error(
        `monitor/status reports down: readyz=${monitor.json?.monitor?.lastSummary?.readyzCode || "unknown"} llm=${
          monitor.json?.monitor?.lastSummary?.llmCode || "unknown"
        }`
      );
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
