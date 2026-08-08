# TabRecap shared gateway

This Cloudflare Worker backs the optional trial endpoint documented in the project README. It is deliberately narrower than a general OpenAI proxy.

The extension's first-run guide visibly prefills `https://tab-recap-gateway.sylvanyu.io/v1` and `deepseek-v4-flash` as an optional trial configuration. It does not contain the upstream provider key, and users can replace the trial values before continuing.

## What the Worker accepts

Public routes:

- `GET /healthz`: Worker process check
- `GET /readyz`: upstream model-list and rate-limit storage check
- `GET /v1/models`: configured model allowlist in OpenAI list format
- `POST /v1/chat/completions`: validated TabRecap jobs

Protected monitor routes:

- `GET /llm-readyz`
- `GET /monitor/status`

`POST /v1/chat/completions` accepts only these shapes:

- TabRecap grouping plans;
- TabRecap cleanup ranking;
- TabRecap time recaps;
- TabRecap progress copy;
- the exact eight-token connection probe used by the settings screen.

Generic chat, custom system prompts, tool calls, streaming, client-selected upstream URLs, unknown fields, oversized data, and models outside the allowlist are rejected before the upstream request.

## Current shared models

The production allowlist is:

- `glm-5.2`
- `kimi-k3`
- `deepseek-v4-pro`
- `deepseek-v4-flash`

These are the Chat Completions models used from [OpenCode Go](https://opencode.ai/docs/go/). Keep the allowlist in `wrangler.toml` aligned with the upstream subscription and the README. `/v1/models` returns this list; it does not expose every model available from the upstream account.

Recommended TabRecap settings:

```text
Primary model:   deepseek-v4-flash
Auxiliary model: leave blank or reuse the primary
```

The auxiliary field can be left blank to reuse the primary model.

## Abuse controls

The Worker enforces all limits before forwarding a request:

- 1 MB request body;
- 8,192 output tokens;
- 20 requests per IP per hour;
- 100 requests per IP per day;
- 20 page-summary jobs per IP per day;
- 3,000 requests across the service per day;
- strict payload schemas, row counts, nesting depth, field lengths, and model allowlisting.

Counters are updated atomically in a Durable Object. The connection IP is converted to a keyed HMAC digest before it is used in a storage key. Raw IP addresses and request bodies are not written to Durable Object or monitor state.

`RATE_LIMIT_HASH_KEY` should be a separate random Worker Secret. If it is absent, the Worker uses `UPSTREAM_API_KEY` as the HMAC key so production does not fall back to an unkeyed IP hash.

Do not set `ALLOW_UNMETERED=true` in production.

## Secrets

Set values interactively in the Cloudflare dashboard or with Wrangler. Never put values in `wrangler.toml`, a shell command argument, source control, screenshots, or release notes.

Required:

- `UPSTREAM_BASE_URL` — `https://opencode.ai/zen/go/v1`
- `UPSTREAM_API_KEY` — the OpenCode Go subscription key
- `RATE_LIMIT_HASH_KEY` — a separate random value used only for IP counter digests

Optional monitoring:

- `MONITOR_TOKEN`
- `RESEND_API_KEY`

Wrangler prompts for each value without placing it in the command itself:

```bash
npx wrangler secret put UPSTREAM_BASE_URL --config worker/wrangler.toml
npx wrangler secret put UPSTREAM_API_KEY --config worker/wrangler.toml
npx wrangler secret put RATE_LIMIT_HASH_KEY --config worker/wrangler.toml
npx wrangler secret put MONITOR_TOKEN --config worker/wrangler.toml
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
```

A provider key pasted into chat, logs, screenshots, or shell history should be rotated before production use.

## Deploy

Confirm the account, secrets, KV namespace, Durable Object binding, route, and zone before deployment:

```bash
npx wrangler whoami
npx wrangler secret list --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

The service is deployed as the dedicated `tab-recap-gateway` Worker. It does not share the retired `cliproxy.sylvanyu.io` route.

After deployment:

```bash
curl -fsS https://tab-recap-gateway.sylvanyu.io/healthz
curl -fsS https://tab-recap-gateway.sylvanyu.io/readyz
curl -fsS https://tab-recap-gateway.sylvanyu.io/v1/models
```

Do not send a provider key to the public Worker. The Worker ignores client authorization for upstream authentication and injects its own secret.

## Tests

```bash
npm run test:worker
```

The test suite covers request-contract enforcement, model discovery, connection probes, provider-compatible requests without `response_format`, secret replacement, error redaction, response bounds, CORS, monitoring, atomic quotas, hourly and daily IP limits, and hashed IP storage keys.

## CORS and permissions

The Worker returns CORS permission only to Chrome/Firefox extension origins and local development origins. The extension requests the exact endpoint origin at runtime. There is no fixed gateway host permission in `manifest.json`.

The public URL is still reachable by non-browser clients, so CORS is not the abuse boundary. Schema validation, model allowlisting, size limits, token limits, IP quotas, and global quotas provide that boundary.
