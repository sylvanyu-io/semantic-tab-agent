import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Actions CI runs release gates and exposes manual stress coverage", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /full_gate:/);
  assert.match(workflow, /permissions:\n\s+contents: read/);

  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v6/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /uses: actions\/cache@v6/);
  assert.match(workflow, /path: ~\/\.cache\/ms-playwright/);
  assert.match(workflow, /key: \$\{\{ runner\.os \}\}-playwright-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/);
  assert.match(workflow, /run: npx playwright install --with-deps chromium/);
  assert.match(workflow, /run: npm run release:check/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.match(workflow, /path: dist\/\*\.zip/);

  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.full_gate/);
  assert.match(workflow, /run: npm run assets:icons && npm run build:extension/);
  assert.match(workflow, /run: xvfb-run --auto-servernum npm run stress:extension/);
  assert.match(workflow, /path: dist\/stress\/\*\.json/);
});
