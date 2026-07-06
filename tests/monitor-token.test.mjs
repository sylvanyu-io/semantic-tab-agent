import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveMonitorToken } from "../scripts/lib/monitor-token.mjs";

test("monitor token resolver prefers MONITOR_TOKEN", () => {
  const result = resolveMonitorToken({
    MONITOR_TOKEN: " env-token ",
    MONITOR_TOKEN_FILE: "/does/not/matter"
  });

  assert.equal(result.token, "env-token");
  assert.equal(result.source, "MONITOR_TOKEN");
});

test("monitor token resolver can read MONITOR_TOKEN_FILE", () => {
  const dir = mkdtempSync(join(tmpdir(), "tab-recap-monitor-token-"));
  const filePath = join(dir, "token");
  writeFileSync(filePath, " file-token \n");

  const result = resolveMonitorToken({
    MONITOR_TOKEN_FILE: filePath
  });

  assert.equal(result.token, "file-token");
  assert.equal(result.source, "MONITOR_TOKEN_FILE");
  assert.equal(result.filePath, filePath);
});

test("monitor token resolver reports an empty token when no source exists", () => {
  const result = resolveMonitorToken({
    MONITOR_TOKEN_FILE: "/definitely/missing/tab-recap-monitor-token"
  });

  assert.equal(result.token, "");
  assert.equal(result.source, "");
});
