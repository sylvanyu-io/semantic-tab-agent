import { analyzeTabs } from "../src/core/controller.js";
import { DEFAULT_SETTINGS, GATEWAY_CUSTOM_MODEL_VALUE, GATEWAY_PROVIDER_MODES, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "../tests/helpers/fake-chrome.mjs";

const key = process.env.GATEWAY_API_KEY || "";
const requestedBaseUrl = process.env.GATEWAY_BASE_URL || "";
const requestedModel = process.env.GATEWAY_MODEL || "";
if (!requestedBaseUrl || !requestedModel) {
  console.error("GATEWAY_BASE_URL and GATEWAY_MODEL are required. GATEWAY_API_KEY is optional.");
  process.exit(2);
}
const startedAt = performance.now();

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
  gatewayApiKey: key,
  gatewayBaseUrl: requestedBaseUrl,
  gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
  gatewayCustomModel: requestedModel,
  gatewayThinkingIntensity: process.env.GATEWAY_THINKING_INTENSITY || DEFAULT_SETTINGS.gatewayThinkingIntensity,
  customPrompt: "Prefer semantic topic grouping over domain grouping. Put uncertain tabs in Review."
};

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
      model: settings.gatewayCustomModel,
      thinkingIntensity: settings.gatewayThinkingIntensity,
      elapsedMs: Math.round(performance.now() - startedAt),
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
