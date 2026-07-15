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
- Time recap local fallback has a repeatable real-extension scale benchmark for
  30/120/300 tab sessions in an isolated Chromium profile.
- More options includes a user-triggered redacted diagnostics export. The
  diagnostics package summarizes settings shape, local-memory counts, job
  states, rollback counts, and coarse error classes without exporting custom
  keys, page URLs, page titles, page text, or custom prompts.
- Side-panel diagnostic details and user-visible custom gateway errors redact
  provider keys, private/session key fields, PEM private-key blocks, bearer
  tokens, tokenized URLs, cookies, passwords, and common secret query parameters
  before rendering.
- The default AI gateway Worker exposes a token-protected `/monitor/status`
  endpoint for outage triage. It reads the last scheduled monitor snapshot from
  KV without spending model usage and only returns redacted readiness, LLM probe,
  email, and config status.
- Large AI gateway jobs use a coarse-then-refine planner: a low-effort coarse
  bucket pass, followed by high-effort refinement for oversized or uncertain
  buckets, then normal local validation.
- Planner errors are restored in the side panel with visible recovery UI instead of
  being hidden in the title bar.
- Recap advanced settings are scoped to recap-relevant controls and do not show
  organization-only switches.
- Release checks clean stale build artifacts and old local stress summaries,
  regenerate icons, run Node and Playwright tests, scan current files and git
  history for provider-key patterns, build both local and store packages, then
  audit the generated zip artifacts against the unpacked extensions.

Not production-complete yet:

- No Chrome Web Store assets or listing text.
- No hosted account system.
- No provider-specific adaptive scheduler beyond the AI gateway coarse/refine
  path.
- No remote telemetry or hosted diagnostics dashboard.

## Release Gates

Blocking gates:

- `npm run check` passes.
- `npm run release:check` passes and produces a clean extension package.
- GitHub Actions runs `npm run release:check` on push and pull requests, then
  uploads the generated extension zip artifacts.
- `npm run release:check:full` passes before public release packaging. It adds
  the real-extension stress runner to the standard package gate.
- `npm run release:publish-check` passes before creating a public tag. It
  rejects package/manifest drift and refuses to reuse a version whose `vX.Y.Z`
  tag already points to another commit.
- The `CI` workflow can be manually dispatched with `full_gate` enabled to run
  the real-extension stress runner on GitHub's Ubuntu runner under `xvfb`.
- The real-extension stress artifact includes both machine-readable JSON and a
  human-readable Markdown summary. After downloading the JSON, `npm run
  stress:summary -- <artifact>` can regenerate the same compact evidence summary
  used to refresh this document.
- The GitHub full stress job also publishes that Markdown summary to the job
  summary, so pass/fail evidence is visible without downloading artifacts.
- `npm run release:check:live` passes before public releases that depend on the
  built-in default AI service. It runs `release:check:full`, reads
  `MONITOR_TOKEN`, `MONITOR_TOKEN_FILE`, or this machine's default local runtime
  token file, and fails if `/monitor/status` is skipped, not `ok`, older than
  two hours, or missing healthy `readyz` / `llm-readyz` summary codes.
- `npm run stress:extension` validates current-window apply/undo and
  consolidate-to-one-window apply/undo on a throwaway Chromium profile. This is
  called automatically by `release:check:full` and `release:check:live`.
- Tag-triggered CI also runs the real-extension stress job and the live default
  gateway smoke check. The repository must provide a `MONITOR_TOKEN` Actions
  secret; a missing secret or unhealthy built-in service blocks the tag
  workflow instead of publishing a green package from an unverified gateway.
- AI gateway live smoke verifies Worker health, origin readiness, monitor email
  configuration, the latest monitor snapshot, and one real chat-completions
  request.
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
- Organize cancellation remains a user-stopped state even if the background job
  has already disappeared before the cancel request reaches it.
- Recap UI exposes only recap-relevant advanced settings.
- No model provider key, alert email provider key, GitHub token, Google API key,
  AWS access key id, or PEM private-key block appears in git history,
  screenshots, test output, or fixtures. The current and history scanners share
  the same secret-pattern list; history scanning only skips known old fake test
  fixtures that were already removed from source. Release artifact audit also
  scans the final unpacked extension files and fails without printing matched
  secret values.
- Extension package contains no `node_modules`, test outputs, or local secrets.
- Extension zip entries exactly match their unpacked build directories and only
  contain publishable extension assets: `manifest.json`, `src/`, and `icons/`.
- Store packages remove `activeTab` and all optional extension permissions,
  including `scripting`, so page-body sampling controls are unavailable in that
  channel. Store packages keep optional host permissions so a user-selected
  custom AI API origin can still be requested explicitly.
- Release artifact audit also requires page-summary controls to be hidden by
  default before runtime feature detection, preventing unavailable store-channel
  controls from flashing during side-panel startup.
- Settings can be exported and imported for migration without exporting custom
  gateway keys, local activity records, page summaries, timeline logs, jobs, or
  rollback snapshots.
- Diagnostics can be exported for support without exposing custom gateway keys,
  page URLs, page titles, page text, or custom prompts.
- Raw provider error payloads may be kept for local debugging paths only after
  UI-facing details are redacted; product copy must not expose keys, private key
  material, bearer tokens, tokenized URLs, cookies, passwords, or secret query
  parameters.
- Gateway monitor status can be queried with `MONITOR_TOKEN`, does not trigger
  a live model request, and does not expose upstream URLs, alert mailboxes, or
  provider secrets.

Latest full release gates:

- `2026-07-07`: GitHub Actions manual `CI` dispatch with `full_gate=true`
  passed on `main` at `acf7f92`.
- Remote run:
  `https://github.com/sylvanyu-io/tab-recap/actions/runs/28829308154`.
- The remote standard release gate completed in 1m02s and covered the Node,
  worker, and Playwright UI suites, current and history secret scans, dev plus
  store builds, release artifact audit, and extension package artifact upload.
- The remote stress gate then completed in 2m20s under Ubuntu `xvfb` against an
  isolated Chromium profile with 240 tabs across 4 windows.
- All-window organization created 6 groups, applied the plan, and restored all
  240 tabs through undo. The all-window analyze phase took 56.0s.
- Current-window organization created 6 groups for the active 60-tab window,
  applied the plan, and restored the window through undo without leaking state
  across other windows.
- Page-summary risk gating blocked 60 of 60 attempted samples before explicit
  acknowledgement.
- UI-authorized full page-summary sampling read 240 of 240 pages, and active-tab
  sampling read 4 of 4 active pages. Full page sampling took 8.5s.
- The live gateway branch was intentionally skipped because `GATEWAY_API_KEY`
  was not set for this remote stress run.
- Remote stress artifact uploaded by CI: `sta-stress-mr9txdu8.json`.

Latest patch release and live-gateway evidence:

- `2026-07-08` Asia/Shanghai: released `v0.2.6` from `main` at `9ce1116`.
- Local standard release gate passed for `0.2.6` at release time: 250
  Node/Worker tests, 36 Playwright UI smoke tests, current and history secret
  scans, dev plus store builds, and release artifact audit.
- Local packages produced by the gate:
  `dist/tab-recap-0.2.6.zip` and `dist/tab-recap-0.2.6-store.zip`.
- GitHub Actions push CI passed on the same commit:
  `https://github.com/sylvanyu-io/tab-recap/actions/runs/28881789229`.
- Built-in AI gateway smoke passed after the local origin recovery. Latest
  recorded live evidence is in
  [Default AI gateway runbook](12-default-ai-gateway-runbook.md): local main,
  API-only proxy, public origin, Worker `/readyz`, monitor status, and a real
  `gpt-5.4` high-reasoning chat request all passed on 2026-07-09.
- `v0.2.6` release assets uploaded:
  `tab-recap-0.2.6.zip` and `tab-recap-0.2.6-store.zip`.

Post-release hardening verification:

- `2026-07-09` Asia/Shanghai: `npm run release:check` passed again after the
  custom AI gateway settings and recap fallback display hardening. The gate
  covered clean build output, icon generation, `348/348` Node and Worker tests,
  `53/53` Playwright UI smoke tests, current and history secret scans,
  dev/store packaging, and release artifact audit.
- The latest UI smoke coverage includes regression checks that legacy built-in
  gateway URLs cannot leave the UI stuck in custom-provider mode, custom API
  endpoint edits persist safely while typing without storing keys unless
  requested, and local recap fallback does not surface default-service outage
  copy as recap content.
- `2026-07-09` Asia/Shanghai: `npm run release:check:full` passed on `main`
  after the store permission boundary and stress harness were tightened.
- `npm run release:check`: passed end to end, including clean build output,
  icon generation, Node/Worker tests, Playwright UI smoke tests, secret scans,
  dev/store packaging, and release artifact audit.
- `node --test --test-reporter=dot tests/release-scripts.test.mjs`: passed.
- `node --test --test-reporter=dot tests/manifest.test.mjs
  tests/release-scripts.test.mjs`: passed.
- `npm run build:extension:store`: produced
  `dist/tab-recap-0.2.6-store.zip`.
- `npm run audit:release-artifacts`: passed and confirmed the store manifest
  has no optional extension permissions while keeping optional host permissions
  for explicitly configured custom AI API origins.
- `npm test`: `348/348` Node and Worker tests passed.
- `npm run test:worker`: `36/36` Worker tests passed.
- `npm run scan:secrets:history`: no secret patterns found in git history.
- `npm run test:ui`: `53/53` Playwright UI smoke tests passed, covering recap
  progress/cancellation, organize and recap parallel generation, page-summary
  permission controls, custom provider model/ping errors, store content-access
  hiding, and stale generation cancellation behavior.
- `npm run stress:extension`: passed with `240` synthetic tabs across `4`
  windows after the stress harness was updated to follow scoped stored jobs. The
  run validated all-window apply/undo, current-window apply/undo, risk-gated
  sampling, UI-driven page sampling `240/240`, and active-tab sampling `4/4`.
- `2026-07-09 09:04` Asia/Shanghai: local full-path stress was re-run after the
  release verification count refresh. Artifact:
  `dist/stress/sta-stress-mrcsxi3h.json`. It passed with `240` tabs across `4`
  windows, restored all `240` tabs through all-window undo, restored the active
  `60`-tab window through current-window undo, blocked `60/60` samples before
  explicit risk acknowledgement, read `240/240` pages after UI authorization,
  and read `4/4` active-tab samples. Key timings: all-window fake analyze
  `14.9s`, UI-authorized full page sampling `4.6s`. The gateway branch was
  skipped because `GATEWAY_API_KEY` was not set.
- `2026-07-09 12:33` Asia/Shanghai: recap theme hardening recheck after
  `92c4726`, `7927eaf`, and `261153e`. The code now filters generic existing
  browser group names such as `待分类`, `General Workbench`, `page`, and `网页`
  both while normalizing new AI recap output and while rendering older stored
  recap results. Verification:
  `node --test --test-reporter=dot tests/time-recap-safety.test.mjs tests/time-recap.test.mjs`
  passed, `npm run test:ui` passed `54/54`, `npm test` passed `354/354`,
  dev/store extension builds succeeded, `npm run scan:secrets` found no secret
  patterns, and `npm run audit:release-artifacts` passed.
- `2026-07-09 12:40` Asia/Shanghai: full local `npm run release:check` passed
  after the recap-theme hardening commits. The gate rebuilt icons, ran clean
  dist, passed `354/354` Node and Worker tests, passed `54/54` Playwright UI
  smoke tests, passed current and history secret scans, rebuilt both dev and
  store packages, and passed release artifact audit.
- `2026-07-09 13:06` Asia/Shanghai: full local `npm run release:check` passed
  after `5a036df` tightened AI provider normalization. Explicit built-in
  provider selection now wins over stale custom API fields, while base-URL-only
  legacy settings still migrate to custom provider mode. Verification covered
  `354/354` Node and Worker tests, `54/54` Playwright UI smoke tests, current
  and history secret scans, dev/store package builds, and release artifact
  audit. The UI smoke suite also verifies that switching from custom provider
  back to built-in clears hidden custom URL, model, auxiliary model, key, and
  remember-key state before saving.
- `2026-07-09 07:13` Asia/Shanghai: the live release gate components passed on
  the same code path. The latest `release:check:live` run reached and passed the
  240-tab stress phase (`dist/stress/sta-stress-mrcowcwu.json`), which means the
  standard release gate had already passed. A follow-up monitor-required live
  gateway smoke passed against `https://cliproxy.sylvanyu.io/v1` with `gpt-5.4`
  high reasoning in `33.4s`; `/healthz`, `/readyz`, monitor status, email
  configuration, and planner JSON validation were all OK.
- `2026-07-09 14:30` Asia/Shanghai: full local `npm run release:check` passed
  after the recap date display was stabilized and README screenshots were
  refreshed. The gate cleaned build output, regenerated icons, passed `355/355`
  Node and Worker tests, passed `57/57` Playwright UI smoke tests, passed
  current and history secret scans, rebuilt both dev and store packages, and
  passed release artifact audit against the freshly built zips.

Recommended before public listing:

- Keep the local-memory clearing control visible before recap history becomes a
  first-class history surface.
- Use the redacted diagnostics export when investigating AI gateway outages
  before asking users for screenshots or raw extension errors.
- Re-run the 30/120/300-tab real-extension recap scale benchmark before larger
  public releases.
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
- Redact custom provider error details before they reach visible product copy.
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
