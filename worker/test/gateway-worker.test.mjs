import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, GATEWAY_MODELS } from "../../src/shared/settings.js";
import { createWorkerHandler, runScheduledMonitor } from "../src/index.js";

const handle = createWorkerHandler({
  fetchImpl: async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
});

test("worker health check returns ok without upstream secrets", async () => {
  const response = await handle(new Request("https://cliproxy.example/healthz"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("worker readiness check reaches the configured local origin health endpoint", async () => {
  const calls = [];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response("ok", { status: 200 });
    }
  });

  const response = await localHandle(new Request("https://cliproxy.example/readyz"), envWithKv());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.upstream.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://raw-llm.example/healthz");
});

test("worker protects the real LLM readiness check with a monitor token", async () => {
  const missingConfig = await handle(new Request("https://cliproxy.example/llm-readyz"), envWithKv());
  assert.equal(missingConfig.status, 503);
  assert.equal((await missingConfig.json()).error.code, "monitor_token_not_configured");

  const unauthorized = await handle(new Request("https://cliproxy.example/llm-readyz"), envWithKv({ MONITOR_TOKEN: "secret" }));
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "monitor_token_required");
});

test("worker LLM readiness check uses the tiny mini-model probe", async () => {
  const calls = [];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await localHandle(
    new Request("https://cliproxy.example/llm-readyz", {
      headers: {
        "x-monitor-token": "secret",
        "x-tab-recap-request-id": "monitor_ping"
      }
    }),
    envWithKv({ MONITOR_TOKEN: "secret" })
  );
  const body = await response.json();
  const upstreamBody = JSON.parse(calls[0].options.body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.llm.model, "gpt-5.4-mini");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://raw-llm.example/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer upstream-secret");
  assert.equal(calls[0].options.headers["x-tab-recap-request-id"], "monitor_ping");
  assert.equal(upstreamBody.model, "gpt-5.4-mini");
  assert.equal(upstreamBody.reasoning_effort, "low");
  assert.equal(upstreamBody.max_tokens, 2);
});

test("worker LLM readiness errors are redacted before monitor responses", async () => {
  const providerKey = ["sk", "worker", "readyz", "secret", "1234567890"].join("-");
  const bearer = "gateway-monitor-secret-1234567890";
  const tokenizedUrl = "https://raw-llm.example/private/health?token=abc123&api_key=def456";
  const pemBegin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const pemEnd = ["-----END", "PRIVATE KEY-----"].join(" ");
  const pemBody = "worker-pem-private-key-material";
  const structuredSecrets = [
    "worker-auth-secret-123456",
    "worker-cookie-secret",
    "worker-api-field-secret",
    "worker-private-key-secret",
    "worker-session-key-secret",
    "worker-access-token-secret"
  ];
  const cloudKeys = [
    ["re", "A".repeat(22)].join("_"),
    ["ghp", "B".repeat(36)].join("_"),
    ["github", "pat", "C".repeat(80)].join("_"),
    ["glpat", "D".repeat(24)].join("-"),
    ["gsk", "E".repeat(28)].join("_"),
    ["hf", "F".repeat(28)].join("_"),
    ["xai", "G".repeat(28)].join("-"),
    `AIza${"H".repeat(35)}`,
    `AKIA${"I".repeat(16)}`
  ];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/chat/completions")) {
        throw new Error(
          [
            `failed ${tokenizedUrl} with Bearer ${bearer}, ${providerKey}, ${cloudKeys.join(", ")}`,
            `${pemBegin}\n${pemBody}\n${pemEnd}`,
            `Authorization: Bearer ${structuredSecrets[0]}`,
            `Cookie: sid=${structuredSecrets[1]}`,
            `api_key=${structuredSecrets[2]}`,
            `private_key=${structuredSecrets[3]}`,
            `"session-key":"${structuredSecrets[4]}"`,
            `"accessToken":"${structuredSecrets[5]}"`
          ].join("\n")
        );
      }
      return new Response("ok", { status: 200 });
    }
  });

  const response = await localHandle(
    new Request("https://cliproxy.example/llm-readyz", {
      headers: { "x-monitor-token": "secret" }
    }),
    envWithKv({ MONITOR_TOKEN: "secret" })
  );
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 503);
  assert.equal(body.llm.code, "llm_ready_failed");
  assert.equal(serialized.includes(providerKey), false);
  assert.equal(serialized.includes(bearer), false);
  assert.equal(serialized.includes("token=abc123"), false);
  assert.equal(serialized.includes("api_key=def456"), false);
  assert.equal(serialized.includes("raw-llm.example"), false);
  assert.equal(serialized.includes("/private/health"), false);
  assert.equal(serialized.includes(pemBegin), false);
  assert.equal(serialized.includes(pemBody), false);
  assert.equal(serialized.includes(pemEnd), false);
  for (const secret of structuredSecrets) {
    assert.equal(serialized.includes(secret), false);
  }
  for (const key of cloudKeys) {
    assert.equal(serialized.includes(key), false);
  }
  assert.equal(serialized.includes("[redacted-key]"), true);
  assert.equal(serialized.includes("Bearer [redacted]"), true);
  assert.equal(serialized.includes("[redacted-url]"), true);
});

test("worker protects the monitor status snapshot with a monitor token", async () => {
  const missingConfig = await handle(new Request("https://cliproxy.example/monitor/status"), envWithKv());
  assert.equal(missingConfig.status, 503);
  assert.equal((await missingConfig.json()).error.code, "monitor_token_not_configured");

  const unauthorized = await handle(new Request("https://cliproxy.example/monitor/status"), envWithKv({ MONITOR_TOKEN: "secret" }));
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "monitor_token_required");
});

test("worker monitor status reads the last scheduled result without live upstream checks", async () => {
  const env = monitorEnv({ MONITOR_TOKEN: "secret" });
  const scheduledFetch = monitorFetch({ readyzStatus: 530, readyzBody: "error code: 1033" });

  await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: scheduledFetch.fetch
  });

  let liveFetchCalled = false;
  const localHandle = createWorkerHandler({
    fetchImpl: async () => {
      liveFetchCalled = true;
      return new Response("unexpected", { status: 500 });
    }
  });
  const response = await localHandle(
    new Request("https://cliproxy.example/monitor/status", {
      headers: { "x-monitor-token": "secret" }
    }),
    env
  );
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(liveFetchCalled, false);
  assert.equal(body.ok, true);
  assert.equal(body.monitor.status, "down");
  assert.equal(body.monitor.ok, false);
  assert.equal(body.monitor.lastSummary.readyzCode, "origin_tunnel_unavailable");
  assert.equal(body.monitor.lastSummary.failed.includes("readyz"), true);
  assert.equal(body.monitor.lastEmail.ok, true);
  assert.equal(body.config.stateStore, "configured");
  assert.equal(body.config.email, "configured");
  assert.equal(body.config.upstream, "configured");
  assert.equal(body.config.llmReadyModel, "gpt-5.4-mini");
  assert.equal(serialized.includes("upstream-secret"), false);
  assert.equal(serialized.includes("resend-secret"), false);
  assert.equal(serialized.includes("me@sylvanyu.io"), false);
  assert.equal(serialized.includes("raw-llm.example"), false);
});

test("worker monitor status reports unknown before the first scheduled run", async () => {
  const response = await handle(
    new Request("https://cliproxy.example/monitor/status", {
      headers: { authorization: "Bearer secret" }
    }),
    monitorEnv({ MONITOR_TOKEN: "secret" })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.monitor.status, "unknown");
  assert.equal(body.monitor.lastSummary, null);
  assert.equal(body.monitor.lastEmail, null);
});

test("worker monitor status reports missing state storage without exposing config secrets", async () => {
  const response = await handle(
    new Request("https://cliproxy.example/monitor/status", {
      headers: { "x-monitor-token": "secret" }
    }),
    monitorEnv({ MONITOR_TOKEN: "secret", RATE_LIMIT_KV: undefined, MONITOR_STATE_KV: undefined })
  );
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "monitor_state_store_missing");
  assert.equal(body.error.config.stateStore, "missing");
  assert.equal(serialized.includes("upstream-secret"), false);
  assert.equal(serialized.includes("resend-secret"), false);
});

test("scheduled monitor keeps quiet on healthy checks", async () => {
  const calls = monitorFetch();
  const result = await runScheduledMonitor(monitorEnv(), {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: calls.fetch
  });

  assert.equal(result.ok, true);
  assert.equal(result.event, "none");
  assert.equal(calls.emails.length, 0);
});

test("scheduled monitor does not spend LLM tokens before email is configured", async () => {
  const calls = monitorFetch();
  const result = await runScheduledMonitor(envWithKv(), {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: calls.fetch
  });

  assert.equal(result.event, "not_configured");
  assert.equal(calls.calls.length, 0);
  assert.equal(calls.emails.length, 0);
});

test("scheduled monitor does not spend LLM tokens before state storage is configured", async () => {
  const calls = monitorFetch();
  const result = await runScheduledMonitor(monitorEnv({ RATE_LIMIT_KV: undefined, MONITOR_STATE_KV: undefined }), {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: calls.fetch
  });

  assert.equal(result.event, "not_configured");
  assert.equal(result.summary.failed.includes("state"), true);
  assert.equal(calls.calls.length, 0);
  assert.equal(calls.emails.length, 0);
});

test("scheduled monitor alerts on outage, suppresses duplicate mail, and reminds later", async () => {
  const env = monitorEnv({ MONITOR_REMINDER_HOURS: "6" });
  const calls = monitorFetch({ llmStatus: 503, llmBody: "upstream temporarily unavailable" });

  const first = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: calls.fetch
  });
  const duplicate = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:30:00.000Z"),
    fetchImpl: calls.fetch
  });
  const reminder = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T06:30:00.000Z"),
    fetchImpl: calls.fetch
  });

  assert.equal(first.ok, false);
  assert.equal(first.event, "down");
  assert.equal(duplicate.event, "none");
  assert.equal(reminder.event, "still_down");
  assert.equal(calls.emails.length, 2);
  assert.match(calls.emails[0].subject, /down: llm-readyz/);
  assert.match(calls.emails[1].subject, /still down/);
});

test("scheduled monitor retries alert mail when the email API fails", async () => {
  const env = monitorEnv({ MONITOR_REMINDER_HOURS: "6" });
  const firstMailFails = monitorFetch({
    llmStatus: 503,
    llmBody: "upstream temporarily unavailable",
    emailStatuses: [500, 200]
  });

  const first = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: firstMailFails.fetch
  });
  const retry = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:30:00.000Z"),
    fetchImpl: firstMailFails.fetch
  });

  assert.equal(first.event, "down");
  assert.equal(retry.event, "still_down");
  assert.equal(firstMailFails.emails.length, 2);
});

test("scheduled monitor sends recovery mail after a failed state", async () => {
  const env = monitorEnv();
  const failing = monitorFetch({ readyzStatus: 530, readyzBody: "error code: 1033" });
  const healthy = monitorFetch();

  await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl: failing.fetch
  });
  const result = await runScheduledMonitor(env, {
    scheduledTime: Date.parse("2026-07-02T00:30:00.000Z"),
    fetchImpl: healthy.fetch
  });

  assert.equal(result.ok, true);
  assert.equal(result.event, "recovered");
  assert.equal(failing.emails.length, 1);
  assert.equal(healthy.emails.length, 1);
  assert.match(healthy.emails[0].subject, /recovered/);
});

test("scheduled monitor emails redact thrown readiness details", async () => {
  const providerKey = ["sk", "worker", "email", "secret", "1234567890"].join("-");
  const bearer = "monitor-email-secret-1234567890";
  const tokenizedUrl = "https://raw-llm.example/private/status?token=abc123&secret=def456";
  const privateKey = "monitor-private-key-secret";
  const sessionKey = "monitor-session-key-secret";
  const pemBegin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const pemEnd = ["-----END", "PRIVATE KEY-----"].join(" ");
  const pemBody = "monitor-pem-private-key-material";
  const emails = [];
  const fetchImpl = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.includes("api.resend.com")) {
      emails.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }
    if (textUrl.endsWith("/healthz")) return new Response("ok", { status: 200 });
    if (textUrl.endsWith("/chat/completions")) {
      throw new Error(
        `failed ${tokenizedUrl} with Bearer ${bearer}, ${providerKey}, private_key=${privateKey}, session_key=${sessionKey}, ${pemBegin}\n${pemBody}\n${pemEnd}`
      );
    }
    return new Response("not found", { status: 404 });
  };

  const result = await runScheduledMonitor(monitorEnv(), {
    scheduledTime: Date.parse("2026-07-02T00:00:00.000Z"),
    fetchImpl
  });
  const serializedEmail = JSON.stringify(emails[0]);
  const serializedResult = JSON.stringify(result);

  assert.equal(result.event, "down");
  assert.equal(emails.length, 1);
  for (const serialized of [serializedEmail, serializedResult]) {
    assert.equal(serialized.includes(providerKey), false);
    assert.equal(serialized.includes(bearer), false);
    assert.equal(serialized.includes("token=abc123"), false);
    assert.equal(serialized.includes("secret=def456"), false);
    assert.equal(serialized.includes("raw-llm.example"), false);
    assert.equal(serialized.includes(privateKey), false);
    assert.equal(serialized.includes(sessionKey), false);
    assert.equal(serialized.includes(pemBegin), false);
    assert.equal(serialized.includes(pemBody), false);
    assert.equal(serialized.includes(pemEnd), false);
    assert.equal(serialized.includes("/private/status"), false);
  }
  assert.equal(serializedEmail.includes("[redacted-key]"), true);
  assert.equal(serializedEmail.includes("Bearer [redacted]"), true);
  assert.equal(serializedEmail.includes("[redacted-url]"), true);
});

test("worker rejects chat requests without a rate limit store", async () => {
  const response = await handle(chatRequest());
  assert.equal(response.status, 429);
  assert.match((await response.json()).error.code, /rate_limit_store_missing/);
});

test("worker validates models and token caps before forwarding", async () => {
  const env = envWithKv();
  const badModel = await handle(chatRequest({ model: "random-model" }), env);
  assert.equal(badModel.status, 400);
  assert.equal((await badModel.json()).error.code, "model_not_allowed");

  const progressCopyModel = await handle(chatRequest(validProgressCopyBody()), env);
  assert.equal(progressCopyModel.status, 200);

  const miniPlannerModel = await handle(chatRequest({ model: "gpt-5.4-mini" }), env);
  assert.equal(miniPlannerModel.status, 200);

  const timeRecapModel = await handle(chatRequest(validTimeRecapBody({ model: "gpt-5.4" })), env);
  assert.equal(timeRecapModel.status, 200);

  const legacyTimeRecapModel = await handle(chatRequest(legacyTimeRecapBody()), env);
  assert.equal(legacyTimeRecapModel.status, 200);

  const olderClaudePlannerModel = await handle(chatRequest({ model: "claude-opus-4-7" }), env);
  assert.equal(olderClaudePlannerModel.status, 200);

  const imageModel = await handle(chatRequest({ model: "gpt-image-2" }), env);
  assert.equal(imageModel.status, 400);
  assert.equal((await imageModel.json()).error.code, "model_not_allowed");

  const tooManyTokens = await handle(chatRequest({ max_tokens: 9000 }), env);
  assert.equal(tooManyTokens.status, 400);
  assert.equal((await tooManyTokens.json()).error.code, "max_tokens_exceeded");
});

test("worker default allowlist accepts every built-in extension model preset", async () => {
  assert.equal(GATEWAY_MODELS.includes(DEFAULT_SETTINGS.gatewayModel), true);

  for (const model of GATEWAY_MODELS) {
    const response = await handle(chatRequest({ model }), envWithKv());
    assert.equal(response.status, 200, `${model} should be accepted by the built-in gateway Worker defaults`);
  }
});

test("worker derives planner models from the configured allowlist", async () => {
  const env = envWithKv({ ALLOWED_MODELS: "gpt-5.4-mini,gpt-5.3-codex-spark" });
  const planner = await handle(chatRequest({ model: "gpt-5.4-mini" }), env);
  assert.equal(planner.status, 200);

  const sparkPlanner = await handle(
    chatRequest({
      model: "gpt-5.3-codex-spark",
      messages: validBody().messages
    }),
    env
  );
  assert.equal(sparkPlanner.status, 200);
});

test("worker keeps the spark progress-copy cap while allowing spark planner shapes", async () => {
  const env = envWithKv();

  const oversizedProgressCopy = await handle(chatRequest(validProgressCopyBody({ max_tokens: 1500 })), env);
  assert.equal(oversizedProgressCopy.status, 400);
  assert.equal((await oversizedProgressCopy.json()).error.code, "spark_token_cap_exceeded");

  const sparkPlanner = await handle(
    chatRequest({
      ...validBody({ model: "gpt-5.3-codex-spark" }),
      max_tokens: 4096
    }),
    env
  );
  assert.equal(sparkPlanner.status, 200);
});

test("worker only accepts TabRecap request shapes", async () => {
  const env = envWithKv();
  const streamRequest = await handle(chatRequest({ stream: true }), env);
  assert.equal(streamRequest.status, 400);
  assert.equal((await streamRequest.json()).error.code, "request_shape_not_allowed");

  const toolRequest = await handle(chatRequest({ tools: [{ type: "function" }] }), env);
  assert.equal(toolRequest.status, 400);
  assert.equal((await toolRequest.json()).error.code, "request_shape_not_allowed");

  const genericChat = await handle(
    chatRequest({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write a poem." }
      ]
    }),
    env
  );
  assert.equal(genericChat.status, 400);
  assert.equal((await genericChat.json()).error.code, "planner_shape_required");

  const markdownChat = await handle(chatRequest({ response_format: { type: "text" } }), env);
  assert.equal(markdownChat.status, 400);
  assert.equal((await markdownChat.json()).error.code, "json_required");

  const malformedRecap = await handle(
    chatRequest(
      validTimeRecapBody({
        messages: [
          { role: "system", content: "You are a JSON-only time recap writer for TabRecap." },
          { role: "user", content: "TabRecap local time-recap input follows. {}" }
        ]
      })
    ),
    env
  );
  assert.equal(malformedRecap.status, 400);
  assert.equal((await malformedRecap.json()).error.code, "recap_payload_required");
});

test("worker rejects oversized bodies using content length", async () => {
  const body = JSON.stringify(validBody());
  const request = new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-tab-recap-install-id": "install-a"
    },
    body
  });
  const response = await handle(request, { ...envWithKv(), MAX_BODY_BYTES: "10" });
  assert.equal(response.status, 413);
});

test("worker forwards with upstream secret and strips client authorization", async () => {
  const calls = [];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const response = await localHandle(chatRequest(undefined, { authorization: "Bearer user-visible-token" }), {
    ...envWithKv(),
    CF_ACCESS_CLIENT_ID: "access-id",
    CF_ACCESS_CLIENT_SECRET: "access-secret"
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-tab-recap-request-id"), /.+/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://raw-llm.example/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer upstream-secret");
  assert.match(calls[0].options.headers["x-tab-recap-request-id"], /.+/);
  assert.equal(calls[0].options.headers["cf-access-client-id"], "access-id");
  assert.equal(calls[0].options.headers["cf-access-client-secret"], "access-secret");
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), [
    "max_tokens",
    "messages",
    "model",
    "reasoning_effort",
    "response_format"
  ]);
});

test("worker echoes client request ids for gateway log correlation", async () => {
  const response = await handle(chatRequest(undefined, { "x-tab-recap-request-id": "op_test_123" }), envWithKv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-tab-recap-request-id"), "op_test_123");
});

test("worker retries local tunnel infrastructure failures before succeeding", async () => {
  const calls = [];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return new Response("error code: 1033", { status: 530, headers: { "content-type": "text/plain" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await localHandle(chatRequest(undefined, { "x-tab-recap-request-id": "op_retry" }), {
    ...envWithKv(),
    UPSTREAM_RETRY_DELAY_MS: "100"
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(response.headers.get("x-tab-recap-upstream-attempts"), "2");
  assert.equal(response.headers.get("x-tab-recap-request-id"), "op_retry");
});

test("worker converts persistent local tunnel failures into product JSON errors", async () => {
  const localHandle = createWorkerHandler({
    fetchImpl: async () => new Response("error code: 1033", { status: 530, headers: { "content-type": "text/plain" } })
  });

  const response = await localHandle(chatRequest(undefined, { "x-tab-recap-request-id": "op_down" }), {
    ...envWithKv(),
    UPSTREAM_RETRY_ATTEMPTS: "1"
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "origin_tunnel_unavailable");
  assert.equal(body.error.requestId, "op_down");
  assert.equal(body.error.upstreamStatus, 530);
  assert.equal(body.error.upstreamCode, "1033");
});

test("worker converts non-json upstream auth failures into redacted product JSON errors", async () => {
  const localHandle = createWorkerHandler({
    fetchImpl: async () =>
      new Response("unauthorized upstream key upstream-secret", {
        status: 401,
        headers: { "content-type": "text/plain" }
      })
  });

  const response = await localHandle(chatRequest(undefined, { "x-tab-recap-request-id": "op_auth_down" }), envWithKv());
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("x-tab-recap-request-id"), "op_auth_down");
  assert.equal(body.error.code, "upstream_auth_failed");
  assert.equal(body.error.requestId, "op_auth_down");
  assert.equal(body.error.upstreamStatus, 401);
  assert.equal(body.error.attempts, 1);
  assert.equal(serialized.includes("upstream-secret"), false);
  assert.equal(serialized.includes("unauthorized upstream key"), false);
});

test("worker converts non-json upstream bad requests into product JSON errors", async () => {
  const localHandle = createWorkerHandler({
    fetchImpl: async () =>
      new Response("<html>prompt details should not leak</html>", {
        status: 400,
        headers: { "content-type": "text/html" }
      })
  });

  const response = await localHandle(chatRequest(undefined, { "x-tab-recap-request-id": "op_bad_request" }), envWithKv());
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(body.error.code, "upstream_rejected_request");
  assert.equal(body.error.requestId, "op_bad_request");
  assert.equal(body.error.upstreamStatus, 400);
  assert.equal(serialized.includes("prompt details should not leak"), false);
});

test("worker applies install id, ip, global, and page-summary quotas", async () => {
  const installLimited = envWithKv({ INSTALL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), installLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), installLimited)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-b" }), installLimited)).status, 200);

  const ipLimited = envWithKv({ IP_HOURLY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 429);

  const globalLimited = envWithKv({ GLOBAL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), globalLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-b" }), globalLimited)).status, 429);

  const pageSummaryLimited = envWithKv({ INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), pageSummaryLimited))
      .status,
    200
  );
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), pageSummaryLimited))
      .status,
    429
  );
});

test("worker accepts legacy Tab Tidy gateway quota headers", async () => {
  const installLimited = envWithKv({ INSTALL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy" }), installLimited)).status, 200);
  assert.equal((await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy" }), installLimited)).status, 429);

  const pageSummaryLimited = envWithKv({ INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal(
    (await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    200
  );
  assert.equal(
    (await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    429
  );
});

test("page-summary quota failures do not consume the general install quota", async () => {
  const env = envWithKv({ INSTALL_DAILY_REQUESTS: "2", INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), env)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), env)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), env)).status, 200);
});

test("worker CORS is limited to extension and local debug origins", async () => {
  const extensionResponse = await handle(chatRequest(undefined, { origin: "chrome-extension://abcdefghijklmnop" }), envWithKv());
  assert.equal(extensionResponse.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");

  const webResponse = await handle(chatRequest(undefined, { origin: "https://random.example" }), envWithKv());
  assert.equal(webResponse.status, 200);
  assert.equal(webResponse.headers.get("access-control-allow-origin"), null);
});

function chatRequest(overrides = {}, headers = {}) {
  return new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tab-recap-install-id": "install-a",
      "cf-connecting-ip": "203.0.113.1",
      ...headers
    },
    body: JSON.stringify(validBody(overrides))
  });
}

function legacyHeaderRequest(headers = {}, overrides = {}) {
  return new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.1",
      ...headers
    },
    body: JSON.stringify(validBody(overrides))
  });
}

function validBody(overrides = {}) {
  return {
    model: DEFAULT_SETTINGS.gatewayModel,
    messages: [
      {
        role: "system",
        content: "You are a JSON-only planner for a Chrome tab organization extension."
      },
      {
        role: "user",
        content: [
          "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
          "Return the JSON action plan only.",
          JSON.stringify({
            schema: "tab_recap_compact_v1",
            tabFields: ["id", "windowId", "index", "sequenceIndex", "title"],
            tabs: [[10, 1, 0, 0, "Chrome tabs API docs"]]
          })
        ].join("\n")
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1024,
    reasoning_effort: "high",
    ...overrides
  };
}

function validProgressCopyBody(overrides = {}) {
  return {
    model: "gpt-5.3-codex-spark",
    messages: [
      {
        role: "system",
        content: "Write short loading captions for an AI browser-tab organization extension. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({ languageMode: "zh-CN", phase: "planning", tabCount: 120, windowCount: 3 })
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
    reasoning_effort: undefined,
    ...overrides
  };
}

function validTimeRecapBody(overrides = {}) {
  return {
    model: "gpt-5.4",
    messages: [
      {
        role: "system",
        content: "You are a JSON-only time recap writer for a consumer Chrome tab organization product named TabRecap."
      },
      {
        role: "user",
        content: [
          "TabRecap local time-recap input follows. Page rows are already privacy-reduced.",
          JSON.stringify({
            schema: "tab_recap_time_recap_input_v1",
            pageFields: ["id", "title", "hostname", "firstSeenAt", "lastSeenAt", "activeCount"],
            coverage: { includedPages: 1, sampledEntries: 0 },
            pages: [[1, "Chrome tabs API docs", "developer.chrome.com", "2026-06-27T00:00:00.000Z", "2026-06-27T01:00:00.000Z", 2]]
          })
        ].join("\n")
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 2048,
    reasoning_effort: "high",
    ...overrides
  };
}

function legacyTimeRecapBody(overrides = {}) {
  const body = validTimeRecapBody(overrides);
  return {
    ...body,
    messages: body.messages.map((message) => ({
      ...message,
      content: String(message.content).replace("tab_recap_time_recap_input_v1", "tab_tidy_time_recap_input_v1")
    }))
  };
}

function envWithKv(overrides = {}) {
  return {
    RATE_LIMIT_KV: new MemoryKv(),
    UPSTREAM_BASE_URL: "https://raw-llm.example/v1",
    UPSTREAM_API_KEY: "upstream-secret",
    ...overrides
  };
}

function monitorEnv(overrides = {}) {
  return envWithKv({
    RESEND_API_KEY: "resend-secret",
    ALERT_TO: "me@sylvanyu.io",
    ALERT_FROM: "TabRecap Monitor <alerts@sylvanyu.io>",
    ...overrides
  });
}

function monitorFetch(options = {}) {
  const emails = [];
  const calls = [];
  const fetch = async (url, requestOptions = {}) => {
    calls.push({ url: String(url), options: requestOptions });
    if (String(url).includes("api.resend.com")) {
      emails.push(JSON.parse(requestOptions.body));
      const status = Array.isArray(options.emailStatuses) ? options.emailStatuses.shift() || 200 : options.emailStatus || 200;
      return new Response(options.emailBody || JSON.stringify({ id: "email_123" }), {
        status,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).endsWith("/healthz")) {
      return new Response(options.readyzBody || "ok", { status: options.readyzStatus || 200 });
    }
    if (String(url).endsWith("/chat/completions")) {
      return new Response(options.llmBody || JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: options.llmStatus || 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls, emails };
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}
