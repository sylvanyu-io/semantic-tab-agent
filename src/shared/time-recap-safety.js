const RECAP_CLEANUP_RECOMMENDATION_PATTERN = new RegExp(
  [
    "(?:建议|可以|可|适合|优先|先|考虑|直接|回头|需要|不必|不用|无需|暂时)[^。！？!?；;\\n]{0,18}(?:关闭|清理|删除|移除|复查|检查|保留)",
    "(?:关闭|清理|删除|移除)[^。！？!?；;\\n]{0,14}(?:标签页|页面|旧页)",
    "(?:是否|要不要)[^。！？!?；;\\n]{0,10}保留",
    "(?:值得|优先)[^。！？!?；;\\n]{0,10}(?:复查|检查)",
    "(?:不再需要|低价值|过期)[^。！？!?；;\\n]{0,18}(?:标签页|标签|页面|旧页|页签)",
    "(?:标签页|标签|页面|旧页|页签)[^。！？!?；;\\n]{0,18}(?:不再需要|低价值|过期)",
    "\\b(?:should|can|could|consider)\\b[^.!?\\n]{0,28}\\b(?:close|delete|remove|clean\\s*up|keep)\\b",
    "\\b(?:worth\\s+reviewing|review\\s+whether|cleanup\\s+candidate|no\\s+longer\\s+needed)\\b",
    "\\b(?:low-value|stale)\\b[^.!?\\n]{0,24}\\b(?:tab|tabs|page|pages)\\b",
    "\\b(?:tab|tabs|page|pages)\\b[^.!?\\n]{0,24}\\b(?:low-value|stale)\\b"
  ].join("|"),
  "i"
);

export function stripCleanupRecommendationsFromRecapText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const pieces = splitRecapSentences(text);
  const kept = pieces.filter((piece) => !RECAP_CLEANUP_RECOMMENDATION_PATTERN.test(piece));
  if (kept.length === pieces.length) return text;
  return kept.join("").replace(/\s+/g, " ").trim();
}

function splitRecapSentences(text) {
  const pieces = [];
  let current = "";
  for (const char of text) {
    current += char;
    if ("。！？!?.；;\n".includes(char)) {
      if (current.trim()) pieces.push(current);
      current = "";
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces.length ? pieces : [text];
}
