import { analyzeTabs } from "../src/core/controller.js";
import { BUILTIN_GATEWAY_BASE_URL, DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "../tests/helpers/fake-chrome.mjs";

const key = process.env.GATEWAY_API_KEY || "";
const requestedBaseUrl = process.env.GATEWAY_BASE_URL || BUILTIN_GATEWAY_BASE_URL;

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  gatewayApiKey: key,
  gatewayBaseUrl: requestedBaseUrl,
  gatewayModel: process.env.GATEWAY_MODEL || DEFAULT_SETTINGS.gatewayModel,
  gatewayThinkingIntensity: process.env.GATEWAY_THINKING_INTENSITY || DEFAULT_SETTINGS.gatewayThinkingIntensity,
  customPrompt: "Prefer semantic topic grouping over domain grouping. Put uncertain tabs in Review."
};

const serviceChecks = await checkBuiltInGatewayService(settings.gatewayBaseUrl);

const chrome = createFakeChrome({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        { id: 10, title: "Structured output docs", url: "https://developers.openai.com/api/docs/guides/structured-outputs", active: true },
        { id: 11, title: "Chrome tabGroups API", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" },
        { id: 12, title: "JSON Output docs", url: "https://example.com/json-output" },
        { id: 13, title: "GitHub pull request review", url: "https://github.com/example/project/pull/42" }
      ]
    }
  ]
});

const job = await analyzeTabs(chrome, settings, { windowId: 1 });

console.log(
  JSON.stringify(
    {
      provider: "gateway",
      baseUrl: settings.gatewayBaseUrl,
      model: settings.gatewayModel,
      thinkingIntensity: settings.gatewayThinkingIntensity,
      serviceChecks,
      validation: job.validation,
      preview: {
        groups: job.preview.groups,
        reviewTabsCount: job.preview.reviewTabsCount,
        excludedTabsCount: job.preview.excludedTabsCount,
        warnings: job.preview.warnings
      }
    },
    null,
    2
  )
);

process.exit(job.validation.ok ? 0 : 1);

async function checkBuiltInGatewayService(baseUrl) {
  const configuredServiceBaseUrl = process.env.GATEWAY_SERVICE_BASE_URL || serviceBaseUrlFromGatewayBaseUrl(baseUrl);
  const shouldCheckService =
    process.env.GATEWAY_CHECK_SERVICE === "1" ||
    (!process.env.GATEWAY_BASE_URL && baseUrl === BUILTIN_GATEWAY_BASE_URL) ||
    configuredServiceBaseUrl === serviceBaseUrlFromGatewayBaseUrl(BUILTIN_GATEWAY_BASE_URL);

  if (!shouldCheckService) {
    return { skipped: true, reason: "custom_gateway" };
  }

  const healthz = await getJson(`${configuredServiceBaseUrl}/healthz`);
  requireOk(healthz, "healthz");

  const readyz = await getJson(`${configuredServiceBaseUrl}/readyz`);
  requireOk(readyz, "readyz");

  const monitorToken = process.env.MONITOR_TOKEN || "";
  const monitor = monitorToken ? await getJson(`${configuredServiceBaseUrl}/monitor/status`, { "x-monitor-token": monitorToken }) : null;
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

function serviceBaseUrlFromGatewayBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
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
