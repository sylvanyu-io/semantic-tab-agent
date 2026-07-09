# Local-Origin Gateway Stability

Status: implemented for the current local-machine deployment path.

For the operational source of truth, including current hostnames, Worker
secrets, Tunnel config, logs, alert email, and migration steps, see
[Default AI Gateway Runbook](12-default-ai-gateway-runbook.md).

TabRecap still uses the user's local machine as the default AI origin. That is acceptable for the current scale, but it changes the failure model: the public Worker can be healthy while the local origin, API-only proxy, Cloudflare Tunnel, or upstream model route is unavailable.

## Current Chain

```text
extension
  -> https://cliproxy.sylvanyu.io Worker
  -> https://cliproxy-origin.sylvanyu.io tunnel
  -> 127.0.0.1:18317 API-only proxy
  -> 127.0.0.1:8317 CLIProxyAPI
  -> upstream model provider
```

`https://cliproxy.sylvanyu.io/healthz` only proves the Worker route is alive. It does not prove the Mac, tunnel, proxy, CLIProxyAPI, or model route is usable.

The local Cloudflare Tunnel should be pinned to HTTP/2:

```yaml
protocol: http2
```

This avoids the observed QUIC failure mode where `cloudflared` stays alive but repeatedly logs `failed to dial to edge with quic: timeout` and public requests return 530.

## Failure Interpretation

| Symptom | Meaning | Product behavior |
| --- | --- | --- |
| `/healthz` 200, `/readyz` 503 | Worker is alive, local origin path is unhealthy | Show default service temporarily offline |
| 530 with `error code: 1033` | Cloudflare has no healthy tunnel connection to the local origin | Retry once, then return structured JSON |
| 502/503/504/52x from origin | Local proxy, tunnel, or origin service is unstable | Retry once, then return structured JSON |
| Chat request exceeds `UPSTREAM_CHAT_TIMEOUT_MS` | Origin path accepted the request but did not finish in time | Return structured `origin_chat_timeout` JSON |
| cloudflared process is alive, public origin is 530, logs show QUIC timeouts | Process-level restart alone may not help; edge transport is unhealthy | Use `protocol: http2`, restart tunnel, then check `/readyz` |
| 401/403 | Auth/config issue, not transient tunnel failure | Do not retry |
| 429 | Rate/model capacity issue | Do not retry |
| JSON parse failure from upstream | Model/output issue | Let extension show invalid output guidance |

## Implemented Changes

1. Worker `/readyz`

   `/readyz` checks the configured upstream health endpoint. With `UPSTREAM_BASE_URL=https://cliproxy-origin.sylvanyu.io/v1`, it checks:

   ```text
   https://cliproxy-origin.sylvanyu.io/healthz
   ```

   This lets deployment checks distinguish "Worker is deployed" from "local origin can actually serve AI requests".

2. Request correlation

   The extension sends the side-panel operation id as `x-tab-recap-request-id` for default gateway requests. The Worker returns the same id in response headers and JSON errors. This creates one id that can be matched across:

   - extension UI error;
   - Worker logs;
   - local proxy logs;
   - CLIProxyAPI logs.

3. Bounded infrastructure retry

   The Worker retries only local-origin infrastructure failures:

   - 408;
   - 502/503/504;
   - Cloudflare 520-526;
   - 530, including `error code: 1033`;
   - fetch-level connection failures.

   It does not retry request validation errors, auth errors, model allowlist errors, or rate-limit errors.

4. Structured local-origin errors

   Persistent tunnel failures are converted into JSON:

   ```json
   {
     "error": {
       "code": "origin_tunnel_unavailable",
       "message": "The local TabRecap AI origin is offline or its Cloudflare Tunnel has no healthy connection.",
       "requestId": "recap_...",
       "upstreamStatus": 530,
       "upstreamCode": "1033",
       "attempts": 2
     }
   }
   ```

   The extension can now show a stable product message instead of leaking raw Cloudflare text.

   Long chat-completions requests are also bounded by
   `UPSTREAM_CHAT_TIMEOUT_MS` in the Worker. The default is 300 seconds. If the
   local origin hangs instead of returning, the Worker returns structured
   `origin_chat_timeout` JSON instead of leaving the extension waiting
   indefinitely.

5. Protected real LLM readiness probe

   `/llm-readyz` checks the full model path by sending a tiny real chat request
   through the Worker, Tunnel, local proxy, CLIProxyAPI, and upstream model:

   ```text
   model: gpt-5.4-mini
   reasoning_effort: low
   max_tokens: 2
   ```

   This endpoint requires `MONITOR_TOKEN` via `x-monitor-token` or
   `Authorization: Bearer ...`. It is meant for low-frequency external uptime
   checks, not browser clients.

6. Worker Cron email alerts

   The Worker also has a scheduled monitor:

   ```toml
   [triggers]
   crons = ["*/30 * * * *"]
   ```

   It runs the same origin and real LLM checks every 30 minutes and sends email
   through the Resend API to `me@sylvanyu.io`.

   Email rules:

   - first outage sends an email;
   - repeated failures stay quiet to avoid inbox noise;
   - persistent failure sends a reminder after 6 hours;
   - recovery sends an email.

   Until `RESEND_API_KEY` is configured, the scheduled job exits before running
   the real LLM probe, so it does not spend model usage without a working alert
   channel.

7. Quota is charged only after upstream config exists

   Chat requests are still validated before any gateway work, but the Worker now
   checks `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY` before incrementing request
   quotas. If the default service is misconfigured, users receive
   `upstream_not_configured` without consuming their install, IP, global, or page
   summary quota.

## Worker Vars

```toml
UPSTREAM_RETRY_ATTEMPTS = "2"
UPSTREAM_RETRY_DELAY_MS = "1200"
UPSTREAM_CHAT_TIMEOUT_MS = "300000"
UPSTREAM_READY_TIMEOUT_MS = "8000"
LLM_READY_MODEL = "gpt-5.4-mini"
LLM_READY_REASONING_EFFORT = "low"
LLM_READY_MAX_TOKENS = "2"
LLM_READY_TIMEOUT_MS = "45000"
ALERT_TO = "me@sylvanyu.io"
ALERT_FROM = "TabRecap Monitor <alerts@sylvanyu.io>"
MONITOR_REMINDER_HOURS = "6"
```

The retry budget is intentionally small. If the local Mac is asleep or the tunnel is gone, more retries mostly waste time. If it is a short tunnel reconnect, one retry is enough to avoid a visible failure.

`/readyz` does not spend model tokens and can be checked every 1-3 minutes.
`/llm-readyz` does spend a tiny amount of model usage and should be checked
every 30 minutes with email alerts.

## Local Ops Checklist

Run these in order when the default service is reported unavailable:

```bash
curl -sS http://127.0.0.1:8317/healthz
curl -sS http://127.0.0.1:18317/healthz
curl -sS https://cliproxy-origin.sylvanyu.io/healthz
curl -sS https://cliproxy.sylvanyu.io/readyz
```

Expected healthy signals:

```text
127.0.0.1:8317/healthz                 -> 200
127.0.0.1:18317/healthz                -> 200
cliproxy-origin.sylvanyu.io/healthz    -> 200
cliproxy.sylvanyu.io/readyz            -> {"ok":true}
```

If local checks pass and public origin fails, restart Cloudflare Tunnel. If local proxy returns bad gateway, restart CLIProxyAPI first. If `/readyz` passes but chat completions fail, inspect model availability or upstream provider state.

## Local Watchdog

The Mac mini now runs a user LaunchAgent watchdog:

```text
com.router-for-me.cliproxyapi-watchdog
```

It runs every 180 seconds. Each run checks:

- local CLIProxyAPI health on `127.0.0.1:8317`;
- local API-only proxy health on `127.0.0.1:18317`;
- product-facing Worker readiness on `https://cliproxy.sylvanyu.io/readyz`.

Restart policy:

- one failed run only records the failure;
- two consecutive failures of the same kind trigger recovery;
- local failures restart the full local stack;
- tunnel/readiness failures restart the Cloudflare Tunnel first;
- restarts have a 10-minute cooldown to avoid loops during upstream incidents.

This is intentionally more conservative than a 60-second probe. The checks are tiny, but the AI gateway does not need sub-minute failover while it is still a Mac-hosted free service.

Local files:

```text
/Users/yuyufeng/Projects/CLIProxyAPI/.codex/cliproxyapi-watchdog.sh
/Users/yuyufeng/Library/LaunchAgents/com.router-for-me.cliproxyapi-watchdog.plist
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.out.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.err.log
```

Inspection commands:

```bash
launchctl print gui/$(id -u)/com.router-for-me.cliproxyapi-watchdog
tail -n 50 /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.out.log
```

## Residual Risk

This setup is still bounded by local-machine availability. If the Mac sleeps, loses network, restarts, or `cloudflared` exits, the public AI service can fail. The implemented changes make failures diagnosable and less noisy; they do not turn a local Mac into a managed production service.

## Verification

2026-06-30 02:50 Asia/Shanghai:

| Check | Result |
| --- | --- |
| Worker deploy target | `tab-tidy-gateway` on `cliproxy.sylvanyu.io/*` |
| Worker version | `3cac8266-2690-4c14-8ac3-8191e41024e3` |
| `https://cliproxy.sylvanyu.io/readyz` | 200, upstream ready, 285 ms |
| Public chat smoke | 200, 6.08 s, `gpt-5.5` |
| Local main `127.0.0.1:8317/healthz` | 200 |
| Local API-only proxy `127.0.0.1:18317/healthz` | 200 |
| Direct origin tunnel health | 200 |
| Product Worker health | 200 |
| Product Worker readiness | 200 |
| Worker unit tests | 16/16 passed |
| Full test suite | 158/158 passed |
| Extension build | `dist/tab-recap-0.2.3.zip` |

Current runtime note: launchd services were not loaded, but the three fallback `screen` sessions were running and all local/public checks passed.

2026-07-01 01:38 Asia/Shanghai:

| Check | Result |
| --- | --- |
| Failure observed | `cliproxy-origin.sylvanyu.io` and `hermes.sylvanyu.io` both returned 530 |
| cloudflared logs | repeated QUIC timeouts and `there are no free edge addresses left to resolve to` |
| Mitigation | Added `protocol: http2` to local cloudflared configs |
| Process supervision | Moved `cliproxyapi`, `cliroxy-v1-proxy`, and `cloudflared` from screen fallback back to launchd |
| LaunchAgent state | all three loaded/running with `keepalive | runatload` |
| Local main `127.0.0.1:8317/healthz` | 200 |
| Local API-only proxy `127.0.0.1:18317/healthz` | 200 |
| Direct origin tunnel health | 200 |
| Product Worker readiness | 200 |
| Public chat smoke | 200, 9.58 s |

2026-07-01 01:53 Asia/Shanghai recheck:

| Check | Result |
| --- | --- |
| LaunchAgent state | all three loaded |
| Local main `127.0.0.1:8317/healthz` | 200 |
| Local API-only proxy `127.0.0.1:18317/healthz` | 200 |
| Direct origin tunnel health | 200 |
| Product Worker readiness | 200 |
| Public chat smoke | 200, 24.68 s |

2026-07-01 02:25 Asia/Shanghai watchdog install:

| Check | Result |
| --- | --- |
| Watchdog LaunchAgent | `com.router-for-me.cliproxyapi-watchdog` loaded |
| Run interval | 180 seconds |
| Consecutive failures before restart | 2 |
| Restart cooldown | 600 seconds |
| First watchdog run | `ok main=200 proxy=200 ready=200` |

2026-07-01 20:59 Asia/Shanghai LLM readiness deploy:

| Check | Result |
| --- | --- |
| Worker version | `465d6a60-6578-47c0-8d7d-a009ada047b3` |
| `/healthz` | 200, 0.31 s |
| `/readyz` | 200, upstream ready, 347 ms |
| `/llm-readyz` without token | 401 `monitor_token_required` |
| `/llm-readyz` with token | 200, `gpt-5.4-mini`, 5.69 s |
| Worker unit tests | 18/18 passed |

2026-07-07 03:34 Asia/Shanghai release-gate recheck:

| Check | Result |
| --- | --- |
| Worker version | `0f0170a3-11a8-4044-a0f0-fe98a25b14ab` |
| `npm run release:check:live` | passed |
| Node tests | 215/215 passed |
| UI smoke tests | 33/33 passed |
| Secret scan | clean |
| Git history secret scan | clean |
| Dev extension package | `dist/tab-recap-0.2.5.zip` |
| Store extension package | `dist/tab-recap-0.2.5-store.zip` |
| Release artifact audit | passed |
| `/healthz` | 200 |
| `/readyz` | 200, upstream ready |
| `/monitor/status` | `ok`, `lastStatusAt=2026-07-06T19:30:36.000Z`, email configured |
| Public chat smoke | 200, `gpt-5.4`, high reasoning |

The live release gate now fails if `/monitor/status` is skipped, not `ok`, or
older than two hours, so public release checks cannot pass on a stale green
monitor snapshot.

2026-07-08 00:25 Asia/Shanghai patch-release recheck:

| Check | Result |
| --- | --- |
| Commit | `9ce1116` |
| Release | `v0.2.6` |
| `npm run release:check` | passed |
| Node/Worker tests | 250/250 passed |
| UI smoke tests | 36/36 passed |
| Secret scan | clean |
| Git history secret scan | clean |
| Dev extension package | `dist/tab-recap-0.2.6.zip` |
| Store extension package | `dist/tab-recap-0.2.6-store.zip` |
| Release artifact audit | passed |
| `/healthz` | 200 |
| `/readyz` | 200, upstream ready |
| `/monitor/status` | `ok`, `lastStatusAt=2026-07-07T16:00:36.000Z`, email configured |
| Public chat smoke | 200, `gpt-5.4`, high reasoning, 57.5 s |

This recheck followed a local origin recovery where the API-only proxy on
`127.0.0.1:18317` was down because the helper script used a stale Node path.
The helper now resolves Node dynamically; see
`docs/12-default-ai-gateway-runbook.md` for the incident record.

2026-07-09 00:47 Asia/Shanghai local code recheck:

| Check | Result |
| --- | --- |
| Node/Worker tests | 322/322 passed |
| Targeted UI smoke tests | 9/9 passed |
| Worker monitor coverage | 530/1033 tunnel failures, retry classification, alert email, recovery email, redaction |
| Gateway smoke helper coverage | health, readiness, monitor status, required-monitor gating |
| Side-panel coverage | recap progress/cancel, organize and recap parallel generation, stale organize suppression, custom provider errors |

This was a local code-level verification, not a live release gate. The latest
live deployment and public-gateway status remain documented in
`docs/12-default-ai-gateway-runbook.md`.
