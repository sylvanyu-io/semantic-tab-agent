import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, patchSettings, saveSettings } from "../src/core/controller.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import {
  createSettingsExport,
  DEFAULT_SETTINGS,
  GATEWAY_CUSTOM_MODEL_VALUE,
  GATEWAY_PROVIDER_MODES,
  GROUPING_GRANULARITIES,
  LANGUAGE_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  PROMPT_PRESETS,
  readSettingsImportPayload,
  THINKING_INTENSITIES,
  UNDO_TARGET_WINDOW_MODES
} from "../src/shared/settings.js";
import { normalizeSettings } from "../src/shared/settings.js";
import { resolveGatewayModel } from "../src/shared/settings.js";
import { resolveGatewayAuxiliaryModel } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("session-only page sampling consent is not persisted", async () => {
  const chrome = createFakeChrome();

  const returned = await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
  });
  assert.equal(returned.pageSamplingConsentMode, PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION);

  const loaded = await getSettings(chrome);
  assert.equal(loaded.pageSamplingConsentMode, PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED);
});

test("invalid selected target window ids normalize to null", () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, selectedTargetWindowId: "not-a-window" });
  assert.equal(settings.selectedTargetWindowId, null);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, selectedTargetWindowId: 0 }).selectedTargetWindowId, null);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, selectedTargetWindowId: -12 }).selectedTargetWindowId, null);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, selectedTargetWindowId: "42" }).selectedTargetWindowId, 42);
});

test("invalid undo target window mode falls back to conservative default", () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, undoTargetWindowMode: "close_anything" });
  assert.equal(settings.undoTargetWindowMode, UNDO_TARGET_WINDOW_MODES.LEAVE_EMPTY);
});

test("first-run privacy disclosure dismissal is persisted as a normal setting", async () => {
  const chrome = createFakeChrome();

  const saved = await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    privacyDisclosureDismissed: true
  });
  const loaded = await getSettings(chrome);

  assert.equal(saved.privacyDisclosureDismissed, true);
  assert.equal(loaded.privacyDisclosureDismissed, true);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, privacyDisclosureDismissed: "yes" }).privacyDisclosureDismissed, true);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, privacyDisclosureDismissed: "" }).privacyDisclosureDismissed, false);
});

test("concurrent settings patches preserve changes from different side panels", async () => {
  const chrome = createFakeChrome();

  await Promise.all([
    patchSettings(chrome, { promptPreset: PROMPT_PRESETS.MEDIA_TYPE }, ["promptPreset"]),
    patchSettings(chrome, { groupingGranularity: GROUPING_GRANULARITIES.DETAILED }, ["groupingGranularity"])
  ]);

  const loaded = await getSettings(chrome);
  assert.equal(loaded.promptPreset, PROMPT_PRESETS.MEDIA_TYPE);
  assert.equal(loaded.groupingGranularity, GROUPING_GRANULARITIES.DETAILED);
});

test("prompt presets accept media type and reject removed preset values", () => {
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, promptPreset: PROMPT_PRESETS.MEDIA_TYPE }).promptPreset,
    PROMPT_PRESETS.MEDIA_TYPE
  );
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, promptPreset: "platform_source" }).promptPreset, DEFAULT_SETTINGS.promptPreset);
});

test("grouping granularity accepts product values and rejects unknown values", () => {
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, groupingGranularity: GROUPING_GRANULARITIES.COMPACT }).groupingGranularity,
    GROUPING_GRANULARITIES.COMPACT
  );
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, groupingGranularity: "one_group_only" }).groupingGranularity, DEFAULT_SETTINGS.groupingGranularity);
});

test("blank numeric settings fall back instead of becoming zero", () => {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    minConfidenceToApply: "",
    maxTabsPerGroup: ""
  });

  assert.equal(settings.minConfidenceToApply, DEFAULT_SETTINGS.minConfidenceToApply);
  assert.equal(settings.maxTabsPerGroup, DEFAULT_SETTINGS.maxTabsPerGroup);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, minConfidenceToApply: "2" }).minConfidenceToApply, 1);
});

test("AI gateway settings normalize safely", () => {
  assert.equal(DEFAULT_SETTINGS.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(DEFAULT_SETTINGS.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(DEFAULT_SETTINGS.gatewayAuxiliaryModel, "same_as_primary");
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1/"
    }).gatewayBaseUrl,
    "http://127.0.0.1:8317/v1"
  );
  const legacyBuiltinProvider = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: "builtin",
    gatewayBaseUrl: "https://legacy-gateway.example.test/v1/",
    gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
    gatewayCustomModel: "deepseek-v4",
    gatewayCustomAuxiliaryModel: "glm-5.2",
    gatewayApiKey: "old-key",
    rememberProviderKeys: true
  });
  assert.equal(legacyBuiltinProvider.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(legacyBuiltinProvider.gatewayBaseUrl, "");
  assert.equal(legacyBuiltinProvider.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(legacyBuiltinProvider.gatewayCustomModel, "");
  assert.equal(legacyBuiltinProvider.gatewayCustomAuxiliaryModel, "");
  assert.equal(legacyBuiltinProvider.gatewayApiKey, "");
  assert.equal(legacyBuiltinProvider.rememberProviderKeys, false);
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
      gatewayBaseUrl: "https://api.openai.com/v1"
    }).gatewayBaseUrl,
    "https://api.openai.com/v1"
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "javascript:alert(1)" }).gatewayBaseUrl,
    ""
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "", gatewayApiKey: "old-key", rememberProviderKeys: true })
      .gatewayApiKey,
    ""
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "", gatewayApiKey: "old-key", rememberProviderKeys: true })
      .rememberProviderKeys,
    false
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayThinkingIntensity: "nope" }).gatewayThinkingIntensity,
    THINKING_INTENSITIES.HIGH
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayThinkingIntensity: THINKING_INTENSITIES.ULTRA }).gatewayThinkingIntensity,
    THINKING_INTENSITIES.ULTRA
  );
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, languageMode: "pirate" }).languageMode, LANGUAGE_MODES.AUTO);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, languageMode: LANGUAGE_MODES.EN_US }).languageMode, LANGUAGE_MODES.EN_US);
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: " glm-5.2\n "
    }).gatewayModel,
    GATEWAY_CUSTOM_MODEL_VALUE
  );
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: " glm-5.2\n "
    }).gatewayCustomModel,
    "glm-5.2"
  );
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      gatewayModel: "glm-5.2",
      gatewayCustomModel: ""
    }).gatewayModel,
    GATEWAY_CUSTOM_MODEL_VALUE
  );
  const manualCustomGateway = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayBaseUrl: "https://api.deepseek.com/v1",
    gatewayModel: "gpt-5.4",
    gatewayCustomModel: "deepseek-v4"
  });
  assert.equal(manualCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(manualCustomGateway.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(resolveGatewayModel(manualCustomGateway), "deepseek-v4");
  const baseOnlyCustomGateway = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayBaseUrl: "https://proxy.example.test/v1",
    gatewayModel: "gpt-5.4"
  });
  assert.equal(baseOnlyCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(baseOnlyCustomGateway.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(baseOnlyCustomGateway.gatewayCustomModel, "gpt-5.4");
  assert.equal(resolveGatewayModel(baseOnlyCustomGateway), "gpt-5.4");
  assert.equal(resolveGatewayAuxiliaryModel(baseOnlyCustomGateway), "gpt-5.4");
  const baseOnlyCustomGatewayWithAuxiliary = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayBaseUrl: "https://proxy.example.test/v1",
    gatewayModel: "gpt-5.4",
    gatewayCustomAuxiliaryModel: "glm-5.2"
  });
  assert.equal(baseOnlyCustomGatewayWithAuxiliary.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(baseOnlyCustomGatewayWithAuxiliary.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(resolveGatewayModel(baseOnlyCustomGatewayWithAuxiliary), "gpt-5.4");
  assert.equal(resolveGatewayAuxiliaryModel(baseOnlyCustomGatewayWithAuxiliary), "glm-5.2");
  const explicitCustomGateway = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayCustomModel: "glm-5.2"
  });
  assert.equal(explicitCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(resolveGatewayModel(explicitCustomGateway), "glm-5.2");
  assert.equal(explicitCustomGateway.gatewayAuxiliaryModel, "same_as_primary");
  assert.equal(resolveGatewayAuxiliaryModel(explicitCustomGateway), "glm-5.2");
  const explicitCustomGatewayWithAuxiliary = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayCustomModel: "glm-5.2",
    gatewayCustomAuxiliaryModel: "deepseek-v4"
  });
  assert.equal(resolveGatewayModel(explicitCustomGatewayWithAuxiliary), "glm-5.2");
  assert.equal(resolveGatewayAuxiliaryModel(explicitCustomGatewayWithAuxiliary), "deepseek-v4");
  const legacyBaseOnlyCustomGateway = normalizeSettings({
    gatewayBaseUrl: "https://legacy-proxy.example.test/v1",
    gatewayCustomModel: "deepseek-v4"
  });
  assert.equal(legacyBaseOnlyCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(legacyBaseOnlyCustomGateway.gatewayBaseUrl, "https://legacy-proxy.example.test/v1");
  assert.equal(resolveGatewayModel(legacyBaseOnlyCustomGateway), "deepseek-v4");
  const explicitBuiltinWithStaleCustomGateway = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: "builtin",
    gatewayBaseUrl: "https://stale-custom.example.test/v1",
    gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
    gatewayCustomModel: "deepseek-v4",
    gatewayCustomAuxiliaryModel: "glm-5.2",
    gatewayApiKey: "stale-key",
    rememberProviderKeys: true
  });
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayBaseUrl, "");
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayCustomModel, "");
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayCustomAuxiliaryModel, "");
  assert.equal(explicitBuiltinWithStaleCustomGateway.gatewayApiKey, "");
  assert.equal(explicitBuiltinWithStaleCustomGateway.rememberProviderKeys, false);
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayModel: "gpt-5.4" }).gatewayCustomModel, "gpt-5.4");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayModel: "gpt-5.4-mini" }).gatewayCustomModel, "gpt-5.4-mini");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "gpt-5.3-codex-spark" }).gatewayAuxiliaryModel, "same_as_primary");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "same_as_primary" }).gatewayAuxiliaryModel, "same_as_primary");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "unknown-helper" }).gatewayAuxiliaryModel, "same_as_primary");
});

test("gateway key is not persisted unless explicitly remembered", async () => {
  const chrome = createFakeChrome();

  await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayBaseUrl: "http://localhost:8317/v1",
    gatewayApiKey: "gateway-test-key",
    rememberProviderKeys: false
  });
  const transient = await getSettings(chrome);
  assert.equal(transient.gatewayApiKey, "");

  await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    gatewayBaseUrl: "http://localhost:8317/v1",
    gatewayApiKey: "gateway-test-key",
    rememberProviderKeys: true
  });
  const persisted = await getSettings(chrome);
  assert.equal(persisted.gatewayApiKey, "gateway-test-key");
});

test("settings export omits custom gateway secrets while keeping portable preferences", () => {
  const payload = createSettingsExport(
    {
      ...DEFAULT_SETTINGS,
      gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
      gatewayBaseUrl: "https://api.deepseek.com/v1",
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: "deepseek-v4",
      gatewayCustomAuxiliaryModel: "glm-5.2",
      gatewayApiKey: "secret-key-that-must-not-export",
      rememberProviderKeys: true,
      customPrompt: "把研究方向分开"
    },
    { now: "2026-07-06T08:00:00.000Z" }
  );

  assert.equal(payload.app, "TabRecap");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.exportedAt, "2026-07-06T08:00:00.000Z");
  assert.equal(payload.settings.gatewayBaseUrl, "https://api.deepseek.com/v1");
  assert.equal(payload.settings.gatewayCustomModel, "deepseek-v4");
  assert.equal(payload.settings.gatewayCustomAuxiliaryModel, "glm-5.2");
  assert.equal(payload.settings.customPrompt, "把研究方向分开");
  assert.equal(payload.settings.gatewayApiKey, "");
  assert.equal(payload.settings.rememberProviderKeys, false);
  assert.doesNotMatch(JSON.stringify(payload), /secret-key-that-must-not-export/);
});

test("settings import accepts wrapped or raw settings and always strips custom gateway secrets", () => {
  const imported = readSettingsImportPayload({
    app: "TabRecap",
    schemaVersion: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
      gatewayBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: "glm-5.2",
      gatewayCustomAuxiliaryModel: "glm-5.1",
      gatewayApiKey: "imported-secret",
      rememberProviderKeys: true,
      groupingGranularity: GROUPING_GRANULARITIES.DETAILED
    }
  });

  assert.equal(imported.gatewayBaseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(imported.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(imported.gatewayCustomModel, "glm-5.2");
  assert.equal(imported.gatewayCustomAuxiliaryModel, "glm-5.1");
  assert.equal(imported.groupingGranularity, GROUPING_GRANULARITIES.DETAILED);
  assert.equal(imported.gatewayApiKey, "");
  assert.equal(imported.rememberProviderKeys, false);

  const raw = readSettingsImportPayload({
    ...DEFAULT_SETTINGS,
    gatewayBaseUrl: "javascript:alert(1)",
    gatewayApiKey: "raw-secret",
    rememberProviderKeys: true,
    maxTabsPerGroup: "12"
  });
  assert.equal(raw.gatewayBaseUrl, "");
  assert.equal(raw.gatewayApiKey, "");
  assert.equal(raw.rememberProviderKeys, false);
  assert.equal(raw.maxTabsPerGroup, 12);
});

test("turning off continuous summaries preserves cached page summaries for recaps", async () => {
  const chrome = createFakeChrome();
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      cached: { sample: { visibleText: "private cached text" } }
    }
  };

  await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    continuousPageSummaries: false
  });

  assert.equal(chrome.__state.storage[STORAGE_KEYS.pageSummaryCache].entries.cached.sample.visibleText, "private cached text");
});
