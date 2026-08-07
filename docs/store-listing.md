# Chrome Web Store listing

This file is the source of truth for the Chrome Web Store dashboard fields.

## Shared fields

- Category: `Productivity`
- Homepage URL: `https://github.com/sylvanyu-io/tab-recap`
- Support URL: `https://github.com/sylvanyu-io/tab-recap/issues`
- Privacy policy URL: `https://github.com/sylvanyu-io/tab-recap/blob/main/PRIVACY.md`

## English (`en`)

### Name

TabRecap

### Summary

AI tab organizer that groups messy tabs, suggests cleanup, and turns local tab activity into private work recaps.

### Detailed description

Turn a crowded browser into a clear plan.

TabRecap groups open tabs by task, topic, or project, highlights tabs worth reviewing, and turns recent local tab activity into a readable recap.

Organize with a preview

- Group tabs by meaning, not just domain or keywords.
- Review the full plan before anything moves.
- Preserve existing groups or consolidate tabs into one window.
- Undo supported organization changes.

Clean up with control

- Surface likely duplicates, stale searches, and low-value pages.
- See a reason for every suggestion.
- Close only the tabs you select. TabRecap never closes tabs automatically.

Understand where your time went

- Choose a recent time period and generate a compact recap.
- See themes, a timeline, and practical next steps.
- Use best-effort local activity clues instead of pretending to be a complete browser history.

Local-first privacy

- No account required.
- Settings, activity clues, and undo data stay in Chrome extension storage on your device.
- Compact tab metadata is sent to the configured AI service only when you start an analysis or recap.
- The Chrome Web Store build does not read page-body text.
- Custom AI endpoints are optional and remain under your control.

TabRecap is built for people who research, compare, plan, and work across too many tabs but still want to stay in charge of every browser change.

## Simplified Chinese (`zh_CN`)

### Name

TabRecap

### Summary

用 AI 归类杂乱标签页、提供清理建议，并根据本地标签页活动生成私密工作回顾。

### Detailed description

把拥挤的浏览器重新变成一份清楚的计划。

TabRecap 会按任务、主题或项目整理已打开的标签页，找出值得复查的页面，并根据近期本机标签页活动生成一份易读的回顾。

先预览，再整理

- 按页面语义分组，而不是只看域名或标题关键词。
- 移动标签页前完整检查整理方案。
- 可以保留现有分组，也可以把多个窗口合并整理。
- 支持撤销已经执行的整理操作。

清理建议由你决定

- 集中列出可能重复、长期闲置或价值较低的页面。
- 每条建议都会说明原因。
- 只关闭你明确选择的标签页，TabRecap 绝不会自动关闭页面。

看清最近在忙什么

- 选择一段近期时间并生成简洁回顾。
- 查看主要主题、时间线和可执行的下一步。
- 使用尽力记录的本机活动线索，不把它伪装成完整浏览器历史。

本机优先的隐私设计

- 无需注册账号。
- 设置、活动线索和撤销数据保存在设备上的 Chrome 扩展存储中。
- 只有当你主动开始分析或回顾时，才会向配置的 AI 服务发送精简标签页信息。
- Chrome 应用商店版本不读取网页正文。
- 可以自行配置 AI 接口，是否使用完全由你决定。

TabRecap 适合经常在大量标签页之间做调研、比较、规划和工作，同时希望保留每一步控制权的人。

## Privacy tab

### Single purpose

Organize the user's open Chrome tabs, present user-controlled cleanup suggestions, and create recaps from local tab activity with optional AI analysis.

### Permission justifications

- `tabs`: Read open-tab titles, URLs, order, and window membership so the extension can build an organization plan and restore supported state.
- `tabGroups`: Read, create, update, and restore Chrome tab groups selected by the user.
- `storage`: Store settings, local activity clues, analysis jobs, diagnostics, and rollback snapshots on the user's device.
- `alarms`: Reconcile best-effort local activity and lifecycle records when the MV3 service worker wakes.
- `sidePanel`: Provide the extension's primary interface in Chrome's native side panel.
- `https://cliproxy.sylvanyu.io/*`: Send validated, compact analysis and recap requests to the built-in AI gateway only after a user starts the action.
- Optional `https://*/*` and `http://*/*`: Request access only to a custom AI endpoint explicitly configured by the user. The store build does not include script-injection permission and cannot use these grants to read page bodies.

### Data disclosures

Declare these categories because the extension handles them:

- Web history: open-tab URLs, titles, hostnames, tab order, and locally recorded first/last-seen activity clues.
- User activity: tab activation runs, transitions, visit counts, and user-triggered organization or recap actions.

The Chrome Web Store build does not collect website content because it does not include script-injection permission or page-body sampling.

Certify that data is not sold, is not used for advertising or credit decisions, is used only for the extension's disclosed single purpose, and is transmitted securely. Disclose that compact tab metadata and activity clues are sent to the selected AI service when the user starts an analysis or recap.

## Reviewer test instructions

No account or paid subscription is required.

1. Open several normal `https://` pages in one Chrome window.
2. Click the TabRecap toolbar icon to open the side panel.
3. In Organize mode, keep the current-window scope and click Analyze.
4. Review the proposed groups and cleanup suggestions, then apply the organization.
5. Use Undo to restore the supported tab state.
6. Switch to Recap, choose a recent period, and generate a recap.

The built-in AI gateway is required for AI results. If it is temporarily unavailable, the extension shows a recoverable error; Recap can still fall back to local signals where supported.
