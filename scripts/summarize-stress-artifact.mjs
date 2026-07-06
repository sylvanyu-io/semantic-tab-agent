import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

if (isCliEntrypoint()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const artifactPath = options.path || (await findLatestStressArtifact());
    const artifact = await loadStressArtifact(artifactPath);
    const summary = summarizeStressArtifact(artifact);
    console.log(options.json ? JSON.stringify(summary, null, 2) : formatStressSummaryMarkdown(summary));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function loadStressArtifact(path) {
  const artifactPath = resolve(path);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  return { ...artifact, artifactPath };
}

export async function findLatestStressArtifact(stressDir = join(rootDir, "dist", "stress")) {
  if (!existsSync(stressDir)) throw new Error("No dist/stress directory found. Pass a stress artifact path.");

  const entries = await readdir(stressDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^sta-stress-.+\.json$/.test(entry.name))
    .map((entry) => join(stressDir, entry.name))
    .sort();

  if (!files.length) throw new Error("No stress artifact JSON found. Pass a stress artifact path.");
  return files.at(-1);
}

export function summarizeStressArtifact(artifact) {
  const result = (label, predicate = () => true) => (artifact.results || []).find((entry) => entry.label === label && predicate(entry)) || null;
  const details = (label) => result(label, (entry) => Boolean(entry.details))?.details || null;
  const elapsedMs = (label) => result(label, (entry) => entry.elapsedMs !== undefined)?.elapsedMs ?? null;

  const required = ["runId", "totalTabs", "windowCount", "results"];
  for (const field of required) {
    if (artifact[field] === undefined) throw new Error(`Stress artifact is missing ${field}.`);
  }

  const gatewaySkipped = details("gateway all-window analyze skipped");
  const gatewayAnalyze = details("gateway all-window analyze");

  return {
    runId: artifact.runId,
    file: artifact.artifactPath ? basename(artifact.artifactPath) : "",
    totalTabs: artifact.totalTabs,
    windowCount: artifact.windowCount,
    gatewayTabs: artifact.gatewayTabs || 0,
    allWindow: details("all-window apply and undo"),
    currentWindow: details("current-window apply and undo"),
    samplingRiskGate: details("sampling risk gate"),
    fullPageSampling: details("UI-driven page sampling"),
    activeTabSampling: details("active-tab page sampling"),
    gateway: gatewayAnalyze || gatewaySkipped,
    timings: {
      allWindowAnalyzeMs: elapsedMs("fake all-window analyze"),
      allWindowApplyMs: elapsedMs("fake all-window apply"),
      allWindowUndoMs: elapsedMs("fake all-window undo"),
      currentWindowAnalyzeMs: elapsedMs("fake current-window analyze"),
      fullPageSamplingMs: elapsedMs("UI-driven full page sampling"),
      activeTabSamplingMs: elapsedMs("active-tab page sampling")
    }
  };
}

export function formatStressSummaryMarkdown(summary) {
  const lines = [
    `Stress artifact: \`${summary.file || `${summary.runId}.json`}\``,
    `- Run: \`${summary.runId}\``,
    `- Scope: ${summary.totalTabs} tabs across ${summary.windowCount} windows`,
    `- All-window apply/undo: ${formatGroups(summary.allWindow?.groups)}, restored ${formatCount(summary.allWindow?.restoredTabs)} tabs`,
    `- Current-window apply/undo: ${formatGroups(summary.currentWindow?.groups)} for ${formatCount(summary.currentWindow?.windowTabs)} tabs`,
    `- Page-summary risk gate: blocked ${formatCount(summary.samplingRiskGate?.blocked)} of ${formatCount(summary.samplingRiskGate?.requested)} attempted samples`,
    `- Authorized page sampling: read ${formatCount(summary.fullPageSampling?.ok)} of ${formatCount(summary.fullPageSampling?.requested)} pages`,
    `- Active-tab sampling: read ${formatCount(summary.activeTabSampling?.ok)} of ${formatCount(summary.activeTabSampling?.requested)} active pages`,
    `- Gateway branch: ${formatGateway(summary.gateway)}`,
    `- Key timings: all-window analyze ${formatMs(summary.timings.allWindowAnalyzeMs)}, full page sampling ${formatMs(summary.timings.fullPageSamplingMs)}`
  ];
  return lines.join("\n");
}

function parseArgs(args) {
  const json = args.includes("--json");
  const path = args.find((arg) => !arg.startsWith("-"));
  return { json, path };
}

function formatGroups(value) {
  return value === undefined || value === null ? "unknown groups" : `${value} groups`;
}

function formatCount(value) {
  return value === undefined || value === null ? "unknown" : String(value);
}

function formatGateway(value) {
  if (!value) return "not recorded";
  if (value.reason) return `skipped (${value.reason})`;
  const pieces = [];
  if (value.tabs !== undefined) pieces.push(`${value.tabs} tabs`);
  if (value.groups !== undefined) pieces.push(`${value.groups} groups`);
  if (value.reviewTabs !== undefined) pieces.push(`${value.reviewTabs} review tabs`);
  if (value.warnings !== undefined) pieces.push(`${value.warnings} warnings`);
  return pieces.length ? pieces.join(", ") : "recorded";
}

function formatMs(value) {
  if (value === undefined || value === null) return "unknown";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
