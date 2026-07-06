# Time Recap Development Plan / 时间段回顾开发计划

Status: implemented in the current build. The codebase now has a recap input builder, gateway recap planner, local fallback, cancelable runtime message, side-panel Recap mode, shared bottom progress controls, scoped advanced AI settings, a local-memory clearing control, and Node plus Playwright coverage. Remaining work is product expansion, not first-use viability: recap history, direct recap-to-organize actions, and larger real-browser benchmark evidence.

This document records the product plan for "summarize what I did during a time period" and the acceptance checks needed before treating it as release-ready. TabRecap already records useful local signals; the feature turns those signals into a user-facing recap instead of a developer activity dump.

## Product Goal

TabRecap should help a user answer:

- "What have I mainly been working on recently?"
- "Which research or project threads are still open?"
- "Which old tabs look like leftovers from a previous phase?"
- "Where can I quickly jump back in?"

This is not a browser history replacement. It is a local, best-effort work recap built from open-tab metadata, tab activity, and optional page summaries.

## Non-Goals

- Do not auto-close tabs.
- Do not read full browser history.
- Do not promise complete tracking while Chrome suspends the MV3 service worker.
- Do not expose raw implementation terms such as `activeCount`, `ageDays`, `idleDays`, or internal cache keys in UI copy.
- Do not make this a separate generic note-taking product.

## Current Implementation

Implemented pieces:

- `src/core/page-activity-cache.js`
  - Stores sanitized URL key, title, hostname, first seen, last seen, seen count, last tab/window, and compact sample metadata.
  - `getActivityOverview()` already returns a local `recap`, open-tab signals, lifecycle stats, and old-tab candidates.
  - Activity cache TTL is 45 days and max entries are 1400.
- `src/core/page-summary-cache.js`
  - Stores opt-in short page summaries for permitted, non-incognito, non-discarded pages.
  - Cache TTL is 14 days and max entries are 800.
  - Stores compact page fields, not cookies, form values, local storage, full HTML, or full visible text.
- `src/core/tab-lifecycle-log.js`
  - Records open, activate, update, close, inferred open/close, and reconcile events.
  - Tracks first observed, last observed, last activated, active count, pinned/discarded/audible state.
  - Session TTL is 90 days and max sessions/events are 1800.
- `src/core/controller.js`
  - Exposes `activity:getOverview`, `activity:generateTimeRecap`, and `activity:cancelTimeRecap`.
  - Uses activity overview as the local fallback and as planner input.
- `src/core/time-recap.js`
  - Builds compact recap input from local activity, summaries, lifecycle sessions, and current tabs.
  - Sends the recap request through the same chat-completions-compatible gateway.
  - Parses fenced JSON, validates returned IDs, drops invalid references, and falls back to a local recap if AI is unavailable.
- `src/shared/task-constants.js`
  - Keeps the long AI timeout shared between the side panel and core recap planner, so UI requests and background execution cannot drift back to different limits.
- `src/sidepanel/sidepanel.js`
  - Provides a top-level `回顾` / `Recap` mode.
  - Supports past 24 hours, today, last 7 days, last 30 days, this week, this month, and custom date-time ranges.
  - Uses the same bottom progress, disabled primary action, and stop button pattern as organizing.
  - Keeps raw AI errors in diagnostics instead of visible product copy.
- `src/sidepanel/index.html` and `src/sidepanel/styles.css`
  - Show recap-relevant advanced settings only: incognito inclusion, URL privacy, result language, primary/auxiliary model, thinking intensity, gateway URL/key, and key persistence.
  - Hide organization-only controls in recap mode.
- `README.md`
  - Mentions time recap as shipped behavior.

Current verification:

- `npm run release:check`: 184 Node tests, 33 Playwright UI tests, secret scans, dev/store builds, and release artifact audit passed on 2026-07-06.

## User Experience

### Entry Point

Add a top-level entry in the side panel header area:

- Primary mode remains "Organize".
- Add a secondary top entry: "近期回顾" / "Recent Recap".
- The entry should be visible without opening advanced options.

Suggested Chinese copy:

- Entry: `近期回顾`
- Subtitle: `看看最近主要在忙什么`
- CTA: `生成回顾`

Suggested English copy:

- Entry: `Recent Recap`
- Subtitle: `See what you have been working on`
- CTA: `Generate recap`

### Time Range

Provide simple presets:

- `过去 24 小时`
- `今天`
- `最近 7 天`
- `最近 30 天`
- `本周`
- `本月`
- custom start/end date-time inputs

Default: `最近 7 天`.

Do not show scary coverage copy like "only read 2/200 pages" in the main result. Instead show neutral evidence copy:

- `已结合本地活动、标题、网址和可用页面摘要。`
- If the user opens details: show exact coverage numbers.

### Result Layout

The recap result should be a review surface, not a wall of text.

1. `这段时间主要在做什么`
   - 3 to 6 theme cards.
   - Each theme has a short human title, one-sentence summary, confidence, and representative tabs.

2. `时间线`
   - Timeline-like clusters.
   - Show "started around", "recently active", "still open", and "representative pages".

3. `主题线索`
   - 3 to 6 topic cards.
   - Each card explains what the user appeared to be working on and shows representative page chips.

4. `下次继续`
   - Optional next-step hints.
   - These should be light, not a project manager voice.

5. `证据详情`
   - Collapsed by default.
   - Shows exact coverage counts, top hosts, sampled entries, excluded pages, and stale-tab stats.

## Data Contract

Add a recap-specific input shape. Keep it compact and readable.

```ts
type TimeRecapInput = {
  schema: "tab_tidy_time_recap_input_v1";
  languageMode: "auto" | "zh-CN" | "en-US";
  range: {
    preset: "1d" | "today" | "7d" | "30d" | "thisWeek" | "thisMonth" | "custom";
    from: string;
    to: string;
    rangeMs: number;
    label: string;
  };
  coverage: {
    activityEntries: number;
    summaryEntries: number;
    sampledEntries: number;
    currentOpenTabs: number;
    lifecycleSessions: number;
    lifecycleEvents: number;
    inferredClosed: number;
    includedPages: number;
    clippedPages: number;
  };
  pages: TimeRecapPage[];
};

type TimeRecapPage = {
  id: number;
  tabId?: number;
  windowId?: number;
  index?: number;
  open: boolean;
  title: string;
  hostname: string;
  sanitizedUrl?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastActivatedAt?: string;
  closedAt?: string;
  seenCount?: number;
  activeCount?: number;
  currentGroupTitle?: string;
  discarded?: boolean;
  pinned?: boolean;
  audible?: boolean;
  sampleable?: boolean;
  summary?: {
    title?: string;
    metaDescription?: string;
    contentKind?: string;
    headings?: string[];
    visibleTextExcerpt?: string;
  };
};
```

Add a strict output schema:

```ts
type TimeRecapOutput = {
  schema: "tab_tidy_time_recap_v1";
  language: "zh-CN" | "en-US";
  headline: string;
  summary: string;
  themes: Array<{
    title: string;
    description: string;
    confidence: "high" | "medium" | "low";
    ids: number[];
    evidence: string[];
  }>;
  timeline: Array<{
    label: string;
    description: string;
    ids: number[];
  }>;
  followUps: Array<{
    title: string;
    reason: string;
    ids: number[];
  }>;
  coverageNote: string;
};
```

Validation rules:

- Every returned `id` must exist in the recap input or be dropped.
- Compatibility parser also accepts `pageIds`, `pages`, and `tabIds`, but normalized UI state uses page IDs.
- Empty or duplicate themes are merged or removed locally.
- Time recap only explains the activity pattern for the selected range; cleanup recommendations belong to the organizer flow and are not shown in recap results.
- Recap output must not include manual close controls, cleanup checklists, or "worth reviewing" tab recommendations.
- Output language must follow the selected UI language.
- Do not allow the model to request permissions or browser mutations.

## AI Strategy

Start simple:

- Use the same gateway infrastructure as the planner.
- Use `gpt-5.4` high as the first default to match current product defaults.
- Add benchmark rows comparing `gpt-5.4 high`, `gpt-5.4 medium`, and `gpt-5.3-codex-spark low` before changing the default.

Why not reuse the grouping prompt:

- Grouping output optimizes browser mutations.
- Time recap output optimizes user understanding and evidence.
- Mixing them would make the prompt harder to validate and the UI harder to reason about.

Large local cache handling:

- Send a compact row per relevant page.
- Include page summaries only when available.
- For more than 300 rows, rank locally first by recency, active count, tab age, and sampled summary availability; open/closed state is a context signal, not a dominance rule.
- Keep excluded rows counted in coverage so the user can understand limits if they open details.

## Implementation Phases

### Phase 0: Product Truth Cleanup

Goal: avoid shipping a claim before the feature exists.

Status: done.

Evidence:

- Time recap is now implemented in code and included in UI tests.
- `docs/README.md` links this document.
- Public README can describe the feature as shipped behavior.

### Phase 1: Data Aggregator

Goal: convert current cache and lifecycle data into a clean recap input.

Status: done.

Implemented:

- `buildTimeRecapInput(chromeApi, settings, range)` in `src/core/time-recap.js`.
- Combines:
  - activity cache entries;
  - lifecycle sessions;
  - current open tabs and groups;
  - page summary cache entries.
- Adds local ranking:
  - currently open tabs first;
  - recently active pages;
  - pages with summaries;
  - old but still open pages;
  - repeated visits.
- Keeps sanitized URLs only by default.
- Excludes incognito unless the user explicitly enables it.

Verified by tests:

- Unit test range filtering.
- Unit test lifecycle merge.
- Unit test URL query/hash stripping.
- Unit test no mutation.
- Unit test TTL and max-entry behavior.

### Phase 2: Recap Planner

Goal: generate structured recap JSON from local input.

Status: done.

Implemented:

- Gateway recap planner function, separate from grouping planner.
- JSON repair for code-fenced model responses.
- Schema validation and local fallback.
- Localized prompt instructions.
- Strict privacy instruction: do not reveal internal field names in user-facing evidence.

Fallback:

- If AI fails, show local recap:
  - top hosts;
  - top terms;
  - recent pages;
  - stale open tabs.
- Make the fallback look intentional, not like a crash state.

Verified by tests:

- Valid AI response.
- Markdown fenced JSON response.
- Invalid JSON fallback.
- Wrong tab IDs dropped.
- Language follows UI setting.

### Phase 3: Side Panel UI

Goal: make recap feel like a first-class product feature.

Status: first-use flow done.

Implemented:

- Top-level mode switch:
  - `整理`
  - `回顾`
- Time-range selector.
- CTA: `生成回顾`.
- Summary card, timeline rows, theme cards, and follow-up hints.
- Collapsed evidence details.
- Representative page chips.
- Shared bottom progress and stop button while generating.
- Scoped advanced settings so recap does not show organization-only controls.

Future product expansion:

- Launch an organize job from a recap theme.

Design requirements:

- No debug chips.
- No raw AI-ish tags.
- Strong visual hierarchy: title, summary, evidence.
- Keep side panel height stable and middle content scrollable.
- Support Chinese and English.

Verified by tests:

- Playwright render for empty state.
- Playwright render for successful recap.
- Playwright render for AI failure fallback.
- Playwright language switch.
- Playwright shared bottom progress controls.
- Playwright AI failure fallback without raw error leakage in visible copy.
- Playwright recap advanced settings only expose recap-relevant controls.

### Phase 4: Integration With Organize/Cleanup

Goal: connect recap to existing product actions without blurring responsibilities.

Status: deferred.

Future tasks:

- From a recap theme, allow "organize these tabs" by launching a scoped grouping job for those tab IDs.
- Do not automatically mutate groups from the recap screen.
- Do not add cleanup recommendations or manual close controls to the recap screen; cleanup remains an organizer feature.

Acceptance:

- Recap helps the user understand recent work, but it does not silently organize or close anything.

### Phase 5: Privacy and Settings

Goal: make data use understandable without sounding like a dev note.

Status: partially done.

Implemented:

- Recap subtitle explains the data classes used: recent activity, open counts, age, titles, URLs, existing groups, and available page summaries.
- Advanced settings let the user control URL privacy, result language, model, thinking intensity, gateway URL/key, and incognito inclusion.
- Turning off continuous summaries stops future page-summary capture while preserving existing local records for recap.
- More options includes a clear local memory control for activity records, page summaries, and lifecycle logs.

Acceptance:

- User can understand what happens before clicking.
- Turning off continuous summaries stops future content capture.
- Recap still works in metadata-only mode, with lower confidence.

### Phase 6: Benchmarks and Evidence

Goal: leave an auditable before/after trail.

Status: partially done.

Existing evidence:

- Model-routing and planner optimization records live under `docs/benchmarks/`.
- Current automated gates include Node and Playwright coverage for recap data, UI, cancellation, fallback, and language handling.

Future benchmark records under `docs/benchmarks/`:

- Metadata-only recap on 30, 120, 300 synthetic tabs.
- Recap with page summaries.
- Mixed old/new tab sessions.
- Forum-like pages where title alone is weak.
- English UI and Chinese UI.

Metrics:

- elapsed time;
- request count;
- input/output tokens;
- number of themes;
- percentage of pages represented in at least one theme;
- invalid tab ID rate;
- human review score for usefulness;
- whether the summary matches the user's remembered activity.

Acceptance:

- Every model or prompt decision has before/after evidence.
- If a smaller model is selected, quality and latency tradeoff are documented.

## Release Gate

Current first-use gate:

- `npm test` passes.
- `npm run test:ui` passes.
- `npm run build:extension` passes.
- UI smoke covers empty recap, successful recap, cancelable progress, AI fallback, language switch, and scoped advanced settings.
- Time recap generation does not mutate tabs.
- README describes only shipped behavior.
- Docs index links this plan.

Recommended before a broad public listing:

- `npm run release:check` passes for the standard package gate.
- `npm run release:check:full` passes before public packaging, including the
  real-extension stress runner.
- Real Chrome side panel smoke includes metadata-only recap, recap with continuous summaries enabled, denied page permission, sleeping tabs, language switch, and gateway failure fallback.
- Larger real-browser recap benchmarks are added to `docs/benchmarks/`.
- Local-memory clearing remains available before recap history becomes a first-class history surface.

## Open Decisions

- Should recap history be stored, or should each recap stay disposable?
- Should recap themes offer "organize these pages" as a scoped follow-up action?
- Should recap use the primary model by default, or benchmark a cheaper recap-only route before changing defaults?

## Completed First Slice

Implemented:

1. Add `buildTimeRecapInput()` and tests.
2. Add `activity:generateTimeRecap` with local fallback.
3. Add side panel `回顾` entry with quick ranges and custom date-time range.
4. Render AI recap cards and evidence details.
5. Add cancelable bottom progress controls.
6. Keep raw AI errors out of visible product copy.
7. Update tests and docs after the UI works.

This slice is enough for first-use validation. The next product step is not more plumbing; it is deciding whether recap should become a persistent history surface or remain a disposable "what happened recently" view.
