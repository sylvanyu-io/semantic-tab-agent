# Default AI Gateway Runbook

Status: current production path as of 2026-07-16 CST.

This document records the public TabRecap AI gateway setup so it can be
debugged, migrated, or rebuilt later without relying on memory. It intentionally
records names, hostnames, file paths, commands, and expected health signals. It
does not record API keys, tokens, or passwords.

## What This Gateway Is

TabRecap ships without a user-visible API key. The default AI service is a
Cloudflare Worker in front of a local Mac-hosted OpenAI-compatible gateway.

The current request chain is:

```text
TabRecap extension
  -> https://cliproxy.sylvanyu.io/v1/chat/completions
  -> Cloudflare Worker: tab-tidy-gateway
  -> https://cliproxy-origin.sylvanyu.io/v1
  -> Cloudflare Tunnel: cliroxyapi
  -> 127.0.0.1:18317 API-only proxy on the Mac
  -> 127.0.0.1:8317 CLIProxyAPI on the Mac
  -> upstream model account
```

Important distinction:

- `cliproxy.sylvanyu.io` is the product-facing hostname used by the extension.
  HTTP requests are handled by the Worker route.
- `cliproxy-origin.sylvanyu.io` is the raw origin Tunnel hostname used by the
  Worker.
- `UPSTREAM_BASE_URL` must point to `https://cliproxy-origin.sylvanyu.io/v1`,
  not `https://cliproxy.sylvanyu.io/v1`, otherwise the Worker can call itself
  recursively.

## Fast Triage When The Extension Says AI Is Unavailable

Use this order before changing prompts, models, or extension code.

1. Check the current live chain without spending model usage:

   ```bash
   /Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
   curl -sS https://cliproxy.sylvanyu.io/readyz
   ```

   `cliproxy.sylvanyu.io/healthz` can be 200 while the actual local origin is
   down. Treat `/readyz`, the helper `status`, or a real smoke request as the
   source of truth.

2. Read the latest scheduled monitor snapshot without spending model usage:

   ```bash
   TOKEN="$(cat /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-secrets/cliproxy-monitor-token)"
   curl -sS -H "x-monitor-token: $TOKEN" https://cliproxy.sylvanyu.io/monitor/status
   ```

   This tells whether the 30-minute Cron monitor last saw `readyz` and
   `llm-readyz` as healthy, and whether alert email is configured.

3. If the live chain is healthy but the monitor still says down, wait for the
   next 30-minute Cron or run ordinary smoke:

   ```bash
   npm run smoke:gateway
   ```

   The scheduled monitor can lag after manual recovery. Use
   `GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway` only for release gates.

4. If current `/readyz` fails, restart the local stack and Tunnel:

   ```bash
   /Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh restart
   /Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
   ```

5. If `/readyz` passes but chat, organize, or recap still fails, run one real
   smoke and correlate with logs by `x-tab-recap-request-id`:

   ```bash
   /Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
   npx wrangler tail --config worker/wrangler.toml
   ```

   This is the path that catches model availability, upstream auth, timeout, or
   JSON/output problems.

## Public Hostnames

| Hostname | Role | Owner |
| --- | --- | --- |
| `cliproxy.sylvanyu.io` | Product-facing AI gateway | Cloudflare Worker route |
| `cliproxy-origin.sylvanyu.io` | Raw local origin tunnel | Cloudflare Tunnel `cliroxyapi` |
| `sylvanyu.io` | Website and email domain | separate from AI gateway |
| `hermes.sylvanyu.io` | Separate tunnel/service | not part of TabRecap AI gateway |

The DNS page can show `cliproxy.sylvanyu.io` as a Tunnel record. That is not
the whole story: the Worker route for `cliproxy.sylvanyu.io/*` is what makes the
extension traffic go through validation, quotas, secret injection, retries, and
monitoring.

The Worker is intentionally not a general LLM proxy. `/v1/chat/completions`
accepts only the TabRecap request shapes used by:

- organize/cleanup planning payloads with compact tab rows;
- time recap payloads with compact page rows and coverage metadata;
- short progress-copy requests from the extension.

The Worker validates the model allowlist, `max_tokens`, JSON response mode,
top-level fields, exact task-contract markers, TabRecap schema names, compact
field lists, row shape, nesting depth, row count, and string sizes before it
injects the upstream key. These checks are an abuse brake for an open-source
client, not account authentication: a determined caller can inspect and copy
the public extension protocol.

Request quotas use the `RATE_LIMIT_DO` SQLite Durable Object. Its transaction
checks global, install, IP, and page-summary counters together before writing
any of them, so concurrent requests cannot bypass a KV read-before-write race.
`RATE_LIMIT_KV` remains in the deployment because the scheduled monitor stores
its last status there; it is no longer the authoritative request quota store.

The first deployment containing this quota implementation must include the
`rate-limit-v1` Durable Object migration from `worker/wrangler.toml`. A deploy
without `RATE_LIMIT_DO` fails closed for public chat requests with
`rate_limit_store_missing`; it does not silently run without quotas. Validate
the bindings before deployment with:

```bash
npx wrangler deploy --dry-run --config worker/wrangler.toml
```

## Local Machine

Local project:

```text
/Users/yuyufeng/Projects/CLIProxyAPI
```

Main local service:

```text
127.0.0.1:8317
```

API-only local proxy:

```text
127.0.0.1:18317
```

The API-only proxy forwards only:

```text
/healthz
/v1
/v1/*
```

It should return `404` for management pages such as `/management.html`. Do not
expose `127.0.0.1:8317` directly to the public internet.

Important files:

```text
/Users/yuyufeng/Projects/CLIProxyAPI/config.yaml
/Users/yuyufeng/Projects/CLIProxyAPI/.codex/v1-only-proxy.mjs
/Users/yuyufeng/Projects/CLIProxyAPI/.codex/cliproxyapi-watchdog.sh
/Users/yuyufeng/.cloudflared/config.yml
/Users/yuyufeng/Library/LaunchAgents/com.router-for-me.cliproxyapi.plist
/Users/yuyufeng/Library/LaunchAgents/com.router-for-me.cliproxyapi-v1-proxy.plist
/Users/yuyufeng/Library/LaunchAgents/com.cloudflare.cloudflared.cliproxyapi.plist
/Users/yuyufeng/Library/LaunchAgents/com.router-for-me.cliproxyapi-watchdog.plist
```

Current Cloudflare Tunnel config:

```yaml
tunnel: 35aaf3af-06b2-4d7e-b391-b607fc9bf2fd
credentials-file: /Users/yuyufeng/.cloudflared/35aaf3af-06b2-4d7e-b391-b607fc9bf2fd.json
protocol: http2

ingress:
  - hostname: cliproxy-origin.sylvanyu.io
    service: http://127.0.0.1:18317
  - hostname: cliproxy.sylvanyu.io
    service: http://127.0.0.1:18317
  - service: http_status:404
```

`protocol: http2` is intentional. It was added after QUIC tunnel failures caused
Cloudflare `530 / 1033` responses while `cloudflared` was still running.

## Local Service Commands

Use the helper script instead of ad hoc commands:

```bash
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh restart
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh stop
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh start
```

`status` checks processes, local health, public origin health, public Worker
health, and launchd state. `smoke` sends one real public chat request through
the Worker and local origin.

Earlier healthy status snapshot, 2026-07-02 01:44 CST:

```text
main local 8317: 200
proxy local 18317: 200
public origin health: 200
public origin models: 200
public main health: 200
public main ready: 200

launchd:
com.router-for-me.cliproxyapi: loaded
com.router-for-me.cliproxyapi-v1-proxy: loaded
com.cloudflare.cloudflared.cliproxyapi: loaded
```

Earlier public smoke snapshot, 2026-07-02 01:44 CST:

```text
HTTP_STATUS: 200
TOTAL_TIME: 21.37s
model: gpt-5.5
```

Latest validation snapshot, 2026-07-07 11:58 CST:

```text
manage-cliroxyapi-service.sh status:
main local 8317: 200
proxy local 18317: 200
public origin health: 200
public origin models: 200
public main health: 200
public main ready: 200

launchd:
com.router-for-me.cliproxyapi: not_loaded
com.router-for-me.cliproxyapi-v1-proxy: not_loaded
com.cloudflare.cloudflared.cliproxyapi: not_loaded

screen fallback:
cliroxy-main: running
cliroxy-v1-proxy: running
cliroxy-tunnel: running

GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway:
elapsedMs: 27539
model: gpt-5.4
thinkingIntensity: high
healthz: 200
readyz: 200, upstreamCode=ready
monitor: ok
monitor lastStatusAt: 2026-07-07T03:30:36.000Z
monitor lastStatusAgeMinutes: 27
monitor readyzCode: ready
monitor llmCode: llm_ready
monitor email: configured
planner validation: ok
```

Helper smoke alignment, 2026-07-07 14:47 CST:

```text
manage-cliroxyapi-service.sh smoke now uses gpt-5.4 / low reasoning to match
the product default model family instead of the older gpt-5.5 smoke payload.

HTTP_STATUS: 200
TOTAL_TIME: 7.42s
model: gpt-5.4
```

Latest local code verification, 2026-07-09 14:30 CST:

```text
npm run release:check:
passed

npm test:
355/355 passed

Full Playwright UI smoke:
57/57 passed

npm run scan:secrets:
No secret patterns found.

npm run scan:secrets:history:
No secret patterns found in git history.

npm run build:extension:
Built dist/tab-recap-0.2.6.zip

npm run build:extension:store:
Built dist/tab-recap-0.2.6-store.zip

npm run audit:release-artifacts:
Release artifact audit passed.

Covered in this verification:
- Worker/monitor tests for 530/1033 tunnel failures, retries, alert email state, recovery mail, and redaction;
- gateway smoke helper tests for health, readiness, monitor status, and required-monitor gating;
- side-panel UI tests for recap progress, cancellation, organize/recap parallel generation, stale organize run suppression, custom provider model errors, custom provider ping errors, safe custom endpoint persistence, local recap fallback display, and stable recap date display.
```

Latest live gateway smoke, 2026-07-09 05:39 CST:

```text
manage-cliroxyapi-service.sh status:
main local 8317: 200
proxy local 18317: 200
public origin health: 200
public origin models: 200
public main health: 200
public main ready: 200

manage-cliroxyapi-service.sh smoke:
HTTP_STATUS: 200
TOTAL_TIME: 9.27s
model: gpt-5.4

npm run smoke:gateway:
elapsedMs: 44362
model: gpt-5.4
thinkingIntensity: high
healthz: 200
readyz: 200, upstreamCode=ready
monitor: ok
monitor lastStatusAt: 2026-07-08T21:30:33.000Z
monitor lastStatusAgeMinutes: 8
monitor readyzCode: ready
monitor llmCode: llm_ready
monitor email: configured
planner validation: ok
```

Latest live gateway recovery verification, 2026-07-09 07:05 CST:

```text
manage-cliroxyapi-service.sh status:
main local 8317: 200
proxy local 18317: 200
public origin health: 200
public origin models: 200
public main health: 200
public main ready: 200

manage-cliroxyapi-service.sh smoke:
HTTP_STATUS: 200
TOTAL_TIME: 7.16s
model: gpt-5.4

/llm-readyz:
ok: true
code: llm_ready
model: gpt-5.4-mini
latencyMs: 2320

/monitor/status after the next Cron run:
monitor.status: ok
monitor.lastStatusAt: 2026-07-08T23:00:33.000Z
monitor.lastEvent: recovered
monitor.readyzCode: ready
monitor.llmCode: llm_ready
monitor.email: configured
monitor.lastEmail.ok: true

GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway:
elapsedMs: 54348
model: gpt-5.4
thinkingIntensity: high
healthz: 200
readyz: 200, upstreamCode=ready
monitor: ok
monitor lastStatusAgeMinutes: 3
planner validation: ok
```

Latest live release-gate verification, 2026-07-09 07:13 CST:

```text
npm run release:check:live:
standard release gate: passed before stress phase
stress artifact: dist/stress/sta-stress-mrcowcwu.json
stress status: passed
stress scope: 240 tabs across 4 windows
UI-driven page sampling: 240/240
active-tab page sampling: 4/4

GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway:
elapsedMs: 33357
model: gpt-5.4
thinkingIntensity: high
healthz: 200
readyz: 200, upstreamCode=ready
monitor: ok
monitor lastStatusAt: 2026-07-08T23:00:33.000Z
monitor lastStatusAgeMinutes: 11
monitor readyzCode: ready
monitor llmCode: llm_ready
monitor email: configured
planner validation: ok
preview groups: 2
reviewTabsCount: 0
excludedTabsCount: 0
```

Latest local stress-only verification, 2026-07-09 09:04 CST:

```text
npm run stress:extension:
stress artifact: dist/stress/sta-stress-mrcsxi3h.json
stress status: passed
stress scope: 240 tabs across 4 windows
all-window apply/undo: 6 groups, restored 240 tabs
current-window apply/undo: 6 groups for 60 tabs
page-summary risk gate: blocked 60/60
UI-driven page sampling: 240/240
active-tab page sampling: 4/4
key timings: all-window fake analyze 14.9s, full page sampling 4.6s
gateway branch: skipped because GATEWAY_API_KEY is not set
```

This verification followed a transient 2026-07-09 06:30 CST monitor outage.
Cloudflared logs showed edge disconnects and TLS handshake failures around the
scheduled check. The local stack and tunnel were healthy again after the
restart at 06:31 CST, current `/readyz`, `/llm-readyz`, and real planner smoke
passed before the monitor snapshot recovered, and the 07:00 CST Cron wrote the
expected recovery state plus recovery email status.

If the stack is running from `screen` fallback, current traffic can be healthy,
but macOS reboot recovery depends on the helper script or re-enabling the
LaunchAgents. Use `manage-cliroxyapi-service.sh restart` before deeper
debugging if alerts say the public AI service is unavailable.

The service is usable, but it is still a Mac-hosted free service, not a managed
cloud SLA.

Latest helper validation, 2026-07-09 08:17 CST:

```text
manage-cliroxyapi-service.sh status:
main local 8317: 200
proxy local 18317: 200
public origin health: 200
public origin models: 200
public main health: 200
public main ready: 200

launchd:
com.router-for-me.cliproxyapi: not_loaded
com.router-for-me.cliproxyapi-v1-proxy: not_loaded
com.cloudflare.cloudflared.cliproxyapi: not_loaded

screen fallback:
cliroxy-main: running
cliroxy-v1-proxy: running
cliroxy-tunnel: running

manage-cliroxyapi-service.sh smoke:
HTTP_STATUS: 200
TOTAL_TIME: 7.33s
model: gpt-5.4
```

Current incident snapshot, 2026-07-16 CST:

```text
local main 8317: 200
local proxy 18317: 200
public origin health: 200
public origin models: 200
public Worker health: 200
public Worker ready: 200
real public chat: 401 auth_unavailable
upstream message: authentication token has been invalidated
```

This combination means the Worker, Tunnel, local proxy, and CLIProxyAPI process
are reachable, but the upstream Codex account must be authenticated again. The
credential file can still contain a future expiry timestamp after the provider
has invalidated the token, so file expiry alone is not a readiness signal.

Re-authenticate from the CLIProxyAPI project, then restart and smoke-test the
stack:

```bash
cd /Users/yuyufeng/Projects/CLIProxyAPI
./bin/cli-proxy-api -codex-login -config ./config.yaml
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh restart
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
```

Use `-codex-device-login` instead of `-codex-login` when browser callback login
is inconvenient. Authentication files are stored under the configured local
`./auths` directory and must never be committed.

Local verification completed while the upstream login was still blocked:

```text
npm test: 359/359 passed
npm run test:ui: 57/57 passed
npm run test:worker: 37/37 passed
npm run scan:secrets: passed
npm run scan:secrets:history: passed
npx wrangler deploy --dry-run: passed with RATE_LIMIT_DO and RATE_LIMIT_KV bound
```

These results validate local code and packaging contracts. They do not replace
the real public smoke request, which remains the final upstream-auth check.

## Worker

Worker config lives in the TabRecap repo:

```text
/Users/yuyufeng/Projects/tab-recap/worker/wrangler.toml
```

Worker name:

```text
tab-tidy-gateway
```

Public route:

```toml
routes = [
  { pattern = "cliproxy.sylvanyu.io/*", zone_name = "sylvanyu.io" }
]
```

Cron trigger:

```toml
[triggers]
crons = ["*/30 * * * *"]
```

Current deployed Worker code version, verified with `wrangler deployments list`
on 2026-07-16:

```text
0f0170a3-11a8-4044-a0f0-fe98a25b14ab
```

Do not infer deployed code from the newest local commit. The production Worker
above predates the local strict-contract, timeout, redaction, and atomic Durable
Object quota changes.

The published extension tag is currently `v0.2.6`. Its coarse-planner and
progress-copy requests do not send the newer `tab_recap_coarse_v1` and
`tab_recap_progress_copy_v1` schema fields. Local Worker code therefore keeps a
strict compatibility branch for only those exact legacy requests. Before every
Worker deploy, run the Worker tests that cover both current and `v0.2.6`
payloads; do not replace this branch with a generic missing-schema allowance.

Safe deployment order:

1. Restore upstream authentication and make the helper `smoke` request pass.
2. Run `npm run test:worker` and `npx wrangler deploy --dry-run --config worker/wrangler.toml`.
3. Keep a ready-to-deploy corrective branch that retains `rate-limit-v1`,
   `RATE_LIMIT_DO`, and the released-client compatibility tests. The first
   production deployment of this migration is a forward-only change.
4. Deploy the Worker, then immediately test `/readyz`, `/llm-readyz`, a current
   extension planner request, and the legacy protocol fixtures.
5. If the deployment breaks released clients, deploy a compatible forward fix;
   do not attempt to roll back to
   `0f0170a3-11a8-4044-a0f0-fe98a25b14ab`. Cloudflare blocks version rollback
   across a Durable Object migration, and the old version predates the required
   binding. Do not publish a new extension until the Worker protocol it needs
   is already live and verified.

After the migration is established, Cloudflare version rollback remains
available only between versions that do not cross a later Durable Object
migration and whose bindings still exist. Confirm that condition in the
Cloudflare deployment history before using `wrangler rollback`; otherwise use a
forward corrective deployment.

Worker secrets currently configured:

```text
UPSTREAM_BASE_URL
UPSTREAM_API_KEY
MONITOR_TOKEN
RESEND_API_KEY
```

Worker vars currently configured:

```toml
ALERT_TO = "me@sylvanyu.io"
ALERT_FROM = "TabRecap Monitor <alerts@sylvanyu.io>"
MONITOR_REMINDER_HOURS = "6"
LLM_READY_MODEL = "gpt-5.4-mini"
LLM_READY_REASONING_EFFORT = "low"
LLM_READY_MAX_TOKENS = "2"
LLM_READY_TIMEOUT_MS = "45000"
UPSTREAM_RETRY_ATTEMPTS = "2"
UPSTREAM_RETRY_DELAY_MS = "1200"
UPSTREAM_CHAT_TIMEOUT_MS = "300000"
UPSTREAM_READY_TIMEOUT_MS = "8000"
```

Useful Worker commands:

```bash
cd /Users/yuyufeng/Projects/tab-recap
npx wrangler deploy --config worker/wrangler.toml
npx wrangler secret list --config worker/wrangler.toml
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
npx wrangler secret put UPSTREAM_BASE_URL --config worker/wrangler.toml
npx wrangler secret put UPSTREAM_API_KEY --config worker/wrangler.toml
npx wrangler secret put MONITOR_TOKEN --config worker/wrangler.toml
npx wrangler tail --config worker/wrangler.toml
```

Do not put secret values in shell history or source files.

## Health Checks

Fast checks:

```bash
curl -sS http://127.0.0.1:8317/healthz
curl -sS http://127.0.0.1:18317/healthz
curl -sS https://cliproxy-origin.sylvanyu.io/healthz
curl -sS https://cliproxy.sylvanyu.io/healthz
curl -sS https://cliproxy.sylvanyu.io/readyz
```

Expected meanings:

| Check | Healthy result | Meaning |
| --- | --- | --- |
| `127.0.0.1:8317/healthz` | 200 | CLIProxyAPI main service is up |
| `127.0.0.1:18317/healthz` | 200 | API-only proxy is up |
| `cliproxy-origin.sylvanyu.io/healthz` | 200 | Tunnel reaches the Mac proxy |
| `cliproxy.sylvanyu.io/healthz` | 200 | Worker route is alive |
| `cliproxy.sylvanyu.io/readyz` | 200 | Worker reaches origin health |

Real model-path check:

```bash
TOKEN="$(cat /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-secrets/cliproxy-monitor-token)"
curl -sS -H "x-monitor-token: $TOKEN" https://cliproxy.sylvanyu.io/llm-readyz
```

`/llm-readyz` spends a tiny model request. It should not be polled frequently.
The Worker Cron already runs it every 30 minutes after email alerts are
configured.

Latest Cron monitor state:

```bash
TOKEN="$(cat /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-secrets/cliproxy-monitor-token)"
curl -sS -H "x-monitor-token: $TOKEN" https://cliproxy.sylvanyu.io/monitor/status
```

This endpoint is for real-time diagnosis after an alert or an extension-side
gateway failure. It reads the last scheduled monitor snapshot from KV and does
not run another upstream health check or model request. A healthy response only
means the status snapshot was read successfully; check `monitor.status`,
`monitor.lastSummary.readyzCode`, and `monitor.lastSummary.llmCode` for the
gateway state.

Useful monitor fields:

- `monitor.firstFailureAt`: when the current outage streak started;
- `monitor.lastFailureAt`: the latest scheduled check that still failed;
- `monitor.lastOkAt`: the latest scheduled healthy check;
- `monitor.lastEmail`: whether the latest alert/recovery email attempt was
  sent successfully;
- `config.upstreamChatTimeoutMs`: Worker chat-completions timeout in
  milliseconds. The current default is 300000 ms.

The response is deliberately redacted. It reports configuration status and
coarse failure codes, but not the upstream origin URL, Worker secrets, Resend
API key, alert mailbox, prompts, page titles, URLs, or page text.

## Monitoring And Email

The Worker runs a Cron monitor every 30 minutes.

Checks:

1. Worker to origin readiness via `/readyz`.
2. Real LLM path via `/llm-readyz`, using:

   ```text
   model: gpt-5.4-mini
   reasoning_effort: low
   max_tokens: 2
   ```

Email delivery:

```text
Provider: Resend
From: TabRecap Monitor <alerts@sylvanyu.io>
To: me@sylvanyu.io
```

Alert rules:

- first outage sends an email;
- repeated failures are quiet;
- persistent failure sends another email after 6 hours;
- recovery sends a recovery email.

If `RESEND_API_KEY`, `ALERT_TO`, or `ALERT_FROM` is missing, the scheduled job
returns before running the real LLM probe, so it does not spend model usage
without a working alert channel.

If monitor state storage is missing, the scheduled job also returns before
`/readyz` or `/llm-readyz`. Without state storage it cannot suppress duplicate
outage emails or send a correct recovery email.

Request correlation:

- every Worker response includes `x-tab-recap-request-id`;
- default gateway requests use the side-panel operation id, so extension errors,
  Worker tail logs, and local origin logs can be matched;
- the side panel preserves this request id in localized gateway error copy,
  including custom provider errors, while redacting raw upstream bodies.

After every Worker deploy or secret change, verify the live monitor config:

```bash
TOKEN="$(cat /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-secrets/cliproxy-monitor-token)"
curl -sS -H "x-monitor-token: $TOKEN" https://cliproxy.sylvanyu.io/monitor/status
```

Expected:

```text
config.email: configured
config.upstream: configured
config.stateStore: configured
monitor.lastSummary.readyzCode: ready
monitor.lastSummary.llmCode: llm_ready
```

If `config.email` is `resend_api_key_missing`, the Worker will not send outage
mail and the Cron job will skip the real LLM probe. Re-enter the secret with a
TTY prompt instead of a non-interactive shell value:

```bash
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
```

Then deploy or wait for Wrangler's secret update to publish, and re-check
`/monitor/status`. Do not store the Resend key in this repository.

Resend test email was sent and received on 2026-07-02. Resend returned:

```text
7c5180ba-4542-43e5-8d73-3333ee5bd1cd
```

DNS/email coexistence notes:

- Migadu receiving mail remains on `sylvanyu.io` MX records:
  `aspmx1.migadu.com` and `aspmx2.migadu.com`.
- Migadu DKIM remains on `key1._domainkey`, `key2._domainkey`, and
  `key3._domainkey`.
- Resend uses `resend._domainkey.sylvanyu.io`, so it does not overwrite Migadu
  selectors.
- `send.sylvanyu.io` has separate Amazon SES records and does not affect
  `me@sylvanyu.io`.

## Logs

Local fallback/direct logs:

```text
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/cli-proxy-api.out.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/v1-proxy.out.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/cloudflared.out.log
```

Screen fallback logs:

```text
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/cli-proxy-api.screen.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/v1-proxy.screen.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/cloudflared.screen.log
```

Watchdog logs:

```text
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.out.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.err.log
/Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog-restart.log
```

Worker logs:

```bash
cd /Users/yuyufeng/Projects/tab-recap
npx wrangler tail --config worker/wrangler.toml
```

Useful local log commands:

```bash
tail -n 80 /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/cloudflared.screen.log
tail -n 80 /Users/yuyufeng/Projects/CLIProxyAPI/.runtime-logs/watchdog.out.log
launchctl print gui/$(id -u)/com.router-for-me.cliproxyapi-watchdog
```

## When The Service Is Down

Start with:

```bash
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
```

Then:

```bash
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
```

Interpretation:

| Symptom | Likely cause | Action |
| --- | --- | --- |
| local `8317` fails | CLIProxyAPI main service down | run helper `restart` |
| local `18317` fails | API-only proxy down | run helper `restart` |
| local healthy, origin public 530 | Cloudflare Tunnel unhealthy | restart tunnel/full stack |
| Worker `/healthz` 200, `/readyz` fails | Worker up, origin path down | inspect tunnel/local services |
| `/readyz` 200, chat fails | model route/upstream issue | inspect Worker tail and CLIProxyAPI logs |
| `401` from origin direct `/v1` | normal for raw origin without key | test via Worker instead |
| `530` / `error code: 1033` | Cloudflare has no healthy origin connection | restart tunnel; verify `protocol: http2` |

Default recovery:

```bash
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh restart
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
```

Gateway smoke with Worker monitor verification:

```bash
npm run smoke:gateway
```

This checks the product-facing Worker health path, origin readiness path,
`/monitor/status` configuration when a monitor token is available, and a real
chat-completions request. The monitor snapshot is diagnostic in this mode: if
the scheduled monitor still shows a stale outage but current `/readyz` and the
real chat request pass, the live smoke passes and reports the stale monitor
status in its output. It still fails if monitor configuration is incomplete.
The script reads `MONITOR_TOKEN`, then `MONITOR_TOKEN_FILE`, then this
machine's default local runtime token file.

For a release-blocking live check, require a fresh monitor snapshot:

```bash
GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway
```

This additionally fails if `/monitor/status` is skipped, not `ok`, older than
two hours, or missing healthy `readyz` / `llm-readyz` summary codes.

This distinction matters after manual recovery: `/monitor/status` is written by
the scheduled Worker Cron, so it can lag behind current service health until the
next 30-minute run.

Full pre-release live gate:

```bash
npm run release:check:live
```

This runs the full local release gate first, then the same live default-gateway
smoke with `GATEWAY_REQUIRE_MONITOR=1`. Use it before publishing builds that
rely on the built-in AI service.

If `cloudflared` is running but public checks still return 530, inspect
Cloudflare tunnel logs. If logs show QUIC timeouts or no free edge addresses,
keep `protocol: http2` and restart the tunnel.

## Incident Log

### 2026-07-07: Worker healthy, origin proxy down

Symptom:

- `https://cliproxy.sylvanyu.io/healthz` returned 200.
- `https://cliproxy.sylvanyu.io/readyz` returned 503 with
  `upstream_unavailable`.
- `npm run smoke:gateway` initially failed because the latest Worker monitor
  snapshot still reported the earlier outage.

Local diagnosis:

```bash
/Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh status
```

Result:

- local main service `127.0.0.1:8317`: healthy.
- local API-only proxy `127.0.0.1:18317`: down.
- Cloudflare Tunnel process: running.
- raw origin `cliproxy-origin.sylvanyu.io`: 502.

Root cause:

- The local helper script started the API-only proxy through a hard-coded
  `/opt/homebrew/bin/node` path.
- This machine's active Node binary is `/Users/yuyufeng/.local/bin/node`.
- The proxy process therefore failed immediately, even though the main service
  and tunnel were alive.

Fix:

- Updated the local helper to resolve Node dynamically from `NODE_BIN`,
  `command -v node`, Homebrew locations, and `$HOME/.local/bin/node`.
- Restarted the CLIProxyAPI stack.
- Verified:
  - local `8317`: 200.
  - local `18317`: 200.
  - raw origin health/models: 200.
  - Worker `/healthz`: 200.
  - Worker `/readyz`: 200.
  - helper smoke: 200, valid `gpt-5.4` chat response in about 6.6 seconds.

Operational note:

- `/monitor/status` is a scheduled KV snapshot. It can remain `down` until the
  next 30-minute Cron run even after the live service is recovered.
- Use ordinary `npm run smoke:gateway` for immediate recovery validation.
- Use `GATEWAY_REQUIRE_MONITOR=1 npm run smoke:gateway` only when a fresh
  healthy monitor snapshot is required, such as before release.

## Migration Checklist

Use this when moving the origin from this Mac to another machine or a server.

1. Provision the new origin.

   - Install CLIProxyAPI.
   - Install Node for `.codex/v1-only-proxy.mjs`.
   - Install `cloudflared`.
   - Copy or recreate `config.yaml` with model-provider credentials.
   - Do not expose `8317` publicly.

2. Recreate the API-only proxy.

   - Listen on `127.0.0.1:18317`.
   - Forward only `/healthz`, `/v1`, and `/v1/*`.
   - Verify `/management.html` returns 404.

3. Recreate or move the Cloudflare Tunnel.

   - Keep `cliproxy-origin.sylvanyu.io` as the raw origin hostname, or update
     the Worker `UPSTREAM_BASE_URL` secret if the hostname changes.
   - Keep `protocol: http2` unless there is a reason to revisit transport.

4. Recreate service supervision.

   - Prefer launchd/systemd/managed service over manual shell sessions.
   - Add a watchdog equivalent to check local main, local proxy, and Worker
     readiness.

5. Update Worker secrets if needed.

   ```bash
   cd /Users/yuyufeng/Projects/tab-recap
   npx wrangler secret put UPSTREAM_BASE_URL --config worker/wrangler.toml
   npx wrangler secret put UPSTREAM_API_KEY --config worker/wrangler.toml
   npx wrangler secret put MONITOR_TOKEN --config worker/wrangler.toml
   npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
   npx wrangler deploy --config worker/wrangler.toml
   ```

6. Verify the whole chain.

   ```bash
   curl -sS https://cliproxy.sylvanyu.io/healthz
   curl -sS https://cliproxy.sylvanyu.io/readyz
   /Users/yuyufeng/.codex/skills/cliroxyapi-service/scripts/manage-cliroxyapi-service.sh smoke
   ```

7. Send a test alert email after DNS/provider setup.

   Use Resend with:

   ```text
   from: TabRecap Monitor <alerts@sylvanyu.io>
   to: me@sylvanyu.io
   ```

## Things Not To Forget

- The extension should use `https://cliproxy.sylvanyu.io/v1`.
- The Worker should use origin `https://cliproxy-origin.sylvanyu.io/v1`.
- The raw origin is not a public product API.
- `cliproxy.sylvanyu.io/healthz` is not enough; check `/readyz` or `smoke`.
- `/llm-readyz` costs a tiny model request and is protected by `MONITOR_TOKEN`.
- `/monitor/status` costs no model usage and shows the latest Cron monitor
  snapshot for outage triage.
- Normal extension chat-completions calls are bounded by
  `UPSTREAM_CHAT_TIMEOUT_MS`; a hung local origin should become
  `origin_chat_timeout` instead of an endless wait.
- Resend is only for alerts; Migadu remains the mailbox provider for
  `me@sylvanyu.io`.
- Secret values live in Cloudflare Worker secrets and local config files, not in
  this repo.
