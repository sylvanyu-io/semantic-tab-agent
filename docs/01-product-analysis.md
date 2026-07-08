# TabRecap: Analysis

## Problem

The target user keeps multiple browser windows open, each with 100+ tabs. Existing tab managers usually group by title keywords, URL rules, or domain. That fails for long-tail sites, research pages, docs, papers, issue trackers, and mixed workflows where the semantic topic matters more than the hostname.

The extension should behave like a small agent:

- collect enough tab and page context;
- ask an LLM to infer semantic groups;
- present a safe, reviewable plan;
- apply grouping to the current window, or consolidate all normal-window tabs into one target window when the user enables that mode;
- support undo and iterative refinement.

## Chrome Capability Boundary

The core extension APIs are enough for a first version:

- `chrome.windows.getAll({ populate: true })` or `chrome.tabs.query({})` can enumerate tabs across windows.
- The `"tabs"` permission is needed to read sensitive tab properties such as `url`, `pendingUrl`, `title`, and `favIconUrl`.
- `chrome.tabs.group()` can create/add tabs to groups; `chrome.tabGroups.update()` can set group title, color, and collapsed state.
- `chrome.tabGroups.TabGroup.windowId` shows that browser tab groups belong to a single window. So a native Chrome tab group cannot literally span windows.
- The toolbar action opens a native side panel as the primary consumer-facing control surface.
- `chrome.storage.local` / IndexedDB should hold job state, cached tab summaries, and undo snapshots because Manifest V3 service workers can be stopped.

Important implication: native Chrome tab groups belong to one window, so the product should expose two clear MVP modes:

1. Current-window mode: only analyze and group the current normal window. No cross-window tab movement.
2. Consolidate-to-one-window mode: analyze all eligible tabs across all normal windows, move them into one target window, then create native tab groups there.

Default to current-window mode. Consolidate-to-one-window should be available behind a clear switch with preview, explicit confirmation, and undo.

See [05-multi-window-feasibility.md](05-multi-window-feasibility.md) for the API-level feasibility check and consolidation algorithm.

## Recommended Architecture

Use an LLM as a planner, not as an unrestricted executor.

```text
native side panel UI
  -> job controller
  -> tab inventory collector
  -> optional page sampler
  -> LLM planner
  -> schema validator
  -> action planner
  -> Chrome tabs/tabGroups executor
  -> undo store
```

### Extension Parts

- Service worker: handles Chrome events, tab inventory, grouping execution, and state persistence.
- Floating window: review UI, long-running job progress, model settings, cancellation,
  and apply/undo controls.
- Content script or programmatic injection: collects optional page evidence such as meta description, headings, canonical URL, and a short visible-text sample.
- LLM adapter: chat-completions-compatible gateway first, later add Chrome built-in AI or a local native-messaging bridge.
- Planner validator: rejects invalid tab IDs, duplicate assignments, over-broad groups, or actions touching incognito/private tabs unless explicitly enabled.

See [02-agent-contract.md](02-agent-contract.md) for the planner tools, prompt switches, custom prompt rules, and non-negotiable execution limits.

See [04-permissions-privacy.md](04-permissions-privacy.md) for the page sampling and LLM provider permission strategy.

## Data To Give The LLM

Start with low-risk metadata, then request more page context only when needed.

Minimum per tab:

```json
{
  "tabId": 123,
  "windowId": 7,
  "index": 42,
  "title": "Issue #482: streaming retry regression",
  "url": "https://github.com/org/repo/issues/482",
  "hostname": "github.com",
  "pathTokens": ["org", "repo", "issues", "482"],
  "currentGroupTitle": "Work",
  "pinned": false,
  "audible": false,
  "discarded": true,
  "lastAccessed": 1782190000000
}
```

Optional page sample:

```json
{
  "tabId": 123,
  "language": "en",
  "canonicalUrl": "https://github.com/org/repo/issues/482",
  "metaDescription": "...",
  "h1": "streaming retry regression",
  "headings": ["Reproduction", "Expected behavior"],
  "visibleTextSample": "..."
}
```

Do not send full page bodies by default. For 300-800 tabs, full text will be expensive, slow, and privacy-hostile.

## LLM Workflow

### Pass 1: Metadata Classification

Batch tabs into chunks, for example 50-100 tabs. Ask the model to assign each tab to an initial semantic group with confidence and reason.

Batching is an internal planning detail only. The final plan must cover the whole active scope: all eligible tabs in the current window, or all eligible tabs across all normal windows in consolidate-to-one-window mode.

The model must return strict JSON:

```json
{
  "groups": [
    {
      "groupKey": "repo-debugging",
      "title": "Repo Debugging",
      "description": "GitHub issues, PRs, and docs for debugging one codebase",
      "tabRefs": [{"tabId": 123, "windowId": 7}],
      "confidence": 0.82
    }
  ],
  "needsMoreContext": [{"tabId": 456, "reason": "title is generic"}]
}
```

### Pass 2: Context Sampling

Only sample tabs that are ambiguous, generic, or high-value. Examples:

- `Untitled`
- login-gated docs
- long-tail domains
- pages with repeated titles
- pages whose domain conflicts with title semantics

### Pass 3: Merge, Split, And Label

Ask the model to merge duplicate groups, split overloaded groups, and produce concise labels that fit native Chrome tab group titles. In current-window mode, this only applies to the current window. In consolidate-to-one-window mode, this applies to all eligible tabs from all normal windows.

### Pass 4: Action Plan

Transform the model output into deterministic Chrome operations. The LLM should not directly call execution tools. It returns intent; local code validates and applies it.

```json
{
  "mode": "current_window",
  "scope": {"kind": "current_window", "windowId": 7},
  "eligibleTabs": [
    {"tabId": 123, "windowId": 7},
    {"tabId": 124, "windowId": 7},
    {"tabId": 125, "windowId": 7}
  ],
  "excludedTabs": [],
  "groups": [
    {
      "groupKey": "repo-debugging",
      "title": "Repo Debugging",
      "color": "blue",
      "confidence": 0.84,
      "tabRefs": [
        {"tabId": 123, "windowId": 7},
        {"tabId": 124, "windowId": 7},
        {"tabId": 125, "windowId": 7}
      ],
      "reason": "GitHub issues, PRs, and docs about one repository."
    }
  ],
  "reviewTabs": []
}
```

## Agent Tools

Expose narrow, auditable planner-visible tools:

- `list_scope()`
- `list_tabs(windowId?)`
- `get_tab_snapshot(tabId)`
- `request_page_sample(tabId)`

Do not expose tools such as arbitrary network fetch, arbitrary script execution, tab close, bookmark deletion, or history access in the first version.

The tool surface is a contract, not a suggestion. The model can inspect scoped tab data and propose a grouping plan. Local code validates, previews, and executes that plan. `preview`, `apply`, and `undo` are runtime/UI APIs, not model-callable tools. Custom prompts must not be able to grant new tools or bypass executor limits.

## UX

The extension should feel like a tab operations console, not a chatbot-first product.

Primary flow:

1. Open the extension side panel.
2. Choose Current Window or enable Consolidate All Windows Into One Window.
3. Click Analyze.
4. See proposed groups, excluded tabs, review tabs, and any cross-window move preview.
5. Expand a group to inspect tabs and reasons.
6. Move misclassified tabs manually or add a short hint such as "separate job search from reading".
7. Apply.
8. Undo if the result is bad.

Core switches:

- mode: current window, or consolidate all windows into one window;
- target window: new AI-organized window, current window, or selected existing window;
- existing groups: preserve locked existing groups, or dissolve and fully regroup them;
- Review tabs: create a Review group, or leave Review tabs ungrouped;
- page context: off, active tab only, ambiguous tabs with granted permission, or all granted origins;
- host permission requests: never, ask per origin, or ask for selected visible origins;
- page sampling risk consent: off until the user acknowledges the content-sampling warning;
- URL privacy: title-only, sanitized URL, or full URL;
- include pinned tabs: off by default;
- include incognito tabs: off by default and only possible if the browser allows extension access;
- collapse groups after apply: user preference;
- undo target window: leave empty created window open, or close it after successful undo;
- prompt preset: smart organization, media type, read later, or bold grouping;
- custom prompt: appended as user preference, never as a permission override.

MVP defaults should be conservative: metadata-only page context, preserve existing groups, create a Review group, never request page host permissions during analysis, and require an explicit risk acknowledgement before any page content sample is collected.

Required states:

- analyzing inventory;
- waiting for model;
- needs permission to inspect page content;
- low-confidence groups;
- preview diff;
- applying;
- applied with undo;
- partial failure with retry.

## Privacy And Trust

This product handles extremely sensitive data: open URLs and titles reveal work, accounts, health, finance, messages, and private research.

Default policy:

- never include incognito tabs unless the user explicitly enables it;
- strip query parameters by default, with allowlist for useful public paths;
- redact obvious tokens, emails, invite codes, and long IDs where possible;
- show exactly what will be sent to the LLM;
- allow metadata-only mode;
- allow domain denylist and workspace allowlist;
- store custom gateway keys only locally, never in sync storage;
- do not ship a privileged hidden shared key in the extension package.

For a public release, the built-in gateway path may use a public client token, but real authorization, quota, and cost controls must live on the service side. A hosted relay can improve UX, but it becomes a privacy and cost product, not just an extension.

## Technical Risks

1. Service worker lifetime: long LLM calls can exceed Manifest V3 service worker timing expectations. Persist state after every step and make calls resumable so the popup can close and reopen safely.
2. Token pressure: hundreds of tabs cannot be handled as one naive prompt. Use batching, compact descriptors, and context sampling.
3. LLM instability: enforce JSON schema, validate all tab IDs, and show preview before applying.
4. Native tab groups are window-scoped: cross-window native grouping only works by moving tabs or groups into one normal window.
5. Permission fatigue: broad host permissions will scare users. Start with `"tabs"`, `"tabGroups"`, `"storage"`, `"activeTab"`, and request the configured gateway origin only when needed. Page sampling needs optional `"scripting"` plus granted host permission for sampled origins; `activeTab` only covers the user-invoked active tab, not bulk background tabs.
6. Sensitive content: a more powerful model may make better groups, but cloud inference means sending browsing metadata away. This must be explicit.
7. Scale and latency: grouping 500 tabs should feel incremental while planning, but apply should use one validated plan that covers the active scope.

## MVP Scope

MVP should implement:

- Chrome Manifest V3 extension.
- Native side panel UI.
- Analyze current normal window by default.
- Analyze all eligible tabs across all normal windows only in consolidate-to-one-window mode.
- Metadata-only grouping through a pluggable LLM adapter.
- Strict JSON group-plan output.
- Preview before apply.
- Current-window native tab group creation.
- Consolidate-to-one-window mode that moves all eligible tabs into one target window behind a switch.
- Undo last apply.
- Existing-group handling switch: preserve locked existing groups or dissolve and regroup.
- Prompt presets, prompt-affecting switches, Review handling, permission request mode, and a custom prompt field.
- Local settings for gateway address, optional key, privacy mode, ignored domains.

MVP should not implement:

- automatic tab closing;
- automatic cross-window moving without preview and explicit confirmation;
- background autonomous reorganization;
- history/bookmark ingestion;
- full-page content upload by default;
- multi-browser sync;
- public hosted backend.

## Later Versions

- Optional content sampling for ambiguous tabs.
- Consolidate-to-topic-windows mode.
- Virtual cross-window groups in the popup.
- User feedback memory: "these domains usually belong together".
- Embedding cache for cheaper clustering before LLM labeling.
- Local model or Chrome built-in AI adapter.
- Team/workspace presets.
- Evaluation harness with synthetic tab sets and golden grouping outputs.

## Initial Build Order

1. Scaffold MV3 extension with a side panel and service worker.
2. Implement tab inventory and sanitized descriptors.
3. Build a fake planner using local fixtures, so UI and executor can be tested without LLM cost.
4. Implement preview and undo.
5. Add consolidate-to-one-window execution and rollback.
6. Add LLM adapter with strict schema validation.
7. Add prompt presets, prompt switches, and custom prompt support.
8. Add optional page sampler behind explicit permission.
9. Test with 300+ synthetic tabs across 3-5 windows through the harness.

## Open Decisions

- Browser target: Chrome first, then maybe Edge/Arc/Firefox.
- LLM provider: TabRecap default gateway first, optional custom gateway, or Chrome built-in AI later.
- Default mode: current window, with consolidate-to-one-window as a visible switch.
- Privacy default: send full URL, sanitized URL, or title-only.
- Whether the product should be a deterministic tool with an AI planner, or a conversational agent that can ask follow-up questions.
