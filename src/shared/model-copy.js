import { localizedText } from "./language.js";

export const MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING =
  "Do not expose raw implementation field names or variants such as activeCount, active_count, active-count, tabId, tabIds, tab_id, tab_ids, pageId, page_ids, windowId, sequenceIndex, sequence_index, ageDays, idleDays, sampleable, currentGroupTitle, hostname, cache, lifecycle, activationFlow, totalActiveSeconds, maxActiveSeconds, appearedInRuns, returnedToCount, nearbyIds, returnToId, repeatedIds, dwellSeconds, activeSeconds, avgDwellSeconds, transitionCount, fromId, toId, startedAt, endedAt, lastAt, ids, strength, count, or clues in user-facing copy.";

const IDENTITY_FIELD_PATTERN =
  /\b(?:tab(?:Ids?|[_\s-]?ids?)|page(?:Ids?|[_\s-]?ids?)|window(?:Ids?|[_\s-]?ids?)|sequence(?:Index(?:es)?|Indices|[_\s-]?index(?:es)?|[_\s-]?indices))\s*(?:为|=|is|:)?\s*(?:\[[^\]]*\]|["'#]?[A-Za-z0-9_.-]+(?:\s*,\s*["'#]?[A-Za-z0-9_.-]+)*)?/gi;
const IDENTITY_FIELD_NAME_PATTERN =
  /\b(?:tab(?:Ids?|[_\s-]?ids?)|page(?:Ids?|[_\s-]?ids?)|window(?:Ids?|[_\s-]?ids?)|sequence(?:Index(?:es)?|Indices|[_\s-]?index(?:es)?|[_\s-]?indices))\b/gi;

const INTERNAL_ID_VALUE = "(?:\\[[^\\]]*\\]|[\"'#]?\\d+(?:\\s*,\\s*[\"'#]?\\d+)*)";
const INTERNAL_TIMESTAMP_VALUE = "(?:[\"']?\\d{4}-\\d{2}-\\d{2}(?:[T ][0-9:.+-]+Z?)?[\"']?)";
const FIELD_VALUE_SEPARATOR = "\\s*(?:为|=|is|:)?\\s*";
const INTERNAL_ID_FIELD_VALUE_PATTERNS = {
  ids: new RegExp(`\\bids${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  nearbyIds: new RegExp(`\\bnearby(?:Ids|[_\\s-]?ids?)${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  returnToId: new RegExp(`\\breturn(?:ToId|[_\\s-]?to(?:[_\\s-]?id)?)${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  repeatedIds: new RegExp(`\\brepeated(?:Ids|[_\\s-]?ids?)${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  fromId: new RegExp(`\\bfrom(?:Id|[_\\s-]?id)${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  toId: new RegExp(`\\bto(?:Id|[_\\s-]?id)${FIELD_VALUE_SEPARATOR}${INTERNAL_ID_VALUE}`, "gi"),
  startedAt: new RegExp(`\\bstarted(?:At|[_\\s-]?at)${FIELD_VALUE_SEPARATOR}${INTERNAL_TIMESTAMP_VALUE}`, "gi"),
  endedAt: new RegExp(`\\bended(?:At|[_\\s-]?at)${FIELD_VALUE_SEPARATOR}${INTERNAL_TIMESTAMP_VALUE}`, "gi"),
  lastAt: new RegExp(`\\blast(?:At|[_\\s-]?at)${FIELD_VALUE_SEPARATOR}${INTERNAL_TIMESTAMP_VALUE}`, "gi")
};
const INTERNAL_SIGNAL_FIELD_VALUE_PATTERNS = {
  strength: /\bstrength\s*(?:为|=|is|:)?\s*(?:0(?:\.\d+)?|1(?:\.0+)?|\d+(?:\.\d+)?%?)\b/gi,
  count: /\bcount\s*(?:为|=|is|:)?\s*\d+(?:\.\d+)?\b/gi,
  clues: /\bclues?\s*(?:为|=|is|:)?\s*(?:是\s*)?(?:\[[^\]]*\]|[^,.;，。；]+)/gi
};

const NUMERIC_FIELD_VALUE_PATTERNS = {
  transitionCount: /\btransition(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  appearedInRuns: /\bappeared(?:InRuns|[_\s-]?in[_\s-]?runs?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  totalActiveSeconds: /\btotal(?:ActiveSeconds|[_\s-]?active[_\s-]?seconds?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  maxActiveSeconds: /\bmax(?:ActiveSeconds|[_\s-]?active[_\s-]?seconds?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  avgDwellSeconds: /\bavg(?:DwellSeconds|[_\s-]?dwell[_\s-]?seconds?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  activeSeconds: /\bactive(?:Seconds|[_\s-]?seconds?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi,
  dwellSeconds: /\bdwell(?:Seconds|[_\s-]?seconds?)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi
};

const FIELD_NAME_PATTERNS = {
  activeCount: /\bactive(?:Count|[_\s-]?count)\b/gi,
  seenCount: /\bseen(?:Count|[_\s-]?count)\b/gi,
  ageDays: /\bage(?:Days|[_\s-]?days?)\b/gi,
  idleDays: /\bidle(?:Days|[_\s-]?days?)\b/gi,
  firstSeenAt: /\bfirst(?:SeenAt|[_\s-]?seen(?:[_\s-]?at)?)\b/gi,
  lastSeenAt: /\blast(?:SeenAt|[_\s-]?seen(?:[_\s-]?at)?)\b/gi,
  lastActivatedAt: /\blast(?:ActivatedAt|[_\s-]?activated(?:[_\s-]?at)?)\b/gi,
  closedAt: /\bclosed(?:At|[_\s-]?at)\b/gi,
  currentGroupTitle: /\bcurrent(?:GroupTitle|[_\s-]?group(?:[_\s-]?title)?)\b/gi,
  hostname: /\b(?:hostname|host(?:Name|[_\s-]?name))\b/gi,
  cache: /\bcache(?:Key|[_\s-]?key)?\b/gi,
  lifecycle: /\blifecycle(?:Status|[_\s-]?status)?\b/gi,
  activationFlow: /\bactivation(?:Flow|[_\s-]?flow)\b/gi,
  ids: /\bids\b/gi,
  nearbyIds: /\bnearby(?:Ids|[_\s-]?ids?)\b/gi,
  returnToId: /\breturn(?:ToId|[_\s-]?to(?:[_\s-]?id)?)\b/gi,
  repeatedIds: /\brepeated(?:Ids|[_\s-]?ids?)\b/gi,
  dwellSeconds: /\bdwell(?:Seconds|[_\s-]?seconds?)\b/gi,
  activeSeconds: /\b(?:(?:active|totalActive|maxActive|avgDwell)(?:Seconds|[_\s-]?seconds?)|total[_\s-]?active[_\s-]?seconds?|max[_\s-]?active[_\s-]?seconds?|avg[_\s-]?dwell[_\s-]?seconds?)\b/gi,
  appearedInRuns: /\bappeared(?:InRuns|[_\s-]?in[_\s-]?runs?)\b/gi,
  returnedToCount: /\breturned(?:ToCount|[_\s-]?to[_\s-]?count)\b/gi,
  transitionCount: /\btransition(?:Count|[_\s-]?count)\b/gi,
  fromId: /\bfrom(?:Id|[_\s-]?id)\b/gi,
  toId: /\bto(?:Id|[_\s-]?id)\b/gi,
  startedAt: /\bstarted(?:At|[_\s-]?at)\b/gi,
  endedAt: /\bended(?:At|[_\s-]?at)\b/gi,
  lastAt: /\blast(?:At|[_\s-]?at)\b/gi,
  sampleable: /\bsample(?:able|[_\s-]?able)\b/gi,
  discarded: /\bdiscarded\b/gi,
  pinned: /\bpinned\b/gi,
  audible: /\baudible\b/gi
};

const CLEANUP_CHINESE_STORAGE_STATE_PATTERN =
  /(?:(?:(?:该|此|这个)?(?:标签页|页面|候选项?)\s*)?(?:(?:本地\s*)?(?:已经?|曾经?|正在|当前)\s*(?:被|在本地|于本地)?|(?:本地|被|在本地|于本地)\s*)\s*(?:暂存|缓存)(?:中|过|完成|了|于本地|在本地|到本地)?(?:\s*(?:约\s*)?\d+(?:\.\d+)?\s*(?:秒|分钟|小时|天|周|月))?|(?:(?:该|此|这个)?(?:标签页|页面|候选项?)\s*)(?:被|在本地|于本地)?\s*(?:暂存|缓存)(?:中|过|完成|了|于本地|在本地|到本地)?(?:\s*(?:约\s*)?\d+(?:\.\d+)?\s*(?:秒|分钟|小时|天|周|月))?|(?:暂存|缓存)(?:中|完成|状态|记录|数据))(?=\s*(?:[，,。.!！？?；;:：]|且|并且|而且|以及|$))/gi;
const CLEANUP_ENGLISH_STORAGE_STATE_PATTERN =
  /(?:(?:(?:(?:this|the)\s+)?(?:tab|page|candidate)\s+)?(?:is|was|were|are|has\s+been|have\s+been|currently|locally)\s+(?:staged|cached|caching)(?:\s+(?:locally|for\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)))?|(?:(?:this|the)\s+)?(?:tab|page|candidate)\s+(?:staged|cached|caching)(?:\s+(?:locally|for\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)))?|(?:staged|cached)(?:\s+(?:locally|for\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)|state|status|record))|\b(?:staged|cached)\b)(?=\s*(?:[,.!?;:]|and\b|but\b|or\b|$))/gi;

export function normalizeModelProductText(value, settings = {}, maxLength = 120) {
  let text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  const languageMode = settings?.languageMode === "en-US" ? "en-US" : "zh-CN";
  const copy = (zhCN, enUS) => localizedText(languageMode, zhCN, enUS);

  text = text
    .replace(/\bactive(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(?:0|zero)\b/gi, copy("基本没再打开", "rarely reopened"))
    .replace(/\bactive(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("打开过 $1 次", "opened $1 times"))
    .replace(/\bseen(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("记录过 $1 次", "seen $1 times"))
    .replace(/\breturned(?:ToCount|[_\s-]?to[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("切回过 $1 次", "returned $1 times"))
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.transitionCount, (_match, value) => copy(`切换过 ${formatNumberValue(value)} 次`, `switched ${formatNumberValue(value)} times`))
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.appearedInRuns, (_match, value) =>
      copy(`出现在 ${formatNumberValue(value)} 段浏览里`, `appeared in ${formatNumberValue(value)} browsing runs`)
    )
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.totalActiveSeconds, (_match, value) =>
      copy(`总活跃约 ${formatDurationValue(value, "zh-CN")}`, `active for about ${formatDurationValue(value, "en-US")} total`)
    )
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.maxActiveSeconds, (_match, value) =>
      copy(`最长停留约 ${formatDurationValue(value, "zh-CN")}`, `longest stay about ${formatDurationValue(value, "en-US")}`)
    )
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.avgDwellSeconds, (_match, value) =>
      copy(`平均停留约 ${formatDurationValue(value, "zh-CN")}`, `average stay about ${formatDurationValue(value, "en-US")}`)
    )
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.activeSeconds, (_match, value) =>
      copy(`活跃约 ${formatDurationValue(value, "zh-CN")}`, `active for about ${formatDurationValue(value, "en-US")}`)
    )
    .replace(NUMERIC_FIELD_VALUE_PATTERNS.dwellSeconds, (_match, value) =>
      copy(`停留约 ${formatDurationValue(value, "zh-CN")}`, `stayed about ${formatDurationValue(value, "en-US")}`)
    )
    .replace(/\bage(?:Days|[_\s-]?days?)\s*(?:约|about|为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("已放约 $1 天", "kept about $1 days"))
    .replace(/\bidle(?:Days|[_\s-]?days?)\s*(?:约|about|为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("闲置约 $1 天", "idle about $1 days"))
    .replace(/\bsample(?:able|[_\s-]?able)\s*(?:为|=|is|:)?\s*(?:false|no|否)\b/gi, copy("页面摘要不可用", "page summary unavailable"))
    .replace(/\bsample(?:able|[_\s-]?able)\s*(?:为|=|is|:)?\s*(?:true|yes|是)\b/gi, copy("可读取页面摘要", "page summary available"))
    .replace(/\bdiscarded\s*(?:为|=|is|:)?\s*(?:true|yes|是)\b/gi, copy("休眠标签页", "sleeping tab"))
    .replace(/\bpinned\s*(?:为|=|is|:)?\s*(?:true|yes|是)\b/gi, copy("固定标签页", "pinned tab"))
    .replace(/\baudible\s*(?:为|=|is|:)?\s*(?:true|yes|是)\b/gi, copy("正在播放声音", "playing audio"))
    .replace(IDENTITY_FIELD_PATTERN, "")
    .replace(IDENTITY_FIELD_NAME_PATTERN, "");

  const labels =
    languageMode === "en-US"
      ? {
          activeCount: "times opened",
          seenCount: "times seen",
          ageDays: "days kept",
          idleDays: "days idle",
          firstSeenAt: "first seen",
          lastSeenAt: "last active",
          lastActivatedAt: "last used",
          closedAt: "closed",
          currentGroupTitle: "current group",
          hostname: "site",
          cache: "local record",
          lifecycle: "activity record",
          activationFlow: "browsing flow",
          ids: "related tabs",
          nearbyIds: "nearby tabs",
          returnToId: "returned to an earlier tab",
          repeatedIds: "repeatedly revisited tabs",
          dwellSeconds: "time spent",
          activeSeconds: "active time",
          appearedInRuns: "same browsing run",
          returnedToCount: "times returned",
          transitionCount: "tab switches",
          strength: "confidence signal",
          count: "repeated signal",
          clues: "evidence note",
          fromId: "source tab",
          toId: "next tab",
          startedAt: "started",
          endedAt: "ended",
          lastAt: "last observed",
          sampleable: "page summary access",
          discarded: "sleeping",
          pinned: "pinned",
          audible: "audio"
        }
      : {
          activeCount: "打开次数",
          seenCount: "记录次数",
          ageDays: "保留天数",
          idleDays: "闲置天数",
          firstSeenAt: "首次看到",
          lastSeenAt: "最近活跃",
          lastActivatedAt: "最近使用",
          closedAt: "已关闭时间",
          currentGroupTitle: "现有分组",
          hostname: "网站",
          cache: "本地记录",
          lifecycle: "活动记录",
          activationFlow: "浏览轨迹",
          ids: "相关标签页",
          nearbyIds: "相邻标签页",
          returnToId: "回到前面的标签页",
          repeatedIds: "反复切回的标签页",
          dwellSeconds: "停留时长",
          activeSeconds: "活跃时长",
          appearedInRuns: "同一段浏览过程",
          returnedToCount: "切回次数",
          transitionCount: "标签页切换次数",
          strength: "信号强度",
          count: "重复线索",
          clues: "依据线索",
          fromId: "来源标签页",
          toId: "下一个标签页",
          startedAt: "开始时间",
          endedAt: "结束时间",
          lastAt: "最近记录时间",
          sampleable: "页面摘要权限",
          discarded: "休眠状态",
          pinned: "固定状态",
          audible: "播放声音"
        };

  for (const [raw, pattern] of Object.entries(INTERNAL_ID_FIELD_VALUE_PATTERNS)) {
    text = text.replace(pattern, labels[raw]);
  }
  for (const [raw, pattern] of Object.entries(INTERNAL_SIGNAL_FIELD_VALUE_PATTERNS)) {
    text = text.replace(pattern, labels[raw]);
  }

  const fieldNameEntries = Object.entries(labels).sort(([left], [right]) => {
    if (left === "ids") return 1;
    if (right === "ids") return -1;
    return 0;
  });

  for (const [raw, label] of fieldNameEntries) {
    text = text.replace(FIELD_NAME_PATTERNS[raw] ?? new RegExp(`\\b${raw}\\b`, "gi"), label);
  }

  return text
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .replace(/([、,，;；:：])\s*([、,，;；:：])/g, "$1")
    .replace(/^\s*[、,，;；:：-]+\s*/, "")
    .replace(/\s*[、,，;；:：-]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeCleanupProductText(value, settings = {}, maxLength = 120) {
  const languageMode = settings?.languageMode === "en-US" ? "en-US" : "zh-CN";
  let text = normalizeModelProductText(value, settings, Math.max(512, maxLength * 2));
  if (!text) return "";

  const withoutStorageState = text
    .replace(CLEANUP_CHINESE_STORAGE_STATE_PATTERN, " ")
    .replace(CLEANUP_ENGLISH_STORAGE_STATE_PATTERN, " ");
  const removedStorageState = withoutStorageState !== text;
  text = withoutStorageState
    .replace(/^\s*(?:[，,。.!！？?；;:：-]\s*)+/, "")
    .replace(/\s*(?:且|并且|而且|以及|and|but|or)\s*([。.!?]|$)/gi, "$1")
    .replace(/^\s*(?:且|并且|而且|以及|and|but|or)\s+/i, "")
    .replace(/^\s*is\s+/i, "")
    .replace(/\s+([，,。.!；;:：])/g, "$1")
    .replace(/([，,。.!！？?；;:：])\s*([，,。.!！？?；;:：])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (removedStorageState && languageMode === "en-US" && /^[a-z]/.test(text)) {
    text = `${text[0].toUpperCase()}${text.slice(1)}`;
  }
  return text.slice(0, maxLength);
}

function formatNumberValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "").trim();
  return Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 10) / 10);
}

function formatDurationValue(value, languageMode) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 90) {
    const rounded = Math.max(1, Math.round(seconds));
    return localizedText(languageMode, `${rounded} 秒`, `${rounded} ${rounded === 1 ? "second" : "seconds"}`);
  }
  const minutes = seconds / 60;
  if (minutes < 90) {
    const rounded = Math.max(1, Math.round(minutes));
    return localizedText(languageMode, `${rounded} 分钟`, `${rounded} ${rounded === 1 ? "minute" : "minutes"}`);
  }
  const hours = minutes / 60;
  const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return localizedText(languageMode, `${rounded} 小时`, `${rounded} ${rounded === 1 ? "hour" : "hours"}`);
}
