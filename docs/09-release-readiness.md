# Release Readiness

This project is no longer treated as a demo. The release target is a Chrome MV3
extension that can be published after the gates below are satisfied.

## Current Production Posture

Implemented:

- Manifest V3 extension shell with a native side panel.
- Current-window organization by default.
- Explicit consolidate-to-one-window mode for all eligible normal-window tabs.
- Metadata-only inventory and URL sanitization.
- Existing native group preserve/dissolve switch.
- Page sampling off by default with explicit consent and permission gates.
- Long-term page memory is opt-in, local, best-effort, and does not claim complete browser history.
- AI gateway planner, with an offline fake planner kept for automated harnesses.
- Recent Recap mode builds a compact local activity timeline from tab activity,
  lifecycle sessions, current tabs, existing groups, URL metadata, and optional
  page summaries.
- Recap generation uses the same gateway, language, model, thinking-intensity,
  URL-privacy, progress, and cancellation patterns as organization.
- Recap AI failures fall back to local signals without exposing raw gateway
  timeout or infrastructure errors in the visible product copy.
- First-run privacy disclosure explains local activity clues, optional page
  summary access, AI usage, and the no-auto-close boundary.
- Local schema validation before every browser mutation.
- Low-confidence groups below the apply threshold are rejected; the planner must
  put uncertain tabs in Review.
- Groups above `maxTabsPerGroup` are rejected instead of applied as oversized
  catch-all groups.
- Tab inventory includes original `sequenceIndex`, per-window `index`, lifecycle
  activation runs, and direct tab-to-tab transition rows. Planner prompts treat
  these as behavioral evidence only, not as hard grouping rules.
- Target-window selection is validated against user settings; planner output
  cannot redirect apply to an arbitrary window.
- Preview before apply and rollback snapshot persisted before the first browser
  mutation.
- Rollback snapshots are refreshed during apply, so partial failures remain
  undoable.
- Fake Chrome harness, Playwright UI smoke test, and real-extension stress
  runner against an isolated Chromium profile.
- Active analysis jobs expose coarse progress states in the side panel and can be
  canceled; cancellation aborts provider fetches when the request is still live.
- Recap jobs expose the same side-panel bottom progress and stop controls.
- Large AI gateway jobs use a coarse-then-refine planner: a low-effort coarse
  bucket pass, followed by high-effort refinement for oversized or uncertain
  buckets, then normal local validation.
- Planner errors are restored in the side panel with visible recovery UI instead of
  being hidden in the title bar.
- Recap advanced settings are scoped to recap-relevant controls and do not show
  organization-only switches.
- Release checks clean stale artifacts, regenerate icons, run Node and
  Playwright tests, scan current files and git history for provider-key
  patterns, build both local and store packages, then audit the generated zip
  artifacts against the unpacked extensions.

Not production-complete yet:

- No Chrome Web Store assets or listing text.
- No hosted account system.
- No provider-specific adaptive scheduler beyond the AI gateway coarse/refine
  path.
- No telemetry/diagnostics toggle.

## Release Gates

Blocking gates:

- `npm run check` passes.
- `npm run release:check` passes and produces a clean extension package.
- `npm run stress:extension` validates current-window apply/undo and
  consolidate-to-one-window apply/undo on a throwaway Chromium profile.
- AI gateway live smoke passes against the configured gateway when gateway
  credentials are available for a manual pre-release smoke.
- Page sampling cannot run without visible risk acknowledgement.
- Page sampling active-tab mode cannot sample background tabs.
- Bulk page sampling returns `permission_required` without host permission.
- Bulk page sampling can request `scripting` plus visible-site host permissions
  from the explicit page-summary switch gesture and sample page body text.
- Low-confidence groups below the apply threshold fail validation.
- Current-window and selected-window targets must match user settings, not model
  preference.
- Empty consolidate jobs do not create target windows.
- Partial apply failure keeps a rollback snapshot and undo can restore surviving
  tabs.
- If a tab disappears mid-apply, the executor fails rather than silently grouping
  a partial tab set.
- Time recap generation does not mutate tabs.
- Time recap can be canceled while the AI request is still live.
- Time recap fallback keeps raw AI errors in diagnostics rather than visible
  product copy.
- Recap UI exposes only recap-relevant advanced settings.
- No custom gateway key appears in git history, screenshots, test output, or
  fixtures.
- Extension package contains no `node_modules`, test outputs, or local secrets.
- Extension zip entries exactly match their unpacked build directories and only
  contain publishable extension assets: `manifest.json`, `src/`, and `icons/`.
- Store packages remove `activeTab`, `scripting`, and optional host permissions,
  so page-body sampling controls and custom gateway host permission requests are
  unavailable in that channel.
- Settings can be exported and imported for migration without exporting custom
  gateway keys, local activity records, page summaries, timeline logs, jobs, or
  rollback snapshots.

Recommended before public listing:

- Keep the local-memory clearing control visible before recap history becomes a
  first-class history surface.
- Add larger real-browser recap benchmarks for 30, 120, and 300 tab sessions.
- Expand adaptive planning beyond the AI gateway path if other providers become
  first-class large-session targets.

## Provider Policy

The extension uses a chat-completions-compatible AI gateway. The built-in service
path does not require a user-provided key; custom gateways may use an optional
key. Runtime rules:

- Never ship a privileged shared custom gateway key.
- Never commit custom gateway keys.
- Persist custom keys only when the user explicitly opts in.
- Redact custom keys from job snapshots and logs.
- Request gateway host permission only for the configured gateway origin.
- Keep provider output as planning intent only; validator/executor remain local.

AI gateway:

- Uses a chat-completions-compatible gateway with JSON object output.
- Exposes only planner-suitable text models in the UI.
- Adapts common `tabIds` grouping output, then still requires local validation.
- The controller retries once with validation feedback for gateway plans.

## Browser Safety Rules

- Do not close, discard, reload, or navigate tabs.
- Do not execute model-supplied JavaScript.
- Do not perform browser mutations without a rollback snapshot.
- Do not let planner-supplied `targetWindow` override the user-selected target.
- Do not apply groups below the configured confidence threshold.
- Do not silently apply a group if any tab in that group disappeared mid-apply.
- Do not move tabs across windows unless consolidate-to-one-window is selected.
- Keep pinned and incognito tabs excluded by default.
- Treat `chrome://`, `chrome-extension://`, and `file://` as unsupported for
  page sampling.

## Manual QA Matrix

Current-window mode:

- 5 tabs, no existing groups.
- 100+ tabs, mixed domains.
- Pinned tabs excluded.
- Existing groups preserved.
- Existing groups dissolved.
- Apply then undo.

Consolidate-to-one-window mode:

- 3 normal windows with 20+ tabs each.
- One source window becomes empty after move.
- Existing groups preserved.
- Existing groups dissolved.
- Apply then undo.
- User closes a tab after apply, then undo reports missing tab.

Provider behavior:

- Fake planner works offline.
- AI gateway built-in service.
- AI gateway valid custom key.
- AI gateway invalid custom key.
- Provider returns invalid JSON or invalid plan.

Page sampling:

- Off by default.
- Active tab only.
- Background tab rejected in active-tab mode.
- Missing host permission returns `permission_required`.
- Granted origin samples only that origin.

## Evidence Links

- Chrome APIs: `docs/04-permissions-privacy.md` and
  `docs/05-multi-window-feasibility.md`.
