const PROGRESS_COPY_MODEL = "gpt-5.3-codex-spark";
const PLANNER_INPUT_SCHEMAS = new Set(["tab_recap_compact_v1", "tab_recap_coarse_v1", "tab_recap_cleanup_ranking_v1"]);
const TIME_RECAP_INPUT_SCHEMAS = new Set(["tab_recap_time_recap_input_v1", "tab_tidy_time_recap_input_v1"]);
const RATE_LIMIT_OBJECT_NAME = "tab-recap-global-rate-limits-v1";
const MAX_PAYLOAD_ROWS = 1500;
const MAX_PAYLOAD_STRING_LENGTH = 4096;
const MAX_PAYLOAD_NODES = 100_000;
const MAX_PAYLOAD_DEPTH = 12;
const PLANNER_ROOT_FIELDS = Object.freeze({
  tab_recap_compact_v1: new Set([
    "schema", "analysisFeatures", "settings", "scope", "windowFields", "windows", "tabFields", "tabs",
    "pageSampleFields", "pageSampleSignalFields", "pageSampleSignals", "activationFlowActivityFields",
    "activationFlowTabActivity", "activationFlowRunFields", "activationFlowRuns", "activationFlowTransitionFields",
    "activationFlowTransitions", "activationFlowEvidenceFields", "activationFlowEvidence", "excludedFields", "excluded",
    "lockedGroupFields", "lockedGroups", "pageSampleResultFields", "pageSampleResults", "cleanupInstructions",
    "activityFields", "activity", "recap"
  ]),
  tab_recap_coarse_v1: new Set([
    "schema", "settings", "scope", "windowFields", "windows", "tabFields", "tabs", "pageSampleFields",
    "pageSampleSignalFields", "pageSampleSignals", "activationFlowActivityFields", "activationFlowTabActivity",
    "activationFlowRunFields", "activationFlowRuns", "activationFlowTransitionFields", "activationFlowTransitions",
    "activationFlowEvidenceFields", "activationFlowEvidence", "lockedGroupFields", "lockedGroups",
    "pageSampleResultFields", "pageSampleResults"
  ]),
  tab_recap_cleanup_ranking_v1: new Set([
    "schema", "settings", "cleanupInstructions", "scope", "tabFields", "tabs", "pageSampleSignalFields",
    "pageSampleSignals", "activationFlowActivityFields", "activationFlowTabActivity", "activationFlowRunFields",
    "activationFlowRuns", "activationFlowTransitionFields", "activationFlowTransitions", "activationFlowEvidenceFields",
    "activationFlowEvidence", "activityFields", "activity", "recap", "proposedGroupFields", "proposedGroups", "review"
  ])
});
const TIME_RECAP_ROOT_FIELDS = new Set(["schema", "languageMode", "range", "coverage", "pageFields", "pages"]);
const PROGRESS_COPY_FIELDS = new Set(["schema", "languageMode", "phase", "tabCount", "windowCount", "style"]);
const LEGACY_PROGRESS_COPY_FIELDS = new Set(["languageMode", "phase", "tabCount", "windowCount", "style"]);
const DEFAULT_ALLOWED_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "codex-auto-review",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
  "claude-opus-4-1-20250805",
  "claude-opus-4-20250514",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
  PROGRESS_COPY_MODEL
];
const FORWARDED_CHAT_FIELDS = Object.freeze(["model", "messages", "response_format", "max_tokens", "reasoning_effort", "thinking"]);
const DEFAULT_LIMITS = Object.freeze({
  bodyBytes: 1_000_000,
  maxTokens: 8192,
  ipHourlyRequests: 60,
  installDailyRequests: 100,
  installDailyPageSummaryRequests: 20,
  globalDailyRequests: 3000,
  upstreamRetryAttempts: 2,
  upstreamRetryDelayMs: 1200,
  upstreamChatTimeoutMs: 300_000,
  upstreamReadyTimeoutMs: 8000,
  llmReadyTimeoutMs: 45000,
  llmReadyMaxTokens: 2
});
const DEFAULT_LLM_READY_MODEL = "gpt-5.4-mini";
const DEFAULT_LLM_READY_REASONING_EFFORT = "low";
const DEFAULT_MONITOR_REMINDER_HOURS = 6;
const MONITOR_STATE_KEY = "monitor:ai-gateway:v1";
const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledMonitor(env, { scheduledTime: event.scheduledTime }));
  }
};

export class RateLimitCounter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ ok: false, code: "method_not_allowed" }, { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ ok: false, code: "invalid_json" }, { status: 400 });
    }
    const now = Number(payload?.now);
    const checks = normalizeRateLimitChecks(payload?.checks);
    if (!Number.isFinite(now) || !checks) {
      return Response.json({ ok: false, code: "invalid_rate_limit_request" }, { status: 400 });
    }

    const result = await this.ctx.storage.transaction(async (transaction) => {
      const records = await Promise.all(checks.map((check) => transaction.get(check.key)));
      const writes = [];
      for (const [index, check] of checks.entries()) {
        const stored = records[index];
        const count = stored && Number(stored.expiresAt) > now ? Number(stored.count) || 0 : 0;
        if (count + 1 > check.limit) {
          return { ok: false, kind: check.kind, retryAfter: check.retryAfter };
        }
        writes.push([check.key, { count: count + 1, expiresAt: check.expiresAt }]);
      }
      await Promise.all(writes.map(([key, value]) => transaction.put(key, value)));
      return { ok: true };
    });

    if (result.ok) await scheduleRateLimitCleanup(this.ctx.storage, checks);
    return Response.json(result);
  }

  async alarm() {
    const now = Date.now();
    const records = await this.ctx.storage.list();
    const expired = [];
    let nextExpiry = Infinity;
    for (const [key, value] of records) {
      if (!value || !Number.isFinite(Number(value.expiresAt))) continue;
      if (Number(value.expiresAt) <= now) expired.push(key);
      else nextExpiry = Math.min(nextExpiry, Number(value.expiresAt));
    }
    if (expired.length) await this.ctx.storage.delete(expired);
    if (Number.isFinite(nextExpiry)) await this.ctx.storage.setAlarm(nextExpiry);
  }
}

export function createWorkerHandler(options = {}) {
  return (request, env = {}, ctx = {}) => handleRequest(request, env, ctx, options);
}

export async function runScheduledMonitor(env = {}, options = {}) {
  const now = new Date(options.scheduledTime || Date.now());
  const requestId = `monitor_${now.getTime()}_${crypto.randomUUID().slice(0, 8)}`;
  const emailConfig = monitorEmailConfig(env);
  if (!emailConfig.ok) {
    console.warn(JSON.stringify({ event: "tab_recap_monitor_not_configured", requestId, code: emailConfig.code }));
    return {
      ok: false,
      event: "not_configured",
      summary: { ok: false, status: "not_configured", failed: ["email"], requestId },
      checks: {}
    };
  }
  const stateStore = monitorStateStore(env);
  if (!stateStore) {
    console.warn(JSON.stringify({ event: "tab_recap_monitor_not_configured", requestId, code: "monitor_state_store_missing" }));
    return {
      ok: false,
      event: "not_configured",
      summary: { ok: false, status: "not_configured", failed: ["state"], requestId },
      checks: {}
    };
  }
  const checks = await runGatewayMonitorChecks(env, { ...options, requestId });
  const summary = monitorSummary(checks);
  const previousState = await readMonitorState(stateStore);
  const event = monitorNotificationEvent(previousState, summary, now, env);
  const nextState = nextMonitorState(previousState, summary, event, now);

  await writeMonitorState(stateStore, nextState);

  if (event.type !== "none") {
    const emailResult = await sendMonitorEmail(env, event, summary, checks, now, options.fetchImpl || fetch);
    await writeMonitorState(stateStore, {
      ...nextState,
      lastAlertAt: emailResult.ok ? nextState.lastAlertAt : previousState?.lastAlertAt || "",
      lastEmail: {
        ok: emailResult.ok,
        status: emailResult.status || 0,
        code: emailResult.code || "",
        at: now.toISOString()
      }
    });
    if (!emailResult.ok) {
      console.warn(
        JSON.stringify({
          event: "tab_recap_monitor_email_failed",
          requestId,
          code: emailResult.code,
          status: emailResult.status || 0
        })
      );
    }
  }

  return { ok: summary.ok, event: event.type, summary, checks };
}

export async function handleRequest(request, env = {}, ctx = {}, options = {}) {
  const url = new URL(request.url);
  const requestId = requestIdFor(request);
  if (request.method === "OPTIONS") return emptyResponse(204, request, requestId);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse({ ok: true }, 200, {}, request, requestId);
  }
  if (url.pathname === "/readyz" && request.method === "GET") {
    return upstreamReadiness(request, env, options, requestId);
  }
  if (url.pathname === "/llm-readyz" && request.method === "GET") {
    return llmReadiness(request, env, options, requestId);
  }
  if (url.pathname === "/monitor/status" && request.method === "GET") {
    return monitorStatus(request, env, requestId);
  }
  if (url.pathname !== "/v1/chat/completions") {
    return jsonError("Not found.", 404, "not_found", {}, request, requestId);
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed.", 405, "method_not_allowed", {}, request, requestId);
  }

  const limits = readLimits(env);
  const bodyText = await readBodyText(request, limits.bodyBytes);
  if (!bodyText.ok) {
    return jsonError(bodyText.message, 413, "request_too_large", {}, request, requestId);
  }

  let body;
  try {
    body = JSON.parse(bodyText.text);
  } catch {
    return jsonError("Request body must be valid JSON.", 400, "invalid_json", {}, request, requestId);
  }

  const validation = validateChatRequest(body, env, limits);
  if (!validation.ok) {
    return jsonError(validation.message, 400, validation.code, {}, request, requestId);
  }

  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return jsonError(upstream.message, 503, "upstream_not_configured", {}, request, requestId);
  }

  const rateLimit = await checkRateLimits(request, env, limits);
  if (!rateLimit.ok) {
    return jsonError(rateLimit.message, 429, rateLimit.code, rateLimit.headers, request, requestId);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const upstreamResult = await fetchUpstreamWithRetries(
    fetchImpl,
    upstream,
    JSON.stringify(forwardedChatBody(body)),
    request,
    limits,
    requestId
  );

  if (upstreamResult.response) {
    return relayUpstreamResponse(upstreamResult.response, request, requestId, upstreamResult.attempts);
  }

  return jsonError(
    upstreamResult.message,
    upstreamResult.status,
    upstreamResult.code,
    { "retry-after": upstreamResult.retryAfter || "20" },
    request,
    requestId,
    upstreamResult.details
  );
}

function readLimits(env) {
  return {
    bodyBytes: positiveInteger(env.MAX_BODY_BYTES, DEFAULT_LIMITS.bodyBytes),
    maxTokens: positiveInteger(env.MAX_TOKENS, DEFAULT_LIMITS.maxTokens),
    ipHourlyRequests: positiveInteger(env.IP_HOURLY_REQUESTS, DEFAULT_LIMITS.ipHourlyRequests),
    installDailyRequests: positiveInteger(env.INSTALL_DAILY_REQUESTS, DEFAULT_LIMITS.installDailyRequests),
    installDailyPageSummaryRequests: positiveInteger(
      env.INSTALL_DAILY_PAGE_SUMMARY_REQUESTS,
      DEFAULT_LIMITS.installDailyPageSummaryRequests
    ),
    globalDailyRequests: positiveInteger(env.GLOBAL_DAILY_REQUESTS, DEFAULT_LIMITS.globalDailyRequests),
    upstreamRetryAttempts: clampInteger(
      positiveInteger(env.UPSTREAM_RETRY_ATTEMPTS, DEFAULT_LIMITS.upstreamRetryAttempts),
      1,
      4
    ),
    upstreamRetryDelayMs: clampInteger(
      positiveInteger(env.UPSTREAM_RETRY_DELAY_MS, DEFAULT_LIMITS.upstreamRetryDelayMs),
      100,
      10_000
    ),
    upstreamChatTimeoutMs: clampInteger(
      positiveInteger(env.UPSTREAM_CHAT_TIMEOUT_MS, DEFAULT_LIMITS.upstreamChatTimeoutMs),
      10,
      900_000
    ),
    upstreamReadyTimeoutMs: clampInteger(
      positiveInteger(env.UPSTREAM_READY_TIMEOUT_MS, DEFAULT_LIMITS.upstreamReadyTimeoutMs),
      500,
      20_000
    ),
    llmReadyTimeoutMs: clampInteger(
      positiveInteger(env.LLM_READY_TIMEOUT_MS, DEFAULT_LIMITS.llmReadyTimeoutMs),
      1_000,
      90_000
    ),
    llmReadyMaxTokens: clampInteger(
      positiveInteger(env.LLM_READY_MAX_TOKENS, DEFAULT_LIMITS.llmReadyMaxTokens),
      1,
      16
    )
  };
}

async function readBodyText(request, byteLimit) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > byteLimit) {
    return { ok: false, message: `Request body is above the ${byteLimit} byte limit.` };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > byteLimit) {
    return { ok: false, message: `Request body is above the ${byteLimit} byte limit.` };
  }
  return { ok: true, text };
}

function validateChatRequest(body, env, limits) {
  const modelAllowlist = allowedModels(env);
  if (!modelAllowlist.includes(body?.model)) {
    return { ok: false, code: "model_not_allowed", message: "This model is not available on the default AI service." };
  }
  const fieldValidation = validateTopLevelFields(body);
  if (!fieldValidation.ok) return fieldValidation;
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return { ok: false, code: "invalid_messages", message: "messages must be a non-empty array." };
  }
  if (body.response_format?.type !== "json_object") {
    return { ok: false, code: "json_required", message: "TabRecap gateway requests must use JSON object output." };
  }
  if (!Number.isInteger(body.max_tokens) || body.max_tokens <= 0) {
    return { ok: false, code: "max_tokens_required", message: "max_tokens must be a positive integer." };
  }
  if (body.max_tokens > limits.maxTokens) {
    return { ok: false, code: "max_tokens_exceeded", message: `max_tokens must be <= ${limits.maxTokens}.` };
  }
  if (body.model === PROGRESS_COPY_MODEL) {
    if (isProgressCopyRequest(body)) {
      const sparkValidation = validateProgressCopyRequest(body);
      if (!sparkValidation.ok) return sparkValidation;
    } else if (isTimeRecapRequest(body)) {
      const recapValidation = validateTimeRecapRequest(body, modelAllowlist, { includeProgressModel: true });
      if (!recapValidation.ok) return recapValidation;
    } else {
      const plannerValidation = validatePlannerRequest(body, modelAllowlist, { includeProgressModel: true });
      if (!plannerValidation.ok) return plannerValidation;
    }
  } else if (isTimeRecapRequest(body)) {
    const recapValidation = validateTimeRecapRequest(body, modelAllowlist);
    if (!recapValidation.ok) return recapValidation;
  } else {
    const plannerValidation = validatePlannerRequest(body, modelAllowlist);
    if (!plannerValidation.ok) return plannerValidation;
  }
  if (body.base_url || body.baseURL || body.provider_url) {
    return { ok: false, code: "proxy_target_not_allowed", message: "Custom upstream targets are not allowed." };
  }
  return { ok: true };
}

function validateTopLevelFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "invalid_request", message: "Request body must be an object." };
  }
  const allowed = new Set(FORWARDED_CHAT_FIELDS);
  const unsupported = Object.keys(body).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    return {
      ok: false,
      code: "request_shape_not_allowed",
      message: `This gateway only accepts TabRecap planner fields. Unsupported field: ${unsupported[0]}.`
    };
  }
  if (body.stream || body.tools || body.functions || body.tool_choice || body.function_call || body.max_completion_tokens) {
    return { ok: false, code: "request_shape_not_allowed", message: "This gateway only accepts TabRecap JSON planning requests." };
  }
  return { ok: true };
}

function validatePlannerRequest(body, modelAllowlist, options = {}) {
  const plannerModels = new Set(
    modelAllowlist.filter((model) => options.includeProgressModel || model !== PROGRESS_COPY_MODEL)
  );
  if (!plannerModels.has(body.model)) {
    return { ok: false, code: "planner_model_not_allowed", message: "This model is not available for TabRecap planning." };
  }
  if (body.messages.length !== 2) {
    return { ok: false, code: "planner_shape_required", message: "Planner requests must use the TabRecap two-message shape." };
  }
  const [system, user] = body.messages;
  const systemText = messageText(system);
  const userText = messageText(user);
  if (system?.role !== "system" || user?.role !== "user") {
    return { ok: false, code: "planner_shape_required", message: "Planner requests must include one system message and one user message." };
  }
  const payload = extractJsonPayload(userText);
  const contract = detectPlannerContract(payload, systemText, userText);
  if (!contract || !includesEvery(systemText, contract.systemMarkers) || !startsWithLines(userText, contract.userLines)) {
    return { ok: false, code: "planner_shape_required", message: "Planner request does not match a supported TabRecap contract." };
  }
  return validatePlannerPayload(payload, contract.schema, { allowMissingSchema: contract.allowMissingSchema });
}

function isProgressCopyRequest(body) {
  const systemText = messageText(body?.messages?.[0]);
  return /AI browser-tab organization extension|loading captions/i.test(systemText);
}

function isTimeRecapRequest(body) {
  const systemText = messageText(body?.messages?.[0]);
  const userText = messageText(body?.messages?.[1]);
  return (
    /time recap writer|time-recap|work recap/i.test(systemText) ||
    /tab_recap_time_recap_input_v1|tab_tidy_time_recap_input_v1|local time-recap input/i.test(userText)
  );
}

function validateTimeRecapRequest(body, modelAllowlist, options = {}) {
  const recapModels = new Set(modelAllowlist.filter((model) => options.includeProgressModel || model !== PROGRESS_COPY_MODEL));
  if (!recapModels.has(body.model)) {
    return { ok: false, code: "recap_model_not_allowed", message: "This model is not available for TabRecap recaps." };
  }
  if (body.messages.length !== 2) {
    return { ok: false, code: "recap_shape_required", message: "Recap requests must use the TabRecap two-message shape." };
  }
  const [system, user] = body.messages;
  const systemText = messageText(system);
  const userText = messageText(user);
  if (system?.role !== "system" || user?.role !== "user") {
    return { ok: false, code: "recap_shape_required", message: "Recap requests must include one system message and one user message." };
  }
  if (
    !includesEvery(systemText, [
      "You are a JSON-only time recap writer for a consumer Chrome tab organization product.",
      "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
      "This feature is recap-only; cleanup recommendations belong to the organizer flow."
    ]) ||
    !startsWithLines(userText, ["TabRecap local time-recap input follows. Page rows are already privacy-reduced."])
  ) {
    return { ok: false, code: "recap_shape_required", message: "Recap request does not match the TabRecap contract." };
  }
  return validateTimeRecapPayload(extractJsonPayload(userText));
}

function validateProgressCopyRequest(body) {
  if (Number(body.max_tokens || 0) > 1200) {
    return { ok: false, code: "spark_token_cap_exceeded", message: "Progress copy max_tokens must be <= 1200." };
  }
  if (body.messages.length !== 2) {
    return { ok: false, code: "spark_shape_required", message: "Progress copy requests must use the TabRecap two-message shape." };
  }
  const [system, user] = body.messages;
  const systemText = messageText(system);
  const userText = messageText(user);
  if (system?.role !== "system" || user?.role !== "user") {
    return { ok: false, code: "spark_shape_required", message: "Progress copy requests must include one system message and one user message." };
  }
  if (!includesEvery(systemText, [
    "Return strict JSON only: {\"messages\":[\"...\"]}.",
    "Write short loading captions for an AI browser-tab organization extension.",
    "Do not claim real internal thoughts, exact work already completed, or user-private content."
  ])) {
    return { ok: false, code: "spark_shape_required", message: "Progress copy request does not match the TabRecap contract." };
  }
  let payload;
  try {
    payload = JSON.parse(userText);
  } catch {
    return { ok: false, code: "spark_payload_required", message: "Progress copy user payload must be JSON." };
  }
  const isLegacyPayload = payload?.schema === undefined;
  const allowedFields = isLegacyPayload ? LEGACY_PROGRESS_COPY_FIELDS : PROGRESS_COPY_FIELDS;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    (!isLegacyPayload && payload.schema !== "tab_recap_progress_copy_v1") ||
    !hasOnlyKeys(payload, allowedFields) ||
    !["zh-CN", "en-US"].includes(payload.languageMode) ||
    !/^[a-z][a-z0-9_]{0,39}$/i.test(String(payload.phase || "")) ||
    !("languageMode" in payload) ||
    !("phase" in payload)
  ) {
    return { ok: false, code: "spark_payload_required", message: "Progress copy payload must include TabRecap progress fields." };
  }
  const bounds = validatePayloadBounds(payload);
  if (!bounds.ok) return { ok: false, code: "spark_payload_required", message: bounds.message };
  return { ok: true };
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
  }
  return "";
}

function validatePlannerPayload(payload, expectedSchema, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload must include compact TabRecap JSON." };
  }
  const hasSchema = typeof payload.schema === "string";
  if ((!hasSchema && !options.allowMissingSchema) || (hasSchema && (!PLANNER_INPUT_SCHEMAS.has(payload.schema) || payload.schema !== expectedSchema))) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload schema is not recognized." };
  }
  if (!hasOnlyKeys(payload, PLANNER_ROOT_FIELDS[expectedSchema])) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload contains unsupported fields." };
  }
  const bounds = validatePayloadBounds(payload);
  if (!bounds.ok) return { ok: false, code: "planner_payload_required", message: bounds.message };
  const fields = payload.tabFields;
  const rows = payload.tabs;
  if (!validFieldList(fields, ["id", "windowId", "index", "title"]) || !Array.isArray(rows) || rows.length > MAX_PAYLOAD_ROWS) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload must include compact TabRecap tab fields." };
  }
  if (!rows.every((row) => validDataRow(row, fields, ["id", "windowId", "index", "title"]))) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload contains invalid tab rows." };
  }
  return { ok: true };
}

function validateTimeRecapPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload must include compact TabRecap JSON." };
  }
  if (!TIME_RECAP_INPUT_SCHEMAS.has(payload.schema)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload schema is not recognized." };
  }
  if (!hasOnlyKeys(payload, TIME_RECAP_ROOT_FIELDS)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload contains unsupported fields." };
  }
  const bounds = validatePayloadBounds(payload);
  if (!bounds.ok) return { ok: false, code: "recap_payload_required", message: bounds.message };
  const fields = payload.pageFields;
  const rows = payload.pages;
  if (!payload.coverage || typeof payload.coverage !== "object" || Array.isArray(payload.coverage)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload must include coverage metadata." };
  }
  if (!validFieldList(fields, ["id", "title", "firstSeenAt", "lastSeenAt"]) || !Array.isArray(rows) || rows.length > MAX_PAYLOAD_ROWS) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload must include compact TabRecap page fields." };
  }
  if (!rows.every((row) => validDataRow(row, fields, ["id", "title"]))) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload contains invalid page rows." };
  }
  return { ok: true };
}

function plannerContract(schema) {
  if (schema === "tab_recap_compact_v1") {
    return {
      schema,
      systemMarkers: [
        "This is a software engineering task: produce the planning JSON used by a Chrome extension runtime.",
        "You are a JSON-only planner for a Chrome tab organization extension.",
        "Do not close, discard, navigate, execute, or mutate tabs. You only produce recommendations."
      ],
      userLines: [
        "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
        "Return the JSON action plan only."
      ]
    };
  }
  if (schema === "tab_recap_coarse_v1") {
    return {
      schema,
      systemMarkers: [
        "This is a fast first-pass software engineering task for a Chrome tab organization extension.",
        "This is a coarse pass: mixed or large buckets are acceptable because a second pass will refine them.",
        "Every eligible tab id must appear exactly once, either in buckets[].tabIds or reviewTabIds."
      ],
      userLines: [
        "Software engineering task input: create broad semantic buckets for these browser tabs.",
        "Return compact coarse-bucket JSON only."
      ]
    };
  }
  if (schema === "tab_recap_cleanup_ranking_v1") {
    return {
      schema,
      systemMarkers: [
        "You are a JSON-only cleanup ranking planner for a Chrome tab organization extension.",
        "This is a manual review checklist, not an automatic close command.",
        "Do not recommend closing pinned tabs as high priority unless evidence is very strong."
      ],
      userLines: [
        "Software engineering task input: rank browser tabs for manual cleanup review.",
        "Return compact cleanup JSON only."
      ]
    };
  }
  return null;
}

function detectPlannerContract(payload, systemText, userText) {
  const explicit = plannerContract(payload?.schema);
  if (explicit) return explicit;

  const legacyCoarse = plannerContract("tab_recap_coarse_v1");
  if (
    payload?.schema === undefined &&
    includesEvery(systemText, legacyCoarse.systemMarkers) &&
    startsWithLines(userText, legacyCoarse.userLines)
  ) {
    return { ...legacyCoarse, allowMissingSchema: true };
  }
  return null;
}

function includesEvery(text, markers) {
  return markers.every((marker) => String(text || "").includes(marker));
}

function hasOnlyKeys(value, allowedKeys) {
  return Boolean(allowedKeys && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowedKeys.has(key)));
}

function startsWithLines(text, lines) {
  return String(text || "").startsWith(lines.join("\n"));
}

function validatePayloadBounds(payload) {
  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES) return false;
    if (depth > MAX_PAYLOAD_DEPTH) return false;
    if (typeof value === "string") return value.length <= MAX_PAYLOAD_STRING_LENGTH;
    if (Array.isArray(value)) {
      if (value.length > MAX_PAYLOAD_ROWS * 2) return false;
      return value.every((entry) => visit(entry, depth + 1));
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length > 120) return false;
      return entries.every(([key, entry]) => key.length <= 120 && visit(entry, depth + 1));
    }
    return value === null || ["number", "boolean"].includes(typeof value);
  };
  return visit(payload, 0)
    ? { ok: true }
    : { ok: false, message: "TabRecap payload exceeds the supported structure or field limits." };
}

function extractJsonPayload(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function validFieldList(fields, requiredFields) {
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    fields.length <= 80 &&
    fields.every((field) => typeof field === "string" && field.length > 0 && field.length <= 80) &&
    requiredFields.every((field) => fields.includes(field))
  );
}

function validDataRow(row, fields, requiredFields) {
  if (Array.isArray(row)) {
    if (row.length > fields.length + 4) return false;
    return requiredFields.every((field) => {
      const value = row[fields.indexOf(field)];
      return validRequiredFieldValue(field, value);
    });
  }
  if (row && typeof row === "object") {
    return requiredFields.every((field) => {
      const value = row[field];
      return validRequiredFieldValue(field, value);
    });
  }
  return false;
}

function validRequiredFieldValue(field, value) {
  if (value === undefined || value === null || String(value).trim() === "") return false;
  if (["id", "tabId", "windowId", "index", "sequenceIndex"].includes(field)) {
    return Number.isFinite(Number(value));
  }
  return true;
}

function forwardedChatBody(body) {
  return Object.fromEntries(FORWARDED_CHAT_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

async function checkRateLimits(request, env, limits) {
  if (!env.RATE_LIMIT_DO) {
    if (String(env.ALLOW_UNMETERED || "").toLowerCase() === "true") return { ok: true };
    return { ok: false, code: "rate_limit_store_missing", message: "Free gateway rate limit store is not configured." };
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const installId = normalizeInstallId(
    request.headers.get("x-tab-recap-install-id") ||
      request.headers.get("x-tab-tidy-install-id")
  );
  const ipKey = normalizeIp(clientIp(request));
  const pageSummary =
    request.headers.get("x-tab-recap-page-summary") === "1" ||
    request.headers.get("x-tab-tidy-page-summary") === "1";
  const checks = [
    rateLimitCheck("global", `global:${day}`, limits.globalDailyRequests, secondsUntilNextUtcDay(now), 3600, now),
    rateLimitCheck("install", `install:${installId}:${day}`, limits.installDailyRequests, secondsUntilNextUtcDay(now), 3600, now),
    rateLimitCheck("ip", `ip:${ipKey}:${hour}`, limits.ipHourlyRequests, secondsUntilNextUtcHour(now), 600, now)
  ];
  if (pageSummary) {
    checks.push(rateLimitCheck(
      "page_summary",
      `page-summary:${installId}:${day}`,
      limits.installDailyPageSummaryRequests,
      secondsUntilNextUtcDay(now),
      3600,
      now
    ));
  }

  try {
    const id = env.RATE_LIMIT_DO.idFromName(RATE_LIMIT_OBJECT_NAME);
    const response = await env.RATE_LIMIT_DO.get(id).fetch("https://rate-limit.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ now: now.getTime(), checks })
    });
    const result = await response.json();
    if (!response.ok || typeof result?.ok !== "boolean") throw new Error("Invalid rate limit response.");
    if (result.ok) return { ok: true };
    return {
      ok: false,
      code: `${result.kind || "gateway"}_rate_limited`,
      message: "The default AI service is temporarily rate limited. Please try later or use a custom AI gateway.",
      headers: { "retry-after": String(Math.min(positiveInteger(result.retryAfter, 3600), 3600)) }
    };
  } catch {
    return {
      ok: false,
      code: "rate_limit_store_unavailable",
      message: "The default AI service is temporarily unavailable. Please try later or use a custom AI gateway."
    };
  }
}

function rateLimitCheck(kind, key, limit, retryAfter, cleanupBuffer, now) {
  return {
    kind,
    key,
    limit,
    retryAfter,
    expiresAt: now.getTime() + (retryAfter + cleanupBuffer) * 1000
  };
}

function normalizeRateLimitChecks(checks) {
  if (!Array.isArray(checks) || !checks.length || checks.length > 8) return null;
  const normalized = [];
  for (const check of checks) {
    const kind = String(check?.kind || "");
    const key = String(check?.key || "");
    const limit = Number(check?.limit);
    const expiresAt = Number(check?.expiresAt);
    const retryAfter = Number(check?.retryAfter);
    if (
      !/^[a-z_]{1,32}$/.test(kind) ||
      !/^[a-z0-9:._-]{1,240}$/i.test(key) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      !Number.isFinite(expiresAt) ||
      !Number.isInteger(retryAfter) ||
      retryAfter < 1
    ) {
      return null;
    }
    normalized.push({ kind, key, limit, expiresAt, retryAfter });
  }
  return normalized;
}

async function scheduleRateLimitCleanup(storage, checks) {
  if (typeof storage?.getAlarm !== "function" || typeof storage?.setAlarm !== "function") return;
  const nextExpiry = Math.min(...checks.map((check) => check.expiresAt));
  const currentAlarm = await storage.getAlarm();
  if (!Number.isFinite(Number(currentAlarm)) || Number(currentAlarm) > nextExpiry) {
    await storage.setAlarm(nextExpiry);
  }
}

function upstreamConfig(env) {
  const baseUrl = String(env.UPSTREAM_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return { ok: false, message: "UPSTREAM_BASE_URL is not configured." };
  if (!env.UPSTREAM_API_KEY) return { ok: false, message: "UPSTREAM_API_KEY is not configured." };
  return {
    ok: true,
    baseUrl,
    url: `${baseUrl}/chat/completions`,
    apiKey: env.UPSTREAM_API_KEY,
    accessClientId: env.CF_ACCESS_CLIENT_ID || "",
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET || ""
  };
}

function upstreamRequest(bodyText, upstream, signal, requestId = "") {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${upstream.apiKey}`
  };
  if (requestId) headers["x-tab-recap-request-id"] = requestId;
  if (upstream.accessClientId && upstream.accessClientSecret) {
    headers["cf-access-client-id"] = upstream.accessClientId;
    headers["cf-access-client-secret"] = upstream.accessClientSecret;
  }
  return { method: "POST", headers, body: bodyText, signal };
}

async function fetchUpstreamWithRetries(fetchImpl, upstream, bodyText, request, limits, requestId) {
  const attempts = Math.max(1, limits.upstreamRetryAttempts);
  let lastFailure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        upstream.url,
        upstreamRequest(bodyText, upstream, null, requestId),
        limits.upstreamChatTimeoutMs,
        request.signal
      );
      if (!isRetryableUpstreamStatus(response.status)) {
        return { response, attempts: attempt };
      }
      const body = await response.text().catch(() => "");
      lastFailure = classifyUpstreamFailure({ status: response.status, body, attempt, attempts });
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      lastFailure = classifyUpstreamFailure({ error, timeout: error?.name === "AbortError", attempt, attempts });
    }

    if (attempt < attempts) {
      console.warn(
        JSON.stringify({
          event: "tab_recap_upstream_retry",
          requestId,
          attempt,
          nextAttempt: attempt + 1,
          code: lastFailure?.code || "unknown"
        })
      );
      await delay(limits.upstreamRetryDelayMs * attempt);
    }
  }
  return {
    response: null,
    status: 503,
    code: lastFailure?.code || "upstream_unavailable",
    message: lastFailure?.message || "The TabRecap AI origin is temporarily unavailable.",
    details: {
      requestId,
      upstreamStatus: lastFailure?.upstreamStatus || 0,
      upstreamCode: lastFailure?.upstreamCode || "",
      attempts
    }
  };
}

function isRetryableUpstreamStatus(status) {
  return [408, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530].includes(Number(status));
}

function classifyUpstreamFailure({ status = 0, body = "", error = null, timeout = false } = {}) {
  const text = compactResponseText(body || error?.message || "");
  const upstreamCode = cloudflareErrorCode(text);
  if (timeout) {
    return {
      code: "origin_chat_timeout",
      message: "The local TabRecap AI origin did not finish the request in time.",
      upstreamStatus: 0,
      upstreamCode: ""
    };
  }
  if (upstreamCode === "1033") {
    return {
      code: "origin_tunnel_unavailable",
      message: "The local TabRecap AI origin is offline or its Cloudflare Tunnel has no healthy connection.",
      upstreamStatus: status,
      upstreamCode
    };
  }
  if (Number(status) === 530 || upstreamCode) {
    return {
      code: "origin_cloudflare_error",
      message: "Cloudflare could not reach the local TabRecap AI origin.",
      upstreamStatus: status,
      upstreamCode
    };
  }
  if (error) {
    return {
      code: "origin_fetch_failed",
      message: "The Worker could not connect to the local TabRecap AI origin.",
      upstreamStatus: 0,
      upstreamCode: ""
    };
  }
  return {
    code: "upstream_unavailable",
    message: "The TabRecap AI origin is temporarily unavailable.",
    upstreamStatus: status,
    upstreamCode: ""
  };
}

function cloudflareErrorCode(text) {
  const match = String(text || "").match(/(?:error\s*code|code)\s*:?\s*(10\d{2})/i);
  return match?.[1] || "";
}

async function upstreamReadiness(request, env, options = {}, requestId = "") {
  const check = await checkUpstreamReadiness(env, options);
  return jsonResponse(
    {
      ok: check.ok,
      worker: true,
      upstream: check
    },
    check.ok ? 200 : 503,
    {},
    request,
    requestId
  );
}

async function llmReadiness(request, env, options = {}, requestId = "") {
  const auth = validateMonitorAuth(request, env);
  if (!auth.ok) {
    return jsonError(auth.message, auth.status, auth.code, {}, request, requestId);
  }

  const check = await checkLlmReadiness(env, { ...options, requestId, signal: request.signal });
  return jsonResponse(
    {
      ok: check.ok,
      worker: true,
      llm: check
    },
    check.ok ? 200 : check.httpStatus || 503,
    {},
    request,
    requestId
  );
}

async function monitorStatus(request, env, requestId = "") {
  const auth = validateMonitorAuth(request, env);
  if (!auth.ok) {
    return jsonError(auth.message, auth.status, auth.code, {}, request, requestId);
  }

  const store = monitorStateStore(env);
  if (!store) {
    return jsonError(
      "Monitor state storage is not configured.",
      503,
      "monitor_state_store_missing",
      {},
      request,
      requestId,
      { config: monitorStatusConfig(env, false) }
    );
  }

  const state = await readMonitorState(store);
  return jsonResponse(
    {
      ok: true,
      worker: true,
      monitor: summarizeMonitorState(state),
      config: monitorStatusConfig(env, true)
    },
    200,
    {},
    request,
    requestId
  );
}

async function checkUpstreamReadiness(env, options = {}) {
  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return { ok: false, code: "upstream_not_configured", message: upstream.message };
  }

  const limits = readLimits(env);
  const url = upstreamHealthUrl(env, upstream);
  const fetchImpl = options.fetchImpl || fetch;
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: "GET", headers: upstreamHealthHeaders(upstream) },
      limits.upstreamReadyTimeoutMs
    );
    const body = await response.text().catch(() => "");
    const ok = response.ok;
    const failure = ok ? null : classifyUpstreamFailure({ status: response.status, body });
    return {
      ok,
      status: response.status,
      code: ok ? "ready" : failure.code,
      message: ok ? "" : failure.message,
      upstreamCode: failure?.upstreamCode || "",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      code: "origin_health_check_failed",
      message: compactResponseText(error?.message || "Health check failed."),
      latencyMs: Date.now() - startedAt
    };
  }
}

async function checkLlmReadiness(env, options = {}) {
  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return { ok: false, code: "upstream_not_configured", message: upstream.message, httpStatus: 503 };
  }

  const model = String(env.LLM_READY_MODEL || DEFAULT_LLM_READY_MODEL).trim();
  if (!allowedModels(env).includes(model)) {
    return {
      ok: false,
      code: "llm_ready_model_not_allowed",
      message: "The configured LLM health model is not in the Worker allowlist.",
      model,
      httpStatus: 503
    };
  }

  const limits = readLimits(env);
  const bodyText = JSON.stringify({
    model,
    messages: [
      { role: "system", content: "You are a health check endpoint. Reply with OK only." },
      { role: "user", content: "Return OK." }
    ],
    max_tokens: limits.llmReadyMaxTokens,
    reasoning_effort: String(env.LLM_READY_REASONING_EFFORT || DEFAULT_LLM_READY_REASONING_EFFORT).trim() || DEFAULT_LLM_READY_REASONING_EFFORT
  });
  const fetchImpl = options.fetchImpl || fetch;
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      upstream.url,
      upstreamRequest(bodyText, upstream, null, options.requestId || ""),
      limits.llmReadyTimeoutMs,
      options.signal
    );
    const text = await response.text().catch(() => "");
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const failure = classifyUpstreamFailure({ status: response.status, body: text });
      return {
        ok: false,
        status: response.status,
        code: failure.code,
        message: failure.message,
        upstreamCode: failure.upstreamCode || "",
        latencyMs,
        model,
        httpStatus: 503
      };
    }

    const validation = validateLlmReadyResponse(text);
    if (!validation.ok) {
      return {
        ok: false,
        status: response.status,
        code: validation.code,
        message: validation.message,
        latencyMs,
        model,
        httpStatus: 502
      };
    }

    return {
      ok: true,
      status: response.status,
      code: "llm_ready",
      latencyMs,
      model,
      httpStatus: 200
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === "AbortError" ? "llm_ready_timeout" : "llm_ready_failed",
      message: compactResponseText(error?.message || "LLM readiness check failed."),
      latencyMs: Date.now() - startedAt,
      model,
      httpStatus: 503
    };
  }
}

function validateMonitorAuth(request, env) {
  const expected = String(env.MONITOR_TOKEN || "").trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "monitor_token_not_configured",
      message: "LLM readiness monitoring is not configured."
    };
  }
  const provided = monitorTokenFromRequest(request);
  if (!constantTimeStringEqual(provided, expected)) {
    return {
      ok: false,
      status: 401,
      code: "monitor_token_required",
      message: "A valid monitor token is required."
    };
  }
  return { ok: true };
}

function monitorTokenFromRequest(request) {
  const header = request.headers.get("x-monitor-token") || "";
  if (header) return header.trim();
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function constantTimeStringEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function runGatewayMonitorChecks(env, options = {}) {
  const readyz = await checkUpstreamReadiness(env, options);
  const llm = readyz.ok
    ? await checkLlmReadiness(env, options)
    : skippedLlmReadinessCheck();
  return { readyz, llm, requestId: options.requestId || "" };
}

function skippedLlmReadinessCheck() {
  return {
    ok: true,
    skipped: true,
    code: "skipped",
    message: "Skipped because readyz failed before the real LLM probe.",
    model: DEFAULT_LLM_READY_MODEL,
    httpStatus: 0
  };
}

function monitorSummary(checks) {
  const ok = Boolean(checks.readyz?.ok && checks.llm?.ok);
  const failed = [];
  if (!checks.readyz?.ok) failed.push("readyz");
  if (!checks.llm?.ok) failed.push("llm-readyz");
  return {
    ok,
    status: ok ? "ok" : "down",
    failed,
    requestId: checks.requestId || "",
    readyzCode: checks.readyz?.code || "unknown",
    llmCode: checks.llm?.code || "unknown",
    llmModel: checks.llm?.model || DEFAULT_LLM_READY_MODEL
  };
}

function monitorStateStore(env) {
  return env.MONITOR_STATE_KV || env.RATE_LIMIT_KV || null;
}

async function readMonitorState(store) {
  if (!store) return null;
  try {
    const raw = await store.get(MONITOR_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeMonitorState(store, state) {
  if (!store) return;
  await store.put(MONITOR_STATE_KEY, JSON.stringify(state));
}

function monitorNotificationEvent(previousState, summary, now, env) {
  if (summary.ok) {
    if (previousState?.status === "down") {
      return { type: "recovered", previousStatus: previousState.status };
    }
    return { type: "none" };
  }

  if (!previousState || previousState.status !== "down") {
    return { type: "down", previousStatus: previousState?.status || "unknown" };
  }

  const reminderMs = positiveInteger(env.MONITOR_REMINDER_HOURS, DEFAULT_MONITOR_REMINDER_HOURS) * 60 * 60 * 1000;
  const lastAlertAt = Date.parse(previousState.lastAlertAt || 0);
  if (!Number.isFinite(lastAlertAt) || now.getTime() - lastAlertAt >= reminderMs) {
    return { type: "still_down", previousStatus: previousState.status };
  }

  return { type: "none" };
}

function nextMonitorState(previousState, summary, event, now) {
  const nowIso = now.toISOString();
  const previousFirstFailureAt = previousState?.firstFailureAt || previousState?.lastFailureAt || "";
  return {
    status: summary.status,
    lastStatusAt: nowIso,
    lastOkAt: summary.ok ? nowIso : previousState?.lastOkAt || "",
    firstFailureAt: summary.ok ? "" : previousFirstFailureAt || nowIso,
    lastFailureAt: summary.ok ? previousState?.lastFailureAt || "" : nowIso,
    lastAlertAt: event.type === "none" ? previousState?.lastAlertAt || "" : nowIso,
    lastEvent: event.type,
    lastSummary: summary,
    lastEmail: previousState?.lastEmail || null
  };
}

function summarizeMonitorState(state) {
  if (!state || typeof state !== "object") {
    return {
      ok: false,
      status: "unknown",
      lastStatusAt: "",
      lastOkAt: "",
      firstFailureAt: "",
      lastFailureAt: "",
      lastAlertAt: "",
      lastEvent: "none",
      lastSummary: null,
      lastEmail: null
    };
  }

  return {
    ok: state.status === "ok",
    status: safeMonitorStatus(state.status),
    lastStatusAt: safeIsoString(state.lastStatusAt),
    lastOkAt: safeIsoString(state.lastOkAt),
    firstFailureAt: safeIsoString(state.firstFailureAt),
    lastFailureAt: safeIsoString(state.lastFailureAt),
    lastAlertAt: safeIsoString(state.lastAlertAt),
    lastEvent: safeMonitorEvent(state.lastEvent),
    lastSummary: safeMonitorSummary(state.lastSummary),
    lastEmail: safeMonitorEmail(state.lastEmail)
  };
}

function monitorStatusConfig(env, hasStateStore) {
  const email = monitorEmailConfig(env);
  const upstream = upstreamConfig(env);
  return {
    stateStore: hasStateStore ? "configured" : "missing",
    email: email.ok ? "configured" : email.code || "missing",
    upstream: upstream.ok ? "configured" : "missing",
    llmReadyModel: String(env.LLM_READY_MODEL || DEFAULT_LLM_READY_MODEL).trim() || DEFAULT_LLM_READY_MODEL,
    llmReadyReasoningEffort:
      String(env.LLM_READY_REASONING_EFFORT || DEFAULT_LLM_READY_REASONING_EFFORT).trim() || DEFAULT_LLM_READY_REASONING_EFFORT,
    upstreamChatTimeoutMs: readLimits(env).upstreamChatTimeoutMs,
    llmReadyMaxTokens: readLimits(env).llmReadyMaxTokens,
    monitorReminderHours: positiveInteger(env.MONITOR_REMINDER_HOURS, DEFAULT_MONITOR_REMINDER_HOURS),
    schedule: "*/30 * * * *"
  };
}

function safeMonitorSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    ok: Boolean(summary.ok),
    status: safeMonitorStatus(summary.status),
    failed: Array.isArray(summary.failed) ? summary.failed.map(safeMonitorFailure).filter(Boolean) : [],
    requestId: safeRequestId(summary.requestId),
    readyzCode: safeMonitorCode(summary.readyzCode),
    llmCode: safeMonitorCode(summary.llmCode),
    llmModel: safeModelName(summary.llmModel || DEFAULT_LLM_READY_MODEL)
  };
}

function safeMonitorEmail(email) {
  if (!email || typeof email !== "object") return null;
  return {
    ok: Boolean(email.ok),
    status: Number.isInteger(Number(email.status)) ? Number(email.status) : 0,
    code: safeMonitorCode(email.code),
    at: safeIsoString(email.at)
  };
}

function safeMonitorStatus(status) {
  return ["ok", "down", "unknown", "not_configured"].includes(status) ? status : "unknown";
}

function safeMonitorEvent(event) {
  return ["none", "down", "still_down", "recovered", "not_configured"].includes(event) ? event : "none";
}

function safeMonitorFailure(value) {
  return ["readyz", "llm-readyz", "email"].includes(value) ? value : "";
}

function safeMonitorCode(value) {
  const text = String(value || "").trim();
  return /^[a-z0-9_.:-]{0,80}$/i.test(text) ? text : "unknown";
}

function safeModelName(value) {
  const text = String(value || "").trim();
  return /^[a-z0-9_.:-]{1,120}$/i.test(text) ? text : DEFAULT_LLM_READY_MODEL;
}

function safeRequestId(value) {
  const text = String(value || "").trim();
  return /^[a-z0-9_-]{0,120}$/i.test(text) ? text : "";
}

function safeIsoString(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

async function sendMonitorEmail(env, event, summary, checks, now, fetchImpl) {
  const config = monitorEmailConfig(env);
  if (!config.ok) return config;

  try {
    const response = await fetchImpl(RESEND_EMAIL_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: monitorEmailSubject(event, summary),
        text: monitorEmailText(event, summary, checks, now)
      })
    });
    if (response.ok) return { ok: true, status: response.status };
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      code: "resend_failed",
      message: compactResponseText(body)
    };
  } catch (error) {
    return {
      ok: false,
      code: "resend_fetch_failed",
      message: compactResponseText(error?.message || "Failed to send monitor email.")
    };
  }
}

function monitorEmailConfig(env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.ALERT_TO || "").trim();
  const from = String(env.ALERT_FROM || "").trim();
  if (!apiKey) return { ok: false, code: "resend_api_key_missing" };
  if (!to) return { ok: false, code: "alert_to_missing" };
  if (!from) return { ok: false, code: "alert_from_missing" };
  return { ok: true, apiKey, to, from };
}

function monitorEmailSubject(event, summary) {
  if (event.type === "recovered") return "[TabRecap] AI gateway recovered";
  if (event.type === "still_down") return "[TabRecap] AI gateway is still down";
  return `[TabRecap] AI gateway is down: ${summary.failed.join(", ") || "unknown"}`;
}

function monitorEmailText(event, summary, checks, now) {
  const statusLine =
    event.type === "recovered"
      ? "The TabRecap AI gateway recovered."
      : event.type === "still_down"
        ? "The TabRecap AI gateway is still failing."
        : "The TabRecap AI gateway started failing.";
  return [
    statusLine,
    "",
    `Time: ${now.toISOString()}`,
    `Overall: ${summary.status}`,
    `Request ID: ${summary.requestId || "-"}`,
    "",
    "Checks:",
    `- readyz: ${formatMonitorCheck(checks.readyz)}`,
    `- llm-readyz: ${formatMonitorCheck(checks.llm)}`,
    "",
    "Interpretation:",
    "- readyz checks Worker -> Cloudflare Tunnel -> local API-only proxy health.",
    `- llm-readyz sends a tiny real ${checks.llm?.model || DEFAULT_LLM_READY_MODEL} / low / max_tokens=2 request only after readyz passes.`,
    "",
    "Runbook:",
    "1. Check https://cliproxy.sylvanyu.io/readyz",
    "2. If readyz fails, restart the local CLIProxyAPI stack and Cloudflare Tunnel.",
    "3. If readyz passes but llm-readyz fails, inspect model availability and CLIProxyAPI logs."
  ].join("\n");
}

function formatMonitorCheck(check) {
  if (!check) return "missing";
  if (check.skipped) {
    return [
      "skipped",
      `code=${check.code || "skipped"}`,
      check.model ? `model=${check.model}` : "",
      check.message ? `message=${check.message}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    check.ok ? "ok" : "failed",
    `code=${check.code || "unknown"}`,
    check.status ? `status=${check.status}` : "",
    Number.isFinite(check.latencyMs) ? `latency=${check.latencyMs}ms` : "",
    check.model ? `model=${check.model}` : "",
    check.message ? `message=${check.message}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function validateLlmReadyResponse(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, code: "llm_ready_invalid_json", message: "The LLM health check did not return JSON." };
  }
  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    payload?.output_text ||
    "";
  if (!String(content).trim()) {
    return { ok: false, code: "llm_ready_empty_response", message: "The LLM health check returned an empty response." };
  }
  return { ok: true };
}

function upstreamHealthUrl(env, upstream) {
  if (env.UPSTREAM_HEALTH_URL) return String(env.UPSTREAM_HEALTH_URL);
  return new URL(String(env.UPSTREAM_HEALTH_PATH || "/healthz"), upstream.baseUrl).toString();
}

function upstreamHealthHeaders(upstream) {
  const headers = {};
  if (upstream.accessClientId && upstream.accessClientSecret) {
    headers["cf-access-client-id"] = upstream.accessClientId;
    headers["cf-access-client-secret"] = upstream.accessClientSecret;
  }
  return headers;
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal = null) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else if (externalSignal?.addEventListener) {
    externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (externalSignal?.removeEventListener) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  });
}

async function relayUpstreamResponse(response, request, requestId = "", attempts = 1) {
  if (!response.ok) {
    return relayUpstreamErrorResponse(response, request, requestId, attempts);
  }
  const headers = {
    ...corsHeaders(request),
    "cache-control": "no-store",
    "content-type": response.headers.get("content-type") || "application/json",
    ...requestIdHeaders(requestId),
    "x-tab-recap-upstream-attempts": String(attempts || 1)
  };
  return new Response(response.body, { status: response.status, headers });
}

async function relayUpstreamErrorResponse(response, request, requestId = "", attempts = 1) {
  const text = await response.text().catch(() => "");
  const status = Number(response.status) || 502;
  const upstreamCode = cloudflareErrorCode(text);
  const retryAfter = response.headers.get("retry-after") || "20";
  const code =
    upstreamCode === "1033"
      ? "origin_tunnel_unavailable"
      : upstreamCode
        ? "origin_cloudflare_error"
        : status === 429
          ? "upstream_rate_limited"
          : status === 401 || status === 403
            ? "upstream_auth_failed"
            : status === 400
              ? "upstream_rejected_request"
              : "upstream_error";
  const message =
    code === "origin_tunnel_unavailable"
      ? "The local TabRecap AI origin is offline or its Cloudflare Tunnel has no healthy connection."
      : code === "origin_cloudflare_error"
        ? "Cloudflare could not reach the local TabRecap AI origin."
        : status === 429
          ? "The TabRecap AI upstream is temporarily rate limited."
          : "The TabRecap AI upstream did not complete the request.";
  return jsonError(
    message,
    503,
    code,
    { "retry-after": retryAfter },
    request,
    requestId,
    {
      upstreamStatus: status,
      upstreamCode,
      attempts: Number(attempts) || 1
    }
  );
}

function allowedModels(env) {
  const configured = String(env.ALLOWED_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = configured.length ? configured : DEFAULT_ALLOWED_MODELS;
  return models
    .filter((model, index, values) => values.indexOf(model) === index);
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function normalizeIp(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, "_")
    .slice(0, 80) || "unknown";
}

function normalizeInstallId(value) {
  return String(value || "missing")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80) || "missing";
}

function secondsUntilNextUtcDay(now) {
  return Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
}

function secondsUntilNextUtcHour(now) {
  return Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1) - now.getTime()) / 1000));
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function requestIdFor(request) {
  const provided = request.headers.get("x-tab-recap-request-id") || request.headers.get("x-request-id") || "";
  const normalized = String(provided)
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 96);
  return normalized || crypto.randomUUID();
}

function requestIdHeaders(requestId) {
  return requestId ? { "x-tab-recap-request-id": requestId } : {};
}

function jsonError(message, status, code, extraHeaders = {}, request = null, requestId = "", details = {}) {
  return jsonResponse({ error: { message, code, requestId, ...details } }, status, extraHeaders, request, requestId);
}

function jsonResponse(value, status = 200, extraHeaders = {}, request = null, requestId = "") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...requestIdHeaders(requestId),
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function emptyResponse(status, request = null, requestId = "") {
  return new Response(null, {
    status,
    headers: {
      ...corsHeaders(request),
      ...requestIdHeaders(requestId),
      "cache-control": "no-store"
    }
  });
}

function corsHeaders(request) {
  const origin = request?.headers?.get?.("origin") || "";
  const allowedOrigin = allowedCorsOrigin(origin);
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-monitor-token,x-tab-recap-install-id,x-tab-recap-page-summary,x-tab-recap-request-id,x-request-id,x-tab-tidy-install-id,x-tab-tidy-page-summary",
    "access-control-expose-headers": "x-tab-recap-request-id,x-tab-recap-upstream-attempts",
    vary: "Origin"
  };
}

function allowedCorsOrigin(origin) {
  if (!origin) return "*";
  if (/^(chrome|moz)-extension:\/\/[a-z0-9_-]+$/i.test(origin)) return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return origin;
  return "";
}

function compactResponseText(text) {
  return redactSensitiveText(text, { redactUrls: true })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function redactSensitiveText(value, options = {}) {
  return String(value || "")
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(authorization)\s*([:=])\s*[^\n\r<>]+/gi, (_match, key, separator) =>
      separator === ":" ? `${key}: [redacted]` : `${key}=[redacted]`
    )
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\n\r<>]+/gi, (_match, key) => `${key}: [redacted]`)
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/\bre_[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]")
    .replace(/\bghp_[A-Za-z0-9_]{36,}\b/g, "[redacted-key]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, "[redacted-key]")
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]")
    .replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, "[redacted-key]")
    .replace(/\bhf_[A-Za-z0-9]{20,}\b/g, "[redacted-key]")
    .replace(/\bxai-[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted-key]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]")
    .replace(
      /((?:["']?)(?:x[_-]?api[_-]?key|api[_-]?key|client[_-]?secret|cf[_-]?access[_-]?client[_-]?secret|webhook[_-]?secret|signing[_-]?secret|private[_-]?key|session[_-]?key|personal[_-]?access[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password)(?:["']?)\s*[:=]\s*)(["']?)[^"',\s;&<>}]+(\2)/gi,
      "$1$2[redacted]$3"
    )
    .replace(/([?&](?:x[_-]?api[_-]?key|api[_-]?key|client[_-]?secret|cf[_-]?access[_-]?client[_-]?secret|webhook[_-]?secret|signing[_-]?secret|private[_-]?key|session[_-]?key|personal[_-]?access[_-]?token|access_token|refresh_token|id_token|token|secret|password|key)=)[^&\s"')<>]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"')<>]+/gi, (rawUrl) => {
      if (options.redactUrls) return options.fallback || "[redacted-url]";
      return redactSensitiveUrl(rawUrl);
    });
}

function redactSensitiveUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    return `${url.protocol}//${url.hostname}${url.pathname && url.pathname !== "/" ? "/..." : ""}`;
  } catch {
    return "[redacted-url]";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
