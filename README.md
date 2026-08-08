# TabRecap

<p align="center">
  <img src="docs/assets/logo.svg" width="560" alt="TabRecap" />
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">Chrome tab organization and recent activity recaps</p>

<p align="center">
  <a href="manifest.json"><img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-1f55ff" /></a>
  <a href="https://github.com/sylvanyu-io/tab-recap/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sylvanyu-io/tab-recap/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="package.json"><img alt="Tests" src="https://img.shields.io/badge/tests-node%20%2B%20playwright-c9ff4a" /></a>
  <a href="worker/README.md"><img alt="Gateway" src="https://img.shields.io/badge/AI-gateway-d94a32" /></a>
</p>

TabRecap is a Chrome MV3 side-panel extension. The Organize view groups tabs from the current window or across all windows. The Recap view turns locally recorded tab activity into a short account of recent work.

Every organization plan is shown before it runs. The extension validates the plan locally; cleanup results remain suggestions until a tab is closed manually.

<p align="center">
  <img src="docs/assets/readme-hero-en.png" width="1120" alt="TabRecap English product overview" />
</p>

## Usage

Organize and Recap keep separate progress, so one task does not block the other.

Organize starts with the current window. After analysis, the preview shows proposed groups, unclassified pages, and cleanup candidates. Cross-window mode moves eligible tabs into one window. An undo snapshot records tab order, groups, pinned state, and window placement.

Recap covers the past 24 hours, today, this week, this month, the last 7 or 30 days, or a custom range. Its summary, timeline, and themes come from activity the extension actually observed. It is not a replacement for Chrome history.

## Planner input

Pages from the same domain often belong to unrelated tasks. A GitHub issue, pull request, documentation page, and project board all come from `github.com`, so domain-only grouping is rarely useful. TabRecap sends the planner a compact record containing:

- tab titles, hostnames, sanitized URLs, window membership, and original order;
- existing groups, pinned state, and restricted-page state;
- first-seen time, recent activity, visit count, and estimated dwell time;
- navigation sequences and transitions between tabs;
- organization instructions entered in the side panel.

Activity is supporting evidence. Titles, page meaning, original order, and user instructions carry more weight. Returned plans must pass local schema and scope checks before they can change a tab or window.

## Page access and privacy

Normal organization uses tab metadata. Page summaries are optional and off by default. When you turn them on, Chrome asks for access to the selected sites before TabRecap reads a small amount of visible text from awake, non-incognito pages. It does not read passwords, form values, cookies, local storage, or full HTML. Pages without permission remain title-and-URL only.

Tab activity, transitions, settings, and undo data stay in Chrome extension storage. Starting an organization or recap request sends the compact data needed for that job to the selected model service. See the [privacy policy](PRIVACY.md) for retention, gateway rate limiting, and the complete data boundary.

Chrome suspends MV3 background workers. TabRecap records activity when the extension starts, tabs change, windows switch, or an alarm wakes the worker. Depending on page state and permission, a record may contain only a title and URL or may be skipped.

## Local installation

```bash
npm install
npm run assets:icons
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/extension`. The toolbar icon opens TabRecap in Chrome's right side panel.

## Connect a model

TabRecap does not ship with a provider key. The first-run guide visibly prefills the optional trial endpoint and model so you can get started, and you can replace both with any OpenAI Chat Completions-compatible Base URL and model ID. The API key is optional for public and local endpoints. **Load models** reads the endpoint's `/models` response; you can still type an ID by hand when an API does not expose model discovery.

This works with self-hosted gateways and compatible services from providers such as Volcengine, Alibaba Cloud, Zhipu, DeepSeek, and Moonshot. Provider-specific account setup stays outside the extension.

### Limited shared gateway

For a quick trial, use the public TabRecap gateway:

```text
Base URL: https://tab-recap-gateway.sylvanyu.io/v1
API key:  leave blank
Primary:  deepseek-v4-flash
Auxiliary: leave blank or reuse the primary
```

Click **Load models** to see the current list. The shared gateway currently exposes `glm-5.2`, `kimi-k3`, `deepseek-v4-pro`, and `deepseek-v4-flash` through [OpenCode Go](https://opencode.ai/docs/go/). It has per-IP, per-day, payload, token, and global limits. It accepts only TabRecap request formats, has no uptime guarantee, and may stop working when the shared subscription quota is exhausted. Switch to your own compatible endpoint when that happens.

The first-run AI step visibly prefills this address and `deepseek-v4-flash`; the API key stays blank because the trial endpoint does not require a client key. You can review or replace the values before continuing. Trial requests pass through the TabRecap Cloudflare Worker and are forwarded only to OpenCode Go. The upstream provider key stays in a Worker Secret and is not included in source code or extension packages.

Do not commit personal API keys. Rotate any key exposed in chat, logs, screenshots, shell history, or test output.

## Development and release

Run the regular test suites:

```bash
npm test
npm run test:ui
```

Release gates:

| Command | Checks |
| --- | --- |
| `npm run release:check` | Tests, secret scans, dev/store builds, artifact audit |
| `npm run release:check:full` | Standard gate plus an isolated Chromium extension stress run |
| `npm run release:publish-check` | Full gate plus package version and Git tag checks |
| `npm run release:check:live` | Full gate plus a real request to the explicitly configured gateway |

The live gate reads `GATEWAY_BASE_URL`, `GATEWAY_MODEL`, and an optional `GATEWAY_API_KEY`. GitHub Actions runs the standard gate on pushes and pull requests. To repeat the extension stress run remotely, dispatch the `CI` workflow with `full_gate` enabled.

Generate documentation images and the store package:

```bash
npm run assets:readme
npm run assets:store
npm run build:extension:store
```

A tagged release produces the complete package at `dist/tab-recap-<version>.zip`. The separate `store` channel remains a reduced fallback and is not the current submission target. Untagged filenames include the commit identity and add `dirty` when the worktree has changes. Dashboard copy and image paths are listed in [Chrome Web Store listing](docs/store-listing.md).

## Stress test

```bash
npm run build
npm run stress:extension
```

The stress run creates several windows and hundreds of pages in an isolated Chromium profile. It covers current-window organization, cross-window consolidation, apply/undo, and page-summary permission boundaries.

Enable the real gateway branch:

```bash
STRESS_GATEWAY=1 STRESS_GATEWAY_TABS=60 npm run stress:extension
```

Pass the gateway URL and model. Add a key only when the endpoint requires one:

```bash
STRESS_GATEWAY=1 \
GATEWAY_BASE_URL=https://example.com/v1 \
GATEWAY_API_KEY="$CUSTOM_GATEWAY_API_KEY" \
GATEWAY_MODEL=your-model \
STRESS_GATEWAY_TABS=60 \
npm run stress:extension
```

## Architecture

```text
Chrome tabs/windows
        |
        v
tab inventory + URL sanitization + original order
        |
        v
optional cached page-summary signals
        |
        v
local activity log and recap input
        |
        v
AI gateway planner
        |
        v
local validation + preview
        |
        v
Chrome executor + undo snapshot
```

## Documentation

- [Documentation index](docs/README.md)
- [Benchmarks and decision records](docs/benchmarks/README.md)
- [Gateway Worker](worker/README.md)
