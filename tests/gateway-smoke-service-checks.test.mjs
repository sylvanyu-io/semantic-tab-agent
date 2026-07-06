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
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/healthz")) return jsonResponse({ ok: true });
      if (url.endsWith("/readyz")) return jsonResponse({ ok: true, upstream: { code: "ready" } });
      if (url.endsWith("/monitor/status")) {
        return jsonResponse({
          ok: true,
          monitor: {
            status: "ok",
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
