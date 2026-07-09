const RECAP_CLEANUP_RECOMMENDATION_PATTERN = new RegExp(
  [
    "(?:建议|可以|可|适合|优先|先|考虑|直接|回头|需要|不必|不用|无需|暂时)[^。！？!?；;\\n]{0,18}(?:关闭|清理|删除|移除|复查|检查|保留)",
    "(?:关闭|清理|删除|移除)[^。！？!?；;\\n]{0,14}(?:标签页|页面|旧页)",
    "(?:是否|要不要)[^。！？!?；;\\n]{0,10}(?:保留|留着|留下)",
    "(?:是否|是不是|要不要|要不要再|还要不要|是否还要)[^。！？!?；;\\n]{0,14}(?:保留|留着|留下|挂着|开着)",
    "(?:值得|优先)[^。！？!?；;\\n]{0,10}(?:复查|检查)",
    "(?:标签页|标签|页面|旧页|页签)[^。！？!?；;\\n]{0,24}(?:删掉|清掉|关掉|关了|收掉|收起来|处理掉|不用留|无需留|不必留|别留|没必要留|不用再留|无需再留|不必再留|不用挂着|无需挂着|不必挂着|没必要挂着|不用一直挂着|无需一直挂着|不必一直挂着|不用开着|无需开着|不必开着|没必要开着|不用继续开着|无需继续开着|不必继续开着|没必要继续开着)",
    "(?:删掉|清掉|关掉|收掉|收起来|处理掉)[^。！？!?；;\\n]{0,18}(?:标签页|标签|页面|旧页|页签)",
    "(?:不用|无需|不必|没必要)[^。！？!?；;\\n]{0,12}(?:留着|留下|保留)[^。！？!?；;\\n]{0,12}(?:标签页|标签|页面|旧页|页签)",
    "(?:不用|无需|不必|没必要|未必需要)[^。！？!?；;\\n]{0,14}(?:一直|继续)?(?:挂着|留着|留下|保留|开着)",
    "(?:回头|稍后|之后|后面)[^。！？!?；;\\n]{0,18}(?:处理|处理掉|收掉|收起来|关掉|清理|复查|检查|判断)[^。！？!?；;\\n]{0,18}(?:标签页|标签|页面|旧页|页签|保留|留着|挂着)",
    "^(?:回头|稍后|之后|后面)[^。！？!?；;\\n]{0,8}(?:处理|处理掉|清理|复查|检查|判断)$",
    "(?:不再需要|低价值|过期)[^。！？!?；;\\n]{0,18}(?:标签页|标签|页面|旧页|页签)",
    "(?:标签页|标签|页面|旧页|页签)[^。！？!?；;\\n]{0,18}(?:不再需要|低价值|过期)",
    "\\b(?:should|can|could|consider)\\b[^.!?\\n]{0,28}\\b(?:close|delete|remove|clean\\s*up|keep)\\b",
    "\\b(?:worth\\s+reviewing|review\\s+whether|cleanup\\s+candidate|no\\s+longer\\s+needed)\\b",
    "\\b(?:review|revisit|triage|check)\\b[^.!?\\n]{0,28}\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,18}\\b(?:later|tomorrow|again|soon|whether|keep|open)\\b",
    "\\b(?:keep|save|archive)\\b[^.!?\\n]{0,28}\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,18}\\b(?:open|for\\s+tomorrow|for\\s+later|for\\s+next\\s+time)\\b",
    "\\b(?:check|decide)\\s+later\\s+whether\\s+to\\s+keep\\b",
    "\\b(?:not\\s+worth|not\\s+useful\\s+enough)\\b[^.!?\\n]{0,24}\\b(?:keep|keeping)\\s+open\\b",
    "\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,36}\\b(?:safe\\s+to\\s+drop|get\\s+rid\\s+of|no\\s+need\\s+to\\s+keep|do\\s+not\\s+need\\s+to\\s+keep|don[’']?t\\s+need\\s+to\\s+keep|discard|drop)\\b",
    "\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,24}\\b(?:can|could|should)\\s+be\\s+(?:closed|deleted|removed|cleaned\\s*up)\\b",
    "\\b(?:drop|discard|get\\s+rid\\s+of)\\b[^.!?\\n]{0,36}\\b(?:tab|tabs|page|pages)\\b",
    "\\b(?:no\\s+need|do\\s+not\\s+need|don[’']?t\\s+need)\\b[^.!?\\n]{0,18}\\bkeep\\b[^.!?\\n]{0,18}\\b(?:tab|tabs|page|pages)\\b",
    "\\b(?:low-value|stale)\\b[^.!?\\n]{0,24}\\b(?:tab|tabs|page|pages)\\b",
    "\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,24}\\b(?:low-value|stale)\\b"
  ].join("|"),
  "i"
);

const GENERIC_RECAP_THEME_TITLES = new Set([
  "待分类",
  "待确认",
  "待整理",
  "未分类",
  "未整理",
  "其他",
  "杂项",
  "综合",
  "一般",
  "通用",
  "默认分组",
  "页面",
  "网页",
  "general",
  "general workbench",
  "general workspace",
  "page",
  "pages",
  "workbench",
  "uncategorized",
  "unsorted",
  "unclassified",
  "needs review",
  "to review",
  "review",
  "pending review",
  "misc",
  "miscellaneous",
  "other",
  "inbox"
]);

export function stripCleanupRecommendationsFromRecapText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const pieces = splitRecapSafetyPieces(text);
  const kept = pieces.filter((piece) => !RECAP_CLEANUP_RECOMMENDATION_PATTERN.test(piece));
  if (kept.length === pieces.length) return text;
  return cleanupRecapSafetyText(kept.join(""));
}

export function isGenericRecapThemeTitle(title) {
  const normalized = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[「」『』“”"'`]/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return true;
  return GENERIC_RECAP_THEME_TITLES.has(normalized);
}

function splitRecapSafetyPieces(text) {
  const pieces = [];
  let current = "";
  for (const char of text) {
    current += char;
    if ("。！？!?.；;，,\n".includes(char)) {
      if (current.trim()) pieces.push(current);
      current = "";
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces.length ? pieces : [text];
}

function cleanupRecapSafetyText(text) {
  return String(text || "")
    .replace(/[，,；;]\s*([。！？!?.])/g, "$1")
    .replace(/[，,；;]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
