export const STORAGE_KEYS = Object.freeze({
  settings: "semanticTabAgent.settings",
  activeJob: "semanticTabAgent.activeJob",
  lastJob: "semanticTabAgent.lastJob",
  lastRollback: "semanticTabAgent.lastRollback",
  pageSummaryCache: "semanticTabAgent.pageSummaryCache",
  pageActivityCache: "semanticTabAgent.pageActivityCache",
  tabLifecycleLog: "semanticTabAgent.tabLifecycleLog"
});

export async function getLocal(chromeApi, key, fallback = null) {
  const result = await chromeApi.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function setLocal(chromeApi, key, value) {
  await chromeApi.storage.local.set({ [key]: value });
  return value;
}

export async function removeLocal(chromeApi, key) {
  await chromeApi.storage.local.remove(key);
}
