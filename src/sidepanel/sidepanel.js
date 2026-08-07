import {
  createSettingsExport,
  DEFAULT_SETTINGS,
  GATEWAY_CUSTOM_MODEL_VALUE,
  GATEWAY_PROVIDER_MODES,
  normalizeSettings,
  readSettingsImportPayload
} from "../shared/settings.js";
import { STORAGE_KEYS } from "../core/storage.js";
import { isReviewLikeGroup, localizedText, reviewGroupReason, reviewGroupTitle } from "../shared/language.js";
import { normalizeCleanupProductText } from "../shared/model-copy.js";
import { shouldShowPageSampleCount } from "../shared/page-sampling-copy.js";
import { redactSensitiveText } from "../shared/redaction.js";
import { TIME_RECAP_GATEWAY_TIMEOUT_MS } from "../shared/task-constants.js";
import { isGenericRecapThemeTitle, stripCleanupRecommendationsFromRecapText } from "../shared/time-recap-safety.js";

const UI_LANGUAGE_STORAGE_KEY = "tabRecap.uiLanguage";
const UI_LANGUAGES = Object.freeze(["zh-CN", "en-US"]);
const CLEANUP_PRIORITY_ORDER = Object.freeze(["high", "medium", "low"]);
const UI_COPY = Object.freeze({
  "zh-CN": {
    "document.title": "TabRecap",
    "status.default": "AI 标签页整理与回顾",
    "status.saved": "偏好已保存",
    "status.requestingPageSummaryPermission": "正在请求页面摘要权限",
    "status.pageSummaryEnabled": "页面摘要已开启",
    "status.preparing": "正在准备整理",
    "status.checkingPermissions": "正在检查权限",
    "status.checkingPageSummaryPermissions": "正在检查页面摘要权限",
    "status.resolvingWindow": "正在确认当前窗口",
    "status.startingBackground": "正在启动后台整理",
    "status.planReady": "方案好了，可以先检查",
    "status.planNeedsReview": "方案需要检查",
    "status.canceled": "已停止生成。",
    "status.canceling": "正在停止生成",
    "status.organizing": "正在整理标签页",
    "status.organizingChanged": "正在整理变化后的标签页",
    "status.closingTabs": "正在关闭标签页",
    "status.undoing": "正在撤销",
    "status.previousFailed": "上次生成失败，请重新生成",
    "status.previousCanceled": "上次整理已取消",
    "status.noTabs": "没有可整理的标签页。",
    "status.generatedButMissingPreview": "方案已生成，但预览数据没有保存成功。",
    "status.backgroundNotStarted": "后台整理任务没有启动，请重试。",
    "status.anotherJobRunning": "后台已有另一个整理任务，请先取消或等待它完成。",
    "status.notComplete": "整理没有完成。",
    "status.permissionAiGateway": "需要先授权这个 AI 服务地址，才能发送 AI 请求。",
    "status.permissionContinuousSummary": "需要授权网页读取权限后，才能保存页面摘要。",
    "status.permissionPageSummary": "需要授权页面摘要权限，才能读取网页文字摘要。",
    "status.permissionFirstEnablePageSummary": "需要先打开「页面摘要增强」并完成授权，才能读取页面摘要。",
    "status.unsupportedContinuousSummary": "当前安装包没有开启长期页面摘要。",
    "status.unsupportedPageSummary": "当前安装包没有开启页面摘要。",
    "status.customModelMissing": "请填写主模型 ID。",
    "status.gatewayTestUrlMissing": "请先填写 API 地址。",
    "status.gatewayModelsLoading": "正在读取模型列表",
    "status.gatewayModelsLoaded": "已读取 {count} 个模型",
    "status.gatewayTesting": "正在测试 API",
    "status.gatewayTestOk": "API 可用：{model}",
    "status.customGatewayUnreachable": "API 暂时连不上。请检查地址、模型 ID、API Key 或上游服务后重试。",
    "status.customGatewayConnectionTimeout": "API 连接超时。请检查地址、模型 ID、API Key 或上游服务后重试。",
    "status.localMemoryCleared": "本机记录已清空",
    "status.localMemoryBusy": "正在生成中，先停止后再清空本机记录。",
    "status.settingsExported": "设置已导出，不包含 API Key。",
    "status.settingsImported": "设置已导入。API Key 需要重新填写。",
    "status.settingsImportInvalid": "设置文件不可用，请选择 TabRecap 导出的 JSON。",
    "status.diagnosticsExported": "诊断包已导出，不包含密钥、页面网址或页面正文。",
    "status.gatewayTimeout": "API 响应超时。请检查连接，或先点「测试连接」。",
    "status.gatewayAuthDenied": "API 拒绝访问。请检查地址和 API Key。",
    "status.gatewayUnavailable": "API 暂时不可用。请检查上游服务后重试。",
    "status.gatewayLocalOriginOffline": "API 的上游服务暂时离线。请稍后重试。",
    "status.gatewayFailed": "API 没有完成请求。请检查连接后重试。",
    "status.customGatewayAuthDenied": "API 拒绝访问。请检查地址和 API Key。",
    "status.applyChanged": "已创建 {groupCount} 个分组；已处理 {changedTabs} 个变化标签页",
    "status.applyChangedWithReview": "已创建 {groupCount} 个分组；已处理 {changedTabs} 个变化标签页，{reviewCount} 个放进「{reviewTitle}」",
    "status.applyDone": "已创建 {groupCount} 个分组",
    "status.undoDone": "已恢复 {count} 个标签页",
    "status.noPlanToApply": "还没有可应用的方案，请先生成方案。",
    "status.noRollback": "还没有可回退的记录。",
    "status.invalidPlan": "当前方案不可用，请重新生成。",
    "status.progressCopyFailed": "提示文案生成失败，请稍后重试。",
    "status.gatewayUnsupportedModel": "API 不支持这个模型。请检查模型 ID，或先点「测试连接」。",
    "status.customGatewayUnsupportedModel": "API 不支持这个模型。请检查模型 ID，或先点「测试连接」。",
    "status.customGatewayFailed": "API 没有完成请求。请检查上游服务后重试。",
    "status.gatewayInvalidOutput": "API 返回的内容格式不对。请重试或换一个兼容模型。",
    "button.generate": "生成方案",
    "button.regenerate": "返回上级",
    "button.backToSettings": "返回设置",
    "button.cancel": "停止生成",
    "button.apply": "开始整理",
    "button.undo": "撤销",
    "button.gatewayTest": "测试连接",
    "button.gatewayModels": "读取模型",
    "button.clearLocalMemory": "清空",
    "button.settingsExport": "导出",
    "button.settingsImport": "导入",
    "button.diagnosticsExport": "下载诊断包",
    "gateway.testHint": "兼容 OpenAI Chat Completions",
    "gateway.setupHint": "先填写 API 地址和主模型 ID，再生成方案。",
    "button.language": "EN",
    "button.languageAria": "切换界面为英文",
    "mode.organize": "整理",
    "mode.recap": "回顾",
    "mode.organizeSubtitle": "分组与清理",
    "mode.recapSubtitle": "时间线总结",
    "privacy.aria": "隐私说明",
    "privacy.title": "只在需要时读取，始终由你决定",
    "privacy.body": "TabRecap 会在本机保存标签页活动线索；页面正文只有打开「页面摘要增强」并授权后才会读取。AI 只生成整理、清理和回顾建议，不会自动关闭标签页。",
    "privacy.dismiss": "知道了",
    "status.recapPreparing": "正在准备回顾",
    "status.recapGenerating": "正在生成近期回顾",
    "status.recapCanceling": "正在停止生成回顾",
    "status.recapCanceled": "已停止生成回顾。",
    "status.recapReady": "回顾已生成",
    "status.recapAiUnavailable": "本机回顾已生成；稍后可重新生成补全表达。",
    "status.recapFailed": "回顾没有完成，请重新生成。",
    "status.recapRangeInvalid": "请选择有效的开始和结束日期。",
    "scope.label": "范围",
    "scope.currentWindow": "当前窗口",
    "scope.allWindows": "所有窗口",
    "scope.nativeLabel": "整理范围",
    "scope.optionCurrent": "只整理当前窗口",
    "scope.optionAll": "合并并整理所有窗口",
    "analysis.mode.label": "本次分析",
    "analysis.mode.aria": "本次分析内容",
    "analysis.mode.both": "整理 + 清理建议",
    "analysis.mode.grouping": "仅整理标签页",
    "analysis.mode.cleanup": "仅清理建议",
    "analysis.mode.hint.both": "一次分析，同时给出分组方案和建议先检查的标签页；关闭由你决定。",
    "analysis.mode.hint.grouping": "生成分组方案，暂不列清理建议。",
    "analysis.mode.hint.cleanup": "列出建议先检查的标签页，暂不创建分组。",
    "sampling.title": "页面摘要增强",
    "sampling.subtitle": "读取少量网页文字，并在本机保存短摘要",
    "sampling.tooltip": "会把标题、描述、标题层级和页面上的正文或讨论摘录发送给 AI，用于整理和回顾；不会读取密码、表单内容、Cookie、本地存储或完整 HTML。短摘要会长期保存在本机，方便之后整理和回顾。",
    "sampling.aria": "页面摘要说明",
    "activity.focused": "已定位标签页",
    "activity.focusFailed": "标签页可能已经关闭，请刷新清理建议。",
    "activity.firstSeen": "首次见到 {age}",
    "activity.lastActive": "最近活跃 {age}",
    "activity.group": "分组：{group}",
    "activity.noGroup": "未分组",
    "activity.priority.high": "优先检查",
    "activity.priority.medium": "稍后检查",
    "activity.priority.low": "最后扫一眼",
    "cleanup.preview.title": "清理建议",
    "cleanup.preview.subtitle": "这些标签页可能已经过期、重复或属于已完成任务；是否关闭由你决定。",
    "cleanup.preview.subtitleOnly": "AI 只做清理检查：帮你挑出建议先检查的标签页，是否关闭由你决定。",
    "cleanup.preview.empty": "这次没有发现明显需要清理的标签页。",
    "cleanup.groupCount": "{count} 个标签页",
    "cleanup.clue.openCount": "打开过 {count} 次",
    "cleanup.clue.notReopened": "基本没再打开",
    "cleanup.clue.rarelyOpened": "很少回看",
    "cleanup.clue.openForDays": "已放约 {days} 天",
    "cleanup.clue.idleForDays": "闲置约 {days} 天",
    "cleanup.clue.sleeping": "休眠页",
    "cleanup.clue.browserPage": "浏览器设置页",
    "cleanup.clue.searchPage": "搜索结果页",
    "cleanup.clue.weakRelation": "和当前主线关系弱",
    "cleanup.clue.refindable": "需要时容易找回",
    "cleanup.clue.entryPage": "入口页",
    "cleanup.clue.sameGroup": "同组已有更具体页面",
    "cleanup.clue.ungrouped": "还没归类",
    "cleanup.closeOne": "关闭标签页",
    "cleanup.focus": "定位",
    "cleanup.closeOneAria": "关闭这个标签页",
    "cleanup.focusAria": "定位这个标签页",
    "cleanup.closed": "已关闭 {count} 个标签页，方案已同步更新",
    "cleanup.closedWithChanged": "已关闭 {closed} 个标签页，{changed} 个已变化标签页已从方案移除",
    "cleanup.changedSynced": "{count} 个已变化标签页已从方案移除",
    "cleanup.noneSelected": "这个标签页现在无法关闭，请重新生成后再试。",
    "recap.step": "近期回顾",
    "recap.heading": "看看最近主要在忙什么",
    "recap.subtitle": "结合最近活跃、打开次数、保留时长、标题、网址、现有分组和可用页面摘要生成，不会自动关闭标签页。",
    "recap.1d": "过去 24 小时",
    "recap.today": "本日",
    "recap.7d": "最近 7 天",
    "recap.30d": "最近 30 天",
    "recap.thisWeek": "本周",
    "recap.thisMonth": "本月",
    "recap.shortcuts": "快捷时间范围",
    "recap.from": "开始日期",
    "recap.to": "结束日期",
    "recap.generate": "生成回顾",
    "recap.regenerate": "返回上级",
    "recap.generating": "正在生成…",
    "recap.rangeHint24h": "按当前时间向前回看 24 小时。",
    "recap.rangeHintCalendar": "按自然日历范围回顾。",
    "recap.empty": "还没有回顾。",
    "recap.memoHeading": "这段时间主要在忙什么",
    "recap.memoFocus": "主要精力",
    "recap.memoReturned": "反复回到",
    "recap.themes": "主题线索",
    "recap.timeline": "时间线",
    "recap.evidence": "证据详情",
    "recap.evidenceRange": "时间范围：{from} - {to}",
    "recap.evidenceCoverage": "已整理 {included} 个本机页面线索，其中 {summaries} 个带页面摘要。",
    "recap.evidenceSignals": "参考信号：最近活跃、打开次数、保留时长、打开/关闭状态、现有分组、标题、网址和可用页面摘要。",
    "recap.evidenceFallback": "本次已先根据本机线索完成回顾，稍后重新生成可能会补充更完整的表达。",
    "recap.evidencePages": "代表页面：",
    "recap.localFallback": "已先根据本机线索完成回顾。",
    "recap.findTab": "定位",
    "customPrompt.label": "自定义要求",
    "customPrompt.placeholder": "例如：找工作、AI 论文、当前项目分开；拿不准的先放到待分类。",
    "advanced.summary": "更多选项",
    "switch.dissolve.title": "重新整理已有分组",
    "switch.dissolve.subtitle": "已有分组也会纳入这次整理",
    "switch.review.title": "使用待分类分组",
    "switch.review.subtitle": "拿不准的页面先集中放好",
    "switch.pinned.title": "包含固定标签页",
    "switch.pinned.subtitle": "会参与移动和分组",
    "switch.incognito.title": "包含无痕标签页",
    "switch.incognito.subtitle": "只在浏览器允许时生效",
    "switch.collapse.title": "整理后收起分组",
    "switch.collapse.subtitle": "新分组默认折叠",
    "field.urlPrivacy": "发送给 AI 的网址信息",
    "field.pageContext": "页面摘要读取范围",
    "field.hostPermission": "站点授权",
    "field.resultLanguage": "结果语言",
    "field.promptPreset": "整理方式",
    "field.groupingGranularity": "分组数量",
    "field.thinking": "思考强度",
    "field.customModel": "主模型 ID",
    "field.customAuxiliaryModel": "辅助模型 ID（可选）",
    "field.gatewayUrl": "API 地址",
    "field.gatewayKey": "API Key（如需要）",
    "field.rememberKey": "记住 API Key",
    "field.rememberKeyHint": "只保存在这台电脑",
    "field.localMemory": "本机记录",
    "field.localMemoryHint": "清空活动记录、页面摘要和时间线记录，不会关闭标签页",
    "field.settingsTransfer": "设置迁移",
    "field.settingsTransferHint": "导出偏好和模型配置，不包含 API Key",
    "field.diagnostics": "诊断包",
    "field.diagnosticsHint": "导出本机状态摘要，不包含密钥、页面网址或页面正文",
    "field.minConfidence": "最低置信度",
    "field.maxTabs": "单组最大数量",
    "placeholder.customModel": "例如：glm-5.2、kimi-k3、qwen-plus",
    "placeholder.customAuxiliaryModel": "留空则使用主模型",
    "placeholder.gatewayUrl": "https://example.com/v1",
    "placeholder.gatewayKey": "公开或本机接口可留空",
    "option.newWindow": "新窗口",
    "option.currentWindow": "当前窗口",
    "option.preserveGroups": "保留",
    "option.dissolveGroups": "重新整理",
    "option.reviewCreate": "使用待分类分组",
    "option.reviewUngrouped": "放入最接近主题",
    "option.leaveEmpty": "保留空窗口",
    "option.closeEmpty": "关闭本次创建的空窗口",
    "option.urlTitleOnly": "只发标题",
    "option.urlSanitized": "精简网址",
    "option.urlFull": "完整网址",
    "option.pageOff": "不补读页面摘要",
    "option.pageAmbiguous": "只读拿不准的页面",
    "option.pageGranted": "尽量读取已授权页面",
    "option.permissionNever": "整理时不弹授权",
    "option.permissionOrigin": "按站点询问",
    "option.permissionVisible": "一次授权可见站点",
    "option.langAuto": "跟随界面",
    "option.langZh": "简体中文",
    "option.langEn": "English",
    "option.presetConservative": "智能整理",
    "option.presetMedia": "媒体类型",
    "option.presetReadLater": "稍后阅读",
    "option.presetAggressive": "强力归纳",
    "option.granularityCompact": "更少分组",
    "option.granularityBalanced": "平衡",
    "option.granularityDetailed": "更多分组",
    "option.thinkingLow": "低",
    "option.thinkingMedium": "中",
    "option.thinkingHigh": "高",
    "option.thinkingUltra": "超高",
    "preview.step": "整理预览",
    "preview.heading": "即将创建的分组",
    "preview.stepCleanup": "清理预览",
    "preview.headingCleanup": "建议先检查的标签页",
    "preview.stepCombined": "方案预览",
    "preview.headingCombined": "AI 分析结果",
    "preview.resultsAria": "分析结果",
    "preview.groupingTab": "分组建议",
    "preview.cleanupTab": "清理建议",
    "preview.tabsCount": "{count} 个标签页",
    "preview.groupCount": "{count} 组",
    "preview.cleanupCount": "{count} 项",
    "preview.pending": "待生成",
    "preview.empty": "还没有方案。",
    "preview.error": "出错",
    "error.heading": "生成失败",
    "error.retryHint": "检查提示后可以重新生成。",
    "preview.emptyCount": "空",
    "details.summary": "诊断信息",
    "confirm.applyMultiWindow": "这会移动多个窗口里的标签页，并创建浏览器分组。确认开始整理吗？",
    "confirm.changedHeader": "标签页在预览后发生了变化。",
    "confirm.newToReview": "{count} 个新增标签页会放进「{reviewTitle}」。",
    "confirm.newUngrouped": "{count} 个新增标签页会放进最接近的分组。",
    "confirm.changedContent": "{count} 个页面内容已变化，会按当前状态重新纳入整理。",
    "confirm.removed": "{count} 个已关闭的标签页会跳过。",
    "confirm.duplicate": "{count} 个重复引用会跳过。",
    "confirm.continue": "确认继续整理吗？",
    "confirm.clearLocalMemory": "清空后，近期回顾和清理建议会失去已保存的本机线索。当前打开的标签页不会被关闭。确认清空吗？",
    "aiWait.planning": ["理解标题线索", "寻找相邻任务", "避开域名硬分组", "检查不确定页", "整理分组边界"],
    "aiWait.coarse_planning": ["快速扫一遍", "寻找跨窗口主题", "拆出主题方向", "标记模糊标签"],
    "aiWait.refining": ["拆开过大的组", "复核模糊边界", "合并同一任务", "保留原始顺序"],
    "aiWait.cleanup_planning": ["排序清理清单", "比较新旧任务", "挑出低价值页面", "保留手动决定权"],
    "aiWait.retrying": ["修正校验问题", "补齐遗漏标签", "移除重复分配", "重新检查结构"],
    "aiWait.recapping": ["梳理时间线索", "合并本机活动", "对齐页面摘要", "提炼阶段重点", "保留人工判断"]
  },
  "en-US": {
    "document.title": "TabRecap",
    "status.default": "AI tab organizer & recap",
    "status.saved": "Preferences saved",
    "status.requestingPageSummaryPermission": "Requesting page-summary access",
    "status.pageSummaryEnabled": "Page summaries enabled",
    "status.preparing": "Preparing organization",
    "status.checkingPermissions": "Checking permissions",
    "status.checkingPageSummaryPermissions": "Checking page-summary access",
    "status.resolvingWindow": "Finding the current window",
    "status.startingBackground": "Starting background organization",
    "status.planReady": "Plan ready to review",
    "status.planNeedsReview": "Plan needs review",
    "status.canceled": "Generation stopped.",
    "status.canceling": "Stopping generation",
    "status.organizing": "Organizing tabs",
    "status.organizingChanged": "Organizing changed tabs",
    "status.closingTabs": "Closing tabs",
    "status.undoing": "Undoing changes",
    "status.previousFailed": "Last generation failed. Try again.",
    "status.previousCanceled": "Last organization run was canceled",
    "status.noTabs": "No tabs to organize.",
    "status.generatedButMissingPreview": "The plan finished, but the preview was not saved.",
    "status.backgroundNotStarted": "The background organization did not start. Try again.",
    "status.anotherJobRunning": "Another organization run is active. Cancel it or wait for it to finish.",
    "status.notComplete": "Organization did not finish.",
    "status.permissionAiGateway": "Allow access to this AI gateway before sending AI requests.",
    "status.permissionContinuousSummary": "Allow page-reading access before saving page summaries.",
    "status.permissionPageSummary": "Allow page-summary access before reading page text summaries.",
    "status.permissionFirstEnablePageSummary": "Turn on page summaries and grant access before reading page summaries.",
    "status.unsupportedContinuousSummary": "This installation does not include page memory.",
    "status.unsupportedPageSummary": "This installation does not include page summaries.",
    "status.customModelMissing": "Enter a primary model ID.",
    "status.gatewayTestUrlMissing": "Enter an API URL first.",
    "status.gatewayModelsLoading": "Loading models",
    "status.gatewayModelsLoaded": "Loaded {count} models",
    "status.gatewayTesting": "Testing API",
    "status.gatewayTestOk": "API connected: {model}",
    "status.customGatewayUnreachable": "The API is not reachable right now. Check the URL, model ID, API key, or upstream service and try again.",
    "status.customGatewayConnectionTimeout": "The API connection timed out. Check the URL, model ID, API key, or upstream service and try again.",
    "status.localMemoryCleared": "Local records cleared",
    "status.localMemoryBusy": "A generation is running. Stop it before clearing local records.",
    "status.settingsExported": "Settings exported without the API key.",
    "status.settingsImported": "Settings imported. Re-enter the API key.",
    "status.settingsImportInvalid": "This settings file is not usable. Choose a JSON exported by TabRecap.",
    "status.diagnosticsExported": "Diagnostics exported without keys, page URLs, or page text.",
    "status.gatewayTimeout": "The API timed out. Check the connection or run Test connection first.",
    "status.gatewayAuthDenied": "The API denied access. Check the URL and API key.",
    "status.gatewayUnavailable": "The API is temporarily unavailable. Check the upstream service and try again.",
    "status.gatewayLocalOriginOffline": "The API upstream is temporarily offline. Try again later.",
    "status.gatewayFailed": "The API did not complete the request. Check the connection and try again.",
    "status.customGatewayAuthDenied": "The API denied access. Check the URL and API key.",
    "status.applyChanged": "Created {groupCount} groups; handled {changedTabs} changed tabs",
    "status.applyChangedWithReview": "Created {groupCount} groups; handled {changedTabs} changed tabs, with {reviewCount} added to \"{reviewTitle}\"",
    "status.applyDone": "Created {groupCount} groups",
    "status.undoDone": "Restored {count} tabs",
    "status.noPlanToApply": "No plan is ready yet. Generate one first.",
    "status.noRollback": "No rollback snapshot is available yet.",
    "status.invalidPlan": "This plan is not ready to apply. Generate a new one.",
    "status.progressCopyFailed": "Progress captions could not be generated. Try again later.",
    "status.gatewayUnsupportedModel": "The API does not support this model. Check the model ID or run Test connection first.",
    "status.customGatewayUnsupportedModel": "The API does not support this model. Check the model ID or run Test connection first.",
    "status.customGatewayFailed": "The API did not complete the request. Check the upstream service and try again.",
    "status.gatewayInvalidOutput": "The API returned an unexpected format. Try again or use a compatible model.",
    "button.generate": "Generate plan",
    "button.regenerate": "Back",
    "button.backToSettings": "Back to settings",
    "button.cancel": "Stop generating",
    "button.apply": "Organize",
    "button.undo": "Undo",
    "button.gatewayTest": "Test connection",
    "button.gatewayModels": "Load models",
    "button.clearLocalMemory": "Clear",
    "button.settingsExport": "Export",
    "button.settingsImport": "Import",
    "button.diagnosticsExport": "Download diagnostics",
    "gateway.testHint": "OpenAI Chat Completions compatible",
    "gateway.setupHint": "Enter an API URL and primary model ID before generating a plan.",
    "button.language": "中",
    "button.languageAria": "Switch UI to Chinese",
    "mode.organize": "Organize",
    "mode.recap": "Recap",
    "mode.organizeSubtitle": "Group and clean",
    "mode.recapSubtitle": "Timeline recap",
    "privacy.aria": "Privacy note",
    "privacy.title": "Reads only when needed, and you stay in control",
    "privacy.body": "TabRecap saves tab activity clues locally. Page text is read only after you turn on Page summary boost and grant access. AI creates organization, cleanup, and recap suggestions; it never closes tabs automatically.",
    "privacy.dismiss": "Got it",
    "status.recapPreparing": "Preparing recap",
    "status.recapGenerating": "Generating recent recap",
    "status.recapCanceling": "Stopping recap generation",
    "status.recapCanceled": "Recap generation stopped.",
    "status.recapReady": "Recap ready",
    "status.recapAiUnavailable": "Local recap is ready. Regenerate later for a fuller version.",
    "status.recapFailed": "Recap did not finish. Regenerate when ready.",
    "status.recapRangeInvalid": "Choose a valid start and end date.",
    "scope.label": "Scope",
    "scope.currentWindow": "Current window",
    "scope.allWindows": "All windows",
    "scope.nativeLabel": "Organization scope",
    "scope.optionCurrent": "Organize current window only",
    "scope.optionAll": "Merge and organize all windows",
    "analysis.mode.label": "Analysis",
    "analysis.mode.aria": "Analysis scope",
    "analysis.mode.both": "Organize + cleanup suggestions",
    "analysis.mode.grouping": "Organize tabs only",
    "analysis.mode.cleanup": "Cleanup suggestions only",
    "analysis.mode.hint.both": "One analysis returns both topic groups and tabs to check first. You decide what to close.",
    "analysis.mode.hint.grouping": "Creates a grouping plan without cleanup suggestions.",
    "analysis.mode.hint.cleanup": "Lists tabs to check first without creating groups.",
    "sampling.title": "Page summary boost",
    "sampling.subtitle": "Reads a little page text and saves short summaries locally",
    "sampling.tooltip": "Sends titles, descriptions, headings, and visible article or discussion excerpts to AI for organization and recaps. It will not read passwords, form values, cookies, local storage, or full HTML. Short summaries are saved locally for future organizing and recaps.",
    "sampling.aria": "Page summary details",
    "activity.focused": "Tab focused",
    "activity.focusFailed": "The tab may already be closed. Refresh suggestions.",
    "activity.firstSeen": "First seen {age}",
    "activity.lastActive": "Last active {age}",
    "activity.group": "Group: {group}",
    "activity.noGroup": "Ungrouped",
    "activity.priority.high": "Check first",
    "activity.priority.medium": "Check later",
    "activity.priority.low": "Quick scan",
    "cleanup.preview.title": "Cleanup suggestions",
    "cleanup.preview.subtitle": "These tabs may be stale, duplicate, or from completed work. You decide what to close.",
    "cleanup.preview.subtitleOnly": "AI is only checking cleanup candidates here. You decide what to close.",
    "cleanup.preview.empty": "No obvious cleanup candidates in this run.",
    "cleanup.groupCount": "{count} tabs",
    "cleanup.clue.openCount": "Opened {count} times",
    "cleanup.clue.notReopened": "Rarely reopened",
    "cleanup.clue.rarelyOpened": "Lightly used",
    "cleanup.clue.openForDays": "Open for about {days} days",
    "cleanup.clue.idleForDays": "Idle for about {days} days",
    "cleanup.clue.sleeping": "Sleeping page",
    "cleanup.clue.browserPage": "Browser settings page",
    "cleanup.clue.searchPage": "Search results",
    "cleanup.clue.weakRelation": "Weak fit with current task",
    "cleanup.clue.refindable": "Easy to find again",
    "cleanup.clue.entryPage": "Entry page",
    "cleanup.clue.sameGroup": "More specific pages nearby",
    "cleanup.clue.ungrouped": "Not yet grouped",
    "cleanup.closeOne": "Close tab",
    "cleanup.focus": "Find",
    "cleanup.closeOneAria": "Close this tab",
    "cleanup.focusAria": "Find this tab",
    "cleanup.closed": "Closed {count} tabs and updated the plan",
    "cleanup.closedWithChanged": "Closed {closed} tabs and removed {changed} changed tabs from the plan",
    "cleanup.changedSynced": "Removed {count} changed tabs from the plan",
    "cleanup.noneSelected": "This tab cannot be closed right now. Regenerate the plan and try again.",
    "recap.step": "Recent recap",
    "recap.heading": "See what you have been working on",
    "recap.subtitle": "Uses recent activity, open counts, age, titles, URLs, existing groups, and available page summaries. It never closes tabs automatically.",
    "recap.1d": "Past 24 hours",
    "recap.today": "Today",
    "recap.7d": "Last 7 days",
    "recap.30d": "Last 30 days",
    "recap.thisWeek": "This week",
    "recap.thisMonth": "This month",
    "recap.shortcuts": "Quick ranges",
    "recap.from": "Start date",
    "recap.to": "End date",
    "recap.generate": "Generate recap",
    "recap.regenerate": "Back",
    "recap.generating": "Generating...",
    "recap.rangeHint24h": "Looks back 24 hours from the current time.",
    "recap.rangeHintCalendar": "Uses calendar boundaries for this range.",
    "recap.empty": "No recap yet.",
    "recap.memoHeading": "What this period was mainly about",
    "recap.memoFocus": "Main focus",
    "recap.memoReturned": "Kept returning to",
    "recap.themes": "Topic clues",
    "recap.timeline": "Timeline",
    "recap.evidence": "Evidence details",
    "recap.evidenceRange": "Time range: {from} - {to}",
    "recap.evidenceCoverage": "Reviewed {included} local page signals, including {summaries} page summaries.",
    "recap.evidenceSignals": "Signals used: recent activity, open counts, tab age, open/closed state, existing groups, titles, URLs, and available page summaries.",
    "recap.evidenceFallback": "This recap is ready from local signals. Regenerating later may add richer wording.",
    "recap.evidencePages": "Representative pages:",
    "recap.localFallback": "Generated from local signals.",
    "recap.findTab": "Find",
    "customPrompt.label": "Custom instructions",
    "customPrompt.placeholder": "Example: keep job search, AI papers, and current projects separate; put uncertain pages in review.",
    "advanced.summary": "More options",
    "switch.dissolve.title": "Regroup existing groups",
    "switch.dissolve.subtitle": "Existing groups are included in this run",
    "switch.review.title": "Use Needs Review group",
    "switch.review.subtitle": "Set unclear pages aside instead of forcing them",
    "switch.pinned.title": "Include pinned tabs",
    "switch.pinned.subtitle": "They may be moved and grouped",
    "switch.incognito.title": "Include incognito tabs",
    "switch.incognito.subtitle": "Only when the browser allows it",
    "switch.collapse.title": "Collapse groups after organizing",
    "switch.collapse.subtitle": "New groups start collapsed",
    "field.urlPrivacy": "URLs sent to AI",
    "field.pageContext": "Page summary reading range",
    "field.hostPermission": "Site access",
    "field.resultLanguage": "Result language",
    "field.promptPreset": "Organization mode",
    "field.groupingGranularity": "Number of groups",
    "field.thinking": "Reasoning effort",
    "field.customModel": "Primary model ID",
    "field.customAuxiliaryModel": "Auxiliary model ID (optional)",
    "field.gatewayUrl": "API URL",
    "field.gatewayKey": "API key (if required)",
    "field.rememberKey": "Remember API key",
    "field.rememberKeyHint": "Stored only on this computer",
    "field.localMemory": "Local records",
    "field.localMemoryHint": "Clears activity records, page summaries, and timeline logs without closing tabs",
    "field.settingsTransfer": "Settings transfer",
    "field.settingsTransferHint": "Exports preferences and model settings without the API key",
    "field.diagnostics": "Diagnostics",
    "field.diagnosticsHint": "Exports a local status summary without keys, page URLs, or page text",
    "field.minConfidence": "Minimum confidence",
    "field.maxTabs": "Max tabs per group",
    "placeholder.customModel": "For example: glm-5.2, kimi-k3, qwen-plus",
    "placeholder.customAuxiliaryModel": "Leave blank to use the primary model",
    "placeholder.gatewayUrl": "https://example.com/v1",
    "placeholder.gatewayKey": "Leave blank for public or local APIs",
    "option.newWindow": "New window",
    "option.currentWindow": "Current window",
    "option.preserveGroups": "Preserve",
    "option.dissolveGroups": "Regroup",
    "option.reviewCreate": "Use Needs Review group",
    "option.reviewUngrouped": "Use closest topic",
    "option.leaveEmpty": "Keep empty window",
    "option.closeEmpty": "Close the empty window created this time",
    "option.urlTitleOnly": "Titles only",
    "option.urlSanitized": "Short URLs",
    "option.urlFull": "Full URLs",
    "option.pageOff": "Do not read page summaries",
    "option.pageAmbiguous": "Only unclear pages",
    "option.pageGranted": "Read authorized pages when possible",
    "option.permissionNever": "Do not ask while organizing",
    "option.permissionOrigin": "Ask per site",
    "option.permissionVisible": "Allow visible sites once",
    "option.langAuto": "Follow UI",
    "option.langZh": "Simplified Chinese",
    "option.langEn": "English",
    "option.presetConservative": "Smart organize",
    "option.presetMedia": "Media type",
    "option.presetReadLater": "Read later",
    "option.presetAggressive": "Bold grouping",
    "option.granularityCompact": "Fewer groups",
    "option.granularityBalanced": "Balanced",
    "option.granularityDetailed": "More groups",
    "option.thinkingLow": "Low",
    "option.thinkingMedium": "Medium",
    "option.thinkingHigh": "High",
    "option.thinkingUltra": "Ultra",
    "preview.step": "Preview",
    "preview.heading": "Groups to be created",
    "preview.stepCleanup": "Cleanup preview",
    "preview.headingCleanup": "Tabs to check first",
    "preview.stepCombined": "Plan preview",
    "preview.headingCombined": "AI analysis",
    "preview.resultsAria": "Analysis results",
    "preview.groupingTab": "Group suggestions",
    "preview.cleanupTab": "Cleanup suggestions",
    "preview.tabsCount": "{count} tabs",
    "preview.groupCount": "{count} groups",
    "preview.cleanupCount": "{count} items",
    "preview.pending": "Pending",
    "preview.empty": "No plan yet.",
    "preview.error": "Error",
    "error.heading": "Generation failed",
    "error.retryHint": "Review the message, then generate again.",
    "preview.emptyCount": "Empty",
    "details.summary": "Diagnostics",
    "confirm.applyMultiWindow": "This will move tabs across windows and create browser tab groups. Continue?",
    "confirm.changedHeader": "Tabs changed after the preview.",
    "confirm.newToReview": "{count} new tabs will be added to \"{reviewTitle}\".",
    "confirm.newUngrouped": "{count} new tabs will be placed in the closest group.",
    "confirm.changedContent": "{count} changed tabs will be handled from their current state.",
    "confirm.removed": "{count} closed tabs will be skipped.",
    "confirm.duplicate": "{count} duplicate references will be skipped.",
    "confirm.continue": "Continue organizing?",
    "confirm.clearLocalMemory": "This clears saved local clues used by recaps and cleanup suggestions. Open tabs will not be closed. Clear local records?",
    "aiWait.planning": ["Reading title clues", "Finding neighboring tasks", "Avoiding domain-only groups", "Checking uncertain pages", "Tightening group edges"],
    "aiWait.coarse_planning": ["Scanning the tab set", "Finding cross-window topics", "Shaping topic lanes", "Marking fuzzy tabs"],
    "aiWait.refining": ["Breaking up large groups", "Reviewing fuzzy edges", "Merging one task", "Keeping tab order"],
    "aiWait.cleanup_planning": ["Ranking cleanup checklist", "Comparing old tasks", "Finding low-value pages", "Keeping you in control"],
    "aiWait.retrying": ["Fixing validation issues", "Filling missing tabs", "Removing duplicates", "Checking structure again"],
    "aiWait.recapping": ["Reading the timeline", "Merging local activity", "Aligning page summaries", "Finding key phases", "Keeping review manual"]
  }
});
const UI_COPY_TEXT_VALUES = new Set(
  Object.values(UI_COPY).flatMap((table) => Object.values(table).filter((value) => typeof value === "string"))
);

const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  targetWindowMode: document.querySelector("#targetWindowMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  undoTargetWindowMode: document.querySelector("#undoTargetWindowMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode"),
  languageMode: document.querySelector("#languageMode"),
  promptPreset: document.querySelector("#promptPreset"),
  groupingGranularity: document.querySelector("#groupingGranularity"),
  plannerProvider: document.querySelector("#plannerProvider"),
  gatewayProviderMode: document.querySelector("#gatewayProviderMode"),
  gatewayBaseUrl: document.querySelector("#gatewayBaseUrl"),
  gatewayModel: document.querySelector("#gatewayModel"),
  gatewayAuxiliaryModel: document.querySelector("#gatewayAuxiliaryModel"),
  gatewayCustomModel: document.querySelector("#gatewayCustomModel"),
  gatewayCustomAuxiliaryModel: document.querySelector("#gatewayCustomAuxiliaryModel"),
  gatewayThinkingIntensity: document.querySelector("#gatewayThinkingIntensity"),
  gatewayApiKey: document.querySelector("#gatewayApiKey"),
  rememberProviderKeys: document.querySelector("#rememberProviderKeys"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  includeIncognitoTabs: document.querySelector("#includeIncognitoTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  continuousPageSummaries: document.querySelector("#continuousPageSummaries"),
  analyzeGrouping: document.querySelector("#analyzeGrouping"),
  analyzeCleanup: document.querySelector("#analyzeCleanup"),
  minConfidenceToApply: document.querySelector("#minConfidenceToApply"),
  maxTabsPerGroup: document.querySelector("#maxTabsPerGroup"),
  ackSampling: document.querySelector("#ackSampling"),
  recapRangePreset: document.querySelector("#recapRangePreset"),
  recapFromDate: document.querySelector("#recapFromDate"),
  recapToDate: document.querySelector("#recapToDate")
};

const settingSwitches = [
  {
    field: "existingGroupMode",
    input: document.querySelector("#dissolveExistingGroupsToggle"),
    offValue: "preserve_existing_groups",
    onValue: "dissolve_existing_groups"
  },
  {
    field: "reviewGroupMode",
    input: document.querySelector("#createReviewGroupToggle"),
    offValue: "leave_review_ungrouped",
    onValue: "create_review_group"
  }
];

const AI_WAIT_PHASES = new Set(["planning", "coarse_planning", "refining", "retrying", "recapping"]);
const AI_WAIT_RAMP_MS = 45000;
const AI_WAIT_COPY_INTERVAL_SECONDS = 4;
const ACTIVE_JOB_POLL_MS = 600;
const ACTIVE_JOB_POLL_MAX_FAILURES = 20;
const LONG_TASK_KEEPALIVE_MS = 20_000;
const GENERATED_COPY_CACHE_LIMIT = 4;
const CANCELED_OPERATION_TTL_MS = 5 * 60 * 1000;

const nodes = {
  appShell: document.querySelector(".app-shell"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  hostPermissionField: document.querySelector("#hostPermissionField"),
  progressBar: document.querySelector("#progressBar"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  analysisModeSelect: document.querySelector("#analysisModeSelect"),
  analysisModeHint: document.querySelector("#analysisModeHint"),
  uiLanguageToggle: document.querySelector("#uiLanguageToggle"),
  privacyDisclosure: document.querySelector("#privacyDisclosure"),
  privacyDisclosureDismissBtn: document.querySelector("#privacyDisclosureDismissBtn"),
  actions: document.querySelector(".actions"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  applyBtn: document.querySelector("#applyBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  previewSection: document.querySelector("#previewSection"),
  previewCount: document.querySelector("#previewCount"),
  previewRoot: document.querySelector("#previewRoot"),
  detailsRoot: document.querySelector("#detailsRoot"),
  detailsText: document.querySelector("#detailsText"),
  gatewayTestBtn: document.querySelector("#gatewayTestBtn"),
  gatewayModelsBtn: document.querySelector("#gatewayModelsBtn"),
  gatewayModelOptions: document.querySelector("#gatewayModelOptions"),
  gatewayTestHint: document.querySelector("#gatewayTestHint"),
  gatewaySetupHint: document.querySelector("#gatewaySetupHint"),
  advancedSettings: document.querySelector(".advanced-settings"),
  clearLocalMemoryBtn: document.querySelector("#clearLocalMemoryBtn"),
  settingsExportBtn: document.querySelector("#settingsExportBtn"),
  settingsImportBtn: document.querySelector("#settingsImportBtn"),
  settingsImportFile: document.querySelector("#settingsImportFile"),
  settingsTransferStatus: document.querySelector("#settingsTransferStatus"),
  diagnosticsExportBtn: document.querySelector("#diagnosticsExportBtn"),
  timeRecapPanel: document.querySelector("#timeRecapPanel"),
  recapCustomRange: document.querySelector("#recapCustomRange"),
  recapResult: document.querySelector("#recapResult"),
  recapDetailsRoot: document.querySelector("#recapDetailsRoot"),
  recapDetailsText: document.querySelector("#recapDetailsText"),
  recapRangeHint: document.querySelector("#recapRangeHint"),
  recapDateDisplays: document.querySelectorAll("[data-date-display-for]"),
  recapQuickButtons: document.querySelectorAll("[data-recap-preset]")
};

const PANEL_MODE_ORGANIZE = "organize";
const PANEL_MODE_RECAP = "recap";

let uiLanguage = readStoredUiLanguage() || browserUiLanguage();
let currentPanelMode = PANEL_MODE_ORGANIZE;
let recapKeepAliveTimer = null;
let recapKeepAliveOperationId = null;
let statusByMode = {
  [PANEL_MODE_ORGANIZE]: createStatusState("status.default"),
  [PANEL_MODE_RECAP]: createStatusState("status.default")
};
let actionStateByMode = {
  [PANEL_MODE_ORGANIZE]: createIdleActionState(),
  [PANEL_MODE_RECAP]: createIdleActionState()
};
let lastPreview = null;
let lastError = null;
let previewResultView = "grouping";
let lastTimeRecap = null;
let lastTimeRecapError = null;
let lastCanApply = false;
let canUndo = false;
let activeAnalyzeRunId = null;
let activeAnalyzeOperationId = null;
const canceledAnalyzeRuns = new Set();
let activeRecapOperationId = null;
const canceledRecapOperations = new Set();
let pageSamplingOriginCache = { origins: [], refreshedAt: 0 };
let pageSamplingOriginRefreshTimer = null;
let progressPollTimer = null;
let progressPollInFlight = false;
let recapProgressTimer = null;
let recapProgressJob = null;
let mockActiveJob = null;
let mockLastJob = null;
let panelWindowId = null;
let privacyDisclosureDismissed = false;
let settingsBaseline = null;
let settingsPersistQueue = Promise.resolve();
const generatedCopyByOperation = new Map();
const generatedCopyRequests = new Set();

function createStatusState(key = "", params = {}, text = "", isError = false) {
  return { key, params, text, isError };
}

function createIdleActionState() {
  return { busy: false, label: "", progress: 0, cancelable: false, cancelDisabled: false };
}

function normalizePanelMode(mode) {
  return mode === PANEL_MODE_RECAP ? PANEL_MODE_RECAP : PANEL_MODE_ORGANIZE;
}

const persistGatewayEndpointSettings = debounce(async () => {
  if (!shouldPersistGatewayEndpointSettings()) return;
  await persistSettings();
}, 500);

function shouldPersistGatewayEndpointSettings() {
  const baseUrl = fields.gatewayBaseUrl.value.trim();
  const apiKey = fields.gatewayApiKey.value.trim();
  if (baseUrl && !isCompleteHttpUrl(baseUrl)) return false;
  if (apiKey && !fields.rememberProviderKeys.checked) return false;
  return true;
}

function isCompleteHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

init().catch((error) => setErrorStatus(error));

async function init() {
  applyUiLanguage();
  initializeRecapDates();
  applyPanelMode();
  panelWindowId = await resolveInvocationWindowId();
  bindEvents();
  bindSettingsStorageSync();
  bindSettingSwitches();
  bindChoiceGroups();
  syncInternalPlannerProviderOption();

  const settings = await sendMessage({ type: "settings:get" });
  writeSettings(settings);
  updateConditionalUi();
  schedulePageSamplingOriginRefresh();
  await hydrateActiveJob();
  await hydrateUndoState();
  guideMissingGatewaySetup({ focus: true });
  syncActionState();
}

function bindEvents() {
  for (const element of Object.values(fields)) {
    if (element === fields.ackSampling || element === fields.continuousPageSummaries) continue;
    if (element === fields.recapRangePreset || element === fields.recapFromDate || element === fields.recapToDate) continue;
    element.addEventListener("change", persistSettings);
  }
  fields.ackSampling.addEventListener("change", async () => {
    if (fields.ackSampling.checked) {
      try {
        await enablePageSummaryEnhancement();
      } catch (error) {
        fields.ackSampling.checked = false;
        fields.continuousPageSummaries.checked = false;
        fields.hostPermissionRequestMode.value = "never";
        updateConditionalUi();
        await persistSettings();
        setErrorStatus(error);
      }
      return;
    }
    fields.continuousPageSummaries.checked = false;
    await persistSettings();
  });
  fields.customPrompt.addEventListener("input", debounce(persistSettings, 250));
  fields.gatewayCustomModel.addEventListener("input", updateConditionalUi);
  fields.gatewayCustomModel.addEventListener("input", debounce(persistSettings, 250));
  fields.gatewayCustomAuxiliaryModel.addEventListener("input", debounce(persistSettings, 250));
  fields.gatewayBaseUrl.addEventListener("input", updateConditionalUi);
  fields.gatewayApiKey.addEventListener("input", updateConditionalUi);
  fields.gatewayBaseUrl.addEventListener("input", persistGatewayEndpointSettings);
  fields.gatewayApiKey.addEventListener("input", persistGatewayEndpointSettings);
  fields.pageContextMode.addEventListener("change", updateConditionalUi);
  fields.organizeMode.addEventListener("change", updateConditionalUi);
  fields.plannerProvider.addEventListener("change", updateConditionalUi);
  nodes.analysisModeSelect?.addEventListener("change", () => {
    setAnalysisMode(nodes.analysisModeSelect.value || "both", { persist: true });
  });

  nodes.analyzeBtn.addEventListener("click", handlePrimaryAction);
  nodes.cancelBtn.addEventListener("click", handleCancelAction);
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
  nodes.gatewayTestBtn?.addEventListener("click", handleGatewayTestClick);
  nodes.gatewayModelsBtn?.addEventListener("click", handleGatewayModelsClick);
  nodes.clearLocalMemoryBtn?.addEventListener("click", handleClearLocalMemoryClick);
  nodes.settingsExportBtn?.addEventListener("click", handleSettingsExportClick);
  nodes.settingsImportBtn?.addEventListener("click", () => nodes.settingsImportFile?.click());
  nodes.settingsImportFile?.addEventListener("change", handleSettingsImportChange);
  nodes.diagnosticsExportBtn?.addEventListener("click", handleDiagnosticsExportClick);
  nodes.privacyDisclosureDismissBtn?.addEventListener("click", handlePrivacyDisclosureDismissClick);
  nodes.uiLanguageToggle?.addEventListener("click", toggleUiLanguage);
  for (const button of nodes.recapQuickButtons || []) {
    button.addEventListener("click", () => setRecapPreset(button.dataset.recapPreset || "7d"));
  }
  fields.recapFromDate?.addEventListener("change", markRecapRangeCustom);
  fields.recapToDate?.addEventListener("change", markRecapRangeCustom);
  for (const button of nodes.modeTabs || []) {
    button.addEventListener("click", () => setPanelMode(button.dataset.panelMode || "organize"));
  }
}

function t(key, params = {}) {
  const template = UI_COPY[uiLanguage]?.[key] ?? UI_COPY["zh-CN"][key] ?? key;
  if (Array.isArray(template)) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

function readStoredUiLanguage() {
  try {
    const stored = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return UI_LANGUAGES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function browserUiLanguage() {
  let extensionUiLanguage = "";
  try {
    extensionUiLanguage = globalThis.chrome?.i18n?.getUILanguage?.() || "";
  } catch {}
  const languages = [extensionUiLanguage, navigator.language, ...(navigator.languages || [])].filter(Boolean);
  return languages.some((language) => String(language).toLowerCase().startsWith("zh")) ? "zh-CN" : "en-US";
}

function toggleUiLanguage() {
  uiLanguage = uiLanguage === "zh-CN" ? "en-US" : "zh-CN";
  try {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
  } catch {}
  applyUiLanguage();
}

function applyUiLanguage() {
  document.documentElement.lang = uiLanguage;
  document.title = t("document.title");
  setText(".control-group .control-label span", t("scope.label"));
  setText('.choice-card[data-value="current_window"] .button-label', t("scope.currentWindow"));
  setText('.choice-card[data-value="consolidate_one_window"] .button-label', t("scope.allWindows"));
  setText('.mode-tab[data-panel-mode="organize"] .mode-tab-title', t("mode.organize"));
  setText('.mode-tab[data-panel-mode="recap"] .mode-tab-title', t("mode.recap"));
  setText('.mode-tab[data-panel-mode="organize"] .mode-tab-subtitle', t("mode.organizeSubtitle"));
  setText('.mode-tab[data-panel-mode="recap"] .mode-tab-subtitle', t("mode.recapSubtitle"));
  setAttribute('.mode-tab[data-panel-mode="organize"]', "aria-label", t("mode.organize"));
  setAttribute('.mode-tab[data-panel-mode="recap"]', "aria-label", t("mode.recap"));
  setAttribute("#privacyDisclosure", "aria-label", t("privacy.aria"));
  setText("#privacyDisclosure strong", t("privacy.title"));
  setText("#privacyDisclosure p", t("privacy.body"));
  setButtonLabel(nodes.privacyDisclosureDismissBtn, t("privacy.dismiss"));
  setAttribute("#organizeMode", "aria-label", t("scope.nativeLabel"));
  setOptionText("#organizeMode", "current_window", t("scope.optionCurrent"));
  setOptionText("#organizeMode", "consolidate_one_window", t("scope.optionAll"));
  setText('label[for="analysisModeSelect"]', t("analysis.mode.label"));
  setAttribute("#analysisModeSelect", "aria-label", t("analysis.mode.aria"));
  setOptionText("#analysisModeSelect", "both", t("analysis.mode.both"));
  setOptionText("#analysisModeSelect", "grouping", t("analysis.mode.grouping"));
  setOptionText("#analysisModeSelect", "cleanup", t("analysis.mode.cleanup"));
  syncAnalysisModeControl();

  setSwitchText("#ackSampling", "sampling.title", "sampling.subtitle");
  setTooltip("#ackSampling", "sampling.tooltip");
  setAttribute("#samplingRisk", "aria-label", t("sampling.aria"));
  setText('label[for="customPrompt"]', t("customPrompt.label"));
  setAttribute("#customPrompt", "placeholder", t("customPrompt.placeholder"));
  setText(".advanced-settings > summary", t("advanced.summary"));

  setSwitchText("#dissolveExistingGroupsToggle", "switch.dissolve.title", "switch.dissolve.subtitle");
  setSwitchText("#createReviewGroupToggle", "switch.review.title", "switch.review.subtitle");
  setSwitchText("#includePinnedTabs", "switch.pinned.title", "switch.pinned.subtitle");
  setSwitchText("#includeIncognitoTabs", "switch.incognito.title", "switch.incognito.subtitle");
  setSwitchText("#collapseGroupsAfterApply", "switch.collapse.title", "switch.collapse.subtitle");

  setText('label[for="urlPrivacyMode"]', t("field.urlPrivacy"));
  setText('label[for="pageContextMode"]', t("field.pageContext"));
  setText('label[for="hostPermissionRequestMode"]', t("field.hostPermission"));
  setText('label[for="languageMode"]', t("field.resultLanguage"));
  setText('label[for="promptPreset"]', t("field.promptPreset"));
  setText('label[for="groupingGranularity"]', t("field.groupingGranularity"));
  setText('label[for="gatewayThinkingIntensity"]', t("field.thinking"));
  setText('label[for="gatewayCustomModel"]', t("field.customModel"));
  setText('label[for="gatewayCustomAuxiliaryModel"]', t("field.customAuxiliaryModel"));
  setText('label[for="gatewayBaseUrl"]', t("field.gatewayUrl"));
  setText('label[for="gatewayApiKey"]', t("field.gatewayKey"));
  setButtonLabel(nodes.gatewayTestBtn, t("button.gatewayTest"));
  setButtonLabel(nodes.gatewayModelsBtn, t("button.gatewayModels"));
  setText("#gatewaySetupHint", t("gateway.setupHint"));
  setText("#gatewayTestHint", t("gateway.testHint"));
  setText(".secret-remember-row strong", t("field.rememberKey"));
  setText(".secret-remember-row small", t("field.rememberKeyHint"));
  setText(".local-memory-row strong", t("field.localMemory"));
  setText(".local-memory-row small", t("field.localMemoryHint"));
  setButtonLabel(nodes.clearLocalMemoryBtn, t("button.clearLocalMemory"));
  setText(".settings-transfer-row strong", t("field.settingsTransfer"));
  setText(".settings-transfer-row > span small", t("field.settingsTransferHint"));
  setButtonLabel(nodes.settingsExportBtn, t("button.settingsExport"));
  setButtonLabel(nodes.settingsImportBtn, t("button.settingsImport"));
  setText(".diagnostics-row strong", t("field.diagnostics"));
  setText(".diagnostics-row > span small", t("field.diagnosticsHint"));
  setButtonLabel(nodes.diagnosticsExportBtn, t("button.diagnosticsExport"));
  setText('label[for="minConfidenceToApply"]', t("field.minConfidence"));
  setText('label[for="maxTabsPerGroup"]', t("field.maxTabs"));
  setText(".recap-intro .step-label", t("recap.step"));
  setText(".recap-intro h2", t("recap.heading"));
  setText(".recap-intro p:not(.step-label)", t("recap.subtitle"));
  setText('label[for="recapFromDate"]', t("recap.from"));
  setText('label[for="recapToDate"]', t("recap.to"));
  setAttribute(".recap-range-shortcuts", "aria-label", t("recap.shortcuts"));
  setText('[data-recap-preset="1d"]', t("recap.1d"));
  setText('[data-recap-preset="today"]', t("recap.today"));
  setText('[data-recap-preset="7d"]', t("recap.7d"));
  setText('[data-recap-preset="30d"]', t("recap.30d"));
  setText('[data-recap-preset="thisWeek"]', t("recap.thisWeek"));
  setText('[data-recap-preset="thisMonth"]', t("recap.thisMonth"));
  updateRecapRangeHint();
  setText("#recapDetailsRoot > summary", t("recap.evidence"));
  setAttribute("#gatewayCustomModel", "placeholder", t("placeholder.customModel"));
  setAttribute("#gatewayCustomAuxiliaryModel", "placeholder", t("placeholder.customAuxiliaryModel"));
  setAttribute("#gatewayBaseUrl", "placeholder", t("placeholder.gatewayUrl"));
  setAttribute("#gatewayApiKey", "placeholder", t("placeholder.gatewayKey"));

  setOptionText("#targetWindowMode", "current_window", t("option.currentWindow"));
  setOptionText("#existingGroupMode", "preserve_existing_groups", t("option.preserveGroups"));
  setOptionText("#existingGroupMode", "dissolve_existing_groups", t("option.dissolveGroups"));
  setOptionText("#reviewGroupMode", "create_review_group", t("option.reviewCreate"));
  setOptionText("#reviewGroupMode", "leave_review_ungrouped", t("option.reviewUngrouped"));
  setOptionText("#undoTargetWindowMode", "leave_empty_target_window", t("option.leaveEmpty"));
  setOptionText("#urlPrivacyMode", "title_only", t("option.urlTitleOnly"));
  setOptionText("#urlPrivacyMode", "sanitized_url", t("option.urlSanitized"));
  setOptionText("#urlPrivacyMode", "full_url", t("option.urlFull"));
  setOptionText("#pageContextMode", "off", t("option.pageOff"));
  setOptionText("#pageContextMode", "ambiguous_with_permission", t("option.pageAmbiguous"));
  setOptionText("#pageContextMode", "all_granted_origins", t("option.pageGranted"));
  setOptionText("#hostPermissionRequestMode", "never", t("option.permissionNever"));
  setOptionText("#hostPermissionRequestMode", "ask_per_origin", t("option.permissionOrigin"));
  setOptionText("#hostPermissionRequestMode", "ask_for_all_visible_origins", t("option.permissionVisible"));
  setOptionText("#languageMode", "auto", t("option.langAuto"));
  setOptionText("#languageMode", "zh-CN", t("option.langZh"));
  setOptionText("#languageMode", "en-US", t("option.langEn"));
  setOptionText("#promptPreset", "conservative", t("option.presetConservative"));
  setOptionText("#promptPreset", "media_type", t("option.presetMedia"));
  setOptionText("#promptPreset", "read_later", t("option.presetReadLater"));
  setOptionText("#promptPreset", "aggressive_cleanup", t("option.presetAggressive"));
  setOptionText("#groupingGranularity", "compact", t("option.granularityCompact"));
  setOptionText("#groupingGranularity", "balanced", t("option.granularityBalanced"));
  setOptionText("#groupingGranularity", "detailed", t("option.granularityDetailed"));
  setOptionText("#gatewayThinkingIntensity", "low", t("option.thinkingLow"));
  setOptionText("#gatewayThinkingIntensity", "medium", t("option.thinkingMedium"));
  setOptionText("#gatewayThinkingIntensity", "high", t("option.thinkingHigh"));
  setOptionText("#gatewayThinkingIntensity", "ultra", t("option.thinkingUltra"));

  setText(".preview .step-label", t("preview.step"));
  setText(".preview .section-heading h2", t("preview.heading"));
  setText("#detailsRoot > summary", t("details.summary"));
  setButtonLabel(nodes.cancelBtn, t("button.cancel"));
  setButtonLabel(nodes.applyBtn, t("button.apply"));
  setButtonLabel(nodes.undoBtn, t("button.undo"));
  if (nodes.uiLanguageToggle) {
    nodes.uiLanguageToggle.setAttribute("aria-label", t("button.languageAria"));
    nodes.uiLanguageToggle.setAttribute("title", t("button.languageAria"));
  }
  if (lastPreview) {
    renderPreview({ preview: lastPreview, validation: { ok: lastCanApply }, settings: { languageMode: currentResultLanguageMode() } });
  } else if (lastError) {
    renderError(lastError);
  } else {
    nodes.previewCount.textContent = t("preview.pending");
    nodes.previewRoot.textContent = t("preview.empty");
  }
  if (lastTimeRecap) renderTimeRecap(lastTimeRecap);
  else if (lastTimeRecapError) renderTimeRecapError(lastTimeRecapError);
  else if (nodes.recapResult) nodes.recapResult.textContent = t("recap.empty");
  syncActionState();
  applyPanelMode();
  renderStatus();
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setAttribute(selector, name, value) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute(name, value);
}

function setOptionText(selectSelector, value, text) {
  const option = document.querySelector(`${selectSelector} option[value="${value}"]`);
  if (option) option.textContent = text;
}

function setSwitchText(inputSelector, titleKey, subtitleKey) {
  const label = document.querySelector(inputSelector)?.closest("label");
  if (!label) return;
  const strong = label.querySelector("strong");
  const helpTip = strong?.querySelector(".help-tip") || null;
  if (strong) {
    strong.replaceChildren(document.createTextNode(t(titleKey)));
    if (helpTip) strong.append(" ", helpTip);
  }
  const small = label.querySelector("small");
  if (small) small.textContent = t(subtitleKey);
}

function setTooltip(inputSelector, tooltipKey) {
  const label = document.querySelector(inputSelector)?.closest("label");
  const tooltip = t(tooltipKey);
  if (label) label.dataset.tooltip = tooltip;
  const helpTip = label?.querySelector(".help-tip");
  if (helpTip) helpTip.dataset.tooltip = tooltip;
}

function currentResultLanguageMode() {
  return fields.languageMode.value === "auto" ? uiLanguage : fields.languageMode.value;
}

function effectiveResultLanguageMode(languageMode) {
  return languageMode === "auto" ? uiLanguage : languageMode;
}

function setPanelMode(mode) {
  currentPanelMode = normalizePanelMode(mode);
  applyPanelMode();
  syncActionState();
  renderStatus();
}

function applyPanelMode() {
  if (!nodes.appShell) return;
  nodes.appShell.dataset.panelMode = currentPanelMode;
  for (const button of nodes.modeTabs || []) {
    button.setAttribute("aria-pressed", button.dataset.panelMode === currentPanelMode ? "true" : "false");
  }
  nodes.timeRecapPanel.hidden = currentPanelMode !== "recap";
}

function initializeRecapDates() {
  if (!fields.recapFromDate || !fields.recapToDate) return;
  setRecapPreset(fields.recapRangePreset?.value || "7d", { silent: true });
}

function syncRecapRangeUi() {
  const preset = fields.recapRangePreset?.value || "custom";
  for (const button of nodes.recapQuickButtons || []) {
    button.setAttribute("aria-pressed", button.dataset.recapPreset === preset ? "true" : "false");
  }
  updateRecapRangeHint();
}

function setRecapPreset(preset, options = {}) {
  const normalized = normalizeRecapPreset(preset);
  if (fields.recapRangePreset) fields.recapRangePreset.value = normalized;
  if (normalized !== "custom") {
    const range = dateRangeForRecapPreset(normalized);
    fields.recapFromDate.value = dateInputValue(range.from);
    fields.recapToDate.value = dateInputValue(range.to);
  }
  syncRecapDateDisplays();
  syncRecapRangeUi();
  if (!options.silent) fields.recapRangePreset?.dispatchEvent(new Event("change", { bubbles: true }));
}

function markRecapRangeCustom() {
  if (fields.recapRangePreset) fields.recapRangePreset.value = "custom";
  syncRecapDateDisplays();
  syncRecapRangeUi();
}

function normalizeRecapPreset(value) {
  return ["1d", "7d", "30d", "today", "thisWeek", "thisMonth", "custom"].includes(value) ? value : "7d";
}

function dateRangeForRecapPreset(preset) {
  const now = new Date();
  const from = new Date(now);
  const to = new Date(now);
  if (preset === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (preset === "thisWeek") {
    const day = from.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    from.setDate(from.getDate() - diffToMonday);
    from.setHours(0, 0, 0, 0);
  } else if (preset === "thisMonth") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else {
    const days = preset === "1d" ? 1 : preset === "30d" ? 30 : 7;
    from.setTime(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
  return { from, to };
}

function updateRecapRangeHint() {
  if (!nodes.recapRangeHint) return;
  const preset = fields.recapRangePreset?.value || "custom";
  const text =
    preset === "1d"
      ? t("recap.rangeHint24h")
      : ["today", "thisWeek", "thisMonth"].includes(preset)
      ? t("recap.rangeHintCalendar")
      : "";
  nodes.recapRangeHint.hidden = !text;
  nodes.recapRangeHint.textContent = text;
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function syncRecapDateDisplays() {
  for (const display of nodes.recapDateDisplays || []) {
    const input = document.getElementById(display.dataset.dateDisplayFor || "");
    const valueNode = display.querySelector(".date-input-value") || display;
    valueNode.textContent = dateInputDisplayValue(input?.value || "");
  }
}

function dateInputDisplayValue(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "----";
  const [, year, month, day, hour, minute] = match;
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

function createClientOperationId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function bindChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;

    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        field.value = button.dataset.value;
        syncChoiceGroups();
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

function bindSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    if (!settingSwitch.input || !fields[settingSwitch.field]) continue;
    settingSwitch.input.addEventListener("change", () => {
      const field = fields[settingSwitch.field];
      field.value = settingSwitch.input.checked ? settingSwitch.onValue : settingSwitch.offValue;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

function readSettings(options = {}) {
  const effectiveForAnalysis = Boolean(options.effectiveForAnalysis);
  const contentAccessAvailable = hasContentAccessFeature();
  const selectedPageContextMode = normalizePanelPageContextMode(fields.pageContextMode.value);
  const pageSummaryEnabled = contentAccessAvailable && fields.ackSampling.checked;
  const gatewayBaseUrl = fields.gatewayBaseUrl.value;
  const gatewayCustomModel = fields.gatewayCustomModel.value;
  const gatewayCustomAuxiliaryModel = fields.gatewayCustomAuxiliaryModel.value;
  const effectivePageContextMode = effectiveForAnalysis
    ? effectivePageContextModeForRun(selectedPageContextMode, pageSummaryEnabled)
    : selectedPageContextMode;
  const continuousPageSummaries = pageSummaryEnabled;
  const effectiveHostPermissionRequestMode =
    effectiveForAnalysis &&
    pageSummaryEnabled &&
    fields.hostPermissionRequestMode.value === "never"
      ? "ask_for_all_visible_origins"
      : fields.hostPermissionRequestMode.value;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    targetWindowMode: "current_window",
    reviewGroupMode: fields.reviewGroupMode.value,
    undoTargetWindowMode: "leave_empty_target_window",
    urlPrivacyMode: fields.urlPrivacyMode.value,
    pageContextMode: effectivePageContextMode,
    hostPermissionRequestMode: effectiveHostPermissionRequestMode,
    pageSamplingConsentMode: continuousPageSummaries ? "acknowledged_persistently" : "not_acknowledged",
    languageMode: fields.languageMode.value,
    promptPreset: fields.promptPreset.value,
    groupingGranularity: fields.groupingGranularity.value,
    plannerProvider: fields.plannerProvider.value || "gateway",
    gatewayProviderMode: GATEWAY_PROVIDER_MODES.CUSTOM,
    rememberProviderKeys: Boolean(fields.rememberProviderKeys.checked && gatewayBaseUrl.trim() && fields.gatewayApiKey.value.trim()),
    gatewayBaseUrl,
    gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
    gatewayAuxiliaryModel: "same_as_primary",
    gatewayCustomModel,
    gatewayCustomAuxiliaryModel,
    gatewayThinkingIntensity: fields.gatewayThinkingIntensity.value,
    gatewayApiKey: fields.gatewayApiKey.value,
    customPrompt: fields.customPrompt.value,
    includePinnedTabs: fields.includePinnedTabs.checked,
    includeIncognitoTabs: fields.includeIncognitoTabs.checked,
    collapseGroupsAfterApply: fields.collapseGroupsAfterApply.checked,
    continuousPageSummaries,
    analyzeGrouping: fields.analyzeGrouping.checked,
    analyzeCleanup: fields.analyzeCleanup.checked,
    minConfidenceToApply: fields.minConfidenceToApply.value,
    maxTabsPerGroup: fields.maxTabsPerGroup.value,
    privacyDisclosureDismissed
  };
}

function effectivePageContextModeForRun(selectedPageContextMode, pageSummaryEnabled) {
  if (!pageSummaryEnabled) return "off";
  return selectedPageContextMode === "off" ? "ambiguous_with_permission" : selectedPageContextMode;
}

async function enablePageSummaryEnhancement() {
  fields.ackSampling.checked = true;
  fields.continuousPageSummaries.checked = true;
  if (fields.pageContextMode.value === "off" || fields.pageContextMode.value === "active_tab_only") {
    fields.pageContextMode.value = "ambiguous_with_permission";
  }
  if (fields.hostPermissionRequestMode.value === "never") {
    fields.hostPermissionRequestMode.value = "ask_for_all_visible_origins";
  }
  updateConditionalUi();
  setStatusKey("status.requestingPageSummaryPermission");
  await ensureContinuousSummaryPermissions();
  await persistSettings();
  setStatusKey("status.pageSummaryEnabled");
}

function writeSettings(settings, options = {}) {
  const normalizedSettings = normalizeSettings(settings || DEFAULT_SETTINGS);
  if (options.updateBaseline !== false) settingsBaseline = { ...normalizedSettings };
  privacyDisclosureDismissed = Boolean(normalizedSettings.privacyDisclosureDismissed);
  const displaySettings = {
    ...normalizedSettings,
    targetWindowMode: "current_window",
    undoTargetWindowMode: "leave_empty_target_window",
    pageContextMode: normalizePanelPageContextMode(normalizedSettings.pageContextMode)
  };
  for (const [key, element] of Object.entries(fields)) {
    if (key === "ackSampling") {
      element.checked =
        hasContentAccessFeature() &&
        displaySettings.pageContextMode !== "off" &&
        displaySettings.pageSamplingConsentMode !== "not_acknowledged";
    } else if (key === "plannerProvider") {
      element.value = allowInternalFakeProvider() && displaySettings[key] === "fake" ? "fake" : "gateway";
    } else if (element.type === "checkbox") {
      element.checked = Boolean(displaySettings[key]);
    } else if (displaySettings[key] !== undefined) {
      element.value = displaySettings[key];
    }
  }
  fields.continuousPageSummaries.checked = fields.ackSampling.checked;
  syncSettingSwitches();
  syncAnalysisModeControl();
  syncChoiceGroups();
  updatePrivacyDisclosure();
}

function syncSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    const field = fields[settingSwitch.field];
    if (!settingSwitch.input || !field) continue;
    settingSwitch.input.checked = field.value === settingSwitch.onValue;
  }
}

function analysisModeFromFields() {
  if (fields.analyzeGrouping.checked && fields.analyzeCleanup.checked) return "both";
  if (fields.analyzeCleanup.checked) return "cleanup";
  if (fields.analyzeGrouping.checked) return "grouping";
  return "both";
}

function setAnalysisMode(mode, options = {}) {
  const normalized = ["both", "grouping", "cleanup"].includes(mode) ? mode : "both";
  fields.analyzeGrouping.checked = normalized !== "cleanup";
  fields.analyzeCleanup.checked = normalized !== "grouping";
  syncAnalysisModeControl();
  if (options.persist) persistSettings().catch((error) => setErrorStatus(error));
}

function syncAnalysisModeControl() {
  const mode = analysisModeFromFields();
  if (nodes.analysisModeSelect) {
    nodes.analysisModeSelect.value = mode;
  }
  if (nodes.analysisModeHint) {
    nodes.analysisModeHint.textContent = t(`analysis.mode.hint.${mode}`);
  }
}

function normalizePanelPageContextMode(value) {
  return value === "active_tab_only" ? "all_granted_origins" : value;
}

function allowInternalFakeProvider() {
  return Boolean(globalThis.__semanticTabAgentAllowFakeProvider);
}

function syncInternalPlannerProviderOption() {
  if (!fields.plannerProvider) return;

  const fakeOption = fields.plannerProvider.querySelector('option[value="fake"]');
  if (!allowInternalFakeProvider()) {
    fakeOption?.remove();
    if (fields.plannerProvider.value === "fake") fields.plannerProvider.value = "gateway";
    return;
  }

  if (!fakeOption) {
    const option = document.createElement("option");
    option.value = "fake";
    option.textContent = "Fake";
    fields.plannerProvider.append(option);
  }
}

function persistSettings() {
  const snapshot = normalizeSettings(readSettings());
  const baseline = settingsBaseline || normalizeSettings(DEFAULT_SETTINGS);
  const changedKeys = settingsChangedKeys(snapshot, baseline);
  if (!changedKeys.length) return Promise.resolve(snapshot);

  const operation = settingsPersistQueue.then(async () => {
    const settings = await sendMessage({ type: "settings:save", settings: snapshot, changedKeys });
    const saved = normalizeSettings(settings || snapshot);
    const current = normalizeSettings(readSettings());
    const editsSinceRequest = settingsPatch(current, snapshot);
    settingsBaseline = { ...saved };
    writeSettings({ ...saved, ...editsSinceRequest }, { updateBaseline: false });
    updateConditionalUi();
    setStatusKey("status.saved");
    if (Object.keys(editsSinceRequest).length) {
      void persistSettings().catch((error) => setErrorStatus(error));
    }
    return saved;
  });
  settingsPersistQueue = operation.catch(() => undefined);
  return operation;
}

function settingsChangedKeys(left = {}, right = {}) {
  return Object.keys(DEFAULT_SETTINGS).filter((key) => !Object.is(left[key], right[key]));
}

function settingsPatch(left = {}, right = {}) {
  return Object.fromEntries(settingsChangedKeys(left, right).map((key) => [key, left[key]]));
}

function bindSettingsStorageSync() {
  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    const change = changes?.[STORAGE_KEYS.settings];
    if (areaName !== "local" || !change?.newValue) return;
    const external = normalizeSettings(change.newValue);
    const current = normalizeSettings(readSettings());
    const localEdits = settingsBaseline ? settingsPatch(current, settingsBaseline) : {};
    if (current.gatewayApiKey && !current.rememberProviderKeys) {
      localEdits.gatewayApiKey = current.gatewayApiKey;
    }
    settingsBaseline = { ...external };
    writeSettings({ ...external, ...localEdits }, { updateBaseline: false });
    updateConditionalUi();
  });
}

function updateConditionalUi() {
  const contentAccessAvailable = hasContentAccessFeature();
  nodes.appShell.dataset.contentAccess = contentAccessAvailable ? "on" : "off";
  nodes.samplingRisk.hidden = !contentAccessAvailable;
  nodes.hostPermissionField.hidden = true;
  const canRememberCustomKey = Boolean(fields.gatewayBaseUrl.value.trim() && fields.gatewayApiKey.value.trim());
  fields.rememberProviderKeys.disabled = !canRememberCustomKey;
  if (!canRememberCustomKey) fields.rememberProviderKeys.checked = false;
  updateGatewaySetupGuidance();
  syncChoiceGroups();
  schedulePageSamplingOriginRefresh();
  syncActionState();
}

function missingGatewaySetupField() {
  if (fields.plannerProvider.value !== "gateway") return null;
  if (!fields.gatewayBaseUrl.value.trim()) return fields.gatewayBaseUrl;
  if (!fields.gatewayCustomModel.value.trim()) return fields.gatewayCustomModel;
  return null;
}

function updateGatewaySetupGuidance() {
  const missingField = missingGatewaySetupField();
  if (nodes.gatewaySetupHint) nodes.gatewaySetupHint.hidden = !missingField;
  fields.gatewayBaseUrl.setAttribute("aria-invalid", missingField === fields.gatewayBaseUrl ? "true" : "false");
  fields.gatewayCustomModel.setAttribute("aria-invalid", missingField === fields.gatewayCustomModel ? "true" : "false");
  return missingField;
}

function guideMissingGatewaySetup(options = {}) {
  if (lastPreview || lastError || lastTimeRecap || lastTimeRecapError) return false;
  const missingField = updateGatewaySetupGuidance();
  if (!missingField) return false;
  if (nodes.advancedSettings) nodes.advancedSettings.open = true;
  setStatusKey(missingField === fields.gatewayBaseUrl ? "status.gatewayTestUrlMissing" : "status.customModelMissing", {}, true);
  if (options.focus) {
    requestAnimationFrame(() => {
      missingField.focus({ preventScroll: true });
      missingField.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
  return true;
}

function updatePrivacyDisclosure() {
  if (nodes.privacyDisclosure) {
    nodes.privacyDisclosure.hidden = privacyDisclosureDismissed;
  }
}

async function handlePrivacyDisclosureDismissClick() {
  privacyDisclosureDismissed = true;
  updatePrivacyDisclosure();
  try {
    await persistSettings();
  } catch (error) {
    privacyDisclosureDismissed = false;
    updatePrivacyDisclosure();
    setErrorStatus(error, friendlyErrorMessage(error));
  }
}

async function handlePrimaryAction() {
  if (currentPanelMode === "recap") {
    if (lastTimeRecap || lastTimeRecapError) {
      resetTimeRecapToSetup();
      return;
    }
    await generateTimeRecap();
    return;
  }
  await handleAnalyzeClick();
}

async function handleCancelAction() {
  if (currentPanelMode === "recap") {
    await cancelTimeRecap();
    return;
  }
  await cancelAnalyze();
}

async function handleAnalyzeClick() {
  if (lastPreview || lastError) {
    await clearAnalysisState();
    resetToSetup();
    if (!guideMissingGatewaySetup({ focus: true })) setStatusKey("status.default");
    return;
  }
  analyze();
}

async function analyze() {
  const runId = createClientOperationId("organize");
  activeAnalyzeRunId = runId;
  resetToSetup();
  setBusy(true, t("status.preparing"), { mode: PANEL_MODE_ORGANIZE, cancelable: true, progress: 4 });
  try {
    const persistedSettings = readSettings();
    const settings = readEffectiveRunSettings();
    await ensureGatewayPermissionForRun(settings, 8, PANEL_MODE_ORGANIZE);
    if (shouldIgnoreAnalyzeRun(runId)) return;
    await ensurePageSummaryPermissionsForRun(settings, 12, PANEL_MODE_ORGANIZE);
    if (shouldIgnoreAnalyzeRun(runId)) return;
    updateLocalProgress(t("status.resolvingWindow"), 14, PANEL_MODE_ORGANIZE);
    const windowId = await resolveInvocationWindowId();
    if (shouldIgnoreAnalyzeRun(runId)) return;
    updateLocalProgress(t("status.startingBackground"), 16, PANEL_MODE_ORGANIZE);
    const started = await sendMessage({ type: "tabs:startAnalyze", settings, persistedSettings, windowId });
    if (shouldIgnoreAnalyzeRun(runId)) {
      if (started?.operationId) {
        sendMessage({ type: "tabs:cancelActiveJob", windowId, operationId: started.operationId }).catch(() => {});
      }
      return;
    }
    activeAnalyzeOperationId = started?.operationId || null;
    const job = await waitForAnalysisCompletion(started?.operationId);
    if (shouldIgnoreAnalyzeRun(runId)) return;
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    renderPreview(job);
    renderDetails(job);
    nodes.applyBtn.disabled = !lastCanApply;
    syncActionState();
    setStatusKey(job.validation?.ok ? "status.planReady" : "status.planNeedsReview", {}, !job.validation?.ok, { mode: PANEL_MODE_ORGANIZE });
  } catch (error) {
    if (shouldIgnoreAnalyzeRun(runId)) return;
    if (canceledAnalyzeRuns.has(runId) || isCancellationError(error)) {
      setStatusKey("status.canceled", {}, false, { mode: PANEL_MODE_ORGANIZE });
    } else {
      const message = friendlyErrorMessage(error);
      setErrorStatus(error, message, { mode: PANEL_MODE_ORGANIZE });
      renderError(error);
    }
  } finally {
    if (activeAnalyzeRunId === runId) {
      stopProgressPolling();
      setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
      activeAnalyzeRunId = null;
      activeAnalyzeOperationId = null;
    }
    canceledAnalyzeRuns.delete(runId);
  }
}

function shouldIgnoreAnalyzeRun(runId) {
  return activeAnalyzeRunId !== runId || canceledAnalyzeRuns.has(runId);
}

async function generateTimeRecap() {
  if (activeRecapOperationId) {
    await cancelTimeRecap();
    return;
  }
  const operationId = createClientOperationId("recap");
  activeRecapOperationId = operationId;
  setBusy(true, t("status.recapPreparing"), { mode: PANEL_MODE_RECAP, cancelable: true, progress: 6 });
  try {
    const settings = readEffectiveRunSettings();
    await ensureGatewayPermissionForRun(settings, 10, PANEL_MODE_RECAP);
    if (shouldIgnoreRecapOperation(operationId)) return;
    await ensurePageSummaryPermissionsForRun(settings, 16, PANEL_MODE_RECAP);
    if (shouldIgnoreRecapOperation(operationId)) return;

    updateLocalProgress(t("status.recapGenerating"), 28, PANEL_MODE_RECAP);
    startRecapProgress(operationId, settings);
    startRecapKeepAlive(operationId);
    const result = await sendMessage(scopedWindowMessage({
      type: "activity:generateTimeRecap",
      operationId,
      settings,
      languageMode: settings.languageMode,
      range: readRecapRange(),
      timeoutMs: TIME_RECAP_GATEWAY_TIMEOUT_MS
    }));
    if (shouldIgnoreRecapOperation(operationId)) return;
    lastTimeRecap = result;
    lastTimeRecapError = null;
    renderTimeRecap(result);
    if (isTimeRecapFallbackResult(result)) {
      setStatus(timeRecapFallbackStatusText(result), false, { mode: PANEL_MODE_RECAP });
    } else {
      setStatusKey("status.recapReady", {}, false, { mode: PANEL_MODE_RECAP });
    }
  } catch (error) {
    if (activeRecapOperationId !== operationId) return;
    if (canceledRecapOperations.has(operationId) || /stopped|canceled|cancelled|已停止|已取消/i.test(error?.message || "")) {
      setStatusKey("status.recapCanceled", {}, false, { mode: PANEL_MODE_RECAP });
      return;
    }
    const message = friendlyErrorMessage(error);
    setErrorStatus(error, message, { mode: PANEL_MODE_RECAP });
    renderTimeRecapError(error);
  } finally {
    stopRecapKeepAlive(operationId);
    stopRecapProgress(operationId);
    canceledRecapOperations.delete(operationId);
    if (activeRecapOperationId === operationId) {
      activeRecapOperationId = null;
      setBusy(false, "", { mode: PANEL_MODE_RECAP });
    }
  }
}

function shouldIgnoreRecapOperation(operationId) {
  return activeRecapOperationId !== operationId || canceledRecapOperations.has(operationId);
}

async function cancelTimeRecap() {
  const operationId = activeRecapOperationId;
  if (!operationId) return;
  canceledRecapOperations.add(operationId);
  setTimeout(() => canceledRecapOperations.delete(operationId), CANCELED_OPERATION_TTL_MS);
  stopRecapKeepAlive(operationId);
  stopRecapProgress(operationId);
  setBusy(true, t("status.recapCanceling"), { mode: PANEL_MODE_RECAP, cancelable: true, progress: currentProgressValue(PANEL_MODE_RECAP) || 92 });
  setCancelDisabled(PANEL_MODE_RECAP, true);
  setStatusKey("status.recapCanceling", {}, false, { mode: PANEL_MODE_RECAP });
  if (activeRecapOperationId === operationId) {
    activeRecapOperationId = null;
    setBusy(false, "", { mode: PANEL_MODE_RECAP });
  }
  setStatusKey("status.recapCanceled", {}, false, { mode: PANEL_MODE_RECAP });
  sendMessage(scopedWindowMessage({ type: "activity:cancelTimeRecap", operationId })).catch(() => {
    // The UI should still stop waiting if the background context has already gone away.
  });
}

function startRecapKeepAlive(operationId) {
  stopRecapKeepAlive();
  const ping = () => {
    sendMessage({ type: "task:keepAlive" }).catch(() => {
      // The normal recap request reports terminal background failures to the UI.
    });
  };
  ping();
  recapKeepAliveOperationId = operationId;
  recapKeepAliveTimer = setInterval(ping, LONG_TASK_KEEPALIVE_MS);
}

function stopRecapKeepAlive(operationId = null) {
  if (operationId && recapKeepAliveOperationId && operationId !== recapKeepAliveOperationId) return;
  if (!recapKeepAliveTimer) return;
  clearInterval(recapKeepAliveTimer);
  recapKeepAliveTimer = null;
  recapKeepAliveOperationId = null;
}

function readEffectiveRunSettings() {
  const settings = readSettings({ effectiveForAnalysis: true });
  settings.languageMode = effectiveResultLanguageMode(settings.languageMode);
  validateGatewaySettingsForAnalyze(settings);
  return settings;
}

async function ensureGatewayPermissionForRun(settings, progress, mode = currentPanelMode) {
  updateLocalProgress(t("status.checkingPermissions"), progress, mode);
  await ensurePlannerHostPermission(settings);
}

async function ensurePageSummaryPermissionsForRun(settings, progress, mode = currentPanelMode) {
  if (settings.pageContextMode === "off" || settings.pageSamplingConsentMode === "not_acknowledged") return;
  updateLocalProgress(t("status.checkingPageSummaryPermissions"), progress, mode);
  await ensurePageSamplingPermissions(settings, { requestMissing: false });
  settings.hostPermissionRequestMode = "never";
}

async function handleGatewayModelsClick() {
  const settings = readSettings();
  settings.languageMode = effectiveResultLanguageMode(settings.languageMode);
  try {
    if (!settings.gatewayBaseUrl.trim()) throw new Error(t("status.gatewayTestUrlMissing"));
    nodes.gatewayModelsBtn.disabled = true;
    setStatusKey("status.gatewayModelsLoading");
    await ensurePlannerHostPermission(settings);
    const result = await sendMessage({
      type: "gateway:listModels",
      settings,
      timeoutMs: 15_000
    });
    renderGatewayModelOptions(result?.models || []);
    setStatusKey("status.gatewayModelsLoaded", { count: result?.models?.length || 0 });
  } catch (error) {
    setErrorStatus(error, friendlyErrorMessage(error));
  } finally {
    nodes.gatewayModelsBtn.disabled = false;
  }
}

function renderGatewayModelOptions(models = []) {
  if (!nodes.gatewayModelOptions) return;
  nodes.gatewayModelOptions.replaceChildren(
    ...models.map((model) => {
      const option = document.createElement("option");
      option.value = String(model);
      return option;
    })
  );
}

async function handleGatewayTestClick() {
  const settings = readSettings({ effectiveForAnalysis: true });
  settings.languageMode = effectiveResultLanguageMode(settings.languageMode);
  try {
    if (!settings.gatewayBaseUrl) {
      throw new Error(t("status.gatewayTestUrlMissing"));
    }
    validateGatewaySettingsForAnalyze(settings);
    nodes.gatewayTestBtn.disabled = true;
    setStatusKey("status.gatewayTesting");
    await ensurePlannerHostPermission(settings);
    const result = await sendMessage({
      type: "gateway:testConnection",
      settings,
      timeoutMs: 15_000
    });
    const primaryModel = result?.model || settings.gatewayCustomModel || settings.gatewayModel;
    const auxiliaryModel = result?.auxiliaryModel && result.auxiliaryModel !== primaryModel
      ? ` / ${result.auxiliaryModel}`
      : "";
    setStatusKey("status.gatewayTestOk", { model: `${primaryModel}${auxiliaryModel}` });
  } catch (error) {
    setErrorStatus(error, friendlyErrorMessage(error));
  } finally {
    nodes.gatewayTestBtn.disabled = false;
  }
}

async function handleClearLocalMemoryClick() {
  if (anyActionBusy()) {
    setStatusKey("status.localMemoryBusy", {}, true);
    return;
  }
  if (!confirm(t("confirm.clearLocalMemory"))) return;
  nodes.clearLocalMemoryBtn.disabled = true;
  try {
    await sendMessage({ type: "activity:clearLocalMemory" });
    await clearAnalysisState();
    resetToSetup();
    resetTimeRecapToSetup();
    setStatusKey("status.localMemoryCleared");
  } catch (error) {
    setErrorStatus(error, friendlyErrorMessage(error));
  } finally {
    nodes.clearLocalMemoryBtn.disabled = anyActionBusy();
  }
}

function handleSettingsExportClick() {
  const payload = createSettingsExport(readSettings());
  downloadJson(payload, `tabrecap-settings-${dateSlug(new Date())}.json`);
  setTransferStatus(t("status.settingsExported"));
  setStatusKey("status.settingsExported");
}

async function handleDiagnosticsExportClick() {
  setTransferButtonsDisabled(true);
  try {
    const payload = await sendMessage({ type: "diagnostics:getSnapshot" });
    downloadJson(payload, `tabrecap-diagnostics-${dateSlug(new Date())}.json`);
    setTransferStatus(t("status.diagnosticsExported"));
    setStatusKey("status.diagnosticsExported");
  } catch (error) {
    setTransferStatus(visibleErrorMessage(error), true);
    setErrorStatus(error, friendlyErrorMessage(error));
  } finally {
    setTransferButtonsDisabled(false);
  }
}

async function handleSettingsImportChange(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  setTransferButtonsDisabled(true);
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const importedSettings = readSettingsImportPayload(payload);
    const saved = await sendMessage({ type: "settings:save", settings: importedSettings });
    writeSettings(saved);
    updateConditionalUi();
    setTransferStatus(t("status.settingsImported"));
    setStatusKey("status.settingsImported");
  } catch (error) {
    setTransferStatus(t("status.settingsImportInvalid"), true);
    setStatusKey("status.settingsImportInvalid", {}, true);
  } finally {
    setTransferButtonsDisabled(false);
    if (event.target) event.target.value = "";
  }
}

function setTransferButtonsDisabled(disabled) {
  if (nodes.settingsExportBtn) nodes.settingsExportBtn.disabled = disabled;
  if (nodes.settingsImportBtn) nodes.settingsImportBtn.disabled = disabled;
  if (nodes.diagnosticsExportBtn) nodes.diagnosticsExportBtn.disabled = disabled;
}

function setTransferStatus(message, isError = false) {
  if (!nodes.settingsTransferStatus) return;
  nodes.settingsTransferStatus.textContent = message || "";
  nodes.settingsTransferStatus.dataset.error = isError ? "true" : "false";
}

function dateSlug(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadJson(payload, filename) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readRecapRange() {
  const preset = normalizeRecapPreset(fields.recapRangePreset?.value || "custom");
  if (preset !== "custom") {
    const range = dateRangeForRecapPreset(preset);
    fields.recapFromDate.value = dateInputValue(range.from);
    fields.recapToDate.value = dateInputValue(range.to);
    syncRecapDateDisplays();
    return {
      preset,
      from: range.from.toISOString(),
      to: range.to.toISOString()
    };
  }

  const fromValue = fields.recapFromDate.value;
  const toValue = fields.recapToDate.value;
  const from = dateTimeInputIso(fromValue, "start");
  const to = dateTimeInputIso(toValue, "end");
  if (!from || !to || Date.parse(to) < Date.parse(from)) {
    throw new Error(t("status.recapRangeInvalid"));
  }
  return {
    preset,
    from,
    to
  };
}

function dateTimeInputIso(value, boundary = "start") {
  const parts = String(value || "").split("-").map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isInteger(part))) {
    return new Date(parts[0], parts[1] - 1, parts[2], boundary === "end" ? 23 : 0, boundary === "end" ? 59 : 0, boundary === "end" ? 59 : 0, boundary === "end" ? 999 : 0).toISOString();
  }
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map((part) => Number(part));
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function renderTimeRecap(result) {
  const recap = safeRecapForDisplay(result?.recap || {});
  const displayResult = { ...(result || {}), recap };
  const input = result?.input || {};
  const pagesById = new Map((input.pages || []).map((page) => [page.id, page]));
  nodes.recapResult.className = "recap-result";

  if (!recap.headline && !recap.summary) {
    nodes.recapResult.className = "recap-result empty";
    nodes.recapResult.textContent = t("recap.empty");
    nodes.recapDetailsRoot.hidden = true;
    return;
  }

  const summary = recapMemoCard(displayResult);
  if (isTimeRecapFallbackResult(result)) {
    const fallback = document.createElement("p");
    fallback.className = "recap-fallback-note";
    const reason = timeRecapFallbackReasonText(result);
    fallback.textContent = reason ? `${t("recap.localFallback")} ${reason}` : t("recap.localFallback");
    summary.append(fallback);
  }

  const children = [summary];
  children.push(...recapTimelineSection(recap.timeline, pagesById));
  children.push(...recapSection(t("recap.themes"), recap.themes, pagesById, { sectionClass: "recap-topic-grid" }));

  nodes.recapResult.replaceChildren(...children);
  nodes.recapDetailsRoot.hidden = false;
  nodes.recapDetailsText.textContent = recapEvidenceDetailsText(displayResult, pagesById);
}

function safeRecapForDisplay(recap = {}) {
  const text = (value) => stripCleanupRecommendationsFromRecapText(value);
  const themes = asArray(recap.themes).map((theme) => ({
    ...theme,
    title: text(theme?.title),
    description: text(theme?.description || theme?.summary),
    evidence: asArray(theme?.evidence).map(text).filter(Boolean)
  })).filter((theme) => (theme.title || theme.description) && !isGenericRecapThemeTitle(theme.title));
  const timeline = asArray(recap.timeline).map((item) => ({
    ...item,
    label: text(item?.label),
    description: text(item?.description || item?.summary)
  })).filter((item) => item.label || item.description);
  return {
    ...recap,
    headline: text(recap.headline),
    summary: text(recap.summary),
    coverageNote: text(recap.coverageNote),
    themes,
    timeline,
    followUps: []
  };
}

function resetTimeRecapToSetup() {
  lastTimeRecap = null;
  lastTimeRecapError = null;
  nodes.recapResult.className = "recap-result empty";
  nodes.recapResult.textContent = t("recap.empty");
  nodes.recapDetailsRoot.hidden = true;
  nodes.recapDetailsText.textContent = "";
  setStatusKey("status.default", {}, false, { mode: PANEL_MODE_RECAP });
  syncActionState();
}

function recapMemoCard(result = {}) {
  const recap = result.recap || {};
  const card = document.createElement("section");
  card.className = "recap-summary-card recap-memo-card";

  const heading = document.createElement("h3");
  heading.textContent = t("recap.memoHeading");
  const lead = document.createElement("p");
  lead.className = "recap-memo-lead";
  lead.textContent = recap.headline || t("recap.heading");
  card.append(heading, lead);

  const rows = document.createElement("div");
  rows.className = "recap-memo-rows";
  for (const row of recapNarrativeRows(recap)) {
    rows.append(recapMemoRow(row));
  }
  card.append(rows);

  return card;
}

function recapNarrativeRows(recap = {}) {
  const focus = recap.summary || recap.coverageNote || recap.headline || "";
  const returned = recapThemesSentence(recap.themes) || recapTimelineSentence(recap.timeline) || recap.coverageNote || "";
  return [
    { tone: "focus", label: t("recap.memoFocus"), text: focus },
    { tone: "returned", label: t("recap.memoReturned"), text: returned }
  ].filter((row) => row.text);
}

function recapThemesSentence(themes = []) {
  const valid = asArray(themes).filter(Boolean).slice(0, 3);
  if (!valid.length) return "";
  const names = valid.map((theme) => theme.title).filter(Boolean).slice(0, 3).join(uiLanguage === "en-US" ? ", " : "、");
  const description = valid.find((theme) => theme.description)?.description || "";
  if (uiLanguage === "en-US") {
    return [names ? `Recurring topics include ${names}.` : "", description].filter(Boolean).join(" ");
  }
  return [names ? `${names} 是反复出现的主题。` : "", description].filter(Boolean).join("");
}

function recapTimelineSentence(timeline = []) {
  const item = asArray(timeline).find((entry) => entry?.description || entry?.label);
  if (!item) return "";
  return [item.label, item.description].filter(Boolean).join(uiLanguage === "en-US" ? ": " : "：");
}

function recapMemoRow(row) {
  const item = document.createElement("p");
  item.className = "recap-memo-row";
  item.dataset.tone = row.tone;
  const label = document.createElement("strong");
  label.textContent = row.label;
  const text = document.createElement("span");
  text.textContent = row.text;
  item.append(label, text);
  return item;
}

function renderTimeRecapError(error) {
  const errorState = normalizeTimeRecapError(error);
  lastTimeRecap = null;
  lastTimeRecapError = errorState;
  nodes.recapResult.className = "recap-result";
  const card = document.createElement("section");
  card.className = "recap-card";
  const title = document.createElement("h3");
  title.textContent = t("error.heading");
  const copy = document.createElement("p");
  copy.textContent = timeRecapErrorText(errorState);
  card.append(title, copy);
  nodes.recapResult.replaceChildren(card);
  nodes.recapDetailsRoot.hidden = true;
}

function normalizeTimeRecapError(error) {
  if (error && typeof error === "object" && ("key" in error || "text" in error)) {
    return {
      key: error.key || "",
      text: error.text || ""
    };
  }
  const rawMessage = String(error?.message || error || "").trim();
  if (/AI gateway time recap timed out/i.test(rawMessage)) {
    return { key: "status.recapFailed", text: "" };
  }
  return { key: "", text: friendlyErrorMessage(error) || t("status.previousFailed") };
}

function timeRecapErrorText(errorState = {}) {
  return errorState.key ? t(errorState.key) : errorState.text || t("status.previousFailed");
}

function recapSection(titleText, items = [], pagesById, options = {}) {
  const validItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!validItems.length) return [];
  const title = document.createElement("h3");
  title.className = "recap-section-title";
  title.textContent = titleText;
  const group = document.createElement("div");
  group.className = options.sectionClass || "recap-card-list";
  group.append(...validItems.map((item) => recapCard(item, pagesById, options)));
  return [
    title,
    group
  ];
}

function recapTimelineSection(items = [], pagesById) {
  const validItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!validItems.length) return [];
  const title = document.createElement("h3");
  title.className = "recap-section-title";
  title.textContent = t("recap.timeline");
  const list = document.createElement("div");
  list.className = "recap-timeline-list";
  validItems.slice(0, 6).forEach((item, index) => list.append(recapTimelineRow(item, pagesById, index)));
  return [title, list];
}

function recapTimelineRow(item, pagesById, index) {
  const row = document.createElement("article");
  row.className = "recap-timeline-row";
  row.dataset.tone = String(index % 3);
  const marker = document.createElement("span");
  marker.className = "recap-timeline-marker";
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item?.label || item?.title || "";
  const description = document.createElement("p");
  description.textContent = item?.description || item?.summary || "";
  copy.append(title, description);
  const pageCount = uniqueNumbers(item?.pageIds || item?.ids || []).map((id) => pagesById.get(id)).filter(Boolean).length;
  const count = document.createElement("span");
  count.className = "recap-timeline-count";
  count.textContent = pageCount ? (uiLanguage === "en-US" ? `${pageCount} pages` : `${pageCount} 页面`) : "";
  row.append(marker, copy, count);
  return row;
}

function recapCard(item, pagesById, options = {}) {
  const card = document.createElement("article");
  card.className = "recap-card";
  const title = document.createElement("h3");
  title.textContent = item?.title || item?.[options.labelKey || "title"] || "";
  const description = document.createElement("p");
  description.textContent = item?.[options.descriptionKey || "description"] || item?.summary || item?.reason || "";
  card.append(title, description);
  const chips = recapPageChips(item?.pageIds || item?.ids || [], pagesById);
  if (chips) card.append(chips);
  return card;
}

function recapPageChips(ids, pagesById) {
  const pages = uniqueNumbers(ids).map((id) => pagesById.get(id)).filter(Boolean).slice(0, 6);
  if (!pages.length) return null;
  const list = document.createElement("div");
  list.className = "recap-page-list";
  for (const page of pages) {
    const chip = document.createElement("span");
    chip.className = "recap-page-chip";
    chip.textContent = page.title || page.hostname || "";
    list.append(chip);
  }
  return list;
}

function recapEvidenceDetailsText(result = {}, pagesById = new Map()) {
  const input = result.input || {};
  const coverage = input.coverage || {};
  const lines = [
    t("recap.evidenceCoverage", {
      included: Number(coverage.includedPages || input.pages?.length || 0),
      summaries: Number(coverage.sampledEntries || 0)
    }),
    t("recap.evidenceSignals")
  ];

  if (input.range?.from && input.range?.to) {
    lines.push(
      t("recap.evidenceRange", {
        from: formatRecapDateTime(input.range.from),
        to: formatRecapDateTime(input.range.to)
      })
    );
  }

  if (isTimeRecapFallbackResult(result)) {
    lines.push(t("recap.evidenceFallback"));
    const reason = timeRecapFallbackReasonText(result);
    if (reason) lines.push(reason);
  }

  const pages = recapReferencedPages(result.recap || {}, input, pagesById);
  if (pages.length) {
    lines.push("", t("recap.evidencePages"));
    for (const page of pages) {
      const title = String(page.title || page.hostname || "").trim();
      const site = String(page.hostname || "").trim();
      const suffix = site && title && !title.includes(site) ? ` (${site})` : "";
      lines.push(`- ${title || site}${suffix}`.slice(0, 180));
    }
  }

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function recapReferencedPages(recap = {}, input = {}, pagesById = new Map()) {
  const ids = [];
  const collect = (values = []) => {
    for (const item of Array.isArray(values) ? values : []) {
      ids.push(...uniqueNumbers(item?.pageIds || item?.ids || []));
      if (Number.isInteger(Number(item?.pageId))) ids.push(Number(item.pageId));
    }
  };

  collect(recap.timeline);
  collect(recap.themes);

  const referenced = uniqueNumbers(ids)
    .map((id) => pagesById.get(id))
    .filter(Boolean);
  const fallback = Array.isArray(input.pages) ? input.pages : [];
  return (referenced.length ? referenced : fallback).slice(0, 8);
}

function formatRecapDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const locale = uiLanguage === "en-US" ? "en-US" : "zh-CN";
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function validateGatewaySettingsForAnalyze(settings) {
  if (settings.plannerProvider !== "gateway") return;
  if (!settings.gatewayBaseUrl.trim()) {
    throw new Error(t("status.gatewayTestUrlMissing"));
  }
  if (!settings.gatewayCustomModel.trim()) {
    throw new Error(t("status.customModelMissing"));
  }
}

function isCancellationError(error) {
  return /已取消整理|已停止生成|Cleanup canceled|canceled|stopped/i.test(String(error?.message || ""));
}

function friendlyErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  const gatewayStatus = (key) => withVisibleGatewayRequestId(t(key), message);
  if (!message) return t("status.default");
  if (/No analyzed plan is available/i.test(message)) return t("status.noPlanToApply");
  if (/No rollback snapshot is available/i.test(message)) return t("status.noRollback");
  if (/Cannot apply an invalid plan/i.test(message)) return t("status.invalidPlan");
  if (/Progress copy generation returned invalid JSON/i.test(message)) return t("status.progressCopyFailed");
  if (/AI 增强未完成|AI enhancement did not finish/i.test(message)) return t("status.recapAiUnavailable");
  if (/AI gateway time recap timed out/i.test(message)) return t("status.recapFailed");
  if (/AI gateway .* timed out|API 连接超时|API connection timed out/i.test(message)) {
    return gatewayStatus("status.customGatewayConnectionTimeout");
  }
  if (
    /不支持(?:当前|这个)模型|model.*not available|not available.*model|unsupported.*model|model.*unsupported|model_not_allowed|planner_model_not_allowed|recap_model_not_allowed/i.test(
      message
    )
  ) {
    return gatewayStatus("status.customGatewayUnsupportedModel");
  }
  if (/AI 服务拒绝访问|AI service denied access/i.test(message)) {
    return gatewayStatus("status.customGatewayAuthDenied");
  }
  if (/AI 网关的源站暂时离线|AI gateway origin is offline|Cloudflare could not reach the local TabRecap AI origin|API upstream is temporarily offline/i.test(message)) {
    return gatewayStatus("status.gatewayLocalOriginOffline");
  }
  if (/AI 网关暂时连不上|API 暂时连不上|AI gateway.*(?:not reachable|temporarily unavailable)|API is not reachable/i.test(message)) {
    return gatewayStatus("status.customGatewayUnreachable");
  }
  if (/AI 服务没有完成请求|AI service did not complete/i.test(message)) {
    return gatewayStatus("status.customGatewayFailed");
  }
  if (/AI gateway planner returned invalid JSON|Unexpected token|is not valid JSON|invalid JSON/i.test(message)) {
    return gatewayStatus("status.gatewayInvalidOutput");
  }
  if (/正在生成中，先停止后再清空本机记录|generation is running|clearing local records/i.test(message)) {
    return t("status.localMemoryBusy");
  }
  return message;
}

function withVisibleGatewayRequestId(text, sourceMessage) {
  const requestId = gatewayRequestIdFromMessage(sourceMessage);
  if (!requestId) return text;
  const suffix = uiLanguage === "en-US" ? ` (request id ${requestId})` : `（请求号 ${requestId}）`;
  return String(text || "").includes(suffix) ? text : `${text}${suffix}`;
}

function gatewayRequestIdFromMessage(message = "") {
  const match = String(message || "").match(/(?:请求号|request id)\s+([A-Za-z0-9._:-]{3,96})/i);
  return match?.[1] || "";
}

function anyActionBusy() {
  return Object.values(actionStateByMode).some((state) => state?.busy);
}

function isTimeRecapFallbackResult(result = {}) {
  return result?.source === "local_fallback" || Boolean(result?.error);
}

function timeRecapFallbackStatusText(result = {}) {
  return timeRecapFallbackReasonText(result) || t("status.recapAiUnavailable");
}

function timeRecapFallbackReasonText(result = {}) {
  if (!result?.error) return "";
  const rawMessage = String(result.error?.message || result.error || "").trim();
  const message = friendlyErrorMessage(result.error);
  if (!message || message === t("status.default") || message === t("status.recapAiUnavailable") || message === t("status.recapFailed")) return "";
  if (message === rawMessage && !isProductSafeGatewayMessage(message)) return "";
  return message;
}

function isProductSafeGatewayMessage(message = "") {
  return /^(?:API|AI 服务|AI 网关|这个 API|The API|The AI service|The AI gateway|This API)/i.test(
    message
  );
}

async function cancelAnalyze() {
  const runId = activeAnalyzeRunId;
  if (runId) {
    canceledAnalyzeRuns.add(runId);
    setTimeout(() => canceledAnalyzeRuns.delete(runId), CANCELED_OPERATION_TTL_MS);
  }
  setCancelDisabled(PANEL_MODE_ORGANIZE, true);
  setStatusKey("status.canceling", {}, false, { mode: PANEL_MODE_ORGANIZE });
  if (!activeAnalyzeOperationId) {
    stopProgressPolling();
    setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
    setStatusKey("status.canceled", {}, false, { mode: PANEL_MODE_ORGANIZE });
    return;
  }
  try {
    const result = await sendMessage(scopedWindowMessage({
      type: "tabs:cancelActiveJob",
      operationId: activeAnalyzeOperationId || undefined
    }));
    if (result?.job) updateProgressFromJob(result.job, PANEL_MODE_ORGANIZE);
    if (result?.job?.status === "complete") {
      await restoreCompletedJob(result.job);
    } else if (result?.job?.status === "error") {
      restoreTerminalJob(result.job);
    } else if (!result?.job || result?.job?.status === "canceled") {
      stopProgressPolling();
      setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
      setStatusKey("status.canceled", {}, false, { mode: PANEL_MODE_ORGANIZE });
    }
  } catch (error) {
    setErrorStatus(error, t("status.previousFailed"), { mode: PANEL_MODE_ORGANIZE });
    setCancelDisabled(PANEL_MODE_ORGANIZE, false);
  }
}

async function applyLastPlan() {
  let confirmMultiWindow = false;
  if (lastPreview?.requiresConfirmation) {
    const confirmed = confirm(t("confirm.applyMultiWindow"));
    if (!confirmed) return;
    confirmMultiWindow = true;
  }

  setBusy(true, t("status.organizing"), { mode: PANEL_MODE_ORGANIZE });
  try {
    let result = await sendMessage(scopedWindowMessage({ type: "tabs:applyLastPlan", confirmMultiWindow }));
    if (result?.requiresMultiWindowConfirmation) {
      const confirmed = confirm(t("confirm.applyMultiWindow"));
      if (!confirmed) {
        setStatusKey("status.canceled", {}, false, { mode: PANEL_MODE_ORGANIZE });
        return;
      }
      confirmMultiWindow = true;
      result = await sendMessage(scopedWindowMessage({ type: "tabs:applyLastPlan", confirmMultiWindow }));
    }
    if (result?.requiresChangedTabsConfirmation) {
      const confirmed = confirm(changedTabsConfirmationText(result.rebasedPlan));
      if (!confirmed) {
        setStatusKey("status.canceled", {}, false, { mode: PANEL_MODE_ORGANIZE });
        return;
      }
      setStatusKey("status.organizingChanged", {}, false, { mode: PANEL_MODE_ORGANIZE });
      result = await sendMessage(scopedWindowMessage({
        type: "tabs:applyLastPlan",
        confirmChangedTabs: true,
        confirmationToken: result.rebasedPlan?.confirmationToken || "",
        confirmMultiWindow
      }));
      if (result?.requiresChangedTabsConfirmation) {
        setStatusKey("status.previousFailed", {}, true, { mode: PANEL_MODE_ORGANIZE });
        renderError(new Error(changedTabsConfirmationText(result.rebasedPlan)));
        return;
      }
    }
    canUndo = true;
    const status = applyResultStatus(result);
    await clearAnalysisState();
    resetToSetup();
    setStatusKey(status.key, status.params, false, { mode: PANEL_MODE_ORGANIZE });
  } catch (error) {
    setErrorStatus(error, t("status.previousFailed"), { mode: PANEL_MODE_ORGANIZE });
  } finally {
    setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
  }
}

function changedTabsConfirmationText(summary = {}) {
  const newCount = [...(summary.skippedNewTabIds || []), ...(summary.addedReviewTabIds || [])].length;
  const changedContentCount = (summary.changedContentTabIds || []).length;
  const removedCount = (summary.removedTabIds || []).length;
  const duplicateCount = (summary.duplicateTabIds || []).length;
  const reviewTitle = reviewGroupTitle(currentResultLanguageMode());
  const lines = [t("confirm.changedHeader")];

  if (newCount) {
    if (fields.reviewGroupMode.value === "create_review_group") {
      lines.push(t("confirm.newToReview", { count: newCount, reviewTitle }));
    } else {
      lines.push(t("confirm.newUngrouped", { count: newCount }));
    }
  }
  if (changedContentCount) lines.push(t("confirm.changedContent", { count: changedContentCount, reviewTitle }));
  if (removedCount) lines.push(t("confirm.removed", { count: removedCount }));
  if (duplicateCount) lines.push(t("confirm.duplicate", { count: duplicateCount }));
  lines.push(t("confirm.continue"));
  return lines.join("\n");
}

function applyResultStatus(result) {
  const groupCount = result.createdGroupIds?.length || 0;
  const changedTabs = result.rebasedPlan?.changedTabsCount || 0;
  if (changedTabs) {
    const reviewCount = result.rebasedPlan?.addedReviewTabIds?.length || 0;
    if (reviewCount && fields.reviewGroupMode.value === "create_review_group") {
      return {
        key: "status.applyChangedWithReview",
        params: { groupCount, changedTabs, reviewCount, reviewTitle: reviewGroupTitle(currentResultLanguageMode()) }
      };
    }
    return { key: "status.applyChanged", params: { groupCount, changedTabs } };
  }
  return { key: "status.applyDone", params: { groupCount } };
}

async function undoLastApply() {
  setBusy(true, t("status.undoing"), { mode: PANEL_MODE_ORGANIZE });
  try {
    const result = await sendMessage(scopedWindowMessage({ type: "tabs:undoLastApply" }));
    canUndo = false;
    setStatusKey("status.undoDone", { count: result.restoredTabs || 0 }, false, { mode: PANEL_MODE_ORGANIZE });
    renderDetails({ undoResult: result });
  } catch (error) {
    setErrorStatus(error, t("status.previousFailed"), { mode: PANEL_MODE_ORGANIZE });
  } finally {
    setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
  }
}

function renderPreview(job) {
  lastError = null;
  nodes.previewSection.hidden = false;
  const preview = job.preview;
  const resultLanguageMode = preview.languageMode || job.settings?.languageMode || currentResultLanguageMode();
  const groupingEnabled = preview.analysisFeatures?.grouping !== false;
  const cleanupEnabled =
    preview.analysisFeatures?.cleanup === true || (preview.analysisFeatures?.cleanup === undefined && Boolean(preview.cleanup));
  const groups = orderPreviewGroups(preview.groups || [], resultLanguageMode);
  const reviewTabsCount = preview.reviewTabsCount || 0;
  const reviewGroupWillBeCreated = Boolean(preview.reviewGroupWillBeCreated && reviewTabsCount);
  const visibleGroupCount = groups.length + (reviewGroupWillBeCreated ? 1 : 0);
  const cleanup = preview.cleanup || null;
  const cleanupCandidateCount = cleanupSuggestionCount(cleanup);
  const hasCleanupContent = Boolean(cleanup && (cleanup.candidateCount || cleanup.summary));
  const cleanupOnly = !groupingEnabled && cleanupEnabled;
  const combinedResults = groupingEnabled && cleanupEnabled;
  const groupedTabsCount = Number.isFinite(Number(preview.groupedTabsCount))
    ? Number(preview.groupedTabsCount)
    : groups.reduce((sum, group) => sum + (Number(group.tabCount) || 0), 0);
  const summaryPreview = {
    ...preview,
    groupedTabsCount,
    eligibleTabsCount: Number.isFinite(Number(preview.eligibleTabsCount))
      ? Number(preview.eligibleTabsCount)
      : groupedTabsCount + reviewTabsCount
  };

  updatePreviewHeading({ cleanupOnly, combinedResults });

  const hasEligibleTabs = Number(preview.eligibleTabsCount || preview.totalTabsCount || 0) > 0;
  if (groupingEnabled && !groups.length && !reviewTabsCount && !preview.lockedGroupsCount && !hasCleanupContent) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = t("status.noTabs");
    nodes.previewCount.textContent = t("preview.emptyCount");
    return;
  }
  if (cleanupOnly && !hasEligibleTabs && !hasCleanupContent) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = t("status.noTabs");
    nodes.previewCount.textContent = t("preview.emptyCount");
    return;
  }

  nodes.previewRoot.className = "preview-list";
  nodes.previewCount.textContent = combinedResults
    ? t("preview.tabsCount", { count: summaryPreview.eligibleTabsCount })
    : cleanupOnly
      ? t("preview.cleanupCount", { count: cleanupCandidateCount })
      : t("preview.groupCount", { count: visibleGroupCount });
  const groupRows = [
    ...groups.map((group, index) => groupRow(group, swatchForIndex(index), uiLanguage)),
    ...(reviewGroupWillBeCreated ? [reviewGroupRow(reviewTabsCount, resultLanguageMode, preview)] : [])
  ];
  const groupNodes = !groupingEnabled
    ? []
    : [
        previewSummary(summaryPreview, groups.length, reviewTabsCount, reviewGroupWillBeCreated, resultLanguageMode),
        ...(groupRows.length ? [previewGroupList(groupRows)] : [])
      ];
  const cleanupNodes = cleanupEnabled ? [cleanupPreviewSection(cleanup, { cleanupOnly, embedded: combinedResults })] : [];
  if (combinedResults) {
    nodes.previewRoot.replaceChildren(
      combinedPreviewResults({
        groupNodes,
        cleanupNodes,
        groupCount: visibleGroupCount,
        cleanupCount: cleanupCandidateCount
      })
    );
    return;
  }
  nodes.previewRoot.replaceChildren(...groupNodes, ...cleanupNodes);
}

function updatePreviewHeading({ cleanupOnly = false, combinedResults = false } = {}) {
  const stepKey = combinedResults ? "preview.stepCombined" : cleanupOnly ? "preview.stepCleanup" : "preview.step";
  const headingKey = combinedResults ? "preview.headingCombined" : cleanupOnly ? "preview.headingCleanup" : "preview.heading";
  setText(".preview .step-label", t(stepKey));
  setText(".preview .section-heading h2", t(headingKey));
}

function combinedPreviewResults({ groupNodes, cleanupNodes, groupCount, cleanupCount }) {
  const container = document.createElement("section");
  container.className = "preview-results";

  const tabList = document.createElement("div");
  tabList.className = "preview-result-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", t("preview.resultsAria"));

  const groupingTab = previewResultTab("grouping", t("preview.groupingTab"), t("preview.groupCount", { count: groupCount }));
  const cleanupTab = previewResultTab("cleanup", t("preview.cleanupTab"), t("preview.cleanupCount", { count: cleanupCount }));
  const groupingPanel = previewResultPanel("grouping", groupNodes);
  const cleanupPanel = previewResultPanel("cleanup", cleanupNodes);
  const tabs = [groupingTab, cleanupTab];
  const panels = [groupingPanel, cleanupPanel];

  const selectView = (view) => {
    previewResultView = view === "cleanup" ? "cleanup" : "grouping";
    tabs.forEach((tab) => {
      const selected = tab.dataset.previewView === previewResultView;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.previewView !== previewResultView;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectView(tab.dataset.previewView));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      selectView(tabs[nextIndex].dataset.previewView);
      tabs[nextIndex].focus();
    });
  });

  tabList.append(...tabs);
  container.append(tabList, ...panels);
  selectView(previewResultView);
  return container;
}

function previewResultTab(view, label, count) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "preview-result-tab";
  tab.id = `preview-result-tab-${view}`;
  tab.dataset.previewView = view;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", `preview-result-panel-${view}`);

  const title = document.createElement("strong");
  title.textContent = label;
  const badge = document.createElement("span");
  badge.textContent = count;
  tab.append(title, badge);
  return tab;
}

function previewResultPanel(view, children) {
  const panel = document.createElement("div");
  panel.className = "preview-result-panel";
  panel.id = `preview-result-panel-${view}`;
  panel.dataset.previewView = view;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `preview-result-tab-${view}`);
  panel.append(...children);
  return panel;
}

function orderPreviewGroups(groups) {
  const normalGroups = [];
  const reviewLikeGroups = [];

  for (const group of groups) {
    if (isReviewLikeGroup(group)) {
      reviewLikeGroups.push(group);
    } else {
      normalGroups.push(group);
    }
  }

  return [...normalGroups, ...reviewLikeGroups];
}

function previewSummary(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode) {
  const summary = document.createElement("div");
  summary.className = "preview-summary";
  const main = document.createElement("span");
  main.textContent = previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode);
  summary.append(main, pageSamplingLine(preview), excludedTabsLine(preview));
  return summary;
}

function previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, resultLanguageMode) {
  const handledTabs = preview.eligibleTabsCount || (preview.groupedTabsCount || 0) + reviewTabsCount;
  const groupedTabs = preview.groupedTabsCount || 0;

  if (!handledTabs) {
    return t("status.noTabs");
  }

  if (uiLanguage === "en-US") {
    const subjectText = groupCount ? `found ${formatCount(groupCount, "topic group")}` : "found no stable topic groups";
    const reviewTitle = preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode);
    const reviewText = reviewTabsCount
      ? reviewGroupWillBeCreated
        ? `, with ${formatCount(reviewTabsCount, "tab")} set aside for "${reviewTitle}"`
        : `, with ${formatCount(reviewTabsCount, "tab")} left ungrouped`
      : "";

    if (!groupCount && reviewTabsCount) {
      return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}${reviewText}.`;
    }

    return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}; ${formatCount(groupedTabs, "tab")} will be grouped automatically${reviewText}.`;
  }

  const subjectText = groupCount ? `识别出 ${groupCount} 个主题` : "没有找到足够稳定的主题";
  const reviewText = reviewTabsCount
    ? reviewGroupWillBeCreated
      ? `，${reviewTabsCount} 个留到「${preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode)}」`
      : `，${reviewTabsCount} 个暂不归类`
    : "";

  if (!groupCount && reviewTabsCount) {
    return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}${reviewText}。`;
  }

  return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}；${groupedTabs} 个已自动归类${reviewText}。`;
}

function pageSamplingLine(preview) {
  const line = document.createElement("small");
  const pageSampling = preview?.pageSampling;
  if (!pageSampling?.requested || !pageSampling.ok) return line;

  const totalTabsForCopy = preview?.eligibleTabsCount || preview?.totalTabsCount || pageSampling.requested;
  const shouldShowCount = shouldShowPageSampleCount(pageSampling.ok, totalTabsForCopy);
  line.textContent =
    uiLanguage === "en-US"
      ? shouldShowCount
        ? `Referenced ${pageSampling.ok} page summaries plus titles, URLs, and tab order.`
        : "Added extra page context where available, then organized with titles, URLs, and tab order."
      : shouldShowCount
        ? `已参考 ${pageSampling.ok} 个页面摘要，并结合标题、网址和原始顺序整理。`
        : "已补充部分页面线索，并结合标题、网址和原始顺序整理。";
  return line;
}

function excludedTabsLine(preview) {
  const line = document.createElement("small");
  if (!preview?.excludedTabsCount) return line;
  line.textContent = localizedText(
    uiLanguage,
    `另有 ${preview.excludedTabsCount} 个固定、无痕或受限标签页未参与整理。`,
    `${preview.excludedTabsCount} pinned, incognito, or restricted tabs were not included.`
  );
  return line;
}

function groupRow(group, swatchColor, languageMode = "auto") {
  const row = document.createElement("div");
  row.className = "group-row";
  row.style.setProperty("--swatch", swatchColor);

  const swatch = document.createElement("div");
  swatch.className = "group-swatch";

  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = group.title;
  const meta = document.createElement("div");
  meta.className = "group-meta";
  meta.textContent = group.reason || group.groupKey;
  body.append(title, meta);

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = localizedText(languageMode, `${group.tabCount} 个`, formatCount(group.tabCount, "tab"));

  row.append(swatch, body, badge);
  return row;
}

function previewGroupList(rows) {
  const list = document.createElement("section");
  list.className = "preview-group-list";
  list.append(...rows);
  return list;
}

function formatCount(count, noun) {
  const numeric = Number(count) || 0;
  return `${numeric} ${noun}${numeric === 1 ? "" : "s"}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueNumbers(values) {
  return [...new Set((values || []).map((value) => Number(value)).filter(Number.isInteger))];
}

function reviewGroupRow(tabCount, resultLanguageMode, preview) {
  return groupRow(
    {
      title: preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode),
      reason: preview.reviewGroupReason || reviewGroupReason(resultLanguageMode),
      tabCount
    },
    "var(--muted)",
    uiLanguage
  );
}

function cleanupPreviewSection(cleanup, options = {}) {
  const cleanupOnly = Boolean(options.cleanupOnly);
  const section = document.createElement("section");
  section.className = "cleanup-preview";
  section.classList.toggle("is-embedded", Boolean(options.embedded));
  const header = document.createElement("div");
  header.className = "cleanup-preview-header";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = t("cleanup.preview.title");
  const subtitle = document.createElement("small");
  subtitle.textContent = cleanupSummaryForPreview(cleanup, { cleanupOnly });
  copy.append(title, subtitle);

  header.append(copy);

  const candidates = cleanup?.candidates || [];
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("cleanup.preview.empty");
    section.append(header, empty);
    return section;
  }

  const candidatesByPriority = new Map(CLEANUP_PRIORITY_ORDER.map((priority) => [priority, []]));
  for (const candidate of candidates) {
    candidatesByPriority.get(normalizeCleanupPriority(candidate.priority)).push(candidate);
  }
  const populatedPriorities = CLEANUP_PRIORITY_ORDER.filter((priority) => candidatesByPriority.get(priority).length);
  const defaultOpenPriority = populatedPriorities.includes("high") ? "high" : populatedPriorities[0];
  const groups = populatedPriorities.map((priority) =>
    cleanupPriorityGroup(priority, candidatesByPriority.get(priority), { open: priority === defaultOpenPriority })
  );

  const groupList = document.createElement("div");
  groupList.className = "cleanup-priority-groups";
  groupList.append(...groups);

  section.append(header, groupList);
  return section;
}

function cleanupPriorityGroup(priority, candidates, options = {}) {
  const group = document.createElement("details");
  group.className = "cleanup-priority-group";
  group.dataset.priority = priority;
  group.open = Boolean(options.open);

  const summary = document.createElement("summary");
  summary.append(cleanupPriorityChip(priority));
  const count = document.createElement("span");
  count.className = "cleanup-priority-count";
  count.textContent = t("cleanup.groupCount", { count: candidates.length });
  summary.append(count);

  const list = document.createElement("div");
  list.className = "cleanup-preview-list";
  list.append(...candidates.map((candidate) => cleanupPreviewRow(candidate)));
  group.append(summary, list);
  return group;
}

function normalizeCleanupPriority(priority) {
  return CLEANUP_PRIORITY_ORDER.includes(priority) ? priority : "medium";
}

function cleanupSuggestionCount(cleanup) {
  const candidates = asArray(cleanup?.candidates);
  if (candidates.length) {
    return candidates.filter((candidate) => normalizeCleanupPriority(candidate.priority) !== "low").length;
  }
  return Number(cleanup?.candidateCount || 0);
}

function cleanupSummaryForPreview(cleanup, { cleanupOnly = false } = {}) {
  const summary = String(cleanup?.summary || "").trim();
  const leaksImplementationDetail =
    /不自动分组|不创建分组|按要求|grouping\s+is\s+disabled|without\s+creating\s+groups/i.test(summary);
  const cleanedSummary = cleanupProductCopy(summary, 180);
  if (cleanedSummary && !leaksImplementationDetail) return cleanedSummary;
  return t(cleanupOnly ? "cleanup.preview.subtitleOnly" : "cleanup.preview.subtitle");
}

function cleanupPreviewRow(candidate) {
  const row = document.createElement("article");
  row.className = "cleanup-preview-row";
  row.dataset.tabId = String(candidate.tabId);

  const body = document.createElement("div");
  body.className = "cleanup-preview-body";
  const titleLine = document.createElement("div");
  titleLine.className = "cleanup-title-line";
  const title = document.createElement("strong");
  title.textContent = candidate.title || candidate.hostname || "Untitled";
  titleLine.append(title);
  const meta = document.createElement("small");
  meta.textContent = cleanupCandidateMeta(candidate);
  body.append(titleLine, meta);

  const reasonText = cleanupProductCopy(candidate.reason, 220);
  if (reasonText) {
    const reason = document.createElement("div");
    reason.className = "cleanup-reason";
    const copy = document.createElement("p");
    copy.textContent = reasonText;
    reason.append(copy);
    body.append(reason);
  }

  const clues = cleanupEvidenceForPreview(candidate);
  if (clues.length) {
    const clueBlock = document.createElement("div");
    clueBlock.className = "cleanup-clues";
    const chips = document.createElement("div");
    chips.className = "cleanup-candidate-meta cleanup-evidence";
    for (const item of clues) {
      chips.append(cleanupMetaChip(item));
    }
    clueBlock.append(chips);
    body.append(clueBlock);
  }

  const actions = document.createElement("div");
  actions.className = "cleanup-row-actions";
  const focus = iconButton("focus", t("cleanup.focusAria"));
  focus.addEventListener("click", () => focusActivityTab(candidate));
  const close = iconButton("close", t("cleanup.closeOneAria"));
  close.addEventListener("click", () => closeCleanupTabs([candidate.tabId]));
  actions.append(focus, close);

  body.prepend(actions);
  row.append(body);
  return row;
}

function iconButton(icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-action";
  button.dataset.action = icon;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const text = document.createElement("span");
  text.className = "icon-action-label";
  const labels = {
    focus: t("cleanup.focus"),
    close: t("cleanup.closeOne")
  };
  text.textContent = labels[icon] || labels.close;
  button.append(text);
  return button;
}

function cleanupCandidateMeta(candidate) {
  return [
    candidate.hostname,
    candidate.currentGroupTitle ? t("activity.group", { group: candidate.currentGroupTitle }) : "",
    candidate.ageMs ? t("activity.firstSeen", { age: formatAgo(candidate.ageMs) }) : "",
    candidate.idleMs ? t("activity.lastActive", { age: formatAgo(candidate.idleMs) }) : ""
  ].filter(Boolean).join(" · ");
}

function cleanupEvidenceForPreview(candidate) {
  const labels = [];
  const push = (value) => {
    const label = String(value || "").trim();
    if (label && !labels.includes(label)) labels.push(label);
  };

  for (const item of Array.isArray(candidate.evidence) ? candidate.evidence : []) {
    push(cleanupEvidenceLabel(item));
  }

  if (Number(candidate.activeCount || 0) === 0) {
    push(t("cleanup.clue.notReopened"));
  } else if (Number(candidate.activeCount || 0) === 1) {
    push(t("cleanup.clue.rarelyOpened"));
  } else if (Number(candidate.activeCount || 0) > 1) {
    push(t("cleanup.clue.openCount", { count: candidate.activeCount }));
  }
  if (Number(candidate.ageMs || 0) >= 24 * 60 * 60 * 1000) {
    push(t("cleanup.clue.openForDays", { days: formatDays(candidate.ageMs) }));
  }
  if (Number(candidate.idleMs || 0) >= 24 * 60 * 60 * 1000) {
    push(t("cleanup.clue.idleForDays", { days: formatDays(candidate.idleMs) }));
  }
  if (candidate.discarded) push(t("cleanup.clue.sleeping"));
  if (!candidate.currentGroupTitle) push(t("cleanup.clue.ungrouped"));

  return labels.slice(0, 4);
}

const CLEANUP_ACTIVE_COUNT_FIELD_PATTERN = /\bactive(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+)/i;
const CLEANUP_AGE_DAYS_FIELD_PATTERN = /\bage(?:Days|[_\s-]?days?)\s*(?:约|为|=|is|:)?\s*([\d.]+)/i;
const CLEANUP_IDLE_DAYS_FIELD_PATTERN = /\bidle(?:Days|[_\s-]?days?)\s*(?:约|为|=|is|:)?\s*([\d.]+)/i;
const CLEANUP_SAMPLEABLE_FIELD_PATTERN = /不可采样|cannot sample|not sampleable|sample(?:able|[_\s-]?able)/i;
const CLEANUP_INTERNAL_FIELD_PATTERN =
  /active(?:Count|[_\s-]?count)|age(?:Days|[_\s-]?days?)|idle(?:Days|[_\s-]?days?)|sample(?:able|[_\s-]?able)|tab(?:Ids?|[_\s-]?ids?)|page(?:Ids?|[_\s-]?ids?)|window(?:Ids?|[_\s-]?ids?)|sequence(?:Index(?:es)?|Indices|[_\s-]?index(?:es)?|[_\s-]?indices)|current(?:Group|[_\s-]?group)|(?:hostname|host(?:Name|[_\s-]?name))|activation(?:Flow|[_\s-]?flow)|nearby(?:Ids?|[_\s-]?ids?)|return(?:ToId|[_\s-]?to[_\s-]?id)|returned(?:ToCount|[_\s-]?to[_\s-]?count)|repeated(?:Ids?|[_\s-]?ids?)|dwell(?:Seconds|[_\s-]?seconds?)|(?:total|avg|max)?(?:Active|Dwell)(?:Seconds|[_\s-]?seconds?)|transition(?:Count|[_\s-]?count)|from(?:Id|[_\s-]?id)|to(?:Id|[_\s-]?id)|started(?:At|[_\s-]?at)|ended(?:At|[_\s-]?at)|last(?:At|[_\s-]?at)|clues?/i;

function cleanupEvidenceLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const productText = cleanupProductCopy(text, 48);
  if (!productText) return "";

  const activeMatch = text.match(CLEANUP_ACTIVE_COUNT_FIELD_PATTERN);
  if (activeMatch) return cleanupOpenCountLabel(Number(activeMatch[1]));

  const ageMatch = text.match(CLEANUP_AGE_DAYS_FIELD_PATTERN);
  if (ageMatch) return t("cleanup.clue.openForDays", { days: formatNumberLabel(ageMatch[1]) });

  const idleMatch = text.match(CLEANUP_IDLE_DAYS_FIELD_PATTERN);
  if (idleMatch) return t("cleanup.clue.idleForDays", { days: formatNumberLabel(idleMatch[1]) });

  if (/标签已被丢弃|discarded|休眠|sleeping/i.test(text)) return t("cleanup.clue.sleeping");
  if (CLEANUP_SAMPLEABLE_FIELD_PATTERN.test(text)) return "";
  if (/chrome:\/\/extensions|浏览器.*(?:内部|设置)|扩展程序|internal page|settings page/i.test(text)) return t("cleanup.clue.browserPage");
  if (/搜索结果|搜索页|Google 搜索|search result|search page/i.test(text)) return t("cleanup.clue.searchPage");
  if (/标题为|title\s*(?:is|=|:)|titled/i.test(text)) return "";
  if (/同组|same group|nearby|更具体|specific pages/i.test(text)) return t("cleanup.clue.sameGroup");
  if (/无直接|关系弱|不相关|weak fit|unrelated|low relevance/i.test(text)) return t("cleanup.clue.weakRelation");
  if (/重新|找回|恢复|recover|find again|refind|rerun/i.test(text)) return t("cleanup.clue.refindable");
  if (/主页|入口|总览|列表|overview|home page|entry page|index page|repository list/i.test(text)) return t("cleanup.clue.entryPage");
  if (productText && productText !== text && !CLEANUP_INTERNAL_FIELD_PATTERN.test(productText)) return productText;
  if (CLEANUP_INTERNAL_FIELD_PATTERN.test(text)) return "";

  return productText || text.slice(0, 48);
}

function cleanupProductCopy(value, maxLength = 160) {
  return normalizeCleanupProductText(value, { languageMode: uiLanguage }, maxLength).trim();
}

function cleanupOpenCountLabel(count) {
  if (!Number.isFinite(count) || count <= 0) return t("cleanup.clue.notReopened");
  if (count === 1) return t("cleanup.clue.rarelyOpened");
  return t("cleanup.clue.openCount", { count });
}

function formatDays(ms) {
  return formatNumberLabel(Math.round((Number(ms || 0) / (24 * 60 * 60 * 1000)) * 10) / 10);
}

function formatNumberLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "").trim();
  return String(Math.round(numeric * 10) / 10).replace(/\.0$/, "");
}

async function closeCleanupTabs(tabIds) {
  const ids = uniqueNumbers(tabIds);
  if (!ids.length) {
    setStatusKey("cleanup.noneSelected", {}, true, { mode: PANEL_MODE_ORGANIZE });
    return;
  }
  setBusy(true, t("status.closingTabs"), { mode: PANEL_MODE_ORGANIZE });
  try {
    const result = await sendMessage(scopedWindowMessage({ type: "tabs:closeCleanupCandidates", tabIds: ids, languageMode: uiLanguage }));
    lastPreview = result.preview;
    lastCanApply = Boolean(result.validation?.ok);
    renderPreview({ preview: lastPreview, validation: result.validation, settings: { languageMode: currentResultLanguageMode() } });
    setCleanupCloseStatus(result);
  } catch (error) {
    setErrorStatus(error, t("status.previousFailed"), { mode: PANEL_MODE_ORGANIZE });
  } finally {
    setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
  }
}

function setCleanupCloseStatus(result = {}) {
  const closed = result.closedTabIds?.length || 0;
  const changed = result.skippedTabIds?.length || 0;
  if (closed > 0 && changed > 0) {
    setStatusKey("cleanup.closedWithChanged", { closed, changed }, false, { mode: PANEL_MODE_ORGANIZE });
    return;
  }
  if (changed > 0) {
    setStatusKey("cleanup.changedSynced", { count: changed }, false, { mode: PANEL_MODE_ORGANIZE });
    return;
  }
  setStatusKey("cleanup.closed", { count: closed }, false, { mode: PANEL_MODE_ORGANIZE });
}

function swatchForIndex(index) {
  return ["var(--group-a)", "var(--group-b)", "var(--group-c)", "var(--group-d)", "var(--group-e)", "var(--group-f)"][
    index % 6
  ];
}

function renderDetails(payload) {
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify(payload, replacerForDetails, 2);
}

function renderError(error) {
  lastError = error instanceof Error ? error : new Error(String(error?.message || error || t("status.previousFailed")));
  lastPreview = null;
  lastCanApply = false;
  nodes.previewSection.hidden = false;
  setText(".preview .step-label", t("preview.error"));
  setText(".preview .section-heading h2", t("error.heading"));
  nodes.previewCount.textContent = t("preview.error");
  nodes.previewRoot.className = "error-panel";
  nodes.previewRoot.replaceChildren(errorPanelContent(lastError));
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify({ error: lastError.message, visibleError: visibleErrorMessage(lastError) }, replacerForDetails, 2);
  syncActionState();
}

function cleanupMetaChip(text) {
  const chip = document.createElement("span");
  chip.textContent = text;
  return chip;
}

function cleanupPriorityChip(priority) {
  const value = normalizeCleanupPriority(priority);
  const chip = cleanupMetaChip(t(`activity.priority.${value}`));
  chip.classList.add("cleanup-priority");
  chip.dataset.priority = value;
  return chip;
}

async function focusActivityTab(tab) {
  try {
    await sendMessage({ type: "activity:focusTab", tabId: tab.tabId, windowId: tab.windowId, languageMode: uiLanguage });
    setStatusKey("activity.focused", {}, false, { mode: PANEL_MODE_ORGANIZE });
  } catch (error) {
    setErrorStatus(error, t("activity.focusFailed"), { mode: PANEL_MODE_ORGANIZE });
  }
}

function resetToSetup() {
  lastPreview = null;
  lastError = null;
  previewResultView = "grouping";
  lastCanApply = false;
  nodes.previewSection.hidden = true;
  setText(".preview .step-label", t("preview.step"));
  setText(".preview .section-heading h2", t("preview.heading"));
  nodes.previewCount.textContent = t("preview.pending");
  nodes.previewRoot.className = "empty";
  nodes.previewRoot.textContent = t("preview.empty");
  nodes.detailsRoot.hidden = true;
  nodes.detailsText.textContent = "";
  syncActionState();
}

function errorPanelContent(error) {
  const wrapper = document.createElement("div");
  const message = document.createElement("strong");
  message.textContent = visibleErrorMessage(error);
  const hint = document.createElement("small");
  hint.textContent = t("error.retryHint");
  wrapper.append(message, hint);
  return wrapper;
}

function visibleErrorMessage(error) {
  const rawMessage = String(error?.message || error || "").trim();
  const message = friendlyErrorMessage(error);
  if (!message) return t("status.previousFailed");
  if (message !== rawMessage || isKnownProductMessage(message)) return redactVisibleErrorMessage(message);
  return t("status.previousFailed");
}

function isKnownProductMessage(message = "") {
  return UI_COPY_TEXT_VALUES.has(message) || isProductSafeGatewayMessage(message);
}

function redactVisibleErrorMessage(message = "") {
  return redactSensitiveText(message).replace(/https?:\/\/[^\s"')<>]+/gi, "[redacted-url]");
}

async function clearAnalysisState() {
  await sendMessage(scopedWindowMessage({ type: "tabs:clearAnalysisState" })).catch(() => null);
}

function replacerForDetails(key, value) {
  if (isSensitiveDetailKey(key)) return "";
  if (typeof value === "string") return redactDetailString(value);
  if (key === "inventory" && value?.tabs) {
    return {
      ...value,
      tabs: `${value.tabs.length} tab(s)`,
      plannerTabs: `${value.plannerTabs?.length || 0} planner tab(s)`,
      excludedTabs: `${value.excludedTabs?.length || 0} excluded tab(s)`
    };
  }
  return value;
}

function isSensitiveDetailKey(key) {
  return /(?:api[_-]?key|authorization|bearer|token|secret|password|cookie)/i.test(String(key || ""));
}

function redactDetailString(value) {
  return redactSensitiveText(value, { redactUrls: true });
}

function setBusy(isBusy, label = "", options = {}) {
  const mode = normalizePanelMode(options.mode || currentPanelMode);
  if (isBusy) {
    actionStateByMode[mode] = {
      busy: true,
      label: label || actionStateByMode[mode]?.label || "",
      progress: Number.isFinite(Number(options.progress)) ? Number(options.progress) : actionStateByMode[mode]?.progress || 8,
      cancelable: Boolean(options.cancelable),
      cancelDisabled: false
    };
    if (label) setStatus(label, false, { mode });
  } else {
    actionStateByMode[mode] = createIdleActionState();
  }
  syncActionState();
}

function setCancelDisabled(mode, disabled) {
  const normalized = normalizePanelMode(mode);
  actionStateByMode[normalized] = {
    ...(actionStateByMode[normalized] || createIdleActionState()),
    cancelDisabled: Boolean(disabled)
  };
  if (normalized === currentPanelMode) renderCurrentActionBusyState();
}

function renderCurrentActionBusyState() {
  const state = actionStateByMode[currentPanelMode] || createIdleActionState();
  const isBusy = Boolean(state.busy);
  nodes.analyzeBtn.disabled = isBusy || currentPrimaryActionNeedsGatewaySetup();
  nodes.undoBtn.disabled = isBusy;
  nodes.applyBtn.disabled = isBusy || !canApplyCurrentPreview();
  nodes.cancelBtn.hidden = !(isBusy && state.cancelable);
  nodes.cancelBtn.disabled = Boolean(state.cancelDisabled);
  nodes.actions.dataset.busy = isBusy ? "true" : "false";
  nodes.progressBar.hidden = !isBusy;
  if (nodes.clearLocalMemoryBtn) {
    nodes.clearLocalMemoryBtn.disabled = anyActionBusy();
  }
  showProgress(isBusy ? state.progress || 8 : 0);
  if (isBusy && state.label) {
    setProgressLabel(state.label);
    renderStatus();
  }
}

function currentPrimaryActionNeedsGatewaySetup() {
  if (currentPanelMode === PANEL_MODE_RECAP) {
    if (lastTimeRecap || lastTimeRecapError) return false;
  } else if (lastPreview || lastError) {
    return false;
  }
  return Boolean(missingGatewaySetupField());
}

async function hydrateActiveJob() {
  const job = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" })).catch(() => null);
  if (!job) return;
  if (isLiveJob(job)) {
    updateProgressFromJob(job, PANEL_MODE_ORGANIZE);
    setBusy(true, localizeKnownMessage(job.message || t("status.organizing")), { mode: PANEL_MODE_ORGANIZE, cancelable: true, progress: job.progress || 8 });
    startProgressPolling();
  } else if (job.status === "complete") {
    await restoreCompletedJob(job);
  } else if (job.status === "error" || job.status === "canceled") {
    restoreTerminalJob(job);
  }
}

async function hydrateUndoState() {
  const result = await sendMessage(scopedWindowMessage({ type: "tabs:canUndo" })).catch(() => null);
  canUndo = Boolean(result?.canUndo);
}

async function restoreCompletedJob(activeJob = {}) {
  stopProgressPolling();
  const job = await sendMessage(scopedWindowMessage({ type: "tabs:getLastJob" })).catch(() => null);
  if (!job?.preview) {
    const message = t("status.generatedButMissingPreview");
    setStatusKey("status.generatedButMissingPreview", {}, true, { mode: PANEL_MODE_ORGANIZE });
    renderError(new Error(message));
    setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
    return;
  }
  if (activeJob.operationId && job.operationId && activeJob.operationId !== job.operationId) {
    return;
  }

  lastPreview = job.preview;
  lastCanApply = Boolean(job.validation?.ok);
  renderPreview(job);
  renderDetails(job);
  nodes.applyBtn.disabled = !lastCanApply;
  setStatusKey(job.validation?.ok ? "status.planReady" : "status.planNeedsReview", {}, !job.validation?.ok, { mode: PANEL_MODE_ORGANIZE });
  setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
}

function restoreTerminalJob(job = {}) {
  stopProgressPolling();
  setBusy(false, "", { mode: PANEL_MODE_ORGANIZE });
  const isError = job.status === "error";
  const message = job.error || job.message || t(isError ? "status.previousFailed" : "status.previousCanceled");
  const error = new Error(message);
  setStatus(message, isError, { mode: PANEL_MODE_ORGANIZE });
  if (isError) renderError(error);
}

function startProgressPolling() {
  stopProgressPolling();
  pollActiveJob();
  progressPollTimer = setInterval(pollActiveJob, ACTIVE_JOB_POLL_MS);
}

function stopProgressPolling() {
  if (!progressPollTimer) return;
  clearInterval(progressPollTimer);
  progressPollTimer = null;
}

async function pollActiveJob() {
  if (progressPollInFlight) return;
  progressPollInFlight = true;
  try {
    const job = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" }));
    updateProgressFromJob(job, PANEL_MODE_ORGANIZE);
    if (job?.status === "complete") {
      await restoreCompletedJob(job);
    } else if (job?.status === "error" || job?.status === "canceled") {
      restoreTerminalJob(job);
    } else if (!isLiveJob(job)) {
      stopProgressPolling();
    }
  } catch (error) {
    if (!isTransientRuntimeMessageError(error)) {
      stopProgressPolling();
      setErrorStatus(error, friendlyErrorMessage(error), { mode: PANEL_MODE_ORGANIZE });
    }
  } finally {
    progressPollInFlight = false;
  }
}

async function waitForAnalysisCompletion(operationId) {
  let transientFailures = 0;
  while (true) {
    let activeJob;
    try {
      activeJob = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" }));
      transientFailures = 0;
    } catch (error) {
      if (!isTransientRuntimeMessageError(error) || transientFailures >= ACTIVE_JOB_POLL_MAX_FAILURES) throw error;
      transientFailures += 1;
      if (activeAnalyzeRunId && canceledAnalyzeRuns.has(activeAnalyzeRunId)) {
        throw new Error(t("status.canceled"));
      }
      await delay(ACTIVE_JOB_POLL_MS);
      continue;
    }
    updateProgressFromJob(activeJob, PANEL_MODE_ORGANIZE);

    if (!activeJob) {
      throw new Error(t("status.backgroundNotStarted"));
    }
    if (operationId && activeJob.operationId && activeJob.operationId !== operationId) {
      throw new Error(t("status.anotherJobRunning"));
    }
    if (activeJob.status === "complete") {
      const job = await sendMessage(scopedWindowMessage({ type: "tabs:getLastJob" }));
      if (!job?.preview) throw new Error(t("status.generatedButMissingPreview"));
      return job;
    }
    if (activeJob.status === "error" || activeJob.status === "canceled") {
      throw new Error(activeJob.message || t("status.notComplete"));
    }

    await delay(ACTIVE_JOB_POLL_MS);
  }
}

function isTransientRuntimeMessageError(error) {
  return /receiving end does not exist|message port closed|message channel closed|extension context invalidated|service worker/i.test(
    String(error?.message || error || "")
  );
}

function updateProgressFromJob(job, mode = PANEL_MODE_ORGANIZE) {
  if (!job) return;
  requestGeneratedProgressCopy(job);
  const normalized = normalizePanelMode(mode);
  const previous = actionStateByMode[normalized] || createIdleActionState();
  actionStateByMode[normalized] = {
    ...previous,
    busy: isLiveJob(job) || previous.busy,
    progress: typeof job.progress === "number" ? displayProgressForJob(job) : previous.progress,
    label: job.message ? displayMessageForJob(job) : previous.label,
    cancelable: isLiveJob(job) ? true : previous.cancelable,
    cancelDisabled: job.status === "canceling" ? true : previous.cancelDisabled
  };
  if (typeof job.progress === "number") {
    if (normalized === currentPanelMode) {
      nodes.progressBar.hidden = false;
      showProgress(displayProgressForJob(job));
    }
  }
  if (job.message) {
    const message = displayMessageForJob(job);
    setStatus(message, job.status === "error", { mode: normalized });
    if (normalized === currentPanelMode) setProgressLabel(message);
  }
  if (job.status === "canceling") setCancelDisabled(normalized, true);
  if (job.status === "canceled" || job.status === "error" || job.status === "complete") {
    actionStateByMode[normalized] = createIdleActionState();
    if (normalized === currentPanelMode) renderCurrentActionBusyState();
  }
}

function showProgress(value) {
  const progress = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  nodes.progressFill.style.width = `${progress}%`;
  nodes.progressPercent.textContent = `${Math.round(progress)}%`;
}

function setProgressLabel(text) {
  if (nodes.progressLabel) nodes.progressLabel.textContent = localizeKnownMessage(text);
}

function updateLocalProgress(label, progress, mode = currentPanelMode) {
  const normalized = normalizePanelMode(mode);
  const previous = actionStateByMode[normalized] || createIdleActionState();
  actionStateByMode[normalized] = {
    ...previous,
    busy: true,
    label,
    progress: Number.isFinite(Number(progress)) ? Number(progress) : previous.progress || 8
  };
  setStatus(label, false, { mode: normalized });
  if (normalized === currentPanelMode) {
    nodes.progressBar.hidden = false;
    showProgress(progress);
    setProgressLabel(label);
  }
}

function startRecapProgress(operationId, settings = {}) {
  startLocalAiWaitProgress({
    operationId,
    phase: "recapping",
    progress: 38,
    message: "正在生成近期回顾",
    settings
  });
}

function startLocalAiWaitProgress({ operationId, phase, progress, message, settings = {}, mode = PANEL_MODE_RECAP }) {
  stopRecapProgress();
  recapProgressJob = {
    operationId,
    status: "running",
    phase,
    progress,
    message,
    tabCount: 0,
    windowCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings
  };
  updateProgressFromJob(recapProgressJob, mode);
  recapProgressTimer = setInterval(() => {
    if (!recapProgressJob || activeRecapOperationId !== operationId) {
      stopRecapProgress(operationId);
      return;
    }
    updateProgressFromJob(recapProgressJob, mode);
  }, ACTIVE_JOB_POLL_MS);
}

function stopRecapProgress(operationId = null) {
  if (operationId && recapProgressJob?.operationId && recapProgressJob.operationId !== operationId) return;
  if (recapProgressTimer) {
    clearInterval(recapProgressTimer);
    recapProgressTimer = null;
  }
  recapProgressJob = null;
}

function currentProgressValue(mode = currentPanelMode) {
  const stateProgress = actionStateByMode[normalizePanelMode(mode)]?.progress;
  if (Number.isFinite(Number(stateProgress))) return Number(stateProgress);
  const rawWidth = nodes.progressFill?.style?.width || "";
  const value = Number.parseFloat(rawWidth);
  return Number.isFinite(value) ? value : 0;
}

function displayProgressForJob(job) {
  const baseProgress = clampProgress(job.progress);
  if (!isLiveAiWait(job)) return baseProgress;

  const cap = optimisticProgressCap(job, baseProgress);
  const elapsedMs = elapsedSinceJobUpdate(job);
  const ramp = 1 - Math.exp(-elapsedMs / AI_WAIT_RAMP_MS);
  return Math.max(baseProgress, Math.min(cap, Math.round(baseProgress + (cap - baseProgress) * ramp)));
}

function displayMessageForJob(job) {
  if (!isLiveAiWait(job)) return job.message;
  const elapsedSeconds = Math.floor(elapsedSinceJobUpdate(job) / 1000);
  if (elapsedSeconds < 3) return localizeKnownMessage(job.message);
  return `${aiWaitCopy(job, elapsedSeconds)} · ${formatElapsedSeconds(elapsedSeconds)}`;
}

function optimisticProgressCap(job, baseProgress) {
  if (job.phase === "coarse_planning") return Math.max(baseProgress, 54);
  if (job.phase === "refining") return Math.max(baseProgress, Math.min(85, baseProgress + 12));
  if (job.phase === "retrying") return Math.max(baseProgress, 93);
  if (job.phase === "recapping") return Math.max(baseProgress, 88);
  return Math.max(baseProgress, 80);
}

function elapsedSinceJobUpdate(job) {
  const startedAt = Date.parse(job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function clampProgress(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

function isLiveAiWait(job) {
  return isLiveJob(job) && AI_WAIT_PHASES.has(job.phase);
}

function aiWaitCopy(job, elapsedSeconds) {
  const copies = generatedProgressCopyForJob(job) || t(`aiWait.${job.phase}`) || t("aiWait.planning");
  const index = Math.floor(elapsedSeconds / AI_WAIT_COPY_INTERVAL_SECONDS) % copies.length;
  return copies[index];
}

function requestGeneratedProgressCopy(job) {
  if (!isLiveAiWait(job)) return;
  const operationId = progressCopyOperationId(job);
  if (generatedCopyByOperation.has(operationId) || generatedCopyRequests.has(operationId)) return;

  generatedCopyRequests.add(operationId);
  sendMessage(scopedWindowMessage({
    type: "progressCopy:generate",
    operationId,
    phase: job.phase,
    tabCount: job.tabCount || 0,
    windowCount: job.windowCount || 0,
    languageMode: uiLanguage
  }))
    .then((result) => {
      const messages = Array.isArray(result?.messages) ? result.messages.filter(Boolean) : [];
      if (messages.length) rememberGeneratedProgressCopy(operationId, messages);
    })
    .catch(() => {})
    .finally(() => {
      generatedCopyRequests.delete(operationId);
    });
}

function generatedProgressCopyForJob(job) {
  return generatedCopyByOperation.get(progressCopyOperationId(job)) || null;
}

function progressCopyOperationId(job) {
  return job.operationId || `${job.phase || "planning"}:${job.createdAt || ""}`;
}

function scopedWindowMessage(message) {
  return Number.isInteger(panelWindowId) ? { ...message, windowId: panelWindowId } : message;
}

function rememberGeneratedProgressCopy(operationId, messages) {
  if (!generatedCopyByOperation.has(operationId) && generatedCopyByOperation.size >= GENERATED_COPY_CACHE_LIMIT) {
    const oldestKey = generatedCopyByOperation.keys().next().value;
    generatedCopyByOperation.delete(oldestKey);
  }
  generatedCopyByOperation.set(operationId, messages);
}

function formatElapsedSeconds(totalSeconds) {
  if (totalSeconds < 60) return uiLanguage === "en-US" ? `${totalSeconds}s` : `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (uiLanguage === "en-US") return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return seconds ? `${minutes}分${seconds}秒` : `${minutes}分`;
}

function formatAgo(ms) {
  const days = Math.max(0, Math.floor(Number(ms || 0) / (24 * 60 * 60 * 1000)));
  if (days >= 1) return uiLanguage === "en-US" ? `${days}d ago` : `约 ${days} 天前`;
  const hours = Math.max(1, Math.floor(Number(ms || 0) / (60 * 60 * 1000)));
  return uiLanguage === "en-US" ? `${hours}h ago` : `约 ${hours} 小时前`;
}

function isLiveJob(job) {
  return job?.status === "running" || job?.status === "canceling";
}

function setStatusKey(key, params = {}, isError = false, options = {}) {
  const mode = normalizePanelMode(options.mode || currentPanelMode);
  statusByMode[mode] = createStatusState(key, params, "", isError);
  if (mode === currentPanelMode) renderStatus();
}

function setStatus(text, isError = false, options = {}) {
  const mode = normalizePanelMode(options.mode || currentPanelMode);
  statusByMode[mode] = createStatusState("", {}, String(text || ""), isError);
  if (mode === currentPanelMode) renderStatus();
}

function setErrorStatus(error, fallback = "", options = {}) {
  setStatus(fallback || friendlyErrorMessage(error) || t("status.previousFailed"), true, options);
}

function renderStatus() {
  const status = statusByMode[currentPanelMode] || statusByMode[PANEL_MODE_ORGANIZE] || createStatusState("status.default");
  const text = status.key
    ? t(status.key, status.params)
    : status.isError
      ? visibleErrorMessage(new Error(status.text))
      : localizeKnownMessage(status.text);
  nodes.statusText.textContent = text;
  nodes.statusText.dataset.tone = status.isError ? "error" : "";
}

function localizeKnownMessage(message = "") {
  const text = String(message || "");
  if (uiLanguage !== "en-US") return text;

  const exact = new Map([
    ["正在准备整理", t("status.preparing")],
    ["正在保存偏好", "Saving preferences"],
    ["正在读取标签页", "Reading tabs"],
    ["正在生成 AI 方案", "Building AI plan"],
    ["正在生成预览", "Preparing preview"],
    ["方案好了，可以先检查", t("status.planReady")],
    ["方案需要检查", t("status.planNeedsReview")],
    ["已取消整理。", t("status.canceled")],
    ["已停止生成。", t("status.canceled")],
    ["后台任务已停止，请重新生成。", t("status.previousFailed")],
    ["正在校验 AI 方案", "Checking AI plan"],
    ["方案未通过校验，正在要求 AI 修正", "Asking AI to fix the plan"],
    ["正在校验修正方案", "Checking the revised plan"],
    ["页面摘要已关闭", "Page summaries are off"],
    ["没有需要补充页面线索", "No extra page clues needed"],
    ["正在补充页面线索", "Adding page clues"],
    ["使用已缓存页面线索", "Using cached page clues"],
    ["已补充部分页面线索", "Added some page clues"],
    ["继续参考标题、网址和原始顺序", "Continuing with titles, URLs, and tab order"],
    ["正在请求 AI 规划", "Asking AI to plan"],
    ["AI 已返回，正在解析方案", "AI returned a plan; parsing it"],
    ["正在快速粗分标签页", "Quickly grouping tabs"],
    ["正在细分不确定标签页", "Refining uncertain tabs"],
    ["不确定标签页已细分", "Uncertain tabs refined"],
    ["正在合并精分结果", "Merging refined results"],
    ["正在取消整理", t("status.canceling")],
    ["正在停止生成", t("status.canceling")],
    ["正在准备回顾", t("status.recapPreparing")],
    ["正在生成近期回顾", t("status.recapGenerating")],
    ["正在停止生成回顾", t("status.recapCanceling")],
    ["回顾已生成", t("status.recapReady")],
    ["已停止生成回顾。", t("status.recapCanceled")]
  ]);
  if (exact.has(text)) return exact.get(text);

  let match = text.match(/^已读取 (\d+) 个可整理标签页$/);
  if (match) return `Read ${match[1]} tabs to organize`;
  match = text.match(/^使用已缓存页面摘要 (\d+) 个$/);
  if (match) return `Using ${match[1]} cached page summaries`;
  match = text.match(/^正在补充页面线索，已补充 (\d+) 个$/);
  if (match) return `Adding page clues, ${match[1]} added`;
  match = text.match(/^已补充 (\d+) 个页面摘要$/);
  if (match) return `Added ${match[1]} page summaries`;
  match = text.match(/^已找到 (\d+) 个主题方向$/);
  if (match) return `Found ${match[1]} topic lanes`;
  match = text.match(/^正在精分「(.+)」$/);
  if (match) return `Refining "${match[1]}"`;
  match = text.match(/^已精分「(.+)」$/);
  if (match) return `Refined "${match[1]}"`;
  return text;
}

function syncChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;
    group.querySelectorAll("button[data-value]").forEach((button) => {
      const selected = button.dataset.value === field.value;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
}

function syncActionState() {
  nodes.appShell.dataset.flowState = lastPreview || lastError ? "preview" : "setup";
  if (currentPanelMode === "recap") {
    configureRecapActions();
    renderCurrentActionBusyState();
    return;
  }

  configureOrganizeActions();
  renderCurrentActionBusyState();
}

function configureRecapActions() {
  nodes.actions.dataset.state = "recap";
  nodes.actions.dataset.canUndo = "false";
  nodes.appShell.dataset.recapState = lastTimeRecap ? "ready" : lastTimeRecapError ? "error" : "idle";
  nodes.applyBtn.hidden = true;
  nodes.undoBtn.hidden = true;
  nodes.applyBtn.dataset.role = "";
  nodes.analyzeBtn.dataset.role = "primary";
  setButtonLabel(nodes.analyzeBtn, t(lastTimeRecap || lastTimeRecapError ? "recap.regenerate" : "recap.generate"));
  setButtonLabel(nodes.cancelBtn, t("button.cancel"));
}

function configureOrganizeActions() {
  nodes.actions.dataset.state = lastPreview ? "preview" : lastError ? "error" : "idle";
  nodes.actions.dataset.canUndo = canUndo ? "true" : "false";
  nodes.appShell.dataset.recapState = "";
  nodes.applyBtn.hidden = !lastPreview || lastPreview.analysisFeatures?.grouping === false;
  nodes.undoBtn.hidden = !canUndo;
  nodes.analyzeBtn.dataset.role = "";
  setButtonLabel(nodes.analyzeBtn, t(lastPreview ? "button.regenerate" : lastError ? "button.backToSettings" : "button.generate"));
  setButtonLabel(nodes.cancelBtn, t("button.cancel"));
  nodes.applyBtn.dataset.role = canApplyCurrentPreview() ? "primary" : "";
}

function canApplyCurrentPreview() {
  return Boolean(lastPreview && lastCanApply && lastPreview.analysisFeatures?.grouping !== false);
}

function setButtonLabel(button, text) {
  const label = button.querySelector(".button-label");
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
}

async function ensurePlannerHostPermission(settings) {
  if (settings.plannerProvider !== "gateway") return;
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  const pattern = providerPermissionPattern(settings.gatewayBaseUrl);
  if (!pattern) return;

  const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
  if (hasPermission) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error(t("status.permissionAiGateway"));
  }
}

async function ensureContinuousSummaryPermissions() {
  if (!hasContentAccessFeature()) {
    throw new Error(t("status.unsupportedContinuousSummary"));
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  await requireOptionalPermission(
    {
      permissions: ["scripting"],
      origins: continuousSummaryOrigins()
    },
    t("status.permissionContinuousSummary")
  );
}

function continuousSummaryOrigins() {
  const optionalOrigins = globalThis.chrome?.runtime?.getManifest?.().optional_host_permissions || [];
  const broadOrigins = optionalOrigins.filter((origin) => origin === "https://*/*" || origin === "http://*/*");
  return broadOrigins.length ? broadOrigins : ["https://*/*", "http://*/*"];
}

async function ensurePageSamplingPermissions(settings, options = {}) {
  if (settings.pageContextMode === "off" || settings.pageSamplingConsentMode === "not_acknowledged") return;
  if (!hasContentAccessFeature()) {
    throw new Error(t("status.unsupportedPageSummary"));
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;
  const requestMissing = Boolean(options.requestMissing);

  const shouldRequestHostOrigins =
    settings.pageContextMode !== "active_tab_only" && settings.hostPermissionRequestMode !== "never";
  if (shouldRequestHostOrigins && !pageSamplingOriginCache.origins.length) {
    await refreshPageSamplingOriginCache();
  }
  const origins = shouldRequestHostOrigins ? pageSamplingOriginCache.origins : [];
  const missingPermissions = [];
  const hasScripting = await chrome.permissions.contains({ permissions: ["scripting"] });
  if (!hasScripting) missingPermissions.push("scripting");
  const missingOrigins = await getMissingOrigins(origins);

  if (!requestMissing) {
    if (missingPermissions.length) {
      throw new Error(t("status.permissionFirstEnablePageSummary"));
    }
    return;
  }

  if (settings.hostPermissionRequestMode === "ask_per_origin" && missingOrigins.length > 1) {
    const [firstOrigin, ...remainingOrigins] = missingOrigins;
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: firstOrigin ? [firstOrigin] : []
      },
      t("status.permissionPageSummary")
    );
    for (const origin of remainingOrigins) {
      await requireOptionalPermission({ origins: [origin] }, t("status.permissionPageSummary"));
    }
    return;
  }

  if (missingPermissions.length || missingOrigins.length) {
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: missingOrigins
      },
      t("status.permissionPageSummary")
    );
  }
}

function schedulePageSamplingOriginRefresh() {
  clearTimeout(pageSamplingOriginRefreshTimer);
  pageSamplingOriginRefreshTimer = setTimeout(() => {
    refreshPageSamplingOriginCache().catch(() => {
      pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
      globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    });
  }, 50);
}

function hasContentAccessFeature() {
  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  if (!manifest) return true;
  return Boolean(
    (manifest.optional_permissions || []).includes("scripting") &&
      (manifest.optional_host_permissions || []).some((origin) => origin === "https://*/*" || origin === "http://*/*")
  );
}

async function refreshPageSamplingOriginCache() {
  if (!hasContentAccessFeature()) {
    pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
    globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    return;
  }
  const settings = readSettings({ effectiveForAnalysis: true });
  const shouldCollect =
    settings.pageContextMode !== "off" &&
    settings.pageSamplingConsentMode !== "not_acknowledged" &&
    settings.pageContextMode !== "active_tab_only" &&
    settings.hostPermissionRequestMode !== "never";
  const windowId = shouldCollect ? await resolveInvocationWindowId() : null;
  const origins = shouldCollect ? await collectPageSamplingOrigins(settings, windowId) : [];
  pageSamplingOriginCache = { origins, refreshedAt: Date.now() };
  globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
}

async function getMissingOrigins(origins) {
  const missing = [];
  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) missing.push(origin);
  }
  return missing;
}

async function requestOptionalPermission(request) {
  const permissionRequest = compactPermissionRequest(request);
  if (!permissionRequest) return true;

  const hasPermission = await chrome.permissions.contains(permissionRequest);
  if (hasPermission) return true;
  return chrome.permissions.request(permissionRequest);
}

async function requireOptionalPermission(request, errorMessage) {
  const granted = await requestOptionalPermission(request);
  if (!granted) {
    throw new Error(errorMessage || t("status.permissionPageSummary"));
  }
}

function compactPermissionRequest(request = {}) {
  const permissions = request.permissions?.filter(Boolean) || [];
  const origins = request.origins?.filter(Boolean) || [];
  if (!permissions.length && !origins.length) return null;
  return {
    ...(permissions.length ? { permissions } : {}),
    ...(origins.length ? { origins } : {})
  };
}

async function collectPageSamplingOrigins(settings, windowId) {
  const tabs = await collectVisibleTabs(settings, windowId);
  return [
    ...new Set(
      tabs
        .filter((tab) => isEligibleForPageSampling(tab, settings))
        .filter((tab) => settings.pageContextMode !== "ambiguous_with_permission" || isAmbiguousTab(tab))
        .map((tab) => hostPermissionPattern(tab.url || tab.pendingUrl || ""))
        .filter(Boolean)
    )
  ];
}

async function collectVisibleTabs(settings, windowId) {
  if (!globalThis.chrome?.windows) return [];
  if (settings.organizeMode === "consolidate_one_window") {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows.flatMap((window) => window.tabs || []);
  }

  const targetWindow =
    Number.isInteger(windowId)
      ? await chrome.windows.get(windowId, { populate: true })
      : await chrome.windows.getCurrent({ populate: true });
  return targetWindow?.tabs || [];
}

function isEligibleForPageSampling(tab, settings) {
  if (!tab || typeof tab.id !== "number") return false;
  if (tab.pinned && !settings.includePinnedTabs) return false;
  if (tab.incognito && !settings.includeIncognitoTabs) return false;
  return Boolean(hostPermissionPattern(tab.url || tab.pendingUrl || ""));
}

function isAmbiguousTab(tab) {
  const title = String(tab.title || "").trim().toLowerCase();
  return !title || title.length < 18 || ["home", "new tab", "untitled", "login", "sign in"].some((term) => title.includes(term));
}

function providerPermissionPattern(baseUrl) {
  return hostPermissionPattern(baseUrl);
}

function hostPermissionPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function sendMessage(message) {
  const payload = shouldAttachWindowId(message) && !Number.isInteger(message?.windowId) && Number.isInteger(panelWindowId)
    ? { ...message, windowId: panelWindowId }
    : message;
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return mockMessage(payload);
  }

  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.result;
}

function shouldAttachWindowId(message) {
  if (!message?.type) return false;
  return message.type.startsWith("tabs:") || message.type.startsWith("activity:") || message.type === "progressCopy:generate";
}

async function resolveInvocationWindowId() {
  const sourceWindowId = sourceWindowIdFromUrl();
  if (Number.isInteger(sourceWindowId)) {
    if (!globalThis.chrome?.windows?.get) return sourceWindowId;
    const sourceWindow = await chrome.windows.get(sourceWindowId).catch(() => null);
    if (sourceWindow?.type === "normal") return sourceWindowId;
  }

  const activeTabWindowId = await lastFocusedActiveTabWindowId();
  if (Number.isInteger(activeTabWindowId)) return activeTabWindowId;

  if (!globalThis.chrome?.windows?.getCurrent) return null;
  try {
    if (globalThis.chrome?.windows?.getLastFocused) {
      const focusedNormalWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (Number.isInteger(focusedNormalWindow?.id)) return focusedNormalWindow.id;
    }
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow?.id ?? null;
  } catch {
    return null;
  }
}

async function lastFocusedActiveTabWindowId() {
  if (!globalThis.chrome?.tabs?.query) return null;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!Number.isInteger(activeTab?.windowId)) return null;
  if (!globalThis.chrome?.windows?.get) return activeTab.windowId;

  const window = await chrome.windows.get(activeTab.windowId).catch(() => null);
  return window?.type === "normal" ? activeTab.windowId : null;
}

function sourceWindowIdFromUrl() {
  try {
    const rawSourceWindowId = new URL(globalThis.location.href).searchParams.get("sourceWindowId");
    if (!rawSourceWindowId) return null;

    const sourceWindowId = Number(rawSourceWindowId);
    return Number.isInteger(sourceWindowId) && sourceWindowId > 0 ? sourceWindowId : null;
  } catch {
    return null;
  }
}

async function mockMessage(message) {
  if (message.type === "settings:get") {
    return {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      analyzeGrouping: true,
      analyzeCleanup: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
      promptPreset: "conservative",
      groupingGranularity: "balanced",
      plannerProvider: "gateway",
      gatewayProviderMode: "custom",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "custom",
      gatewayAuxiliaryModel: "same_as_primary",
      gatewayCustomModel: "",
      gatewayCustomAuxiliaryModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
  }
  if (message.type === "settings:save") {
    return message.settings || {};
  }
  if (message.type === "tabs:startAnalyze") {
    mockLastJob = mockAnalysisJob(message.settings || {});
    mockActiveJob = {
      operationId: "mock_job",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    return { operationId: mockActiveJob.operationId };
  }
  if (message.type === "tabs:analyze") {
    return mockAnalysisJob(message.settings || {});
  }
  if (message.type === "tabs:getLastJob") return mockLastJob || mockAnalysisJob();
  if (message.type === "tabs:closeCleanupCandidates") {
    const ids = uniqueNumbers(message.tabIds || []);
    const job = mockLastJob || mockAnalysisJob();
    job.preview.cleanup.candidates = (job.preview.cleanup.candidates || []).filter((candidate) => !ids.includes(candidate.tabId));
    job.preview.cleanup.candidateCount = job.preview.cleanup.candidates.length;
    mockLastJob = job;
    return { closedTabIds: ids, skippedTabIds: [], preview: job.preview, validation: job.validation };
  }
  if (message.type === "tabs:applyLastPlan") return { createdGroupIds: [1, 2] };
  if (message.type === "tabs:undoLastApply") return { restoredTabs: 20 };
  if (message.type === "tabs:getActiveJob") return mockActiveJob;
  if (message.type === "tabs:canUndo") return { canUndo };
  if (message.type === "tabs:clearAnalysisState") {
    mockActiveJob = null;
    mockLastJob = null;
    return { cleared: true };
  }
  if (message.type === "tabs:cancelActiveJob") return { canceled: false, job: mockActiveJob };
  if (message.type === "gateway:testConnection") {
    const primaryModel = message.settings?.gatewayCustomModel || message.settings?.gatewayModel || DEFAULT_SETTINGS.gatewayModel;
    const rawAuxiliaryModel = message.settings?.gatewayCustomAuxiliaryModel || message.settings?.gatewayAuxiliaryModel || "";
    const auxiliaryModel = rawAuxiliaryModel === "same_as_primary" ? primaryModel : rawAuxiliaryModel;
    return {
      ok: true,
      status: 200,
      model: primaryModel,
      auxiliaryModel,
      baseUrl: message.settings?.gatewayBaseUrl || ""
    };
  }
  if (message.type === "gateway:listModels") {
    return {
      models: ["glm-5.2", "kimi-k3", "deepseek-v4-pro", "deepseek-v4-flash"],
      baseUrl: message.settings?.gatewayBaseUrl || ""
    };
  }
  if (message.type === "activity:focusTab") {
    if (globalThis.__mockFailNextFocusTab) {
      globalThis.__mockFailNextFocusTab = false;
      throw new Error(`No tab with id ${message.tabId}`);
    }
    return { focused: true, tabId: message.tabId, windowId: message.windowId };
  }
  if (message.type === "activity:clearLocalMemory") return { cleared: true, removedCount: 3 };
  if (message.type === "activity:cancelTimeRecap") return { canceled: true, operationId: message.operationId || "mock_recap" };
  if (message.type === "activity:generateTimeRecap") {
    return mockTimeRecap();
  }
  if (message.type === "activity:getOverview") {
    const overview = {
      rangeMs: message.rangeMs || 604800000,
      generatedAt: new Date().toISOString(),
      cache: { entries: 18, sampledEntries: 7 },
      openTabs: { total: 24, tracked: 18, staleCandidates: 2 },
      recap: {
        entries: 18,
        sampledEntries: 7,
        topHosts: [
          { value: "github.com", count: 5 },
          { value: "developer.chrome.com", count: 3 }
        ],
        topTerms: [
          { value: "extensions", count: 4 },
          { value: "tabs", count: 3 },
          { value: "agent", count: 2 }
        ],
        recentPages: [
          { title: "Chrome extensions API", hostname: "developer.chrome.com", seenCount: 3, hasSummary: true },
          { title: "Current project issues", hostname: "github.com", seenCount: 2, hasSummary: false }
        ]
      },
      staleTabs: [
        {
          tabId: 31,
          windowId: 1,
          title: "旧方案对比笔记",
          hostname: "yuque.com",
          currentGroupTitle: "技术调研",
          ageMs: 16 * 24 * 60 * 60 * 1000,
          idleMs: 9 * 24 * 60 * 60 * 1000,
          activeCount: 1,
          summary: { metaDescription: "Comparison notes for an earlier investigation", headings: ["Old direction"] }
        },
        {
          tabId: 32,
          windowId: 1,
          title: "上轮调研资料",
          hostname: "docs.qq.com",
          currentGroupTitle: "",
          ageMs: 22 * 24 * 60 * 60 * 1000,
          idleMs: 18 * 24 * 60 * 60 * 1000,
          activeCount: 0
        }
      ]
    };
    if (message.type === "activity:getOverview") return overview;
    return {
      overview,
      cleanup: {
        summary: "这 2 个标签页看起来更像旧任务遗留，可以先从它们开始。",
        candidates: [
          {
            tabId: 31,
            windowId: 1,
            title: "旧方案对比笔记",
            hostname: "yuque.com",
            currentGroupTitle: "技术调研",
            ageMs: 16 * 24 * 60 * 60 * 1000,
            idleMs: 9 * 24 * 60 * 60 * 1000,
            activeCount: 1,
            priority: "high",
            reason: "它像是上一轮对比调研留下的页面，时间较久且近期没有再打开。",
            evidence: ["首次见到约 16 天前", "最近活跃约 9 天前", "当前分组 技术调研"],
            summary: { metaDescription: "Comparison notes for an earlier investigation", headings: ["Old direction"] }
          },
          {
            tabId: 32,
            windowId: 1,
            title: "上轮调研资料",
            hostname: "docs.qq.com",
            currentGroupTitle: "",
            ageMs: 22 * 24 * 60 * 60 * 1000,
            idleMs: 18 * 24 * 60 * 60 * 1000,
            activeCount: 0,
            priority: "medium",
            reason: "标题显示是旧研究资料，且没有归属到当前分组。",
            evidence: ["未分组", "长期未活跃"]
          }
        ]
      }
    };
  }
  throw new Error(`Mock does not implement ${message.type}`);
}

function mockTimeRecap() {
  const now = new Date();
  return {
    source: "ai",
    input: {
      schema: "tab_recap_time_recap_input_v1",
      range: { preset: "7d", from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() },
      coverage: { includedPages: 18, sampledEntries: 7, currentOpenTabs: 24 },
      pages: [
        { id: 1, tabId: 31, windowId: 1, title: "Chrome extensions side panel docs", hostname: "developer.chrome.com", open: true },
        { id: 2, tabId: 32, windowId: 1, title: "TabRecap release checklist", hostname: "github.com", open: true },
        { id: 3, tabId: 33, windowId: 1, title: "AI planner benchmark notes", hostname: "github.com", open: true }
      ]
    },
    recap: {
      schema: "tab_recap_time_recap_v1",
      language: uiLanguage,
      headline: uiLanguage === "en-US" ? "Recent work centered on extension polish and planner evaluation." : "最近主要在打磨扩展体验和验证 AI 整理策略。",
      summary:
        uiLanguage === "en-US"
          ? "The active thread is productizing TabRecap: side panel behavior, release readiness, and planner benchmark evidence."
          : "主线是把 TabRecap 做成可发布产品：侧边栏体验、发布检查和整理策略的基准对比。",
      themes: [
        {
          title: uiLanguage === "en-US" ? "Extension product polish" : "扩展产品打磨",
          description: uiLanguage === "en-US" ? "Side panel UX, permissions, and release copy are being refined together." : "侧边栏交互、权限说明和发布文案在一起收敛。",
          confidence: "high",
          pageIds: [1, 2],
          evidence: ["side panel", "release"]
        },
        {
          title: uiLanguage === "en-US" ? "Planner benchmarks" : "整理策略验证",
          description: uiLanguage === "en-US" ? "Benchmark notes compare model routing and large-tab performance." : "基准记录在对比模型路由和大规模标签页耗时。",
          confidence: "medium",
          pageIds: [3],
          evidence: ["benchmark"]
        }
      ],
      timeline: [
        {
          label: uiLanguage === "en-US" ? "This week" : "这一周",
          description: uiLanguage === "en-US" ? "Most activity points to release cleanup and side panel iteration." : "活动主要集中在发布收口和侧边栏迭代。",
          pageIds: [1, 2, 3]
        }
      ],
      coverageNote: uiLanguage === "en-US" ? "Used local activity plus available summaries." : "已结合本机活动和可用摘要。"
    }
  };
}

function mockAnalysisJob(settings = {}) {
  const grouping = settings.analyzeGrouping !== false;
  const cleanup = settings.analyzeCleanup !== false;
  return {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: grouping ? [
          { title: "AI 研究", reason: "模型、论文和文档", tabCount: 12 },
          { title: "当前项目", reason: "Issue、PR 和本地应用", tabCount: 8 }
        ] : [],
        totalTabsCount: 24,
        eligibleTabsCount: 23,
        windowCount: 1,
        groupedTabsCount: grouping ? 20 : 0,
        reviewTabsCount: grouping ? 3 : 23,
        reviewGroupWillBeCreated: grouping,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
        pageSampling: {
          requested: 3,
          ok: 2,
          permissionRequired: 1,
          blocked: 0
        },
        cleanup: cleanup ? mockCleanupPreview(grouping) : null,
        analysisFeatures: {
          grouping,
          cleanup
        },
        warnings: []
      }
  };
}

function mockCleanupPreview(grouping = true) {
  return {
    summary: grouping ? "本地已缓存，AI 找到 2 个可能是旧任务遗留的标签页，你可以先检查。" : "本次按要求不自动分组，优先检查这些低价值或已完成页面。",
    candidateCount: 3,
    candidates: [
      {
        tabId: 31,
        windowId: 1,
        title: "旧方案对比笔记",
        hostname: "yuque.com",
        currentGroupTitle: "技术调研",
        ageMs: 16 * 24 * 60 * 60 * 1000,
        idleMs: 9 * 24 * 60 * 60 * 1000,
        activeCount: 1,
        priority: "high",
        reason: "该标签页已暂存，上一轮对比调研留下的页面，近期没有再打开。",
        evidence: ["旧任务线索", "标签页已暂存", "已暂存 7 天", "page was cached locally", "浏览器缓存策略文档"]
      },
      {
        tabId: 32,
        windowId: 1,
        title: "上轮调研资料",
        hostname: "docs.qq.com",
        ageMs: 22 * 24 * 60 * 60 * 1000,
        idleMs: 18 * 24 * 60 * 60 * 1000,
        activeCount: 0,
        priority: "medium",
        reason: "activationFlow 显示 nearbyIds 很近，returnedToCount=0，dwellSeconds 很短。",
        evidence: [
          "transitionCount=2",
          "dwellSeconds=45",
          "page_id 32",
          "tab_ids [31,32]",
          "sample_able false",
          "标题为“上轮调研资料”"
        ]
      },
      {
        tabId: 33,
        windowId: 1,
        title: "临时浏览入口",
        hostname: "example.com",
        ageMs: 4 * 24 * 60 * 60 * 1000,
        idleMs: 2 * 24 * 60 * 60 * 1000,
        activeCount: 2,
        priority: "low",
        reason: "和当前任务关系不强，但没有足够证据建议优先清理。",
        evidence: ["最后确认是否还需要"]
      }
    ]
  };
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
