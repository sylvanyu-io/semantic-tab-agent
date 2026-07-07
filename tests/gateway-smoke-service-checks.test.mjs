import assert from "node:assert/strict";
import test from "node:test";
import { checkBuiltInGatewayService, serviceBaseUrlFromGatewayBaseUrl } from "../scripts/lib/gateway-smoke-service-checks.mjs";
import { BUILTIN_GATEWAY_BASE_URL } from "../src/shared/settings.js";

test("gateway smoke derives the product service URL from a v1 base URL", () => {
  assert.equal(serviceBaseUrlFromGatewayBaseUrl("https://cliproxy.sylvanyu.io/v1"), "https://cliproxy.sylvanyu.io");
  assert.equal(serviceBaseUrlFromGatewayBaseUrl("https://cliproxy.sylvanyu.io/v1/"), "https://cliproxy.sylvanyu.io");
  assert.equal(serviceBaseUrlFromGatewayBaseUrl("https://api.example.test/custom"), "https://api.example.test/custom");
});

test("gateway smoke skips built-in service checks for custom gateways by default", async () => {
  let called = false;
  const result = await checkBuiltInGatewayService({
    gatewayBaseUrl: "https://custom.example.test/v1",
    gatewayBaseUrlExplicit: true,
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ ok: true });
    }
  });

  assert.deepEqual(result, { skipped: true, reason: "custom_gateway" });
  assert.equal(called, false);
});

test("gateway smoke verifies health, readiness, and monitor status for the built-in gateway", async () => {
  const calls = [];
  const result = await checkBuiltInGatewayService({
    gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
    monitorToken: "monitor-secret",
    nowMs: Date.parse("2026-07-02T00:45:00.000Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
      if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
      if (url.endsWith("/monitor/status")) {
        return jsonResponse({
          ok: true,
          monitor: {
            status: "ok",
            lastStatusAt: "2026-07-02T00:00:00.000Z",
            lastSummary: {
              readyzCode: "ready",
              llmCode: "llm_ready"
            }
          },
          config: {
            stateStore: "configured",
            email: "configured",
            upstream: "configured"
          }
        });
      }
      return jsonResponse({ ok: false }, 404);
    }
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers["x-monitor-token"], "monitor-secret");
  assert.equal(result.skipped, false);
  assert.equal(result.readyz.upstreamCode, "ready");
  assert.equal(result.monitor.email, "configured");
  assert.equal(result.monitor.llmCode, "llm_ready");
  assert.equal(result.monitor.lastStatusAgeMinutes, 45);
});

test("gateway smoke skips monitor status when no monitor token is supplied", async () => {
  const calls = [];
  const result = await checkBuiltInGatewayService({
    gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
      if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
      return jsonResponse({ ok: false }, 404);
    }
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(result.monitor, { skipped: true, reason: "MONITOR_TOKEN not set" });
});

test("gateway smoke fails when a required monitor check has no token", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        requireMonitor: true,
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /requires MONITOR_TOKEN or MONITOR_TOKEN_FILE/
  );
});

test("gateway smoke fails when required monitor checks are skipped by a custom gateway", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: "https://custom.example.test/v1",
        gatewayBaseUrlExplicit: true,
        requireMonitor: true,
        fetchImpl: async () => jsonResponse({ ok: true })
      }),
    /monitor check was required but service checks were skipped/
  );
});

test("gateway smoke accepts a fresh ok monitor status when required", async () => {
  const result = await checkBuiltInGatewayService({
    gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
    monitorToken: "monitor-secret",
    requireMonitor: true,
    nowMs: Date.parse("2026-07-02T01:00:00.000Z"),
    fetchImpl: async (url) => {
      if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
      if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
      if (url.endsWith("/monitor/status")) return monitorStatusResponse({ lastStatusAt: "2026-07-02T00:30:00.000Z" });
      return jsonResponse({ ok: false }, 404);
    }
  });

  assert.equal(result.monitor.status, "ok");
  assert.equal(result.monitor.lastStatusAt, "2026-07-02T00:30:00.000Z");
  assert.equal(result.monitor.lastStatusAgeMinutes, 30);
});

test("gateway smoke fails when required readyz details are not healthy", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        monitorToken: "monitor-secret",
        requireMonitor: true,
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "origin_health_check_failed" } });
          if (url.endsWith("/monitor/status")) return monitorStatusResponse({ lastStatusAt: "2026-07-02T00:30:00.000Z" });
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /readyz upstream code is origin_health_check_failed/
  );
});

test("gateway smoke fails when required monitor summary details are not healthy", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        monitorToken: "monitor-secret",
        requireMonitor: true,
        nowMs: Date.parse("2026-07-02T01:00:00.000Z"),
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
          if (url.endsWith("/monitor/status")) {
            return monitorStatusResponse({
              lastStatusAt: "2026-07-02T00:30:00.000Z",
              llmCode: "llm_ready_timeout"
            });
          }
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /monitor\/status summary is not healthy: readyz=ready llm=llm_ready_timeout/
  );
});

test("gateway smoke fails when a required monitor status is unknown", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        monitorToken: "monitor-secret",
        requireMonitor: true,
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
          if (url.endsWith("/monitor/status")) return monitorStatusResponse({ status: "unknown", lastStatusAt: "" });
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /monitor\/status is unknown/
  );
});

test("gateway smoke fails when a required monitor status is stale", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        monitorToken: "monitor-secret",
        requireMonitor: true,
        nowMs: Date.parse("2026-07-02T03:00:00.000Z"),
        maxMonitorAgeMs: 60 * 60 * 1000,
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
          if (url.endsWith("/monitor/status")) return monitorStatusResponse({ lastStatusAt: "2026-07-02T01:30:00.000Z" });
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /monitor\/status is stale/
  );
});

test("gateway smoke fails when monitor email alerts are not configured", async () => {
  await assert.rejects(
    () =>
      checkBuiltInGatewayService({
        gatewayBaseUrl: BUILTIN_GATEWAY_BASE_URL,
        monitorToken: "monitor-secret",
        fetchImpl: async (url) => {
          if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
          if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
          if (url.endsWith("/monitor/status")) {
            return jsonResponse({
              ok: true,
              monitor: { status: "unknown", lastSummary: null },
              config: {
                stateStore: "configured",
                email: "resend_api_key_missing",
                upstream: "configured"
              }
            });
          }
          return jsonResponse({ ok: false }, 404);
        }
      }),
    /monitor\/status email is resend_api_key_missing/
  );
});

function monitorStatusResponse(overrides = {}) {
  return jsonResponse({
    ok: true,
    monitor: {
      status: overrides.status || "ok",
      lastStatusAt: overrides.lastStatusAt || "2026-07-02T00:00:00.000Z",
      lastSummary: {
        readyzCode: overrides.readyzCode || "ready",
        llmCode: overrides.llmCode || "llm_ready"
      }
    },
    config: {
      stateStore: "configured",
      email: "configured",
      upstream: "configured"
    }
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
