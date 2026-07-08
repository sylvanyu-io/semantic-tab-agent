# TabRecap Gateway Worker

Cloudflare Worker wrapper for the default free TabRecap AI gateway.

The extension sends chat-completions-compatible planner requests to this Worker.
The Worker validates the request, applies coarse anti-abuse limits, injects the
real upstream API key on the server side, and forwards only to the configured
upstream base URL.

For the current production hostnames, local Mac origin, Cloudflare Tunnel,
monitoring email, logs, and migration checklist, see
[`docs/12-default-ai-gateway-runbook.md`](../docs/12-default-ai-gateway-runbook.md).

## What It Protects

- No upstream API key is shipped in the extension.
- Clients cannot override the upstream target.
- Only the TabRecap text-model allowlist is accepted by default. It mirrors the
  current CLIProxyAPI origin chat models, including `gpt-5.5`, `gpt-5.4`,
  `gpt-5.4-mini`, `codex-auto-review`, Claude Opus/Sonnet/Haiku variants, and
  `gpt-5.3-codex-spark`. The spark model is allowed for bounded progress UI
  copy and compact auxiliary TabRecap planning shapes; generic chat remains
  rejected. Image models are intentionally excluded because this Worker only
  exposes `/v1/chat/completions`.
- Request body size and `max_tokens` are capped before upstream forwarding.
- KV counters limit global, IP, install-id, and page-summary usage.

This is not account-grade billing control. It is a practical free-tier abuse
brake for an open-source browser extension before login exists.

## Required Cloudflare Resources

Create a Workers KV namespace and bind it as `RATE_LIMIT_KV`. This repository
includes `worker/wrangler.toml` for the current public route. For another
deployment, copy `worker/wrangler.toml.example` to your own config and fill in
the KV namespace ID.

The current production Worker service name is still `tab-tidy-gateway`. That is
intentional deploy continuity from the earlier product name, not user-facing
branding. Rename it only when intentionally migrating to a new Cloudflare Worker.

Use a Worker route for the public extension domain:

```toml
routes = [
  { pattern = "cliproxy.sylvanyu.io/*", zone_name = "sylvanyu.io" }
]
```

Keep the raw LLM gateway on a separate origin host such as
`https://cliproxy-origin.sylvanyu.io/v1`. Do not set `UPSTREAM_BASE_URL` to
`https://cliproxy.sylvanyu.io/v1`, because that would make the Worker call
itself recursively.

Set upstream values as Worker secrets:

```bash
npx wrangler secret put UPSTREAM_BASE_URL
npx wrangler secret put UPSTREAM_API_KEY
```

For a local-machine origin, keep the retry budget small. These are normal
Worker vars, already present in `worker/wrangler.toml`:

```toml
UPSTREAM_RETRY_ATTEMPTS = "2"
UPSTREAM_RETRY_DELAY_MS = "1200"
UPSTREAM_READY_TIMEOUT_MS = "8000"
LLM_READY_MODEL = "gpt-5.4-mini"
LLM_READY_REASONING_EFFORT = "low"
LLM_READY_MAX_TOKENS = "2"
LLM_READY_TIMEOUT_MS = "45000"
ALERT_TO = "me@sylvanyu.io"
ALERT_FROM = "TabRecap Monitor <alerts@sylvanyu.io>"
MONITOR_REMINDER_HOURS = "6"
```

The Worker retries only Cloudflare/Tunnel infrastructure failures such as
`530` with `error code: 1033`, `502`, `503`, `504`, and Cloudflare `52x`
origin errors. It does not retry model validation failures, `401`, `403`, or
`429`, so it should not silently double-spend normal model requests.

If the origin LLM gateway is behind Cloudflare Access, also set:

```bash
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

Then deploy:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Health check:

```bash
curl https://cliproxy.sylvanyu.io/healthz
```

The Worker health response is `{"ok":true}`. This only proves the Worker is
deployed. It does not prove the local origin machine, API-only proxy, or
Cloudflare Tunnel is reachable.

Readiness check:

```bash
curl https://cliproxy.sylvanyu.io/readyz
```

`/readyz` calls the configured upstream health endpoint. By default it checks
`/healthz` at the `UPSTREAM_BASE_URL` origin, so
`UPSTREAM_BASE_URL=https://cliproxy-origin.sylvanyu.io/v1` checks
`https://cliproxy-origin.sylvanyu.io/healthz`. Override with
`UPSTREAM_HEALTH_URL` only if the origin uses a different health path.

LLM readiness check:

```bash
npx wrangler secret put MONITOR_TOKEN --config worker/wrangler.toml
curl -H "x-monitor-token: $MONITOR_TOKEN" https://cliproxy.sylvanyu.io/llm-readyz
```

`/llm-readyz` is intentionally separate from `/readyz`:

- `/readyz` is free and only verifies Worker -> Tunnel -> local origin health.
- `/llm-readyz` spends a tiny amount of model usage by sending one protected
  `gpt-5.4-mini`, `reasoning_effort=low`, `max_tokens=2` chat request through
  the real upstream path.
- The endpoint returns `401` unless the request includes `x-monitor-token` or
  `Authorization: Bearer ...` matching the `MONITOR_TOKEN` Worker secret.

Use `/llm-readyz` as a low-frequency external monitor. The current production
policy is every 30 minutes with email alerts, while `/readyz` can run every
1-3 minutes.

Latest monitor status:

```bash
curl -H "x-monitor-token: $MONITOR_TOKEN" https://cliproxy.sylvanyu.io/monitor/status
```

`/monitor/status` reads the last Cron monitor snapshot from KV. It does not call
the upstream origin and does not spend model usage. Use it when an email says
the gateway is down, or when the extension shows the default AI service as
temporarily unavailable. The response reports the last `readyz` and
`llm-readyz` result codes, the last alert event, and whether email/upstream/state
storage are configured. It intentionally does not expose the upstream URL,
gateway keys, Resend key, alert mailbox, prompts, page titles, or page text.

Scheduled email monitoring:

```bash
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

The Worker has a Cron Trigger:

```toml
[triggers]
crons = ["*/30 * * * *"]
```

Every 30 minutes it first checks the free local-origin readiness path. Only
when that passes does it run the tiny real LLM probe, so a broken Tunnel or
offline local origin will not spend model usage. It sends email through the
Resend HTTP API only when state changes:

- first detected outage;
- recovery after an outage;
- reminder after `MONITOR_REMINDER_HOURS` while still down.

If `RESEND_API_KEY`, `ALERT_TO`, or `ALERT_FROM` is missing, the scheduled job
returns early and does not run the real LLM probe, so it will not spend model
usage before email delivery is configured.

Each chat request now carries an `x-tab-recap-request-id` response header. The
extension sends the side-panel operation id as this header for default gateway
traffic, so a user-visible error can be matched with Worker logs and local
origin logs. The side panel keeps this request id in localized gateway error
copy, including custom provider errors, while still hiding raw upstream details.

When the upstream path fails, the Worker converts raw upstream failures into
redacted TabRecap JSON errors instead of relaying text or HTML bodies to the
extension. This covers Cloudflare Tunnel failures, origin auth failures, model
gateway bad requests, and upstream rate limits. For example, when the local
Tunnel is down the extension receives JSON such as:

```json
{
  "error": {
    "code": "origin_tunnel_unavailable",
    "message": "The local TabRecap AI origin is offline or its Cloudflare Tunnel has no healthy connection.",
    "requestId": "recap_..."
  }
}
```

That is intentionally different from relaying an HTML/`error code: 1033` body
to the extension. Upstream raw text is not copied into these product errors
because it can contain provider internals, prompt fragments, or local service
details. Use `x-tab-recap-request-id`, `upstreamStatus`, and `upstreamCode` to
correlate the visible error with Worker tail logs and local origin logs.

## Local-Machine Origin Checklist

The production-facing hostname can still use a local Mac as the origin, but the
chain must stay up:

```text
extension -> cliproxy.sylvanyu.io Worker -> cliproxy-origin.sylvanyu.io tunnel -> 127.0.0.1:18317 -> 127.0.0.1:8317
```

Operational checks, in order:

```bash
curl -sS http://127.0.0.1:8317/healthz
curl -sS http://127.0.0.1:18317/healthz
curl -sS https://cliproxy-origin.sylvanyu.io/healthz
curl -sS https://cliproxy.sylvanyu.io/readyz
```

If `/healthz` on `cliproxy.sylvanyu.io` is 200 but `/readyz` is 503, the Worker
is alive and the local origin path is not. Restart the local CLIProxyAPI stack
and Cloudflare Tunnel before changing extension code or model settings.

## Local Tests

```bash
npm run test:worker
```

The tests use an in-memory KV and mocked upstream fetch. They never call the
real LLM gateway.

Production gateway smoke:

```bash
npm run smoke:gateway
```

For the built-in gateway, the smoke script checks `/healthz`, `/readyz`, reads
`/monitor/status` when a token is available, and sends a real
chat-completions request. The monitor snapshot is reported for diagnosis, but a
stale scheduled outage does not block the live smoke when the current readiness
and chat checks pass. It reads `MONITOR_TOKEN`, then `MONITOR_TOKEN_FILE`, then
this machine's default local runtime token file. On another machine, point it
at the copied monitor token:

```bash
MONITOR_TOKEN_FILE="/path/to/cliproxy-monitor-token" npm run smoke:gateway
```

Use `GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway` for release-blocking
checks that also require a fresh healthy monitor snapshot.
