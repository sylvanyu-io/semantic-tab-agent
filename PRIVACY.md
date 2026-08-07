# TabRecap Privacy Policy

Effective date: August 7, 2026

TabRecap organizes open Chrome tabs, shows cleanup candidates, and creates recaps from recent tab activity. This policy describes the data involved in those features.

## Data handled on your device

TabRecap can use:

- open-tab titles, URLs, hostnames, order, window membership, pinned state, and tab-group information;
- first-seen and last-seen times, activation runs, transitions, visit counts, and estimated dwell time recorded while the extension is active;
- settings, analysis state, diagnostics, and rollback snapshots needed to apply and undo organization changes;
- short visible-text page summaries when you turn that feature on and grant Chrome access to the selected sites.

Page summaries are off by default. TabRecap does not read passwords, form values, cookies, browser local storage, payment information, private messages, or full HTML. Incognito tabs and unsupported Chrome pages are skipped.

Local records are stored in Chrome extension storage on your device. They remain until you clear them in TabRecap, uninstall the extension, or Chrome removes the extension's storage. Turning off activity memory stops future activity capture. Clearing local memory does not close tabs.

## AI endpoints and requests

TabRecap does not contain a provider API key or silently select an AI service. You enter an OpenAI Chat Completions-compatible Base URL, model ID, and an API key when the endpoint requires one. API keys are saved locally only when you choose the remember-key option; settings and diagnostics exports omit them.

Data is sent only after you start an analysis, connection test, model-list request, or recap. An analysis or recap can include compact tab metadata, local activity clues, relevant settings, custom instructions, and page summaries you explicitly enabled. Long-term local URL records omit query strings and fragments where possible.

Requests go to the endpoint you entered. That endpoint and its infrastructure may process the request under their own terms and privacy policy.

### Optional shared endpoint

The README and Chrome Web Store description document `https://tab-recap-gateway.sylvan-yu.workers.dev/v1` as a limited trial endpoint. It is not embedded as a hidden default. If you choose it, the request passes through a TabRecap Cloudflare Worker and then OpenCode Go.

The Worker:

- accepts only fixed TabRecap request structures and an allowlist of model IDs;
- limits request size, output tokens, requests per IP per hour and day, page-summary use, and total daily traffic;
- replaces the client credential with a provider credential stored as a Cloudflare Worker Secret;
- does not write request bodies, page titles, page text, or prompts to its rate-limit or monitoring stores;
- turns the connection IP into a keyed one-way digest before creating expiring rate-limit counters, so the raw IP is not used as a Durable Object storage key.

Cloudflare still receives connection information in the normal course of delivering the network request. OpenCode Go processes the forwarded request to produce the model response. The shared subscription has no uptime guarantee and may stop accepting requests when its quota is exhausted.

Operational logs may contain a request ID, response status, timing, and a redacted error category. They are designed not to contain provider keys or full request bodies. Rate-limit counters expire at the end of their hourly or daily window. Monitoring state contains service-health results rather than browsing content.

## How data is used

TabRecap uses the data above only to provide tab organization, cleanup review, activity recap, undo, diagnostics, and abuse protection for the optional shared endpoint. It does not sell personal data, use browsing data for advertising, or use it for credit, lending, or unrelated profiling.

## Your choices

You can use TabRecap without an account. You can review every proposed browser change, leave page summaries off, choose your own AI endpoint, avoid the shared endpoint, stop activity memory, clear local records, or uninstall the extension.

## Security

The extension requires HTTPS for non-local AI endpoints, keeps the shared provider key out of the published package, validates model output before browser changes, and redacts common secrets from visible errors and diagnostics. No storage or transmission method can be guaranteed completely secure.

## Changes

Material changes will be published in this repository with a new effective date. Disclosures and consent prompts will be updated if data use expands.

## Contact

For privacy questions, email [me@sylvanyu.io](mailto:me@sylvanyu.io) or open an issue in the [TabRecap repository](https://github.com/sylvanyu-io/tab-recap/issues).

---

# TabRecap 隐私政策

生效日期：2026 年 8 月 7 日

TabRecap 用于整理 Chrome 标签页、检查清理候选，并根据近期标签页活动生成回顾。下面说明这些功能会涉及哪些数据。

## 设备上的数据

TabRecap 可能使用：

- 已打开标签页的标题、网址、域名、顺序、所属窗口、固定状态和分组信息；
- 扩展运行期间记录的首次出现、最后出现、激活片段、切换关系、访问次数和估算停留时间；
- 设置、任务状态、诊断信息，以及执行和撤销整理所需的快照；
- 你主动开启页面摘要并授予站点权限后，从页面可见区域提取的少量文字。

页面摘要默认关闭。TabRecap 不读取密码、表单内容、Cookie、浏览器本地存储、支付信息、私人消息或完整 HTML。无痕标签页和 Chrome 不允许访问的页面会被跳过。

本机记录保存在设备上的 Chrome 扩展存储中，直到你在 TabRecap 中清除、卸载扩展，或 Chrome 删除扩展数据。关闭活动记忆后不会继续记录新的活动线索。清除本机记录不会关闭标签页。

## AI 接口与请求

TabRecap 不包含服务商 API Key，也不会暗中选择 AI 服务。你需要填写兼容 OpenAI Chat Completions 的 Base URL、模型 ID；接口要求鉴权时再填写 API Key。只有主动开启“记住密钥”后，Key 才会保存在本机；设置与诊断导出不会带出 Key。

只有在你主动分析、测试连接、读取模型列表或生成回顾时，扩展才会发出请求。分析和回顾可能包含精简标签页信息、本机活动线索、相关设置、自定义要求，以及你明确开启的页面摘要。长期保存的网址记录会尽量移除查询参数和片段。

请求会发送到你填写的接口。该接口及其基础设施可能依据各自的条款与隐私政策处理请求。

### 可选共享接口

README 和 Chrome 应用商店简介提供 `https://tab-recap-gateway.sylvan-yu.workers.dev/v1` 作为限量试用地址。它不是藏在扩展里的默认服务。选择该地址后，请求会先经过 TabRecap 的 Cloudflare Worker，再转发给 OpenCode Go。

Worker 会：

- 只接受固定的 TabRecap 请求结构和白名单内的模型 ID；
- 限制请求大小、输出 token、每个 IP 的小时/每日请求数、页面摘要用量和全局每日用量；
- 用保存在 Cloudflare Worker Secret 中的上游凭据替换客户端凭据；
- 不把请求正文、页面标题、页面文字或提示词写入限流和监控存储；
- 先把连接 IP 转换为带密钥的单向摘要，再生成会自动过期的限流计数，因此 Durable Object 不会使用原始 IP 作为存储键。

Cloudflare 在正常转发网络请求时仍会接触连接信息。OpenCode Go 会处理转发内容并生成模型响应。共享订阅不承诺可用时间，额度耗尽后可能停止接受请求。

运行日志可能包含请求 ID、响应状态、耗时和经过脱敏的错误类别，设计上不记录服务商 Key 或完整请求正文。限流计数会在对应小时或日期结束后过期。监控状态只记录服务健康结果，不记录浏览内容。

## 数据用途

上述数据只用于标签页整理、清理复查、活动回顾、撤销、诊断，以及共享接口的防滥用。TabRecap 不出售个人数据，不把浏览数据用于广告、信贷或无关画像。

## 你的选择

使用 TabRecap 无需注册账号。你可以检查每一项浏览器改动，始终关闭页面摘要，换成自己的 AI 接口，不使用共享接口，停止活动记忆，清除本机记录，或卸载扩展。

## 安全

非本机 AI 接口必须使用 HTTPS。共享服务商 Key 不进入发布包；模型结果在改变浏览器状态前会经过校验；可见错误和诊断会对常见密钥格式进行脱敏。任何存储和传输方式都无法保证绝对安全。

## 政策变更

重大变更会在本仓库公开并更新生效日期。如果数据用途扩大，相关商店披露和授权提示也会更新。

## 联系方式

隐私问题可发送邮件至 [me@sylvanyu.io](mailto:me@sylvanyu.io)，或在 [TabRecap 仓库](https://github.com/sylvanyu-io/tab-recap/issues)提交 issue。
