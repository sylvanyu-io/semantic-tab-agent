# TabRecap Privacy Policy

Effective date: August 7, 2026

TabRecap is a Chrome extension for organizing open tabs, reviewing cleanup suggestions, and creating recaps from recent tab activity. This policy explains what data TabRecap handles, why it is needed, and the controls available to you.

## Data TabRecap handles

### Browser data used by the extension

To provide its core features, TabRecap can use:

- open-tab metadata such as page title, URL, hostname, tab order, window, and existing tab-group information;
- local activity clues such as first-seen and last-seen times, activation runs, transitions, and visit counts recorded while the extension is active;
- settings, current analysis state, and rollback snapshots needed to apply and undo tab organization;
- a random installation identifier used only to enforce usage limits for the built-in AI service.

TabRecap does not collect passwords, form values, cookies, browser local storage, payment information, private messages, or full HTML. It skips incognito tabs and unsupported browser pages.

The Chrome Web Store build does not include script-injection permission and does not read page-body text. Development builds may expose an optional page-summary feature, but it remains off until the user acknowledges the risk and grants site access.

### AI requests

TabRecap sends data to an AI service only when you explicitly start an analysis or recap. The request contains the compact tab metadata, local activity clues, settings relevant to that task, and any custom instructions you entered. URLs are reduced where possible, and long-term local records omit query strings and fragments.

By default, requests pass through the TabRecap gateway at `cliproxy.sylvanyu.io` and are forwarded to the configured AI provider. The gateway validates request shape, applies rate limits, adds the server-side provider credential, and returns the result. TabRecap does not write request bodies to its rate-limit or monitoring stores. The network infrastructure and upstream AI provider may process request data to deliver the response under their own terms and privacy policies.

If you configure a custom AI endpoint, requests go to the endpoint you selected. Custom endpoint settings and credentials are stored locally in Chrome extension storage and are not sent to the TabRecap default gateway.

### Service protection data

The built-in AI gateway uses the connection IP address and the random installation identifier to enforce hourly and daily request limits. It stores counters keyed to those values until the applicable hour or day expires. These counters are used only for reliability and abuse prevention, not advertising or behavioral profiling.

Operational logs may contain request identifiers, response status, timing, and redacted error classes. They are designed not to contain page titles, page text, prompts, provider keys, or full request bodies.

## Local storage and retention

Settings, activity clues, analysis state, and rollback information are stored in Chrome extension storage on your device. They remain until you clear them in TabRecap, uninstall the extension, or Chrome removes the extension's storage. Turning off activity memory stops future activity capture. TabRecap provides controls for clearing saved activity, summaries, lifecycle logs, and diagnostics without closing tabs.

Rate-limit counters for the built-in AI gateway expire automatically at the end of their hourly or daily window. Monitoring state contains service-health results rather than browsing content.

## Sharing and sale of data

TabRecap does not sell personal data, use browsing data for advertising, or share it for credit, lending, or unrelated profiling. Data is disclosed only as needed to provide the AI feature you requested, operate the network service, comply with law, or protect the service from abuse.

## Your choices

You can:

- use TabRecap without creating an account;
- review every proposed grouping or cleanup action before applying it;
- undo supported organization changes;
- choose a custom AI endpoint instead of the built-in service;
- turn local activity memory off;
- clear saved local activity and diagnostic data; and
- uninstall the extension to remove its local extension storage.

## Security

TabRecap uses HTTPS for the built-in AI gateway, keeps provider credentials out of the published extension, validates AI responses before browser changes, and redacts common secrets from user-visible diagnostics and service errors. No method of storage or transmission can be guaranteed completely secure.

## Changes to this policy

Material changes will be published in this repository with an updated effective date. If a change materially expands data use, TabRecap will update its disclosures and request consent where required.

## Contact

For privacy questions or requests, email [me@sylvanyu.io](mailto:me@sylvanyu.io) or open an issue in the [TabRecap repository](https://github.com/sylvanyu-io/tab-recap/issues).

---

# TabRecap 隐私政策

生效日期：2026 年 8 月 7 日

TabRecap 是一款用于整理已打开标签页、检查清理建议，并根据近期标签页活动生成回顾的 Chrome 扩展。本政策说明 TabRecap 会处理哪些数据、处理原因以及你可以使用的控制方式。

## TabRecap 处理的数据

为提供核心功能，TabRecap 可能使用标签页标题、网址、域名、顺序、窗口和现有分组信息；也可能在扩展运行期间，将首次出现、最后出现、激活片段、标签页切换和访问次数等活动线索保存在本机。同时，设置、当前任务状态和用于撤销整理操作的快照也会保存在 Chrome 扩展存储中。

TabRecap 不收集密码、表单内容、Cookie、网页本地存储、支付信息、私人消息或完整 HTML，也会跳过无痕标签页和不受支持的浏览器页面。

Chrome 应用商店版本不包含脚本注入权限，不读取网页正文。开发版本可能提供可选的页面摘要功能，但只有在用户确认风险并主动授予站点访问权限后才能开启。

## AI 请求

只有当你主动开始整理分析或生成回顾时，TabRecap 才会向 AI 服务发送完成该任务所需的精简标签页信息、本机活动线索、相关设置和你填写的自定义指令。长期本机记录会移除网址中的查询参数和片段。

默认情况下，请求会经过 `cliproxy.sylvanyu.io` 的 TabRecap 网关，再转发给配置的 AI 提供商。网关负责校验请求、执行用量限制、加入服务端密钥并返回结果。TabRecap 不会把请求正文写入限流或监控存储；网络基础设施和上游 AI 提供商可能依据各自的条款和隐私政策处理请求，以完成响应。

如果你配置自定义 AI 接口，请求会发送到你选择的地址。自定义地址和凭据保存在本机 Chrome 扩展存储中，不会发送到 TabRecap 默认网关。

## 服务保护数据

默认 AI 网关会使用连接 IP 地址和随机安装标识执行每小时、每日用量限制，相应计数会在当前小时或日期结束后过期。这些数据只用于服务可靠性和防滥用，不用于广告或行为画像。

运行日志可能包含请求标识、响应状态、耗时和经过脱敏的错误类型，设计上不记录页面标题、页面正文、提示词、提供商密钥或完整请求正文。

## 本机存储与保留时间

设置、活动线索、任务状态和撤销信息保存在设备上的 Chrome 扩展存储中，直到你在 TabRecap 中清除、卸载扩展，或 Chrome 删除扩展数据。关闭活动记忆后不会继续记录新的活动线索。你可以单独清除活动、摘要、生命周期记录和诊断数据，而不会关闭任何标签页。

默认 AI 网关的限流计数会在对应的小时或日期结束后自动过期。监控存储只包含服务健康结果，不包含浏览内容。

## 数据共享与出售

TabRecap 不出售个人数据，不将浏览数据用于广告，也不会将其用于信贷或无关画像。只有在完成你主动请求的 AI 功能、运行网络服务、遵守法律或保护服务免受滥用所必需时，相关数据才会被处理或转交。

## 你的选择

你无需注册账号即可使用 TabRecap；可以在执行前检查所有分组和清理建议，撤销支持的整理操作，改用自定义 AI 接口，关闭活动记忆，清除本机活动与诊断数据，或通过卸载扩展移除本机扩展存储。

## 安全

TabRecap 的默认 AI 网关使用 HTTPS，发布包中不包含提供商密钥；浏览器操作前会校验 AI 输出，并对诊断和服务错误中的常见敏感信息进行脱敏。任何存储或传输方式都无法保证绝对安全。

## 政策变更

重大变更会在本仓库公开，并更新生效日期。如果变更明显扩大数据用途，TabRecap 会同步更新商店披露，并在需要时重新征得同意。

## 联系方式

隐私相关问题可发送邮件至 [me@sylvanyu.io](mailto:me@sylvanyu.io)，或在 [TabRecap 仓库](https://github.com/sylvanyu-io/tab-recap/issues)提交 issue。
