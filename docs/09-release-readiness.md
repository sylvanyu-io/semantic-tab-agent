# Release readiness

## Product state

TabRecap is a Chrome MV3 side-panel extension with English and Simplified Chinese UI. It supports current-window organization, cross-window consolidation, preview, apply, undo, manual cleanup candidates, local activity memory, time recaps, and optional page summaries.

The extension ships without a provider key, endpoint, or vendor preset. Users enter a Chat Completions-compatible Base URL and model ID. `/models` discovery is available when the endpoint supports it. The public trial Worker is documented outside the extension and remains quota-limited.

The normal build is the complete submission target. It keeps `activeTab`, optional `scripting`, and optional host access; page summaries remain off until the user opts in. The reduced `store` channel is retained only as a fallback if the complete package cannot pass review.

## Blocking checks

- `npm test`
- `npm run test:ui`
- `npm run scan:secrets`
- `npm run scan:secrets:history`
- `npm run build:extension`
- `npm run build:extension:store`
- `npm run audit:release-artifacts`
- `git diff --check`

`npm run release:check` runs the regular package gate. `release:check:full` adds the isolated Chromium stress test. `release:publish-check` also checks version and tag consistency.

The live gate requires an explicit `GATEWAY_BASE_URL` and `GATEWAY_MODEL`. `GATEWAY_API_KEY` is optional because public and local endpoints may not require it. No release command should fall back to a hidden service.

## Store submission

Before upload:

- synchronize `manifest.json`, `package.json`, and `package-lock.json`;
- build the full versioned ZIP;
- confirm the ZIP contains no Worker secrets, provider keys, docs, tests, source maps, or build-only files;
- use the permission and data disclosures in `docs/store-listing.md`;
- upload English and Chinese screenshots and the English promotional image;
- verify the side panel at 320 px width;
- test the reviewer flow with the documented shared endpoint.

The shared Worker must be deployed separately. Its provider key and IP hash key belong in Cloudflare Worker Secrets. The extension release is not allowed to contain either value.

## Remaining external step

Chrome Web Store review is the remaining external approval. The published privacy policy and store disclosures must match the complete package, especially optional page summaries and the documented shared endpoint.
