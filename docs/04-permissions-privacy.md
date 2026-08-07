# Permissions and privacy

TabRecap keeps title-and-URL organization available without page-body access. Page summaries are a separate opt-in feature.

## Manifest permissions

```json
{
  "permissions": ["tabs", "tabGroups", "storage", "activeTab", "alarms", "sidePanel"],
  "optional_permissions": ["scripting"],
  "optional_host_permissions": ["https://*/*", "http://*/*"]
}
```

There is no fixed AI host in `host_permissions`.

- `tabs` reads the title, URL, order, window, pinned state, and other metadata needed to build and restore a plan.
- `tabGroups` reads and changes Chrome tab groups after the user approves a plan.
- `storage` keeps settings, local activity, analysis state, diagnostics, and rollback snapshots on the device.
- `activeTab` supports a user-invoked summary of the active page.
- `alarms` wakes the MV3 worker for best-effort activity reconciliation.
- `sidePanel` provides the main UI.
- Optional `scripting` extracts short visible-text summaries only after page summaries are enabled.
- Optional host permissions cover the exact AI origin entered by the user and page origins selected for summary access.

The normal build is the complete submission target and keeps `scripting` optional. The separate `store` channel remains a reduced fallback without page-summary scripting and is not used for the current submission.

## AI endpoint access

The extension has no embedded default endpoint. During setup it derives the exact origin from the Base URL and requests only that origin. Public, local, and authenticated endpoints follow the same path; the API key field may be blank.

The shared Cloudflare Worker is documented in the README. Its hostname is not a fixed manifest permission and is not selected silently.

## Page summaries

Normal organization uses tab metadata only. Page summaries require all of the following:

1. the user turns on the feature;
2. the risk notice is acknowledged;
3. Chrome grants optional `scripting` permission;
4. Chrome grants the requested page origin;
5. the page is awake, non-incognito, and supported.

Tabs without permission remain metadata-only. Background jobs never open a permission prompt; they use already granted origins and return a structured `permission_required` result for the rest.

The sampler reads headings, descriptions, and a bounded visible-text excerpt. It excludes passwords, form values, cookies, local storage, full HTML, editable drafts, incognito tabs, and restricted Chrome pages.

## Local activity

Activity memory is best-effort because Chrome suspends MV3 service workers. Records are updated on startup, tab and window events, alarms, and side-panel actions. They must not be presented as complete browser history.

Saved activity uses sanitized URLs without query strings or fragments. Users can stop capture and clear activity, summary caches, lifecycle logs, and diagnostics without closing tabs.

## Store disclosures

Declare web history, user activity, and website content. Website content applies only to the optional page-summary feature. Disclose that compact task data is sent to the endpoint selected by the user after an explicit analysis or recap action.

Remote code is `No`: all executable extension code ships in the ZIP. Model responses are data and pass local validation before any browser mutation.
