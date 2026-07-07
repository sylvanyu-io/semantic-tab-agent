import { localizedText } from "./language.js";

const IDENTITY_FIELD_PATTERN = /\b(?:tabId|pageId|windowId|sequenceIndex)\s*(?:为|=|is|:)?\s*["'#]?[A-Za-z0-9_.-]+["']?/gi;
const IDENTITY_FIELD_NAME_PATTERN = /\b(?:tabId|pageId|windowId|sequenceIndex)\b/gi;

export function normalizeModelProductText(value, settings = {}, maxLength = 120) {
  let text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  const languageMode = settings?.languageMode === "en-US" ? "en-US" : "zh-CN";
  const copy = (zhCN, enUS) => localizedText(languageMode, zhCN, enUS);

  text = text
    .replace(/\bactiveCount\s*(?:为|=|is|:)?\s*(?:0|zero)\b/gi, copy("基本没再打开", "rarely reopened"))
    .replace(/\bactiveCount\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("打开过 $1 次", "opened $1 times"))
    .replace(/\bseenCount\s*(?:为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("记录过 $1 次", "seen $1 times"))
    .replace(/\bageDays\s*(?:约|about|为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("已放约 $1 天", "kept about $1 days"))
    .replace(/\bidleDays\s*(?:约|about|为|=|is|:)?\s*(\d+(?:\.\d+)?)\b/gi, copy("闲置约 $1 天", "idle about $1 days"))
    .replace(/\bsampleable\s*(?:为|=|is|:)?\s*(?:false|no|否)\b/gi, copy("页面摘要不可用", "page summary unavailable"))
    .replace(/\bsampleable\s*(?:为|=|is|:)?\s*(?:true|yes|是)\b/gi, copy("可读取页面摘要", "page summary available"))
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
          sampleable: "页面摘要权限",
          discarded: "休眠状态",
          pinned: "固定状态",
          audible: "播放声音"
        };

  for (const [raw, label] of Object.entries(labels)) {
    text = text.replace(new RegExp(`\\b${raw}\\b`, "gi"), label);
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
