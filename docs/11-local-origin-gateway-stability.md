# Shared gateway reliability

The old local-machine origin has been retired from the release design. The optional shared path is now:

```text
TabRecap
  -> Cloudflare Worker
  -> OpenCode Go Chat Completions
```

The extension remains usable with any user-supplied compatible endpoint. The shared path is a trial convenience, not a product dependency.

## Health checks

- `/healthz` proves the Worker is running.
- `/readyz` checks Durable Object access and the upstream `/models` route with server-side authorization.
- `/llm-readyz` sends a protected, tiny model request.
- `/monitor/status` returns the last scheduled health snapshot without spending model quota.

A green `/healthz` alone is not enough. Public readiness requires the rate-limit store and upstream model list. Model readiness additionally requires a valid response from `deepseek-v4-flash` or the configured health model.

## Failure behavior

- Missing Durable Object binding: fail closed with 503.
- Missing upstream secret: fail before consuming quota.
- IP, daily, page-summary, or global quota reached: return 429 with `Retry-After`.
- Upstream auth, timeout, or provider failure: return a redacted product error.
- Shared subscription exhausted: show a recoverable error and let the user switch endpoints.

Request bodies are not written to rate-limit or monitor storage. IP counter keys use a keyed HMAC digest. Generic chat and altered TabRecap contracts are rejected before reaching OpenCode Go.

Deployment and secret instructions live in [`worker/README.md`](../worker/README.md).
