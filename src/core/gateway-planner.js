import {
  BUILTIN_GATEWAY_BASE_URL,
  GROUPING_GRANULARITIES,
  ORGANIZE_MODES,
  PROMPT_PRESET_TEXT,
  PROMPT_PRESETS,
  REVIEW_GROUP_MODES,
  TARGET_WINDOW_MODES,
  THINKING_INTENSITIES,
  URL_PRIVACY_MODES,
  isCustomGatewayProvider,
  normalizeSettings,
  resolveGatewayAuxiliaryModel,
  resolveGatewayModel
} from "../shared/settings.js";
import { languageInstruction, localizedText, targetWindowTitle } from "../shared/language.js";
import { MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING, normalizeModelProductText } from "../shared/model-copy.js";
import { redactSensitiveText } from "../shared/redaction.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { ACTION_PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { CHROME_GROUP_COLORS } from "./plan-validator.js";

const REFINE_BUCKET_MIN_TABS = 50;
const HIERARCHICAL_MIN_TABS = 50;
const REFINE_MAX_TABS_PER_REQUEST = 80;
const REFINE_CONFIDENCE_BELOW = 0.78;
const REFINE_TITLE_CLUSTER_MIN_TABS = 12;
const REFINE_TITLE_CLUSTER_MIN_CLUSTERS = 3;
const REFINE_TITLE_CLUSTER_MIN_CLUSTER_SIZE = 2;
const REFINE_TITLE_CLUSTER_DOMINANCE_ABOVE = 0.75;
const REFINE_DEFAULT_CONCURRENCY = 3;
const REFINE_MAX_CONCURRENCY = 5;
const COARSE_MAX_BUCKETS = 24;
const GATEWAY_MAX_OUTPUT_TOKENS = 8192;
const GATEWAY_ERROR_DETAIL_MAX_LENGTH = 240;
const SPLIT_CLEANUP_MIN_TABS = 20;
const CLEANUP_CANDIDATE_MIN_LIMIT = 20;
const CLEANUP_CANDIDATE_MAX_LIMIT = 200;
const WINDOW_FIELDS = Object.freeze(["id", "type", "focused", "incognito", "tabCount"]);
const TAB_FIELDS = Object.freeze([
  "id",
  "windowId",
  "index",
  "sequenceIndex",
  "title",
  "hostname",
  "sanitizedUrl",
  "urlKind",
  "audible",
  "discarded",
  "sampleable",
  "existingGroup",
  "pageSample"
]);
const PAGE_SAMPLE_FIELDS = Object.freeze(["status", "title", "metaDescription", "language", "contentKind", "headings", "visibleText", "reason"]);
const PAGE_SAMPLE_SIGNAL_FIELDS = Object.freeze(["id", "contentKind", "title", "headings", "summary"]);
const ACTIVATION_FLOW_ACTIVITY_FIELDS = Object.freeze([
  "id",
  "activeCount",
  "totalActiveSeconds",
  "maxActiveSeconds",
  "lastActivatedAt",
  "appearedInRuns",
  "returnedToCount",
  "nearbyIds"
]);
const ACTIVATION_FLOW_RUN_FIELDS = Object.freeze(["windowId", "startedAt", "endedAt", "ids", "dwellSeconds", "returnToId", "repeatedIds"]);
const ACTIVATION_FLOW_TRANSITION_FIELDS = Object.freeze([
  "fromId",
  "toId",
  "count",
  "avgDwellSeconds",
  "maxDwellSeconds",
  "lastAt",
  "clues"
]);
const ACTIVATION_FLOW_EVIDENCE_FIELDS = Object.freeze(["ids", "strength", "count", "lastAt", "clues"]);
const EXCLUDED_FIELDS = Object.freeze(["id", "windowId", "reason"]);
const LOCKED_GROUP_FIELDS = Object.freeze(["id", "windowId", "title", "color", "collapsed", "tabIds"]);
const PAGE_SAMPLE_RESULT_FIELDS = Object.freeze(["id", "windowId", "status", "origin", "reason"]);

export async function createGatewayPlan(inventory, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  if (shouldUseHierarchicalPlanner(inventory, settings, options)) {
    return createHierarchicalGatewayPlan(inventory, settings, fetchImpl, options);
  }

  if (shouldUseSplitCleanupPlanner(inventory, settings, options)) {
    return createSingleGatewayPlanWithAuxiliaryCleanup(inventory, settings, fetchImpl, options);
  }

  return createSingleGatewayPlan(inventory, settings, fetchImpl, options);
}

async function createSingleGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 45, message: "正在请求 AI 规划" });
  }
  const body = {
    model: requireGatewayModel(settings),
    messages: [
      { role: "system", content: buildPlannerSystemPrompt(settings) },
      { role: "user", content: buildGatewayUserPrompt(inventory, settings, options) }
    ],
    max_tokens: 8192
  };
  attachJsonResponseFormat(body, settings);
  applyThinkingIntensity(body, settings, options.thinkingIntensity || settings.gatewayThinkingIntensity);

  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }

  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 82, message: "正在整理可执行方案" });
  }
  return parsePlanFromGatewayResponse(data, inventory, settings, options);
}

async function createSingleGatewayPlanWithAuxiliaryCleanup(inventory, settings, fetchImpl, options = {}) {
  const groupingSettings = { ...settings, analyzeCleanup: false };
  const plan = await createSingleGatewayPlan(inventory, groupingSettings, fetchImpl, options);
  await emitProgress(options, { phase: "cleanup_planning", progress: 84, message: "正在排序清理清单" });
  const cleanup = await createCleanupGatewayAnalysisWithFallback(inventory, settings, fetchImpl, options, plan.groups, plan.reviewTabs, []);
  return { ...plan, cleanup };
}

async function createHierarchicalGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  await emitProgress(options, { phase: "coarse_planning", progress: 42, message: "正在快速粗分标签页" });
  const coarse = await createCoarseGatewayBuckets(inventory, settings, fetchImpl, options);
  await emitProgress(options, {
    phase: "coarse_planning",
    progress: 55,
    message: `已找到 ${coarse.buckets.length} 个主题方向`
  });
  const finalGroups = [];
  const finalReviewTabs = [];
  const cleanupCandidates = [];
  const cleanupSeen = new Set();
  const seen = new Set();
  const refinementTasks = [];
  const refinementTotal = countRefinementRequests(coarse, settings, options);
  let refinementDone = 0;

  for (const bucket of coarse.buckets) {
    if (shouldRefineBucket(bucket, settings, options)) {
      refinementTasks.push(...refinementTasksForBucket(bucket, settings, options));
    } else if (bucket.confidence >= settings.minConfidenceToApply) {
      mergePlanParts([bucketToGroup(bucket)], [], { finalGroups, finalReviewTabs, seen, settings });
    } else {
      mergePlanParts(
        [],
        bucket.tabRefs.map((ref) => ({
          ...ref,
          reason: localizedText(settings.languageMode, `粗分主题「${bucket.title}」置信度不足。`, `Low-confidence coarse bucket: ${bucket.title}.`)
        })),
        { finalGroups, finalReviewTabs, seen, settings }
      );
    }
  }

  if (coarse.reviewTabs.length) {
    const reviewBucket = {
      groupKey: "coarse-review",
      title: localizedText(settings.languageMode, "待分类", "Review"),
      color: "grey",
      confidence: 0.5,
      tabRefs: coarse.reviewTabs,
      reason: localizedText(settings.languageMode, "粗分阶段认为这些标签页仍不确定。", "Coarse pass left these tabs uncertain.")
    };
    refinementTasks.push(...refinementTasksForBucket(reviewBucket, settings, options));
  }

  const refinedResults = await mapWithConcurrency(refinementTasks, refinementConcurrency(options), async (task) => {
    throwIfAborted(options.signal);
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: task.messageStart
    });
    const refined = await refineBucket(task.bucket, inventory, settings, fetchImpl, options);
    refinementDone += 1;
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: task.messageDone
    });
    return refined;
  });

  for (const refined of refinedResults) {
    mergePlanParts(refined.groups, refined.reviewTabs, { finalGroups, finalReviewTabs, seen, settings });
    mergeCleanupPart(refined.cleanup, { cleanupCandidates, cleanupSeen });
  }

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      finalReviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "分层规划没有稳定归类这个标签页。", "Hierarchical planner did not assign this tab.")
      });
      seen.add(tab.tabId);
    }
  }

  await emitProgress(options, { phase: "building_plan", progress: 86, message: "正在合并精分结果" });
  let cleanup = null;
  if (settings.analyzeCleanup) {
    await emitProgress(options, { phase: "cleanup_planning", progress: 88, message: "正在排序清理清单" });
    cleanup = await createCleanupGatewayAnalysisWithFallback(
      inventory,
      settings,
      fetchImpl,
      options,
      finalGroups,
      finalReviewTabs,
      cleanupCandidates
    );
  }
  return buildActionPlan(finalGroups, finalReviewTabs, inventory, settings, cleanup);
}

export function gatewayChatCompletionsUrl(settings) {
  const baseUrl = effectiveGatewayBaseUrl(settings);
  if (!baseUrl) {
    throw new Error(localizedText(settings.languageMode, "请先填写自定义 API 地址。", "Enter a custom API URL first."));
  }
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function effectiveGatewayBaseUrl(settings) {
  return isCustomGatewayProvider(settings) ? settings.gatewayBaseUrl : BUILTIN_GATEWAY_BASE_URL;
}

export function requireGatewayModel(settings) {
  const model = resolveGatewayModel(settings);
  if (!model) {
    throw new Error(
      localizedText(
        settings.languageMode,
        "请填写自定义模型名。",
        "Enter a custom model name."
      )
    );
  }
  return model;
}

function requireGatewayAuxiliaryModel(settings) {
  return resolveGatewayAuxiliaryModel(settings) || requireGatewayModel(settings);
}

export function gatewayHeaders(settings, requestMeta = {}) {
  const headers = { "content-type": "application/json" };
  if (isCustomGatewayProvider(settings) && settings.gatewayApiKey) {
    headers.authorization = `Bearer ${settings.gatewayApiKey}`;
  }
  if (requestMeta.requestId) {
    headers["x-tab-recap-request-id"] = requestMeta.requestId;
  }
  if (!isCustomGatewayProvider(settings) && requestMeta.installId) {
    headers["x-tab-recap-install-id"] = requestMeta.installId;
  }
  if (!isCustomGatewayProvider(settings) && requestMeta.hasPageSamples) {
    headers["x-tab-recap-page-summary"] = "1";
  }
  return headers;
}

export function gatewayRequestMeta(inventory, options = {}) {
  return {
    installId: options.installId || "",
    requestId: options.operationId || options.requestId || "",
    hasPageSamples: (inventory.pageSamples || []).some((sample) => sample.status === "ok")
  };
}

export function attachJsonResponseFormat(body, settings) {
  if (shouldRequestJsonResponseFormat(settings)) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

export function shouldRequestJsonResponseFormat(settings) {
  return !usesCustomCompatibleGateway(settings);
}

export async function testGatewayConnection(rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }
  if (!isCustomGatewayProvider(settings) || !settings.gatewayBaseUrl) {
    throw new Error(localizedText(settings.languageMode, "请先填写自定义 API 地址。", "Enter a custom API URL first."));
  }

  const model = requireGatewayModel(settings);
  const auxiliaryModel = requireGatewayAuxiliaryModel(settings);
  const modelsToTest = [...new Set([model, auxiliaryModel].filter(Boolean))];
  let lastStatus = 0;
  for (const testModel of modelsToTest) {
    const body = {
      model: testModel,
      messages: [{ role: "user", content: "Reply with ok." }],
      max_tokens: 8
    };
    let response;
    let data;
    try {
      ({ response, data } = await fetchJsonWithTimeout(
        fetchImpl,
        gatewayChatCompletionsUrl(settings),
        {
          method: "POST",
          headers: gatewayHeaders(settings, { requestId: options.requestId || "" }),
          body: JSON.stringify(body)
        },
        "AI gateway connection test",
        options.timeoutMs ?? 15_000,
        options.signal
      ));
    } catch (error) {
      throw new Error(gatewayConnectionErrorMessage(error, settings));
    }
    lastStatus = response.status;
    if (!response.ok) {
      throw new Error(gatewayErrorMessage(response, data, settings));
    }
  }
  return {
    ok: true,
    status: lastStatus || 200,
    model,
    auxiliaryModel,
    baseUrl: effectiveGatewayBaseUrl(settings)
  };
}

function gatewayConnectionErrorMessage(error, settings) {
  const message = sanitizeGatewayErrorDetail(error?.message || error || "");
  const isCustomProvider = isCustomGatewayProvider(settings);
  if (/was canceled|aborted|cancel/i.test(message)) {
    return localizedText(settings.languageMode, "连接测试已取消。", "Connection test was canceled.");
  }
  if (/timed out/i.test(message)) {
    return isCustomProvider
      ? localizedText(
          settings.languageMode,
          "自定义 API 连接超时。请检查地址、模型名、密钥或上游服务后重试。",
          "The custom API connection timed out. Check the URL, model name, key, or upstream service and try again."
        )
      : localizedText(
          settings.languageMode,
          "默认 AI 服务连接超时。请稍后重试。",
          "The default AI service connection timed out. Try again later."
        );
  }
  return isCustomProvider
    ? localizedText(
        settings.languageMode,
        "自定义 API 暂时连不上。请检查地址、模型名、密钥或上游服务后重试。",
        "The custom API is not reachable right now. Check the URL, model name, key, or upstream service and try again."
      )
    : localizedText(settings.languageMode, "默认 AI 服务暂时不可用。请稍后重试。", "The default AI service is temporarily unavailable. Try again later.");
}

export function gatewayErrorMessage(response, data, settings) {
  const rawProviderMessage = extractProviderErrorMessage(data);
  const providerMessage = sanitizeGatewayErrorDetail(rawProviderMessage);
  const requestId = extractGatewayRequestId(response, data);
  const suffix = gatewayRequestIdSuffix(settings, requestId);
  const isCustomProvider = isCustomGatewayProvider(settings);
  if (response.status === 401 || response.status === 403) {
    return isCustomProvider
      ? `${localizedText(
          settings.languageMode,
          "AI 服务拒绝访问。请检查自定义网关地址和密钥。",
          "The AI service rejected access. Check the custom gateway URL and key."
        )}${suffix}`
      : `${localizedText(
          settings.languageMode,
          "默认 AI 服务拒绝访问。请稍后重试，或在更多选项里切换自定义网关。",
          "The default AI service rejected access. Try again later, or switch to a custom gateway in More options."
        )}${suffix}`;
  }
  if (isModelNotAllowedError(data, rawProviderMessage)) {
    return isCustomProvider
      ? `${localizedText(
          settings.languageMode,
          "自定义 API 不支持这个模型。请检查模型名，或先点「测试连接」。",
          "The custom API does not support this model. Check the model name or run Test connection first."
        )}${suffix}`
      : `${localizedText(
          settings.languageMode,
          "默认 AI 服务暂时不支持这个模型。请稍后再试，或在更多选项里切换模型。",
          "The default AI service does not support this model right now. Try again later, or switch models in More options."
        )}${suffix}`;
  }
  if (isLocalOriginOffline(response, rawProviderMessage, data)) {
    return isCustomProvider
      ? `${localizedText(
          settings.languageMode,
          "自定义 AI 网关的本地源站暂时离线。请检查本机服务、Cloudflare Tunnel 和上游模型。",
          "The custom AI gateway local origin is offline. Check the local service, Cloudflare Tunnel, and upstream model."
        )}${suffix}`
      : `${localizedText(
          settings.languageMode,
          "默认 AI 服务的本地源站暂时离线。请稍后再试；如果一直失败，说明本机网关或 Cloudflare Tunnel 需要恢复。",
          "The default AI service local origin is offline. Try again later; if it keeps failing, the local gateway or Cloudflare Tunnel needs recovery."
        )}${suffix}`;
  }
  if (isGatewayInfrastructureError(response, rawProviderMessage)) {
    return isCustomProvider
      ? `${localizedText(
          settings.languageMode,
          "自定义 AI 网关暂时连不上。请检查网关地址、隧道或上游服务是否在线。",
          "The custom AI gateway is not reachable right now. Check the gateway URL, tunnel, or upstream service."
        )}${suffix}`
      : `${localizedText(
          settings.languageMode,
          "默认 AI 服务暂时不可用。请稍后再试，或在更多选项里临时切换自定义 AI 网关。",
          "The default AI service is temporarily unavailable. Try again later, or temporarily switch to a custom AI gateway in More options."
        )}${suffix}`;
  }
  if (isCustomProvider) {
    return providerMessage
      ? `${localizedText(
          settings.languageMode,
          `自定义 AI 网关这次没有完成请求（${response.status}）。`,
          `The custom AI gateway did not complete this request (${response.status}). `
        )}${providerMessage}${suffix}`
      : `${localizedText(
          settings.languageMode,
          `自定义 AI 网关这次没有完成请求（${response.status}）。请检查网关服务后重试。`,
          `The custom AI gateway did not complete this request (${response.status}). Check the gateway service and try again.`
        )}${suffix}`;
  }
  return providerMessage
    ? `${localizedText(
        settings.languageMode,
        "默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。",
        "The default AI service did not complete this request. Try again later, or temporarily switch to a custom AI gateway in More options."
      )}${suffix}`
    : `${localizedText(
        settings.languageMode,
        "默认 AI 服务这次没有成功响应。请稍后再试，或在更多选项里临时切换自定义 AI 网关。",
        "The default AI service did not respond successfully. Try again later, or temporarily switch to a custom AI gateway in More options."
      )}${suffix}`;
}

function extractProviderErrorMessage(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.error === "string") return data.error.trim();
  if (typeof data.error?.message === "string") return data.error.message.trim();
  if (typeof data.message === "string") return data.message.trim();
  return "";
}

function gatewayRequestIdSuffix(settings, requestId) {
  if (!requestId) return "";
  return localizedText(settings.languageMode, `（请求号 ${requestId}）`, ` (request id ${requestId})`);
}

function sanitizeGatewayErrorDetail(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return truncateGatewayErrorDetail(redactSensitiveText(text, { redactUrls: true }));
}

function truncateGatewayErrorDetail(text) {
  const value = String(text || "");
  if (value.length <= GATEWAY_ERROR_DETAIL_MAX_LENGTH) return value;
  return `${value.slice(0, GATEWAY_ERROR_DETAIL_MAX_LENGTH - 3).trimEnd()}...`;
}

function extractGatewayRequestId(response, data) {
  const fromBody = data?.error?.requestId || data?.requestId || "";
  const fromHeader = response?.headers?.get?.("x-tab-recap-request-id") || "";
  return String(fromBody || fromHeader || "").slice(0, 96);
}

function isModelNotAllowedError(data, providerMessage) {
  const code = String(data?.error?.code || data?.code || data?.error?.upstreamCode || data?.upstreamCode || "");
  const text = `${providerMessage || ""} ${code}`.toLowerCase();
  return /model_not_allowed|planner_model_not_allowed|recap_model_not_allowed|model.*not available|not available.*model|unsupported.*model|model.*unsupported|不支持.*模型/.test(
    text
  );
}

function isLocalOriginOffline(response, providerMessage, data) {
  const code = String(data?.error?.code || data?.error?.upstreamCode || data?.upstreamCode || "");
  const text = `${providerMessage} ${code}`.toLowerCase();
  return (
    /origin_tunnel_unavailable|origin_cloudflare_error|origin_fetch_failed|1033|cloudflare tunnel|local .*origin|源站.*离线|tunnel/i.test(text) ||
    Number(response?.status) === 530
  );
}

function isGatewayInfrastructureError(response, providerMessage) {
  const message = String(providerMessage || "");
  return (
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504 ||
    (response.status === 530 && /1033|cloudflare|argo|tunnel/i.test(message)) ||
    /cloudflare tunnel|argo tunnel|error code:\s*1033/i.test(message)
  );
}

export function buildPlannerSystemPrompt(settings) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const customPrompt = settings.customPrompt.trim();
  const thinkingText = thinkingIntensityText(settings.gatewayThinkingIntensity);
  const requiredShape = JSON.stringify(exampleCompactPlan(settings));

  return [
    "This is a software engineering task: produce the planning JSON used by a Chrome extension runtime.",
    "You are a JSON-only planner for a Chrome tab organization extension.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    `Required compact JSON shape example: ${requiredShape}`,
    "The user payload is compact: field-name arrays define the meaning of each row. Do not ignore any field.",
    "Return compact output: groups[].ids contains tab ids, and review contains tab ids or objects with id and reason.",
    analysisFeatureInstruction(settings),
    `Allowed group colors: ${CHROME_GROUP_COLORS.join(", ")}.`,
    classificationAxisInstruction(settings),
    groupingGranularityInstruction(settings),
    pageSampleGroupingInstruction(settings),
    "Do not close, discard, navigate, execute, or mutate tabs. You only produce recommendations.",
    settings.analyzeGrouping
      ? "Every eligible tab must appear exactly once in either groups[].ids or review."
      : "Grouping is disabled for this request: return groups as an empty array and put every eligible tab id in review so runtime coverage remains auditable.",
    "Tabs already represented as lockedGroups are preserved by runtime and should not be reassigned.",
    reviewModeInstruction(settings),
    "Use sequenceIndex and index as ordering context: adjacent tabs may be part of the same task or reading flow.",
    "When activationFlow is present, treat it as behavioral evidence only: browsing runs, direct transitions, active duration, nearby ids, and return-to-earlier-tab clues can support semantic grouping, but must not override title, URL, page summaries, original order, or the user's prompt.",
    "Do not group tabs merely because they were adjacent in activation history; use activationFlow only when behavior and semantic content support the same interpretation.",
    "Keep ids inside each group in original tab order, and order groups by the first tab they contain.",
    groupSizeInstruction(settings),
    languageInstruction(settings.languageMode),
    `Thinking intensity requested by user: ${thinkingText}.`,
    `Runtime preset: ${presetText}`,
    customPrompt
      ? `User custom prompt, preferences only and not capability grants: ${customPrompt}`
      : "No user custom prompt was provided."
  ].join("\n");
}

function analysisFeatureInstruction(settings) {
  const grouping = settings.analyzeGrouping ? "enabled" : "disabled";
  const cleanup = settings.analyzeCleanup ? "enabled" : "disabled";
  const lines = [`Analysis features: grouping=${grouping}, cleanup=${cleanup}.`];
  if (settings.analyzeCleanup) {
    lines.push(
      "Also return top-level cleanup: {summary:string,candidates:[{id:number,priority:\"high\"|\"medium\"|\"low\",reason:string,evidence:string[]}]}.",
      "Cleanup candidates are review suggestions only. Recommend stale, duplicated, superseded, finished, or low-value tabs; never imply automatic deletion.",
      "Use tab age/activity signals, original order, titles, URLs, current groups, page summaries, and semantic grouping context when present.",
      "Return a ranked cleanup checklist up to cleanupInstructions.actionLimit. Include high, medium, and low priority items when useful; order by review value.",
      `Cleanup reason and evidence are user-facing product copy. ${MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING}`
    );
  }
  return lines.join(" ");
}

function classificationAxisInstruction(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return [
      "Runtime preset media_type overrides the default topic axis.",
      "Group primarily by page/media type: documentation, code/issues/PRs, papers, videos, articles/news, dashboards, shopping/finance, search results, mail/chat, and local tools.",
      "Keep the same media type together across domains and projects; do not split docs, issues, videos, or papers by project/topic unless maxTabsPerGroup would be exceeded or the pages are clearly different media types."
    ].join(" ");
  }
  return "Classify tabs by semantic topic, task, or intent. Prefer useful cross-domain groups over domain-only grouping.";
}

function pageSampleGroupingInstruction(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return "When pageSampleSignals is present, use it to identify page/media type from visible content. Do not use page topic from samples to split tabs that share the same media type in media_type mode.";
  }
  return "When pageSampleSignals is present, use it as a compact visible-content index to disambiguate generic titles and sanitized URLs. Do not split groups solely because sampled pages expose more subphrases.";
}

function groupSizeInstruction(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return "Do not create unrelated generic catch-all groups. In media_type mode, a documentation, issue/PR, paper, video, article, dashboard, shopping/finance, search, mail/chat, or local-tool group is an intentional group, not a catch-all; split only when maxTabsPerGroup would be exceeded or the pages are clearly different media types.";
  }
  if (settings.groupingGranularity === GROUPING_GRANULARITIES.COMPACT) {
    return "Prefer fewer practical groups. Merge adjacent or semantically related small topics. Avoid singleton or 2-tab groups unless the tabs are clearly unrelated to every nearby group. Never exceed maxTabsPerGroup.";
  }
  if (settings.groupingGranularity === GROUPING_GRANULARITIES.DETAILED) {
    return "Use detailed groups when subtopics or task runs are clearly distinct. Small groups are acceptable when they preserve a real user task. Never exceed maxTabsPerGroup.";
  }
  return "Prefer practical medium-sized groups, but do not merge clearly different tasks, artifact types, or research topics just to reduce group count. Merge tiny adjacent fragments only when they share the same user intent. Never exceed maxTabsPerGroup.";
}

function groupingGranularityInstruction(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return "Grouping granularity still applies, but the media/page type axis is primary.";
  }
  if (settings.groupingGranularity === GROUPING_GRANULARITIES.COMPACT) {
    return "Grouping granularity: compact. Optimize for fewer groups a normal user can scan quickly; preserve accuracy by using Review for genuinely ambiguous tabs rather than creating many tiny groups.";
  }
  if (settings.groupingGranularity === GROUPING_GRANULARITIES.DETAILED) {
    return "Grouping granularity: detailed. Optimize for precise task boundaries while still avoiding domain-only groups.";
  }
  return "Grouping granularity: balanced. Prefer a moderate set of useful topic/task groups; reduce noisy fragments without collapsing distinct subjects into broad workbench buckets.";
}

function coarseClassificationAxisInstruction(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return "Use broad media-type buckets first: documentation, issues/PRs, papers, videos, articles/news, dashboards, shopping/finance, search, mail/chat, and local tools. Do not split those buckets by domain or project during the coarse pass.";
  }
  if (settings.groupingGranularity === GROUPING_GRANULARITIES.DETAILED) {
    return "Prefer useful semantic topics over domain-only grouping; coarse buckets may still be broad because refinement can split true subtopics.";
  }
  return "Prefer broad, useful semantic topics over domain-only grouping. Merge related small task fragments during the coarse pass.";
}

function reviewModeInstruction(settings) {
  if (settings.reviewGroupMode === REVIEW_GROUP_MODES.LEAVE_UNGROUPED) {
    return "Do not use review for merely uncertain tabs. Assign every eligible tab to the closest useful topic group, even when confidence is imperfect. Use review only for truly unsafe or impossible-to-classify input.";
  }
  return "Low-confidence, generic, sensitive, or mixed pages should go to review.";
}

export function buildPlannerPayload(inventory, settings, options = {}) {
  const pageSamplesByTabId = new Map((inventory.pageSamples || []).map((result) => [result.tabId, result]));
  const pageSampleSignals = buildPageSampleSignals(inventory, pageSamplesByTabId);
  const payload = {
    schema: "tab_recap_compact_v1",
    analysisFeatures: {
      grouping: Boolean(settings.analyzeGrouping),
      cleanup: Boolean(settings.analyzeCleanup)
    },
    settings: {
      organizeMode: settings.organizeMode,
      targetWindowMode: settings.targetWindowMode,
      existingGroupMode: settings.existingGroupMode,
      reviewGroupMode: settings.reviewGroupMode,
      urlPrivacyMode: settings.urlPrivacyMode,
      languageMode: settings.languageMode,
      promptPreset: settings.promptPreset,
      groupingGranularity: settings.groupingGranularity,
      minConfidenceToApply: settings.minConfidenceToApply,
      maxTabsPerGroup: settings.maxTabsPerGroup,
      thinkingIntensity: settings.gatewayThinkingIntensity,
      analyzeGrouping: Boolean(settings.analyzeGrouping),
      analyzeCleanup: Boolean(settings.analyzeCleanup)
    },
    scope: inventory.scope,
    windowFields: WINDOW_FIELDS,
    windows: (inventory.windows || []).map((window) => [
      window.windowId,
      window.type,
      Boolean(window.focused),
      Boolean(window.incognito),
      window.tabCount
    ]),
    tabFields: TAB_FIELDS,
    tabs: (inventory.plannerTabs || []).map((tab) => [
      tab.tabId,
      tab.windowId,
      tab.index,
      tab.sequenceIndex,
      tab.title,
      tab.hostname,
      tab.sanitizedUrl,
      tab.urlKind,
      Boolean(tab.audible),
      Boolean(tab.discarded),
      Boolean(tab.sampleable),
      tab.groupTitle || "",
      formatPageSample(pageSamplesByTabId.get(tab.tabId))
    ]),
    pageSampleFields: PAGE_SAMPLE_FIELDS,
    pageSampleSignalFields: PAGE_SAMPLE_SIGNAL_FIELDS,
    pageSampleSignals,
    activationFlowActivityFields: ACTIVATION_FLOW_ACTIVITY_FIELDS,
    activationFlowTabActivity: buildActivationFlowActivityRows(inventory),
    activationFlowRunFields: ACTIVATION_FLOW_RUN_FIELDS,
    activationFlowRuns: buildActivationFlowRunRows(inventory),
    activationFlowTransitionFields: ACTIVATION_FLOW_TRANSITION_FIELDS,
    activationFlowTransitions: buildActivationFlowTransitionRows(inventory),
    activationFlowEvidenceFields: ACTIVATION_FLOW_EVIDENCE_FIELDS,
    activationFlowEvidence: buildActivationFlowEvidenceRows(inventory),
    excludedFields: EXCLUDED_FIELDS,
    excluded: (inventory.excludedTabs || []).map((tab) => [tab.tabId, tab.windowId, tab.exclusionReason]),
    lockedGroupFields: LOCKED_GROUP_FIELDS,
    lockedGroups: (inventory.lockedGroups || []).map((group) => [
      group.groupId,
      group.windowId,
      group.title,
      group.color,
      Boolean(group.collapsed),
      group.tabIds || []
    ]),
    pageSampleResultFields: PAGE_SAMPLE_RESULT_FIELDS,
    pageSampleResults: (inventory.pageSamples || []).map((result) => [
      result.tabId,
      result.windowId,
      result.status,
      settings.urlPrivacyMode === URL_PRIVACY_MODES.TITLE_ONLY ? "" : result.origin,
      result.reason
    ])
  };

  if (settings.analyzeCleanup) {
    const activityOverview = options.activityOverview || {};
    const actionLimit = cleanupCandidateLimit(inventory);
    payload.cleanupInstructions = {
      actionLimit,
      nonDestructive: true,
      humanMustDecide: true,
      outputFields: ["summary", "candidates[].id", "candidates[].priority", "candidates[].reason", "candidates[].evidence"]
    };
    payload.activityFields = [
      "id",
      "windowId",
      "index",
      "firstSeenAt",
      "lastSeenAt",
      "ageDays",
      "idleDays",
      "activeCount",
      "currentGroup",
      "discarded",
      "summary"
    ];
    payload.activity = cleanupActivityRows(activityOverview);
    payload.recap = {
      rangeMs: activityOverview.rangeMs || null,
      trackedOpenTabs: activityOverview.openTabs?.tracked || 0,
      localEntries: activityOverview.cache?.entries || 0,
      sampledEntries: activityOverview.cache?.sampledEntries || 0,
      topTerms: (activityOverview.recap?.topTerms || []).slice(0, 8),
      topHosts: (activityOverview.recap?.topHosts || []).slice(0, 8)
    };
  }

  return payload;
}

function buildActivationFlowActivityRows(inventory = {}) {
  const tabIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  const nearbyIdsByTabId = buildActivationFlowNearbyIds(inventory.activationFlow?.runs || [], tabIds);
  return (inventory.activationFlow?.tabActivity || [])
    .filter((activity) => tabIds.has(activity.id))
    .map((activity) => [
      activity.id,
      Math.max(0, Number(activity.activeCount || 0)),
      Math.max(0, Number(activity.totalActiveSeconds || 0)),
      Math.max(0, Number(activity.maxActiveSeconds || 0)),
      activity.lastActivatedAt || "",
      Math.max(0, Number(activity.appearedInRuns || 0)),
      Math.max(0, Number(activity.returnedToCount || 0)),
      (activity.nearbyIds || []).filter((id) => (nearbyIdsByTabId.get(activity.id) || new Set()).has(id)).slice(0, 6)
    ]);
}

function buildActivationFlowNearbyIds(runs = [], tabIds = new Set()) {
  const nearbyById = new Map([...tabIds].map((id) => [id, new Map()]));
  for (const run of activationRunSegmentsForTabIds(runs, tabIds)) {
    const ids = uniqueNumbers(run.ids || []);
    for (const id of ids) {
      const counts = nearbyById.get(id);
      if (!counts) continue;
      for (const nearbyId of ids) {
        if (nearbyId === id) continue;
        counts.set(nearbyId, (counts.get(nearbyId) || 0) + 1);
      }
    }
  }
  return new Map(
    [...nearbyById.entries()].map(([id, counts]) => [
      id,
      new Set(
        [...counts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0] - right[0])
          .slice(0, 6)
          .map(([nearbyId]) => nearbyId)
      )
    ])
  );
}

function buildActivationFlowRunRows(inventory = {}) {
  const tabIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  return activationRunSegmentsForTabIds(inventory.activationFlow?.runs || [], tabIds)
    .map((run) => [
      run.windowId,
      run.startedAt || "",
      run.endedAt || "",
      run.ids.slice(0, 14),
      (run.dwellSeconds || []).slice(0, Math.max(0, Math.min(13, run.ids.length - 1))).map((seconds) => Math.max(0, Number(seconds || 0))),
      tabIds.has(run.returnToId) ? run.returnToId : null,
      run.repeatedIds.slice(0, 6)
    ])
    .slice(0, 24);
}

function activationRunSegmentsForTabIds(runs = [], tabIds = new Set()) {
  const segments = [];
  for (const run of runs || []) {
    const ids = (run.ids || []).filter(Number.isInteger);
    if (ids.length < 2) continue;

    let startIndex = -1;
    for (let index = 0; index < ids.length; index += 1) {
      if (tabIds.has(ids[index])) {
        if (startIndex < 0) startIndex = index;
      } else {
        appendActivationRunSegment(segments, run, ids, startIndex, index - 1);
        startIndex = -1;
      }
    }
    appendActivationRunSegment(segments, run, ids, startIndex, ids.length - 1);
  }
  return segments;
}

function appendActivationRunSegment(segments, run, ids, startIndex, endIndex) {
  if (startIndex < 0 || endIndex - startIndex < 1) return;
  const dwellSeconds = (run.dwellSeconds || []).map((seconds) => Math.max(0, Number(seconds || 0)));
  const segmentIds = ids.slice(startIndex, endIndex + 1);
  const segmentDwellSeconds = dwellSeconds.slice(startIndex, endIndex);
  const secondsBefore = sumNumbers(dwellSeconds.slice(0, startIndex));
  const secondsUntilEnd = sumNumbers(dwellSeconds.slice(0, endIndex));

  segments.push({
    ...run,
    startedAt: offsetIsoTime(run.startedAt, secondsBefore, run.startedAt || ""),
    endedAt: offsetIsoTime(run.startedAt, secondsUntilEnd, run.endedAt || ""),
    spanSeconds: Math.max(1, sumNumbers(segmentDwellSeconds)),
    ids: segmentIds,
    dwellSeconds: segmentDwellSeconds,
    returnToId: firstRepeatedId(segmentIds),
    repeatedIds: repeatedIdsInOrder(segmentIds)
  });
}

function offsetIsoTime(startedAt, offsetSeconds, fallback = "") {
  const start = Date.parse(startedAt || "");
  if (!Number.isFinite(start)) return fallback;
  return new Date(start + Math.max(0, Number(offsetSeconds || 0)) * 1000).toISOString();
}

function sumNumbers(values = []) {
  return values.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function firstRepeatedId(ids = []) {
  return repeatedIdsInOrder(ids)[0] || null;
}

function repeatedIdsInOrder(ids = []) {
  const seen = new Set();
  const repeated = new Set();
  const result = [];
  for (const id of ids) {
    if (!Number.isInteger(id)) continue;
    if (seen.has(id) && !repeated.has(id)) {
      repeated.add(id);
      result.push(id);
    }
    seen.add(id);
  }
  return result;
}

function buildActivationFlowTransitionRows(inventory = {}) {
  const tabIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  return (inventory.activationFlow?.transitions || [])
    .filter((transition) => tabIds.has(transition.fromId) && tabIds.has(transition.toId))
    .map((transition) => [
      transition.fromId,
      transition.toId,
      Math.max(1, Number(transition.count || 1)),
      Math.max(0, Number(transition.avgDwellSeconds || 0)),
      Math.max(0, Number(transition.maxDwellSeconds || 0)),
      transition.lastAt || "",
      (transition.clues || []).map((clue) => String(clue || "").slice(0, 48)).filter(Boolean).slice(0, 5)
    ])
    .slice(0, 120);
}

function buildActivationFlowEvidenceRows(inventory = {}) {
  const tabIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  return (inventory.activationFlow?.evidence || [])
    .filter((evidence) => Array.isArray(evidence.ids) && evidence.ids.length >= 2 && evidence.ids.every((id) => tabIds.has(id)))
    .map((evidence) => [
      evidence.ids.slice(0, 8),
      Math.max(0, Math.min(1, Number(evidence.strength || 0))),
      Math.max(1, Number(evidence.count || 1)),
      evidence.lastAt || "",
      (evidence.clues || []).map((clue) => String(clue || "").slice(0, 48)).filter(Boolean).slice(0, 5)
    ])
    .slice(0, 80);
}

function uniqueNumbers(values = []) {
  return [...new Set(values.filter(Number.isInteger))];
}

export function buildGatewayUserPrompt(inventory, settings, options = {}) {
  return [
    "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
    "Return the JSON action plan only.",
    JSON.stringify(buildPlannerPayload(inventory, settings, options))
  ].join("\n");
}

function cleanupActivityRows(activityOverview = {}) {
  return (activityOverview.openTabSignals || activityOverview.staleTabs || []).map((tab) => [
    tab.tabId,
    tab.windowId,
    tab.index,
    tab.firstSeenAt || "",
    tab.lastSeenAt || "",
    daysFromMs(tab.ageMs),
    daysFromMs(tab.idleMs),
    Number(tab.activeCount || 0),
    tab.currentGroupTitle || "",
    Boolean(tab.discarded),
    compactActivitySummary(tab.summary)
  ]);
}

function compactActivitySummary(summary = null) {
  if (!summary) return null;
  return [
    String(summary.title || "").slice(0, 120),
    String(summary.metaDescription || "").slice(0, 180),
    String(summary.contentKind || "").slice(0, 40),
    Array.isArray(summary.headings) ? summary.headings.slice(0, 3).map((heading) => String(heading || "").slice(0, 80)) : []
  ];
}

function normalizeCleanupAnalysis(parsed, inventory, activityOverview = {}, settings = {}) {
  const source = unwrapCleanupAnalysis(parsed);
  const tabById = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const activityById = new Map(
    [...(activityOverview.openTabSignals || []), ...(activityOverview.staleTabs || [])]
      .filter((tab) => Number.isInteger(tab?.tabId))
      .map((tab) => [tab.tabId, tab])
  );
  const seen = new Set();
  const rawCandidates = Array.isArray(source?.candidates)
    ? source.candidates
    : Array.isArray(source?.tabs)
    ? source.tabs
    : Array.isArray(source?.review)
    ? source.review
    : [];
  const candidates = [];
  const limit = cleanupCandidateLimit(inventory);

  for (const raw of rawCandidates) {
    const id = typeof raw === "number" ? raw : Number(raw?.id ?? raw?.tabId);
    const tab = tabById.get(id);
    if (!tab || seen.has(id)) continue;
    seen.add(id);
    const activity = activityById.get(id) || {};
    candidates.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      index: tab.index,
      sequenceIndex: tab.sequenceIndex,
      title: tab.title || activity.title || "",
      hostname: tab.hostname || activity.hostname || "",
      sanitizedUrl: tab.sanitizedUrl || activity.sanitizedUrl || "",
      currentGroupTitle: activity.currentGroupTitle || tab.groupTitle || "",
      currentGroupColor: activity.currentGroupColor || tab.groupColor || "",
      ageMs: Number(activity.ageMs || 0),
      idleMs: Number(activity.idleMs || 0),
      activeCount: Number(activity.activeCount || 0),
      discarded: Boolean(activity.discarded || tab.discarded),
      pinned: Boolean(tab.pinned),
      priority: normalizeCleanupPriority(raw?.priority),
      reason:
        normalizeModelProductText(raw?.reason || raw?.rationale, settings, 220) ||
        localizedText(settings.languageMode, "AI 建议优先复核这个标签页。", "AI suggests reviewing this tab first."),
      evidence: normalizeCleanupEvidence(raw?.evidence || raw?.signals || raw?.clues, settings),
      summary: activity.summary || null
    });
    if (candidates.length >= limit) break;
  }
  appendCleanupReviewFallbacks(candidates, { inventory, activityById, seen, settings, limit });

  return {
    schema: "tab_recap_cleanup_v1",
    summary: normalizeModelProductText(
      source?.summary ||
        localizedText(
          settings.languageMode,
          `找到 ${candidates.length} 个可以先检查的标签页。`,
          `Found ${candidates.length} tabs worth reviewing first.`
        ),
      settings,
      220
    ),
    candidates
  };
}

function appendCleanupReviewFallbacks(candidates, { inventory, activityById, seen, settings, limit }) {
  const tabOrder = buildTabOrder(inventory);
  const tabs = [...(inventory.plannerTabs || [])].sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
  for (const tab of tabs) {
    if (candidates.length >= limit) break;
    if (seen.has(tab.tabId) || tab.pinned) continue;
    const activity = activityById.get(tab.tabId) || {};
    seen.add(tab.tabId);
    candidates.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      index: tab.index,
      sequenceIndex: tab.sequenceIndex,
      title: tab.title || activity.title || "",
      hostname: tab.hostname || activity.hostname || "",
      sanitizedUrl: tab.sanitizedUrl || activity.sanitizedUrl || "",
      currentGroupTitle: activity.currentGroupTitle || tab.groupTitle || "",
      currentGroupColor: activity.currentGroupColor || tab.groupColor || "",
      ageMs: Number(activity.ageMs || 0),
      idleMs: Number(activity.idleMs || 0),
      activeCount: Number(activity.activeCount || 0),
      discarded: Boolean(activity.discarded || tab.discarded),
      pinned: Boolean(tab.pinned),
      priority: "low",
      reason: localizedText(
        settings.languageMode,
        "AI 没有标成高风险，适合最后快速扫一遍。",
        "AI did not flag this as high risk; review it near the end."
      ),
      evidence: cleanupFallbackEvidence(tab, activity, settings),
      summary: activity.summary || null
    });
  }
}

function cleanupFallbackEvidence(tab, activity = {}, settings = {}) {
  const evidence = [];
  if (Number(activity.ageMs || 0) > 0) {
    evidence.push(localizedText(settings.languageMode, `已打开 ${daysFromMs(activity.ageMs)} 天`, `Open for ${daysFromMs(activity.ageMs)} days`));
  }
  if (Number(activity.idleMs || 0) > 0) {
    evidence.push(localizedText(settings.languageMode, `闲置 ${daysFromMs(activity.idleMs)} 天`, `Idle for ${daysFromMs(activity.idleMs)} days`));
  }
  if (tab.discarded || activity.discarded) {
    evidence.push(localizedText(settings.languageMode, "当前处于休眠状态", "Currently sleeping"));
  }
  if (tab.groupTitle || activity.currentGroupTitle) {
    evidence.push(localizedText(settings.languageMode, `当前分组：${tab.groupTitle || activity.currentGroupTitle}`, `Current group: ${tab.groupTitle || activity.currentGroupTitle}`));
  }
  if (!evidence.length && tab.hostname) evidence.push(tab.hostname);
  return evidence.slice(0, 2);
}

function cleanupCandidateLimit(inventory = {}) {
  const count = (inventory.plannerTabs || []).length;
  if (!count) return CLEANUP_CANDIDATE_MIN_LIMIT;
  if (count <= 80) return count;
  return Math.min(count, CLEANUP_CANDIDATE_MAX_LIMIT, Math.max(CLEANUP_CANDIDATE_MIN_LIMIT, Math.ceil(count * 0.7)));
}

function cleanupPlannerMaxTokens(inventory = {}) {
  return Math.min(GATEWAY_MAX_OUTPUT_TOKENS, Math.max(4096, cleanupCandidateLimit(inventory) * 70));
}

function unwrapCleanupAnalysis(value) {
  if (!value || typeof value !== "object") return {};
  return value.cleanup || value.cleanupPlan || value.result || value.data || value;
}

function normalizeCleanupPriority(value) {
  const normalized = String(value || "").toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) return normalized;
  if (["urgent", "strong", "delete", "close"].includes(normalized)) return "high";
  return "medium";
}

function normalizeCleanupEvidence(value, settings = {}) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => normalizeModelProductText(item, settings, 120)).filter(Boolean).slice(0, 4);
}

function daysFromMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round((numeric / (24 * 60 * 60 * 1000)) * 10) / 10;
}

async function createCoarseGatewayBuckets(inventory, settings, fetchImpl, options = {}) {
  const body = {
    model: requireGatewayAuxiliaryModel(settings),
    messages: [
      { role: "system", content: buildCoarseSystemPrompt(settings, options) },
      { role: "user", content: buildCoarseUserPrompt(inventory, settings) }
    ],
    max_tokens: 8192
  };
  attachJsonResponseFormat(body, settings);
  applyThinkingIntensity(body, settings, THINKING_INTENSITIES.LOW);
  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway coarse planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }
  return normalizeCoarsePlan(parseGatewayJson(data), inventory, settings);
}

async function createCleanupGatewayAnalysis(inventory, settings, fetchImpl, options = {}, groups = [], reviewTabs = []) {
  const body = {
    model: requireGatewayAuxiliaryModel(settings),
    messages: [
      { role: "system", content: buildCleanupSystemPrompt(settings) },
      { role: "user", content: buildCleanupUserPrompt(inventory, settings, options, groups, reviewTabs) }
    ],
    max_tokens: cleanupPlannerMaxTokens(inventory)
  };
  attachJsonResponseFormat(body, settings);
  applyThinkingIntensity(body, settings, THINKING_INTENSITIES.LOW);
  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway cleanup planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }
  return normalizeCleanupAnalysis(parseGatewayJson(data), inventory, options.activityOverview || {}, settings);
}

async function createCleanupGatewayAnalysisWithFallback(inventory, settings, fetchImpl, options = {}, groups = [], reviewTabs = [], fallbackCandidates = []) {
  try {
    return await createCleanupGatewayAnalysis(inventory, settings, fetchImpl, options, groups, reviewTabs);
  } catch (error) {
    if (isAbortLikeError(error, options.signal)) throw error;
    return buildMergedCleanup(fallbackCandidates, inventory, settings);
  }
}

function buildCleanupSystemPrompt(settings) {
  return [
    "You are a JSON-only cleanup ranking planner for a Chrome tab organization extension.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    "Shape: {\"summary\":\"Short summary\",\"candidates\":[{\"id\":1,\"priority\":\"high|medium|low\",\"reason\":\"Why review this tab\",\"evidence\":[\"signal\"]}]}",
    "This is a manual review checklist, not an automatic close command.",
    "Use high for likely stale/duplicate/superseded/finished tabs, medium for plausible cleanup items, and low for low-urgency items that still help the user review the tab set.",
    "Rank as many eligible tabs as useful up to cleanupInstructions.actionLimit. For sessions at or below that limit, include nearly all tabs unless they are clearly current, pinned, or unsafe to suggest.",
    "Keep each candidate compact: reason should be one short clause, evidence should contain one or two short user-facing clues.",
    `Write evidence like "search result", "old task", "easy to find again", or "rarely reopened". ${MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING}`,
    "Use original tab order, tab age/activity, current groups, page summaries, behavioral activation evidence, and the proposed grouping context.",
    "Treat activationFlow as behavioral evidence only. A tab repeatedly used as an anchor may be valuable to keep; direct transitions and quick handoffs may indicate search or comparison behavior. Do not expose raw activation field names to users.",
    "Do not recommend closing pinned tabs as high priority unless evidence is very strong.",
    languageInstruction(settings.languageMode)
  ].join("\n");
}

function buildCleanupUserPrompt(inventory, settings, options = {}, groups = [], reviewTabs = []) {
  const payload = buildPlannerPayload(inventory, { ...settings, analyzeGrouping: false, analyzeCleanup: true }, options);
  const cleanupTabFields = ["id", "windowId", "index", "sequenceIndex", "title", "hostname", "sanitizedUrl", "discarded", "existingGroup"];
  return [
    "Software engineering task input: rank browser tabs for manual cleanup review.",
    "Return compact cleanup JSON only.",
    JSON.stringify({
      schema: "tab_recap_cleanup_ranking_v1",
      settings: payload.settings,
      cleanupInstructions: payload.cleanupInstructions,
      scope: payload.scope,
      tabFields: cleanupTabFields,
      tabs: projectRows(payload.tabFields, payload.tabs, cleanupTabFields),
      pageSampleSignalFields: payload.pageSampleSignalFields,
      pageSampleSignals: payload.pageSampleSignals,
      activationFlowActivityFields: payload.activationFlowActivityFields,
      activationFlowTabActivity: payload.activationFlowTabActivity,
      activationFlowRunFields: payload.activationFlowRunFields,
      activationFlowRuns: payload.activationFlowRuns,
      activationFlowTransitionFields: payload.activationFlowTransitionFields,
      activationFlowTransitions: payload.activationFlowTransitions,
      activationFlowEvidenceFields: payload.activationFlowEvidenceFields,
      activationFlowEvidence: payload.activationFlowEvidence,
      activityFields: payload.activityFields,
      activity: payload.activity,
      recap: payload.recap,
      proposedGroupFields: ["title", "color", "confidence", "ids", "reason"],
      proposedGroups: (groups || []).map((group) => [
        group.title,
        group.color,
        group.confidence,
        (group.tabRefs || []).map((ref) => ref.tabId),
        group.reason || ""
      ]),
      review: (reviewTabs || []).map((ref) => (typeof ref === "number" ? ref : ref.tabId))
    })
  ].join("\n");
}

function projectRows(sourceFields, rows, targetFields) {
  const indexes = targetFields.map((field) => sourceFields.indexOf(field));
  return (rows || []).map((row) => indexes.map((index) => (index >= 0 ? row[index] : null)));
}

async function refineBucket(bucket, inventory, settings, fetchImpl, options = {}) {
  const maxTabsPerRequest = options.refineMaxTabsPerRequest || Math.min(settings.maxTabsPerGroup, REFINE_MAX_TABS_PER_REQUEST);
  if (bucket.tabRefs.length > maxTabsPerRequest) {
    const refined = await mapWithConcurrency(
      refinementTasksForBucket(bucket, settings, options).map((task) => task.bucket),
      refinementConcurrency(options),
      (part) => refineBucket(part, inventory, settings, fetchImpl, options)
    );
    const merged = refined.reduce(
      (parts, part) => {
        parts.groups.push(...part.groups);
        parts.reviewTabs.push(...part.reviewTabs);
        mergeCleanupPart(part.cleanup, {
          cleanupCandidates: parts.cleanupCandidates,
          cleanupSeen: parts.cleanupSeen
        });
        return parts;
      },
      { groups: [], reviewTabs: [], cleanupCandidates: [], cleanupSeen: new Set() }
    );
    return {
      groups: merged.groups,
      reviewTabs: merged.reviewTabs,
      cleanup: settings.analyzeCleanup
        ? {
            schema: "tab_recap_cleanup_v1",
            summary: "",
            candidates: merged.cleanupCandidates
          }
        : null
    };
  }

  const subInventory = subsetInventory(inventory, bucket.tabRefs);
  if (!(subInventory.plannerTabs || []).length) return { groups: [], reviewTabs: [], cleanup: null };
  const subsetOptions = {
    ...options,
    activityOverview: subsetActivityOverview(options.activityOverview || {}, subInventory)
  };

  const refineSettings = {
    ...settings,
    analyzeCleanup: false,
    customPrompt: [
      settings.customPrompt,
      `Refine this coarse bucket: ${bucket.title}.`,
      `Coarse reason: ${bucket.reason}`,
      ...refinementPromptLines(settings),
      "Keep uncertain or sensitive tabs in reviewTabs."
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000)
  };

  try {
    const plan = await createSingleGatewayPlan(subInventory, refineSettings, fetchImpl, {
      ...subsetOptions,
      thinkingIntensity: refinementThinkingIntensity(settings, options),
      suppressSingleRequestProgress: true
    });
    return {
      groups: (plan.groups || []).map((group) => ({
        ...group,
        groupKey: `${bucket.groupKey}-${group.groupKey || slugify(group.title)}`.slice(0, 64)
      })),
      reviewTabs: plan.reviewTabs || [],
      cleanup: plan.cleanup || null
    };
  } catch {
    if (bucket.confidence >= settings.minConfidenceToApply) {
      return {
        groups: fallbackGroupsForBucket(bucket, settings),
        reviewTabs: [],
        cleanup: null
      };
    }

    return {
      groups: [],
      reviewTabs: bucket.tabRefs.map((ref) => ({ ...ref, reason: refinementUnavailableReviewReason(settings) })),
      cleanup: null
    };
  }
}

function buildCoarseSystemPrompt(settings, options = {}) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const maxBuckets = options.coarseMaxBuckets || COARSE_MAX_BUCKETS;
  return [
    "This is a fast first-pass software engineering task for a Chrome tab organization extension.",
    "Return exactly one compact JSON object. Do not include markdown or prose outside JSON.",
    "Shape: {\"buckets\":[{\"bucketKey\":\"topic\",\"title\":\"Topic\",\"color\":\"blue\",\"confidence\":0.8,\"tabIds\":[1],\"reason\":\"Short reason.\"}],\"reviewTabIds\":[2]}",
    "Use tabIds arrays, not full tab objects.",
    `Use at most ${maxBuckets} broad semantic buckets.`,
    `Allowed colors: ${CHROME_GROUP_COLORS.join(", ")}.`,
    coarseClassificationAxisInstruction(settings),
    "This is a coarse pass: mixed or large buckets are acceptable because a second pass will refine them.",
    "Every eligible tab id must appear exactly once, either in buckets[].tabIds or reviewTabIds.",
    "Put generic, sensitive, or very uncertain tabs in reviewTabIds.",
    "Use sequenceIndex and index as ordering clues. Adjacent tabs may belong together, but they are not a hard rule.",
    "When activationFlow is present, use browsing runs, direct transitions, dwell durations, nearby ids, and return-to-earlier-tab evidence as clues. Do not create buckets from behavior alone unless semantic content also supports it.",
    "Do not create a broad catch-all bucket for unrelated leftovers; use reviewTabIds instead.",
    languageInstruction(settings.languageMode),
    `Runtime preset: ${presetText}`
  ].join("\n");
}

function buildCoarseUserPrompt(inventory, settings) {
  const payload = buildPlannerPayload(inventory, { ...settings, analyzeCleanup: false });
  return [
    "Software engineering task input: create broad semantic buckets for these browser tabs.",
    "Return compact coarse-bucket JSON only.",
    JSON.stringify({
      schema: "tab_recap_coarse_v1",
      settings: payload.settings,
      scope: payload.scope,
      windowFields: payload.windowFields,
      windows: payload.windows,
      tabFields: payload.tabFields,
      tabs: payload.tabs,
      pageSampleFields: payload.pageSampleFields,
      pageSampleSignalFields: payload.pageSampleSignalFields,
      pageSampleSignals: payload.pageSampleSignals,
      activationFlowActivityFields: payload.activationFlowActivityFields,
      activationFlowTabActivity: payload.activationFlowTabActivity,
      activationFlowRunFields: payload.activationFlowRunFields,
      activationFlowRuns: payload.activationFlowRuns,
      activationFlowTransitionFields: payload.activationFlowTransitionFields,
      activationFlowTransitions: payload.activationFlowTransitions,
      activationFlowEvidenceFields: payload.activationFlowEvidenceFields,
      activationFlowEvidence: payload.activationFlowEvidence,
      lockedGroupFields: payload.lockedGroupFields,
      lockedGroups: payload.lockedGroups,
      pageSampleResultFields: payload.pageSampleResultFields,
      pageSampleResults: payload.pageSampleResults
    })
  ].join("\n");
}

function normalizeCoarsePlan(plan, inventory, settings) {
  const tabById = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const buckets = [];
  const sourceBuckets = Array.isArray(plan?.buckets) ? plan.buckets : Array.isArray(plan?.groups) ? plan.groups : [];

  for (const [index, bucket] of sourceBuckets.entries()) {
    const tabRefs = sortRefsByOriginalOrder(
      normalizeTabRefs(bucket.tabRefs || bucket.tabIds || bucket.tabs || [], tabById)
      .filter((ref) => {
        if (seen.has(ref.tabId)) return false;
        seen.add(ref.tabId);
        return true;
      }),
      inventory
    )
      .map(toPlainTabRef);
    if (!tabRefs.length) continue;

    const titleClusterSignal = titleClusterRefinementSignal(tabRefs, tabById, settings);
    buckets.push({
      groupKey: slugify(bucket.bucketKey || bucket.groupKey || bucket.key || bucket.title || bucket.name || `bucket-${index + 1}`),
      title: String(bucket.title || bucket.name || localizedText(settings.languageMode, `粗分主题 ${index + 1}`, `Bucket ${index + 1}`)).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(bucket.color) ? bucket.color : CHROME_GROUP_COLORS[index % CHROME_GROUP_COLORS.length],
      confidence: clampConfidence(bucket.confidence),
      tabRefs,
      reason: String(bucket.reason || bucket.rationale || "Coarse semantic bucket.").slice(0, 280),
      refineSignal: titleClusterSignal.shouldRefine ? titleClusterSignal.reason : ""
    });
  }

  const reviewTabs = normalizeTabRefs(plan?.reviewTabs || plan?.reviewTabIds || plan?.ungrouped || [], tabById)
    .filter((ref) => !seen.has(ref.tabId))
    .map((ref) => {
      seen.add(ref.tabId);
      return {
        ...ref,
        reason: ref.reason || localizedText(settings.languageMode, "粗分阶段暂时保留给复核。", "Coarse pass left this tab for review.")
      };
    });

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "粗分阶段没有稳定归类这个标签页。", "Coarse pass did not assign this tab.")
      });
      seen.add(tab.tabId);
    }
  }

  return { buckets: orderGroupsByOriginalPosition(buckets, inventory), reviewTabs: sortRefsByOriginalOrder(reviewTabs, inventory) };
}

function titleClusterRefinementSignal(tabRefs, tabById, settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) return { shouldRefine: false, reason: "" };
  if ((tabRefs || []).length < REFINE_TITLE_CLUSTER_MIN_TABS) return { shouldRefine: false, reason: "" };

  const clusters = new Map();
  for (const ref of tabRefs || []) {
    const stem = titleClusterStem(tabById.get(ref.tabId)?.title);
    if (!stem) continue;
    clusters.set(stem, (clusters.get(stem) || 0) + 1);
  }

  const repeatedClusters = [...clusters.entries()]
    .filter(([, count]) => count >= REFINE_TITLE_CLUSTER_MIN_CLUSTER_SIZE)
    .sort((left, right) => right[1] - left[1]);
  if (repeatedClusters.length < REFINE_TITLE_CLUSTER_MIN_CLUSTERS) return { shouldRefine: false, reason: "" };

  const largest = repeatedClusters[0]?.[1] || 0;
  const total = tabRefs.length;
  if (largest / total > REFINE_TITLE_CLUSTER_DOMINANCE_ABOVE) return { shouldRefine: false, reason: "" };

  const labels = repeatedClusters
    .slice(0, 4)
    .map(([stem, count]) => `${stem} (${count})`)
    .join(", ");
  return {
    shouldRefine: true,
    reason: `Repeated title patterns suggest mixed subtopics: ${labels}.`
  };
}

function titleClusterStem(title) {
  const cleaned = String(title || "")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const [prefix] = cleaned.split(/\s+(?:[-–—|:：]\s+)|\s+[·•]\s+/);
  const normalized = String(prefix || cleaned)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  if (normalized.length < 6) return "";
  return normalized;
}

function refinementPromptLines(settings) {
  if (settings.promptPreset === PROMPT_PRESETS.MEDIA_TYPE) {
    return [
      "This is a large-session media-type refinement pass; preserve the media-type axis and strict JSON over deep reasoning.",
      "If this bucket is already one page/media type, return one group with all ids unless maxTabsPerGroup would be exceeded.",
      "Split only when the bucket mixes clearly different page/media types, not by project, topic, domain, or contiguous task."
    ];
  }
  return [
    "This is a large-session refinement pass; prefer concise semantic clustering and strict JSON over deep reasoning.",
    "Split it only when there are clearly different semantic tasks or topics."
  ];
}

function shouldUseHierarchicalPlanner(inventory, settings, options = {}) {
  if (options.hierarchical === false) return false;
  if (options.hierarchical === true) return true;
  if (!settings?.analyzeGrouping) return false;
  const minTabs = options.hierarchicalMinTabs || HIERARCHICAL_MIN_TABS;
  return (inventory.plannerTabs || []).length >= minTabs;
}

function shouldUseSplitCleanupPlanner(inventory, settings, options = {}) {
  if (options.splitCleanup === false) return false;
  if (!settings?.analyzeGrouping || !settings?.analyzeCleanup) return false;
  if (!(inventory.plannerTabs || []).length) return false;
  if ((inventory.plannerTabs || []).length < SPLIT_CLEANUP_MIN_TABS) return false;
  return resolveGatewayAuxiliaryModel(settings) !== resolveGatewayModel(settings);
}

function shouldRefineBucket(bucket, settings, options = {}) {
  const minTabs = options.refineBucketMinTabs || Math.min(settings.maxTabsPerGroup, REFINE_BUCKET_MIN_TABS);
  const confidenceBelow = options.refineConfidenceBelow ?? REFINE_CONFIDENCE_BELOW;
  return bucket.tabRefs.length >= minTabs || bucket.confidence < confidenceBelow || Boolean(bucket.refineSignal);
}

function countRefinementRequests(coarse, settings, options = {}) {
  const bucketRequests = (coarse.buckets || []).reduce(
    (sum, bucket) => sum + (shouldRefineBucket(bucket, settings, options) ? countBucketRefinementRequests(bucket, settings, options) : 0),
    0
  );
  const reviewRequests = coarse.reviewTabs?.length
    ? countBucketRefinementRequests({ tabRefs: coarse.reviewTabs }, settings, options)
    : 0;
  return Math.max(1, bucketRequests + reviewRequests);
}

function countBucketRefinementRequests(bucket, settings, options = {}) {
  const maxTabsPerRequest = options.refineMaxTabsPerRequest || Math.min(settings.maxTabsPerGroup, REFINE_MAX_TABS_PER_REQUEST);
  return Math.max(1, Math.ceil((bucket.tabRefs || []).length / Math.max(1, maxTabsPerRequest)));
}

function refinementTasksForBucket(bucket, settings, options = {}) {
  const maxTabsPerRequest = options.refineMaxTabsPerRequest || Math.min(settings.maxTabsPerGroup, REFINE_MAX_TABS_PER_REQUEST);
  const tabRefChunks = chunkRefs(bucket.tabRefs || [], maxTabsPerRequest);
  const split = tabRefChunks.length > 1;
  return tabRefChunks.map((tabRefs, index) => {
    const bucketTitle = split ? `${bucket.title} ${index + 1}` : bucket.title;
    return {
      bucket: {
        ...bucket,
        groupKey: split ? `${bucket.groupKey}-part-${index + 1}` : bucket.groupKey,
        title: bucketTitle,
        tabRefs,
        reason: [bucket.reason, bucket.refineSignal, split ? "Split from an oversized coarse bucket." : ""].filter(Boolean).join(" ")
      },
      messageStart: localizedText(settings.languageMode, `正在精分「${bucketTitle}」`, `Refining "${bucketTitle}"`),
      messageDone: localizedText(settings.languageMode, `已精分「${bucketTitle}」`, `Refined "${bucketTitle}"`)
    };
  });
}

function refinementConcurrency(options = {}) {
  const raw = Number(options.refineConcurrency || REFINE_DEFAULT_CONCURRENCY);
  if (!Number.isFinite(raw)) return REFINE_DEFAULT_CONCURRENCY;
  return Math.min(REFINE_MAX_CONCURRENCY, Math.max(1, Math.floor(raw)));
}

function refinementThinkingIntensity(settings, options = {}) {
  if (Object.values(THINKING_INTENSITIES).includes(options.refineThinkingIntensity)) {
    return options.refineThinkingIntensity;
  }
  if (settings.gatewayThinkingIntensity === THINKING_INTENSITIES.LOW) {
    return THINKING_INTENSITIES.LOW;
  }
  return THINKING_INTENSITIES.MEDIUM;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );
  return results;
}

function refinementProgress(completed, total) {
  const ratio = Math.min(1, Math.max(0, completed / Math.max(1, total)));
  return 55 + Math.round(ratio * 30);
}

function chunkRefs(refs, size) {
  const chunks = [];
  const chunkSize = Math.max(1, size);
  for (let index = 0; index < refs.length; index += chunkSize) {
    chunks.push(refs.slice(index, index + chunkSize));
  }
  return chunks;
}

function subsetInventory(inventory, refs) {
  const ids = new Set(refs.map((ref) => ref.tabId));
  const plannerTabs = (inventory.plannerTabs || []).filter((tab) => ids.has(tab.tabId));
  const tabs = (inventory.tabs || []).filter((tab) => ids.has(tab.tabId));
  const windows = (inventory.windows || []).map((window) => ({
    ...window,
    tabCount: plannerTabs.filter((tab) => tab.windowId === window.windowId).length
  }));

  return {
    ...inventory,
    windows,
    tabs,
    plannerTabs,
    excludedTabs: [],
    lockedGroups: [],
    activationFlow: subsetActivationFlow(inventory.activationFlow || {}, ids),
    pageSamples: (inventory.pageSamples || []).filter((sample) => ids.has(sample.tabId))
  };
}

function subsetActivationFlow(activationFlow = {}, ids) {
  return {
    tabActivity: (activationFlow.tabActivity || []).filter((activity) => ids.has(activity.id)),
    runs: activationRunSegmentsForTabIds(activationFlow.runs || [], ids),
    transitions: (activationFlow.transitions || []).filter((transition) => ids.has(transition.fromId) && ids.has(transition.toId)),
    evidence: (activationFlow.evidence || [])
      .filter((evidence) => Array.isArray(evidence.ids) && evidence.ids.length >= 2 && evidence.ids.every((id) => ids.has(id)))
  };
}

function bucketToGroup(bucket) {
  return {
    groupKey: bucket.groupKey,
    title: bucket.title,
    color: bucket.color,
    confidence: bucket.confidence,
    tabRefs: bucket.tabRefs.map(toPlainTabRef),
    reason: bucket.reason
  };
}

function refinementUnavailableReviewReason(settings) {
  return localizedText(
    settings.languageMode,
    "这个主题暂时没有稳定细分，已留给你确认。",
    "This topic could not be refined confidently, so it is left for review."
  );
}

function fallbackGroupsForBucket(bucket, settings) {
  const chunkSize = Math.max(1, Number(settings.maxTabsPerGroup) || 1);
  const chunks = chunkRefs(bucket.tabRefs || [], chunkSize);
  return chunks.map((tabRefs, index) => {
    const suffix = chunks.length > 1 ? ` ${index + 1}` : "";
    const fallbackReason = localizedText(
      settings.languageMode,
      `${bucket.reason} 已按初步主题保留，稍后重新生成可能得到更细的分组。`,
      `${bucket.reason} Kept from the initial topic pass. Regenerating later may produce a more detailed split.`
    );
    return {
      ...bucketToGroup({ ...bucket, tabRefs }),
      groupKey: chunks.length > 1 ? `${bucket.groupKey}-${index + 1}` : bucket.groupKey,
      title: `${bucket.title}${suffix}`.slice(0, 40),
      reason: fallbackReason.slice(0, 280)
    };
  });
}

function mergePlanParts(groups, reviewTabs, state) {
  for (const group of groups || []) {
    const tabRefs = (group.tabRefs || [])
      .filter((ref) => !state.seen.has(ref.tabId))
      .map((ref) => {
        state.seen.add(ref.tabId);
        return toPlainTabRef(ref);
      });
    if (!tabRefs.length) continue;
    state.finalGroups.push({ ...group, tabRefs });
  }

  for (const ref of reviewTabs || []) {
    if (state.seen.has(ref.tabId)) continue;
    state.seen.add(ref.tabId);
    state.finalReviewTabs.push({
      tabId: ref.tabId,
      windowId: ref.windowId,
      reason:
        ref.reason ||
        localizedText(state.settings?.languageMode, "分层规划后仍需要复核。", "Left for review by hierarchical planner.")
    });
  }
}

function mergeCleanupPart(cleanup, state) {
  if (!cleanup || typeof cleanup !== "object") return;
  for (const candidate of cleanup.candidates || []) {
    const tabId = Number(candidate?.tabId ?? candidate?.id);
    if (!Number.isInteger(tabId) || state.cleanupSeen.has(tabId)) continue;
    state.cleanupSeen.add(tabId);
    state.cleanupCandidates.push(candidate);
  }
}

function buildMergedCleanup(candidates, inventory, settings) {
  const tabOrder = buildTabOrder(inventory);
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const limit = cleanupCandidateLimit(inventory);
  const sortedCandidates = [...(candidates || [])]
    .sort((left, right) => {
      const leftRank = priorityRank[left.priority] ?? priorityRank.medium;
      const rightRank = priorityRank[right.priority] ?? priorityRank.medium;
      return leftRank - rightRank || tabOrder(left.tabId) - tabOrder(right.tabId);
    })
    .slice(0, limit);
  return {
    schema: "tab_recap_cleanup_v1",
    summary: sortedCandidates.length
      ? localizedText(
          settings.languageMode,
          `AI 找到 ${sortedCandidates.length} 个建议先检查的标签页。`,
          `AI found ${sortedCandidates.length} tabs worth reviewing first.`
        )
      : localizedText(settings.languageMode, "这次没有发现明显需要优先清理的标签页。", "No obvious cleanup candidates found this time."),
    candidates: sortedCandidates
  };
}

function buildActionPlan(groups, reviewTabs, inventory, settings, cleanup = null) {
  const orderedGroups = orderGroupsByOriginalPosition(
    uniquifyGroupKeys(groups, settings).map((group) => ({ ...group, tabRefs: sortRefsByOriginalOrder(group.tabRefs || [], inventory) })),
    inventory
  );
  const plan = {
    schemaVersion: 1,
    mode: settings.organizeMode,
    scope:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? { kind: "all_normal_windows", windowIds: inventory.scope.windowIds }
        : { kind: "current_window", windowIds: [inventory.scope.currentWindowId] },
    targetWindow:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? buildTargetWindow(inventory, settings)
        : { kind: "current_window", windowId: inventory.scope.currentWindowId },
    eligibleTabs: (inventory.plannerTabs || []).map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason
    })),
    groups: orderedGroups,
    reviewTabs: sortRefsByOriginalOrder(reviewTabs, inventory)
  };
  if (cleanup) {
    plan.cleanup = cleanup;
  }
  return plan;
}

function subsetActivityOverview(activityOverview = {}, inventory = {}) {
  const ids = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  const filterRows = (rows = []) => rows.filter((tab) => ids.has(Number(tab?.tabId)));
  const openTabSignals = filterRows(activityOverview.openTabSignals || []);
  const staleTabs = filterRows(activityOverview.staleTabs || []);
  return {
    ...activityOverview,
    openTabs: {
      ...(activityOverview.openTabs || {}),
      tracked: openTabSignals.length,
      total: openTabSignals.length
    },
    openTabSignals,
    staleTabs
  };
}

function uniquifyGroupKeys(groups, settings) {
  const seen = new Map();
  return groups.map((group, index) => {
    const base = slugify(group.groupKey || group.title);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return {
      ...group,
      groupKey: count ? `${base}-${count + 1}` : base,
      title: String(group.title || localizedText(settings.languageMode, `主题 ${index + 1}`, "Topic")).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : "grey",
      confidence: clampConfidence(group.confidence),
      reason: String(group.reason || localizedText(settings.languageMode, "语义相近的标签页。", "Semantic grouping.")).slice(0, 280)
    };
  });
}

function formatPageSample(result) {
  if (!result) return null;
  if (result.status !== "ok") {
    return [result.status, "", "", "", "", [], "", result.reason || ""];
  }
  const sample = result.sample || {};
  return [
    "ok",
    sample.title || "",
    sample.metaDescription || "",
    sample.language || "",
    sample.contentKind || "",
    sample.headings || [],
    "",
    ""
  ];
}

function buildPageSampleSignals(inventory, pageSamplesByTabId) {
  const rows = [];
  for (const tab of inventory.plannerTabs || []) {
    const result = pageSamplesByTabId.get(tab.tabId);
    if (!result || result.status !== "ok") continue;
    const sample = result.sample || {};
    const summary = compactSampleSummary(sample);
    if (!sample.title && !sample.metaDescription && !sample.visibleText && !summary) continue;
    rows.push([
      tab.tabId,
      String(sample.contentKind || "").slice(0, 32),
      String(sample.title || "").slice(0, 120),
      Array.isArray(sample.headings) ? sample.headings.map((heading) => String(heading || "").slice(0, 80)).filter(Boolean).slice(0, 4) : [],
      summary
    ]);
  }
  return rows;
}

function compactSampleSummary(sample = {}) {
  const pieces = [];
  for (const value of [sample.metaDescription, sample.visibleText]) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (pieces.some((piece) => piece.includes(text) || text.includes(piece))) continue;
    pieces.push(text);
  }
  const text = pieces.join(" ");
  return text.replace(/\s+/g, " ").slice(0, 320);
}

export function parsePlanFromResponse(data) {
  return parseGatewayJson(data);
}

export function parsePlanFromGatewayResponse(data, inventory, settings, options = {}) {
  const parsed = parseGatewayJson(data);
  return normalizeGatewayPlan(parsed, inventory, settings, options);
}

function parseGatewayJson(data) {
  const text =
    data?.choices?.[0]?.message?.content ||
    data?.output_text ||
    (data?.output || [])
      .flatMap((item) => item.content || [])
      .find((content) => content.type === "output_text" || content.type === "text")?.text;

  if (!text) {
    const refusal = findRefusal(data);
    if (refusal) {
      throw gatewayResponseParseError(
        "AI 没有生成可用方案。请调整自定义要求后重新生成。",
        "gateway_response_refused"
      );
    }
    throw gatewayResponseParseError("AI 这次没有生成可用方案。请重新生成。", "gateway_response_empty");
  }

  try {
    return JSON.parse(extractJsonObjectText(text));
  } catch {
    throw gatewayResponseParseError(
      "AI 这次生成的方案格式不完整。请重新生成，或换一个模型再试。",
      "gateway_response_invalid_json"
    );
  }
}

function gatewayResponseParseError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function findRefusal(data) {
  return (data?.output || [])
    .flatMap((item) => item.content || [])
    .find((content) => content.refusal)?.refusal;
}

function normalizeGatewayPlan(plan, inventory, settings, options = {}) {
  const wrappedPlan = unwrapGatewayPlan(plan);
  if (wrappedPlan !== plan) return normalizeGatewayPlan(wrappedPlan, inventory, settings, options);
  if (plan?.schemaVersion === 1 && hasInternalPlanShape(plan)) {
    const normalized = normalizeSchemaPlanOrder(plan, inventory);
    const cleanupSource = plan.cleanup || plan.cleanupPlan;
    if (settings.analyzeCleanup && cleanupSource) {
      normalized.cleanup = normalizeCleanupAnalysis(cleanupSource, inventory, options.activityOverview || {}, settings);
    }
    return normalized;
  }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) return plan;

  const plannerTabs = inventory.plannerTabs || [];
  const tabById = new Map(plannerTabs.map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const groups = [];

  for (const [index, group] of plan.groups.entries()) {
    const refs = sortRefsByOriginalOrder(
      normalizeTabRefs(group.tabRefs || group.ids || group.tabIds || group.tabs || [], tabById).filter((ref) => {
        if (seen.has(ref.tabId)) return false;
        seen.add(ref.tabId);
        return true;
      }),
      inventory
    ).map(toPlainTabRef);
    if (!refs.length) continue;

    groups.push({
      groupKey: slugify(group.groupKey || group.key || group.name || group.title || `group-${index + 1}`),
      title: String(group.title || group.name || localizedText(settings.languageMode, `分组 ${index + 1}`, `Group ${index + 1}`)).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : CHROME_GROUP_COLORS[index % CHROME_GROUP_COLORS.length],
      confidence: clampConfidence(group.confidence),
      tabRefs: refs,
      reason: String(
        group.reason ||
          group.rationale ||
          group.reasoning ||
          localizedText(settings.languageMode, "AI 网关输出的语义分组。", "Semantic grouping from AI gateway output.")
      ).slice(0, 280)
    });
  }

  const reviewSeen = new Set();
  const reviewTabs = sortRefsByOriginalOrder(
    normalizeTabRefs(plan.reviewTabs || plan.review || plan.ungrouped || [], tabById)
      .filter((ref) => {
        if (seen.has(ref.tabId) || reviewSeen.has(ref.tabId)) return false;
        reviewSeen.add(ref.tabId);
        return true;
      })
      .map((ref) => ({
        ...ref,
        reason: ref.reason || localizedText(settings.languageMode, "AI 网关把这个标签页留给复核。", "AI gateway left this tab for review.")
      })),
    inventory
  );
  for (const tab of plannerTabs) {
    if (!seen.has(tab.tabId) && !reviewTabs.some((ref) => ref.tabId === tab.tabId)) {
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "AI 网关没有稳定归类这个标签页。", "AI gateway did not assign this tab.")
      });
    }
  }

  const normalized = {
    schemaVersion: 1,
    mode: settings.organizeMode,
    scope:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? { kind: "all_normal_windows", windowIds: inventory.scope.windowIds }
        : { kind: "current_window", windowIds: [inventory.scope.currentWindowId] },
    targetWindow:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? buildTargetWindow(inventory, settings)
        : { kind: "current_window", windowId: inventory.scope.currentWindowId },
    eligibleTabs: plannerTabs.map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason
    })),
    groups: orderGroupsByOriginalPosition(groups, inventory),
    reviewTabs
  };
  const cleanupSource = plan.cleanup || plan.cleanupPlan;
  if (settings.analyzeCleanup && cleanupSource) {
    normalized.cleanup = normalizeCleanupAnalysis(cleanupSource, inventory, options.activityOverview || {}, settings);
  }
  return normalized;
}

function unwrapGatewayPlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  return plan.plan || plan.actionPlan || plan.result || plan.data || plan;
}

function hasInternalPlanShape(plan) {
  return (
    plan &&
    typeof plan === "object" &&
    Array.isArray(plan.groups) &&
    Array.isArray(plan.reviewTabs) &&
    plan.groups.every((group) => Array.isArray(group?.tabRefs))
  );
}

function normalizeSchemaPlanOrder(plan, inventory) {
  return {
    ...plan,
    groups: Array.isArray(plan.groups)
      ? orderGroupsByOriginalPosition(
          plan.groups.map((group) => ({
            ...group,
            tabRefs: Array.isArray(group?.tabRefs) ? sortRefsByOriginalOrder(group.tabRefs, inventory) : group?.tabRefs
          })),
          inventory
        )
      : plan.groups,
    reviewTabs: Array.isArray(plan.reviewTabs) ? sortRefsByOriginalOrder(plan.reviewTabs, inventory) : plan.reviewTabs
  };
}

function buildTargetWindow(inventory, settings) {
  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    return {
      kind: settings.targetWindowMode,
      windowId: settings.selectedTargetWindowId,
      title: targetWindowTitle(settings.targetWindowMode, settings.languageMode)
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW) {
    return {
      kind: settings.targetWindowMode,
      windowId: resolveInvocationWindowId(inventory),
      title: targetWindowTitle(settings.targetWindowMode, settings.languageMode)
    };
  }

  return { kind: settings.targetWindowMode, windowId: null, title: targetWindowTitle(settings.targetWindowMode, settings.languageMode) };
}

function resolveInvocationWindowId(inventory) {
  if (Number.isInteger(inventory.scope?.invocationWindowId)) return inventory.scope.invocationWindowId;
  const focusedWindow = (inventory.windows || []).find((window) => window.focused) || inventory.windows?.[0];
  return focusedWindow?.windowId ?? null;
}

function normalizeTabRefs(values, tabById) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      const tabId = typeof value === "number" ? value : Number(value?.tabId ?? value?.id);
      const tab = tabById.get(tabId);
      if (!tab) return null;
      return {
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: typeof value === "object" && value?.reason ? String(value.reason) : ""
      };
    })
    .filter(Boolean);
}

function toPlainTabRef(ref) {
  return { tabId: ref.tabId, windowId: ref.windowId };
}

function sortRefsByOriginalOrder(refs, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(refs).sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(groups).sort((left, right) => firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder));
}

function firstGroupOrder(group, tabOrder) {
  const orders = asArray(group?.tabRefs).map((ref) => tabOrder(ref.tabId));
  return orders.length ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
}

function buildTabOrder(inventory) {
  const order = new Map();
  for (const [fallbackIndex, tab] of (inventory.plannerTabs || []).entries()) {
    const value = Number.isInteger(tab.sequenceIndex) ? tab.sequenceIndex : fallbackIndex;
    order.set(tab.tabId, value);
  }
  return (tabId) => order.get(tabId) ?? Number.MAX_SAFE_INTEGER;
}

function asArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function stripCodeFence(text) {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^```\s*(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function extractJsonObjectText(text) {
  const raw = stripCodeFence(text).trim();
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return raw.slice(start, end + 1);
    return raw;
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "group";
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.7;
  return Math.min(1, Math.max(0, numeric));
}

export function applyThinkingIntensity(body, settings, intensity = settings.gatewayThinkingIntensity) {
  if (usesGlmThinking(settings)) {
    body.thinking = { type: intensity === THINKING_INTENSITIES.LOW ? "disabled" : "enabled" };
    return;
  }

  if (!supportsReasoningEffort(settings)) {
    return;
  }

  body.reasoning_effort = intensity === THINKING_INTENSITIES.ULTRA ? THINKING_INTENSITIES.HIGH : intensity;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortLikeError(error, signal = null) {
  if (signal?.aborted) return true;
  if (error?.name === "AbortError") return true;
  return /abort|cancel|已停止生成/i.test(String(error?.message || error || ""));
}

function usesGlmThinking(settings) {
  const model = resolveGatewayModel(settings).toLowerCase();
  if (model.startsWith("glm-")) return true;

  try {
    const hostname = new URL(effectiveGatewayBaseUrl(settings)).hostname.toLowerCase();
    return hostname.endsWith("bigmodel.cn") || hostname.endsWith("z.ai");
  } catch {
    return false;
  }
}

function supportsReasoningEffort(settings) {
  return !usesCustomCompatibleGateway(settings);
}

function usesCustomCompatibleGateway(settings) {
  return isCustomGatewayProvider(settings);
}

function thinkingIntensityText(value) {
  if (value === "low") return "low, prefer a faster but still valid plan";
  if (value === "medium") return "medium, balance quality and speed";
  if (value === "high") return "high, spend more reasoning on semantic grouping";
  if (value === "ultra") return "ultra-high, be especially careful with semantic overlap, cross-window context, and low-confidence tabs";
  return "high, spend more reasoning on semantic grouping";
}

async function emitProgress(options, event) {
  if (typeof options.onProgress === "function") {
    await options.onProgress(event);
  }
}

function exampleCompactPlan(settings = {}) {
  const example = {
    schema: "tab_recap_plan_compact_v1",
    groups: [
      {
        key: "topic",
        title: "Topic",
        color: "blue",
        confidence: 0.8,
        ids: [1],
        reason: "Semantic reason."
      }
    ],
    review: [{ id: 2, reason: "Low confidence." }]
  };
  if (settings.analyzeCleanup) {
    example.cleanup = {
      summary: "Short review summary.",
      candidates: [{ id: 3, priority: "medium", reason: "Stale or superseded page.", evidence: ["old", "low activity"] }]
    };
  }
  return example;
}

export { ACTION_PLAN_JSON_SCHEMA };
