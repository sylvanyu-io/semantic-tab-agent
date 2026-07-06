import { analyzeTabs } from "../src/core/controller.js";
import { BUILTIN_GATEWAY_BASE_URL, DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "../tests/helpers/fake-chrome.mjs";
import { checkBuiltInGatewayService } from "./lib/gateway-smoke-service-checks.mjs";
import { resolveMonitorToken } from "./lib/monitor-token.mjs";

const key = process.env.GATEWAY_API_KEY || "";
const requestedBaseUrl = process.env.GATEWAY_BASE_URL || BUILTIN_GATEWAY_BASE_URL;
const monitorToken = resolveMonitorToken();

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  gatewayApiKey: key,
  gatewayBaseUrl: requestedBaseUrl,
  gatewayModel: process.env.GATEWAY_MODEL || DEFAULT_SETTINGS.gatewayModel,
  gatewayThinkingIntensity: process.env.GATEWAY_THINKING_INTENSITY || DEFAULT_SETTINGS.gatewayThinkingIntensity,
  customPrompt: "Prefer semantic topic grouping over domain grouping. Put uncertain tabs in Review."
};

const serviceChecks = await checkBuiltInGatewayService({
  gatewayBaseUrl: settings.gatewayBaseUrl,
  gatewayBaseUrlExplicit: Boolean(process.env.GATEWAY_BASE_URL),
  gatewayServiceBaseUrl: process.env.GATEWAY_SERVICE_BASE_URL || "",
  monitorToken: monitorToken.token,
  forceServiceCheck: process.env.GATEWAY_CHECK_SERVICE === "1"
});

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
