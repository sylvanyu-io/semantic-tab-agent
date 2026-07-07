import { localizedText } from "./language.js";

export const MODEL_PRODUCT_COPY_INTERNAL_FIELD_WARNING =
  "Do not expose raw implementation field names or variants such as activeCount, active_count, active-count, tabId, tabIds, tab_id, tab_ids, pageId, page_ids, windowId, sequenceIndex, sequence_index, ageDays, idleDays, sampleable, currentGroupTitle, hostname, cache, lifecycle, activationFlow, nearbyIds, returnToId, repeatedIds, dwellSeconds, or activeSeconds in user-facing copy.";

const IDENTITY_FIELD_PATTERN =
  /\b(?:tab(?:Ids?|[_\s-]?ids?)|page(?:Ids?|[_\s-]?ids?)|window(?:Ids?|[_\s-]?ids?)|sequence(?:Index(?:es)?|Indices|[_\s-]?index(?:es)?|[_\s-]?indices))\s*(?:为|=|is|:)?\s*(?:\[[^\]]*\]|["'#]?[A-Za-z0-9_.-]+(?:\s*,\s*["'#]?[A-Za-z0-9_.-]+)*)?/gi;
const IDENTITY_FIELD_NAME_PATTERN =
  /\b(?:tab(?:Ids?|[_\s-]?ids?)|page(?:Ids?|[_\s-]?ids?)|window(?:Ids?|[_\s-]?ids?)|sequence(?:Index(?:es)?|Indices|[_\s-]?index(?:es)?|[_\s-]?indices))\b/gi;

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
  nearbyIds: /\bnearby(?:Ids|[_\s-]?ids?)\b/gi,
  returnToId: /\breturn(?:ToId|[_\s-]?to(?:[_\s-]?id)?)\b/gi,
  repeatedIds: /\brepeated(?:Ids|[_\s-]?ids?)\b/gi,
  dwellSeconds: /\bdwell(?:Seconds|[_\s-]?seconds?)\b/gi,
  activeSeconds: /\b(?:(?:active|totalActive|maxActive|avgDwell)(?:Seconds|[_\s-]?seconds?)|total[_\s-]?active[_\s-]?seconds?|max[_\s-]?active[_\s-]?seconds?|avg[_\s-]?dwell[_\s-]?seconds?)\b/gi,
  appearedInRuns: /\bappeared(?:InRuns|[_\s-]?in(?:[_\s-]?runs?)?)\b/gi,
  transitionCount: /\btransition(?:Count|[_\s-]?count)\b/gi,
  sampleable: /\bsample(?:able|[_\s-]?able)\b/gi,
  discarded: /\bdiscarded\b/gi,
  pinned: /\bpinned\b/gi,
  audible: /\baudible\b/gi
};

export function normalizeModelProductText(value, settings = {}, maxLength = 120) {
  let text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  const languageMode = settings?.languageMode === "en-US" ? "en-US" : "zh-CN";
  const copy = (zhCN, enUS) => localizedText(languageMode, zhCN, enUS);

  text = text
    .replace(/\bactive(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(?:0|zero)\b/gi, copy("基本没再打开", "rarely reopened"))
    .replace(/\bactive(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("打开过 $1 次", "opened $1 times"))
    .replace(/\bseen(?:Count|[_\s-]?count)\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("记录过 $1 次", "seen $1 times"))
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
          nearbyIds: "nearby tabs",
          returnToId: "returned to an earlier tab",
          repeatedIds: "repeatedly revisited tabs",
          dwellSeconds: "time spent",
          activeSeconds: "active time",
          appearedInRuns: "same browsing run",
          transitionCount: "tab switches",
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
          nearbyIds: "相邻标签页",
          returnToId: "回到前面的标签页",
          repeatedIds: "反复切回的标签页",
          dwellSeconds: "停留时长",
          activeSeconds: "活跃时长",
          appearedInRuns: "同一段浏览过程",
          transitionCount: "标签页切换次数",
          sampleable: "页面摘要权限",
          discarded: "休眠状态",
          pinned: "固定状态",
          audible: "播放声音"
        };

  for (const [raw, label] of Object.entries(labels)) {
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
