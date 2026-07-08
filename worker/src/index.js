const PROGRESS_COPY_MODEL = "gpt-5.3-codex-spark";
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

  const rateLimit = await checkRateLimits(request, env, limits);
  if (!rateLimit.ok) {
    return jsonError(rateLimit.message, 429, rateLimit.code, rateLimit.headers, request, requestId);
  }

  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return jsonError(upstream.message, 503, "upstream_not_configured", {}, request, requestId);
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
    return { ok: false, code: "model_not_allowed", message: "This model is not available on the free gateway." };
  }
  const fieldValidation = validateTopLevelFields(body);
  if (!fieldValidation.ok) return fieldValidation;
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return { ok: false, code: "invalid_messages", message: "messages must be a non-empty array." };
  }
  if (body.response_format?.type !== "json_object") {
    return { ok: false, code: "json_required", message: "TabRecap gateway requests must use JSON object output." };
  }
  if (Number(body.max_tokens || 0) > limits.maxTokens) {
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
  if (!/Chrome tab organization extension|Chrome extension runtime|Chrome tab organization/i.test(systemText)) {
    return { ok: false, code: "planner_shape_required", message: "Planner system prompt is not recognized as a TabRecap request." };
  }
  if (!/browser tabs|browser tab inventory|tab inventory|broad semantic buckets/i.test(userText)) {
    return { ok: false, code: "planner_shape_required", message: "Planner user payload is not recognized as a TabRecap request." };
  }
  if (!/"tabFields"\s*:/.test(userText) || !/"tabs"\s*:/.test(userText)) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload must include compact TabRecap tab fields." };
  }
  return { ok: true };
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
  if (!/TabRecap|time recap writer|work recap/i.test(systemText)) {
    return { ok: false, code: "recap_shape_required", message: "Recap system prompt is not recognized as a TabRecap request." };
  }
  if (!/tab_recap_time_recap_input_v1|tab_tidy_time_recap_input_v1|local time-recap input/i.test(userText)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload is not recognized as a TabRecap request." };
  }
  if (!/"pageFields"\s*:/.test(userText) || !/"pages"\s*:/.test(userText) || !/"coverage"\s*:/.test(userText)) {
    return { ok: false, code: "recap_payload_required", message: "Recap payload must include compact TabRecap page fields." };
  }
  return { ok: true };
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
  if (!/AI browser-tab organization extension|loading captions/i.test(systemText)) {
    return { ok: false, code: "spark_shape_required", message: "Progress copy system prompt is not recognized as a TabRecap request." };
  }
  let payload;
  try {
    payload = JSON.parse(userText);
  } catch {
    return { ok: false, code: "spark_payload_required", message: "Progress copy user payload must be JSON." };
  }
  if (!payload || typeof payload !== "object" || !("languageMode" in payload) || !("phase" in payload)) {
    return { ok: false, code: "spark_payload_required", message: "Progress copy payload must include TabRecap progress fields." };
  }
  return { ok: true };
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
  }
  return "";
}

function forwardedChatBody(body) {
  return Object.fromEntries(FORWARDED_CHAT_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

async function checkRateLimits(request, env, limits) {
  if (!env.RATE_LIMIT_KV) {
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
    ["global", `global:${day}`, limits.globalDailyRequests, secondsUntilNextUtcDay(now) + 3600],
    ["install", `install:${installId}:${day}`, limits.installDailyRequests, secondsUntilNextUtcDay(now) + 3600],
    ["ip", `ip:${ipKey}:${hour}`, limits.ipHourlyRequests, secondsUntilNextUtcHour(now) + 600]
  ];
  if (pageSummary) {
    checks.push([
      "page_summary",
      `page-summary:${installId}:${day}`,
      limits.installDailyPageSummaryRequests,
      secondsUntilNextUtcDay(now) + 3600
    ]);
  }

  const currentValues = await Promise.all(checks.map(([, key]) => env.RATE_LIMIT_KV.get(key)));
  const currentCounts = [];
  for (const [position, [kind, key, limit, ttlSeconds]] of checks.entries()) {
    const current = Number(currentValues[position]) || 0;
    if (current + 1 > limit) {
      return {
        ok: false,
        code: `${kind}_rate_limited`,
        message: "The free gateway is temporarily rate limited. Please try later or use a custom gateway.",
        headers: { "retry-after": String(Math.min(ttlSeconds, 3600)) }
      };
    }
    currentCounts.push([key, current + 1, ttlSeconds]);
  }

  await Promise.all(
    currentCounts.map(([key, next, ttlSeconds]) => env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: ttlSeconds }))
  );
  return { ok: true };
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
      const response = await fetchImpl(upstream.url, upstreamRequest(bodyText, upstream, request.signal, requestId));
      if (!isRetryableUpstreamStatus(response.status)) {
        return { response, attempts: attempt };
      }
      const body = await response.text().catch(() => "");
      lastFailure = classifyUpstreamFailure({ status: response.status, body, attempt, attempts });
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      lastFailure = classifyUpstreamFailure({ error, attempt, attempts });
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

function classifyUpstreamFailure({ status = 0, body = "", error = null } = {}) {
  const text = compactResponseText(body || error?.message || "");
  const upstreamCode = cloudflareErrorCode(text);
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
      upstreamRequest(bodyText, upstream, options.signal, options.requestId || ""),
      limits.llmReadyTimeoutMs
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
  const [readyz, llm] = await Promise.all([
    checkUpstreamReadiness(env, options),
    checkLlmReadiness(env, options)
  ]);
  return { readyz, llm, requestId: options.requestId || "" };
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
  return {
    status: summary.status,
    lastStatusAt: nowIso,
    lastOkAt: summary.ok ? nowIso : previousState?.lastOkAt || "",
    lastFailureAt: summary.ok ? previousState?.lastFailureAt || "" : previousState?.lastFailureAt || nowIso,
    lastAlertAt: event.type === "none" ? previousState?.lastAlertAt || "" : nowIso,
    lastEvent: event.type,
    lastSummary: summary
  };
}

function summarizeMonitorState(state) {
  if (!state || typeof state !== "object") {
    return {
      ok: false,
      status: "unknown",
      lastStatusAt: "",
      lastOkAt: "",
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
    "- llm-readyz sends a tiny real gpt-5.4-mini / low / max_tokens=2 request.",
    "",
    "Runbook:",
    "1. Check https://cliproxy.sylvanyu.io/readyz",
    "2. If readyz fails, restart the local CLIProxyAPI stack and Cloudflare Tunnel.",
    "3. If readyz passes but llm-readyz fails, inspect model availability and CLIProxyAPI logs."
  ].join("\n");
}

function formatMonitorCheck(check) {
  if (!check) return "missing";
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

function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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
