const RECAP_CLEANUP_FOLLOW_UP_PATTERN = new RegExp(
  [
    "关闭",
    "清理",
    "删除",
    "移除",
    "值得复查",
    "优先复查",
    "先检查",
    "要不要保留",
    "是否保留",
    "不再需要",
    "低价值",
    "过期",
    "重复",
    "close",
    "delete",
    "remove",
    "cleanup",
    "clean up",
    "worth reviewing",
    "review whether",
    "stale",
    "duplicate",
    "low-value",
    "no longer needed"
  ].join("|"),
  "i"
);

export function isCleanupLikeRecapFollowUp(item) {
  const text = `${item?.title || ""} ${item?.reason || item?.description || ""}`.toLowerCase();
  return RECAP_CLEANUP_FOLLOW_UP_PATTERN.test(text);
}

export function filterRecapFollowUps(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !isCleanupLikeRecapFollowUp(item));
}
