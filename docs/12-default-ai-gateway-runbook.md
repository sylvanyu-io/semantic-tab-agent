# Shared gateway runbook

The gateway is no longer an extension default. Its public URL appears only in the README and Chrome Web Store description.

## Production values

- Worker service: `tab-tidy-gateway` (kept for deployment continuity)
- Public Base URL: `https://cliproxy.sylvanyu.io/v1`
- Upstream Base URL: `https://opencode.ai/zen/go/v1`
- Primary model: `glm-5.2`
- Auxiliary and health model: `deepseek-v4-flash`
- Other allowed models: `kimi-k3`, `deepseek-v4-pro`

## Required secrets

- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`
- `RATE_LIMIT_HASH_KEY`

Never add secret values to this file, `wrangler.toml`, source code, shell arguments, logs, screenshots, or release notes. Set them interactively in Cloudflare or with `wrangler secret put`. Rotate any key that has appeared in chat or another recorded surface.

## Pre-deploy check

1. Confirm the Cloudflare account and existing Worker name.
2. Confirm required secrets exist without printing their values.
3. Confirm the production KV namespace, Durable Object binding, route, and zone.
4. Run `npm run test:worker`.
5. Review the model allowlist and quota values in `worker/wrangler.toml`.
6. Deploy `worker/src/index.js` with `worker/wrangler.toml`.

## Post-deploy check

```bash
curl -fsS https://cliproxy.sylvanyu.io/healthz
curl -fsS https://cliproxy.sylvanyu.io/readyz
curl -fsS https://cliproxy.sylvanyu.io/v1/models
```

Then use the extension's **Test connection** action with the shared Base URL, no client key, `glm-5.2` as primary, and `deepseek-v4-flash` as auxiliary.

Do not test the shared endpoint with generic prompts. It intentionally rejects them.

See [`worker/README.md`](../worker/README.md) for routes, quotas, CORS, monitoring, and exact secret commands.
