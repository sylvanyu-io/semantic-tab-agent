# Real Session Evidence Snapshots

Status: implemented as an internal, redacted-by-default runtime snapshot.

## Why This Exists

Synthetic fixtures are good for regression tests, but they cannot prove how the
planner behaves on a real messy browser profile. Real-session evidence snapshots
give us a repeatable way to inspect input coverage before changing prompts,
models, or routing.

The snapshot answers:

- how many tabs and recap pages are available;
- how many page summaries exist;
- how much lifecycle and activation-flow evidence exists;
- whether the current session has enough behavior signals to justify a planner
  quality comparison;
- whether data is thin because summaries, lifecycle events, or activation runs
  are missing.

## Privacy Boundary

The default snapshot is `redacted_counts`. It records counts, ratios, readiness
warnings, and behavior-shape statistics. It does not include tab titles, URLs, or
page-summary text.

Private details are available only when `includePrivateFields: true` is passed.
Private snapshots can contain titles, sanitized URLs, recap pages, and activation
flow IDs. Save them under `docs/benchmarks/private/`; that directory is ignored
by git.

## Runtime Message

From the extension context:

```js
chrome.runtime.sendMessage({
  type: "activity:getEvidenceSnapshot",
  range: { preset: "7d" }
});
```

For local-only private diagnosis:

```js
chrome.runtime.sendMessage({
  type: "activity:getEvidenceSnapshot",
  range: { preset: "7d" },
  includePrivateFields: true
});
```

## Current Use

Use this before running live A/B planner benchmarks:

1. export a redacted snapshot;
2. check `readiness.level` and `readiness.warnings`;
3. only compare prompt/model behavior when lifecycle events and activation runs
   are present;
4. keep private detail snapshots out of git;
5. record public conclusions in `docs/benchmarks/README.md`.

This closes the gap between "synthetic fixture looks good" and "the user's
actual browser profile has enough evidence for the same feature to matter."
