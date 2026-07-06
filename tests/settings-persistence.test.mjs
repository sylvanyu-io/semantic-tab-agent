import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, saveSettings } from "../src/core/controller.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import {
  DEFAULT_SETTINGS,
  GATEWAY_CUSTOM_MODEL_VALUE,
  GATEWAY_PROVIDER_MODES,
  GROUPING_GRANULARITIES,
  LANGUAGE_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  PROMPT_PRESETS,
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
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "http://127.0.0.1:8317/v1/" }).gatewayBaseUrl,
    "http://127.0.0.1:8317/v1"
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "https://cliproxy.sylvanyu.io/v1/" }).gatewayBaseUrl,
    ""
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "https://api.openai.com/v1" }).gatewayBaseUrl,
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
      gatewayCustomModel: "glm-5.2"
    }).gatewayModel,
    DEFAULT_SETTINGS.gatewayModel
  );
  const manualCustomGateway = normalizeSettings({
    ...DEFAULT_SETTINGS,
    gatewayBaseUrl: "https://api.deepseek.com/v1",
    gatewayModel: "gpt-5.4",
    gatewayCustomModel: "deepseek-v4"
  });
  assert.equal(manualCustomGateway.gatewayProviderMode, GATEWAY_PROVIDER_MODES.CUSTOM);
  assert.equal(manualCustomGateway.gatewayModel, GATEWAY_CUSTOM_MODEL_VALUE);
  assert.equal(resolveGatewayModel(manualCustomGateway), "deepseek-v4");
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
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayModel: "gpt-5.4" }).gatewayModel, "gpt-5.4");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayModel: "gpt-5.4-mini" }).gatewayModel, "gpt-5.4-mini");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "gpt-5.3-codex-spark" }).gatewayAuxiliaryModel, "gpt-5.3-codex-spark");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "same_as_primary" }).gatewayAuxiliaryModel, "same_as_primary");
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, gatewayAuxiliaryModel: "unknown-helper" }).gatewayAuxiliaryModel, DEFAULT_SETTINGS.gatewayAuxiliaryModel);
});

test("gateway key is not persisted unless explicitly remembered", async () => {
  const chrome = createFakeChrome();

  await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    gatewayBaseUrl: "http://localhost:8317/v1",
    gatewayApiKey: "gateway-test-key",
    rememberProviderKeys: false
  });
  const transient = await getSettings(chrome);
  assert.equal(transient.gatewayApiKey, "");

  await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    gatewayBaseUrl: "http://localhost:8317/v1",
    gatewayApiKey: "gateway-test-key",
    rememberProviderKeys: true
  });
  const persisted = await getSettings(chrome);
  assert.equal(persisted.gatewayApiKey, "gateway-test-key");
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
