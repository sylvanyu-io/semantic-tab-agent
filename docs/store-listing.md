# Chrome Web Store listing

Source copy for the Chrome Web Store dashboard.

## Shared fields

- Category: `Productivity`
- Homepage URL: `https://github.com/sylvanyu-io/tab-recap`
- Support URL: `https://github.com/sylvanyu-io/tab-recap/issues`
- Privacy policy URL: `https://github.com/sylvanyu-io/tab-recap/blob/main/PRIVACY.md`

## English (`en`)

### Name

TabRecap

### Summary

Sort crowded Chrome windows by task, review cleanup candidates, and recap recent tab activity.

### Detailed description

TabRecap is for the point where a working session has spread across too many tabs. It proposes task-based groups, keeps uncertain pages visible for review, and builds a recap from activity recorded on this device.

Organize with a preview

- Group tabs by meaning instead of domain alone.
- Check the complete plan before anything moves.
- Keep existing groups or consolidate tabs into one window.
- Undo supported organization changes.

Clean up on your terms

- Review likely duplicates, stale searches, and low-value pages.
- See the reason behind each suggestion.
- Close only the tabs you select. TabRecap never closes tabs automatically.

Review a recent session

- Choose a recent period and generate a compact recap.
- See themes and a timeline grounded in recorded activity.
- Treat the result as a working note, not a complete Chrome history.

Data and control

- No TabRecap account is required.
- Settings, activity clues, and undo data stay in Chrome extension storage on this device.
- Compact tab data is sent to the selected AI endpoint only after you start an analysis or recap.
- Page summaries are off by default and require a separate Chrome permission prompt.

AI connection

Enter any OpenAI Chat Completions-compatible Base URL and model ID. TabRecap can read the endpoint's model list, but model IDs may also be typed manually. There are no vendor presets.

For a quick trial, use `https://tab-recap-gateway.sylvanyu.io/v1`, leave the API key blank, and load the available models. The shared endpoint is limited by IP, payload size, token count, and total quota. It accepts only TabRecap requests and may be unavailable after the shared quota is used. You can switch to your own endpoint at any time.

## Simplified Chinese (`zh_CN`)

### Name

TabRecap

### Summary

按任务整理杂乱标签页，检查清理候选，根据本地活动记录回顾最近的工作。

### Detailed description

当一次工作逐渐铺满多个窗口和几十个标签页时，TabRecap 会给出按任务划分的分组方案，把拿不准的页面留给你复查，再用本机记录的活动生成近期回顾。

整理前先看方案

- 按页面含义分组，不只看域名。
- 移动标签页前检查完整方案。
- 保留现有分组，或把多个窗口收进一个窗口。
- 支持撤销已经执行的整理操作。

清理哪些页面由你决定

- 检查可能重复、长期闲置或价值较低的页面。
- 每条候选都附有原因。
- 只关闭你明确选择的标签页；TabRecap 不会自动关页。

回看近期工作

- 选择时间范围，生成简短回顾。
- 查看有活动记录支撑的主题和时间线。
- 回顾是一份工作线索，不冒充完整的 Chrome 历史记录。

数据与控制

- 不需要注册 TabRecap 账号。
- 设置、活动线索和撤销数据保存在本机 Chrome 扩展存储中。
- 只有主动开始分析或回顾后，精简标签页数据才会发送到所选 AI 接口。
- 页面摘要默认关闭，开启时 Chrome 会单独询问站点权限。

AI 接口

填写兼容 OpenAI Chat Completions 的 Base URL 和模型 ID 即可。扩展可以读取接口返回的模型列表，也允许手动输入；界面不提供服务商预设。

快速试用可填写 `https://tab-recap-gateway.sylvanyu.io/v1`，API Key 留空，再读取模型。共享接口有 IP、请求大小、token 和总额度限制，只接受 TabRecap 的固定请求。额度耗尽或服务不可用时，可以随时换成自己的接口。

## Privacy tab

### Single purpose

Organize the user's open Chrome tabs, present user-controlled cleanup suggestions, and create recaps from local tab activity with optional AI analysis.

### Permission justifications

- `tabs`: Read open-tab titles, URLs, order, and window membership so the extension can build an organization plan and restore supported state.
- `tabGroups`: Read, create, update, and restore Chrome tab groups selected by the user.
- `storage`: Store settings, local activity clues, analysis jobs, diagnostics, and rollback snapshots on the user's device.
- `activeTab`: Access the currently selected page only after the user enables page summaries and starts a supported action.
- `alarms`: Reconcile best-effort local activity and lifecycle records when the MV3 service worker wakes.
- `sidePanel`: Provide the extension's primary interface in Chrome's native side panel.
- Optional `scripting`: Extract a short visible-text summary from pages the user has authorized. It is not used for normal title-and-URL organization.
- Optional `https://*/*` and `http://*/*`: Request the exact AI API origin entered by the user. When page summaries are enabled, Chrome separately asks for the page origins the user chooses to summarize.

### Data disclosures

Declare these categories because the extension handles them:

- Web history: open-tab URLs, titles, hostnames, tab order, and locally recorded first/last-seen activity clues.
- User activity: tab activation runs, transitions, visit counts, and user-triggered organization or recap actions.
- Website content: a short amount of visible text only after the user enables page summaries and grants site access. The extension does not read form values, passwords, cookies, local storage, or full HTML.

Certify that data is not sold, is not used for advertising or credit decisions, is used only for the extension's disclosed single purpose, and is transmitted securely. Disclose that compact tab metadata, activity clues, and any user-enabled page summaries are sent to the selected AI service when the user starts an analysis or recap.

Remote code: `No`. All executable extension code is packaged in the submitted ZIP. AI responses are treated as data and validated before browser changes.

## Reviewer test instructions

No account or paid subscription is required for the limited shared endpoint.

1. Open several normal `https://` pages in one Chrome window.
2. Click the TabRecap toolbar icon to open the side panel.
3. In the first-run guide, review the organization preferences and page-access choice, then continue to the AI step.
4. Confirm that the AI step visibly prefills `https://tab-recap-gateway.sylvanyu.io/v1` and `deepseek-v4-flash`, with API Key blank. Click Test connection, then enter TabRecap.
5. Keep the current-window scope and click Analyze.
6. Review the proposed groups and cleanup suggestions, then apply the organization.
7. Use Undo to restore the supported tab state.
8. Switch to Recap, choose a recent period, and generate a recap.

The shared endpoint is quota-limited. If its quota is exhausted, the extension shows a recoverable error and accepts any reviewer-provided Chat Completions-compatible endpoint instead.
