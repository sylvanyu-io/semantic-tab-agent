import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerSystemPrompt, createGatewayPlan, testGatewayConnection } from "../src/core/gateway-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import {
  DEFAULT_SETTINGS,
  GATEWAY_CUSTOM_MODEL_VALUE,
  GROUPING_GRANULARITIES,
  PLANNER_PROVIDERS,
  PROMPT_PRESETS
} from "../src/shared/settings.js";

const inventory = {
  scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
  windows: [{ windowId: 1, tabCount: 2 }],
  plannerTabs: [
    { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Structured output docs", hostname: "docs.example" },
    { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Chrome tabGroups API", hostname: "developer.chrome.com" }
  ],
  excludedTabs: [],
  lockedGroups: [],
  pageSamples: [
    {
      tabId: 10,
      windowId: 1,
      status: "ok",
      sample: { title: "Structured output docs", headings: ["JSON"], visibleText: "JSON schema output" }
    }
  ]
};

test("planner prompt includes the selected organization preset", () => {
  const prompt = buildPlannerSystemPrompt({
    ...DEFAULT_SETTINGS,
    promptPreset: PROMPT_PRESETS.MEDIA_TYPE
  });

  assert.match(prompt, /media type/);
  assert.match(prompt, /overrides the default topic axis/);
  assert.match(prompt, /Keep the same media type together/);
  assert.match(prompt, /Do not use page topic from samples to split tabs/);
  assert.match(prompt, /intentional group, not a catch-all/);
  assert.match(prompt, /code\/issues\/PRs/);
  assert.match(prompt, /shopping\/finance/);
});

test("planner prompt exposes grouping granularity without losing ordering constraints", () => {
  const compactPrompt = buildPlannerSystemPrompt({
    ...DEFAULT_SETTINGS,
    groupingGranularity: GROUPING_GRANULARITIES.COMPACT
  });
  const detailedPrompt = buildPlannerSystemPrompt({
    ...DEFAULT_SETTINGS,
    groupingGranularity: GROUPING_GRANULARITIES.DETAILED
  });

  assert.match(compactPrompt, /Grouping granularity: compact/);
  assert.match(compactPrompt, /Avoid singleton or 2-tab groups/);
  assert.match(compactPrompt, /Use sequenceIndex and index/);
  assert.match(detailedPrompt, /Grouping granularity: detailed/);
  assert.match(detailedPrompt, /precise task boundaries/);
});

test("balanced grouping prompt avoids over-merging distinct topics", () => {
  const prompt = buildPlannerSystemPrompt({
    ...DEFAULT_SETTINGS,
    groupingGranularity: GROUPING_GRANULARITIES.BALANCED
  });

  assert.match(prompt, /Grouping granularity: balanced/);
  assert.match(prompt, /do not merge clearly different tasks/);
  assert.match(prompt, /without collapsing distinct subjects/);
});

test("AI gateway planner posts a chat-completions JSON request", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [],
    groups: [
      {
        groupKey: "developer-docs",
        title: "Developer Docs",
        color: "cyan",
        confidence: 0.88,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Developer documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "http://localhost:8317/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer gateway-test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.4");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.reasoning_effort, "high");
    assert.match(body.messages[0].content, /JSON-only planner/);
    assert.match(body.messages[0].content, /compact output/);
    assert.match(body.messages[0].content, /sequenceIndex and index/);
    assert.match(body.messages[0].content, /pageSampleSignals/);
    assert.match(body.messages[0].content, /Write every user-facing string in English/);
    assert.match(body.messages[1].content, /Structured output docs/);
    assert.match(body.messages[1].content, /Software engineering task input/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.schema, "tab_tidy_compact_v1");
    assert.equal(payload.settings.languageMode, "en-US");
    assert.equal(payload.settings.promptPreset, "conservative");
    assert.equal(payload.settings.groupingGranularity, "balanced");
    assert.deepEqual(payload.excludedFields, ["id", "windowId", "reason"]);
    assert.deepEqual(payload.tabFields, [
      "id",
      "windowId",
      "index",
      "sequenceIndex",
      "title",
      "hostname",
      "sanitizedUrl",
      "urlKind",
      "audible",
      "discarded",
      "sampleable",
      "existingGroup",
      "pageSample"
    ]);
    const firstTab = rowToObject(payload.tabFields, payload.tabs[0]);
    const secondTab = rowToObject(payload.tabFields, payload.tabs[1]);
    assert.equal(firstTab.sequenceIndex, 0);
    assert.equal(secondTab.index, 1);
    assert.deepEqual(payload.pageSampleFields, ["status", "title", "metaDescription", "language", "contentKind", "headings", "visibleText", "reason"]);
    const firstSample = rowToObject(payload.pageSampleFields, firstTab.pageSample);
    assert.equal(firstSample.status, "ok");
    assert.equal(firstSample.contentKind, "");
    assert.equal(firstSample.visibleText, "");
    assert.deepEqual(payload.pageSampleSignalFields, ["id", "contentKind", "title", "headings", "summary"]);
    assert.equal(payload.pageSampleSignals.length, 1);
    assert.equal(payload.pageSampleSignals[0][0], 10);
    assert.match(payload.pageSampleSignals[0][4], /JSON schema output/);
    assert.equal(rowToObject(payload.pageSampleResultFields, payload.pageSampleResults[0]).status, "ok");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner returns cleanup candidates in the same full-detail plan request", async () => {
  const activityOverview = {
    rangeMs: 2592000000,
    cache: { entries: 3, sampledEntries: 1 },
    openTabs: { total: 2, tracked: 2 },
    recap: { topTerms: [], topHosts: [] },
    openTabSignals: [
      {
        tabId: 10,
        windowId: 1,
        index: 0,
        ageMs: 18 * 24 * 60 * 60 * 1000,
        idleMs: 12 * 24 * 60 * 60 * 1000,
        activeCount: 1,
        currentGroupTitle: "Old docs",
        summary: { metaDescription: "Old JSON notes" }
      }
    ]
  };

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /Analysis features: grouping=enabled, cleanup=enabled/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.analysisFeatures.grouping, true);
    assert.equal(payload.analysisFeatures.cleanup, true);
    assert.equal(rowToObject(payload.activityFields, payload.activity[0]).currentGroup, "Old docs");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [
                    {
                      key: "docs",
                      title: "Docs",
                      color: "blue",
                      confidence: 0.9,
                      ids: [10, 11],
                      reason: "Documentation tabs."
                    }
                  ],
                  review: [],
                  cleanup: {
                    summary: "Review old docs first.",
                    candidates: [
                      { id: 10, priority: "high", reason: "Old notes look superseded.", evidence: ["18 days old", "low activity"] }
                    ]
                  }
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US"
    },
    fetchImpl,
    { activityOverview }
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.cleanup.summary, "Review old docs first.");
  assert.equal(plan.cleanup.candidates.length, 2);
  assert.equal(plan.cleanup.candidates[0].tabId, 10);
  assert.equal(plan.cleanup.candidates[0].ageMs, 18 * 24 * 60 * 60 * 1000);
  assert.deepEqual(plan.cleanup.candidates[0].evidence, ["18 days old", "low activity"]);
  assert.equal(plan.cleanup.candidates[1].tabId, 11);
  assert.equal(plan.cleanup.candidates[1].priority, "low");
});

test("AI gateway planner keeps a ranked cleanup checklist beyond the old 12-item cap", async () => {
  const plannerTabs = Array.from({ length: 33 }, (_, index) => ({
    tabId: 40_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Cleanup tab ${index + 1}`,
    hostname: "example.com"
  }));
  const cleanupInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.cleanupInstructions.actionLimit, 33);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [
                    {
                      key: "all-tabs",
                      title: "All Tabs",
                      color: "blue",
                      confidence: 0.9,
                      ids: plannerTabs.map((tab) => tab.tabId),
                      reason: "One compact group."
                    }
                  ],
                  review: [],
                  cleanup: {
                    summary: "Ranked checklist.",
                    candidates: plannerTabs.map((tab, index) => ({
                      id: tab.tabId,
                      priority: index < 5 ? "high" : index < 20 ? "medium" : "low",
                      reason: `Review item ${index + 1}.`,
                      evidence: ["ranked"]
                    }))
                  }
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    cleanupInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US"
    },
    fetchImpl,
    { hierarchical: false, splitCleanup: false }
  );

  assert.equal(plan.cleanup.candidates.length, 33);
  assert.deepEqual(
    plan.cleanup.candidates.slice(0, 3).map((candidate) => candidate.priority),
    ["high", "high", "high"]
  );
});

test("AI gateway planner fills cleanup checklist when the model returns too few candidates", async () => {
  const plannerTabs = Array.from({ length: 4 }, (_, index) => ({
    tabId: 41_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Manual review tab ${index + 1}`,
    hostname: `example${index}.com`
  }));
  const cleanupInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                groups: [
                  {
                    key: "all-tabs",
                    title: "All Tabs",
                    color: "blue",
                    confidence: 0.9,
                    ids: plannerTabs.map((tab) => tab.tabId),
                    reason: "One compact group."
                  }
                ],
                review: [],
                cleanup: {
                  summary: "Nothing urgent.",
                  candidates: []
                }
              })
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    cleanupInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US"
    },
    fetchImpl
  );

  assert.equal(plan.cleanup.candidates.length, 4);
  assert.deepEqual(
    plan.cleanup.candidates.map((candidate) => candidate.priority),
    ["low", "low", "low", "low"]
  );
  assert.match(plan.cleanup.candidates[0].reason, /review it near the end/);
  assert.deepEqual(
    plan.cleanup.candidates.map((candidate) => candidate.tabId),
    plannerTabs.map((tab) => tab.tabId)
  );
});

test("AI gateway planner omits cleanup payload when cleanup analysis is disabled", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /Analysis features: grouping=enabled, cleanup=disabled/);
    assert.doesNotMatch(body.messages[0].content, /top-level cleanup/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.analysisFeatures.grouping, true);
    assert.equal(payload.analysisFeatures.cleanup, false);
    assert.equal(payload.cleanupInstructions, undefined);
    assert.equal(payload.activityFields, undefined);
    assert.equal(payload.activity, undefined);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [
                    {
                      key: "docs",
                      title: "Docs",
                      color: "blue",
                      confidence: 0.9,
                      ids: [10, 11],
                      reason: "Documentation tabs."
                    }
                  ],
                  review: [],
                  cleanup: {
                    summary: "Should be ignored when disabled.",
                    candidates: [{ id: 10, priority: "high", reason: "Ignored.", evidence: ["ignored"] }]
                  }
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US",
      analyzeCleanup: false
    },
    fetchImpl,
    { activityOverview: { openTabSignals: [{ tabId: 10, currentGroupTitle: "Old docs" }] } }
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.cleanup, undefined);
});

test("AI gateway planner supports cleanup-only analysis without creating groups", async () => {
  const activityOverview = {
    openTabSignals: [
      {
        tabId: 10,
        windowId: 1,
        index: 0,
        ageMs: 21 * 24 * 60 * 60 * 1000,
        idleMs: 13 * 24 * 60 * 60 * 1000,
        activeCount: 1,
        currentGroupTitle: "Old docs"
      }
    ]
  };
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /Analysis features: grouping=disabled, cleanup=enabled/);
    assert.match(body.messages[0].content, /return groups as an empty array and put every eligible tab id in review/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.analysisFeatures.grouping, false);
    assert.equal(payload.analysisFeatures.cleanup, true);
    assert.equal(rowToObject(payload.activityFields, payload.activity[0]).currentGroup, "Old docs");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [],
                  review: [
                    { id: 10, reason: "Grouping disabled." },
                    { id: 11, reason: "Grouping disabled." }
                  ],
                  cleanup: {
                    summary: "Review old docs first.",
                    candidates: [{ id: 10, priority: "high", reason: "Old task leftover.", evidence: ["21 days old"] }]
                  }
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US",
      analyzeGrouping: false,
      analyzeCleanup: true
    },
    fetchImpl,
    { activityOverview }
  );

  assert.equal(plan.groups.length, 0);
  assert.deepEqual(
    plan.reviewTabs.map((ref) => ref.tabId),
    [10, 11]
  );
  assert.equal(plan.cleanup.candidates.length, 2);
  assert.equal(plan.cleanup.candidates[0].tabId, 10);
  assert.equal(plan.cleanup.candidates[1].tabId, 11);
  assert.equal(plan.cleanup.candidates[1].priority, "low");
});

test("AI gateway planner sends a custom model name to custom gateways", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [],
    groups: [
      {
        groupKey: "docs",
        title: "Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "glm-5.2");
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.response_format, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(options.headers.authorization, "Bearer glm-key");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "https://open.bigmodel.cn/api/paas/v4/",
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: "glm-5.2",
      gatewayApiKey: "glm-key",
      languageMode: "en-US"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner prefers manual model names when a custom base URL is set", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [],
    groups: [
      {
        groupKey: "docs",
        title: "Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-v4");
    assert.equal(body.response_format, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.thinking, undefined);
    assert.equal(options.headers.authorization, "Bearer deepseek-test-key");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "https://api.deepseek.com/v1",
      gatewayModel: "gpt-5.4",
      gatewayCustomModel: "deepseek-v4",
      gatewayApiKey: "deepseek-test-key"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner sends a custom model name to the built-in gateway", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [],
    groups: [
      {
        groupKey: "docs",
        title: "Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://cliproxy.sylvanyu.io/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "claude-opus-4-7");
    assert.equal(options.headers.authorization, undefined);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: "claude-opus-4-7"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner rejects blank custom model names", async () => {
  await assert.rejects(
    createGatewayPlan(
      inventory,
      {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
        gatewayCustomModel: ""
      },
      async () => {
        throw new Error("fetch should not be called");
      }
    ),
    /请填写自定义模型名/
  );
});

test("AI gateway connection test sends a minimal custom API ping", async () => {
  const pingedModels = [];
  const result = await testGatewayConnection(
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "https://api.deepseek.com/v1/",
      gatewayModel: "gpt-5.4",
      gatewayCustomModel: "deepseek-v4",
      gatewayCustomAuxiliaryModel: "glm-5.2",
      gatewayApiKey: "ping-test-key"
    },
    async (url, options) => {
      assert.equal(url, "https://api.deepseek.com/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer ping-test-key");
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model"]);
      pingedModels.push(body.model);
      assert.equal(body.messages[0].content, "Reply with ok.");
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: "ok" } }] };
        }
      };
    },
    { timeoutMs: 1000 }
  );

  assert.deepEqual(pingedModels, ["deepseek-v4", "glm-5.2"]);
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    model: "deepseek-v4",
    auxiliaryModel: "glm-5.2",
    baseUrl: "https://api.deepseek.com/v1"
  });
});

test("AI gateway payload omits excluded tab titles", async () => {
  const sensitiveInventory = {
    ...inventory,
    excludedTabs: [
      {
        tabId: 99,
        windowId: 1,
        title: "Private bank account recovery phrase",
        exclusionReason: "Pinned tabs are excluded by policy."
      }
    ]
  };
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [{ tabId: 99, windowId: 1, reason: "Pinned tabs are excluded by policy." }],
    groups: [
      {
        groupKey: "developer-docs",
        title: "Developer Docs",
        color: "cyan",
        confidence: 0.88,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Developer documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (_url, options) => {
    const bodyText = options.body;
    assert.doesNotMatch(bodyText, /Private bank account recovery phrase/);
    const body = JSON.parse(bodyText);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.deepEqual(payload.excludedFields, ["id", "windowId", "reason"]);
    assert.deepEqual(payload.excluded, [[99, 1, "Pinned tabs are excluded by policy."]]);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    sensitiveInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key"
    },
    fetchImpl
  );

  assert.deepEqual(plan.excludedTabs, expectedPlan.excludedTabs);
});

test("AI gateway planner maps ultra thinking to gateway-compatible high effort", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning_effort, "high");
    assert.match(body.messages[0].content, /ultra-high/);
    assert.match(body.messages[1].content, /"thinkingIntensity":"ultra"/);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [],
                  reviewTabs: [
                    { tabId: 10, windowId: 1, reason: "Review." },
                    { tabId: 11, windowId: 1, reason: "Review." }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayApiKey: "gateway-test-key",
      gatewayThinkingIntensity: "ultra"
    },
    fetchImpl
  );
});

test("AI gateway planner adapts common tabIds output and strips markdown fences", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content:
                "Here is the JSON plan:\n``` json\n" +
                JSON.stringify({
                  groups: [
                    {
                      name: "Developer Docs",
                      color: "green",
                      tabIds: [10, 11],
                      confidence: 0.84,
                      reasoning: "Both tabs are developer documentation."
                    }
                  ],
                  ungrouped: []
                }) +
                "\n```\n"
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.groups[0].title, "Developer Docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
  assert.deepEqual(plan.reviewTabs, []);
});

test("AI gateway planner accepts raw fenced JSON bodies from compatible gateways", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async text() {
      return (
        "```json\n" +
        JSON.stringify({
          groups: [
            {
              name: "Developer Docs",
              color: "cyan",
              tabIds: [10, 11],
              confidence: 0.9,
              reason: "Both tabs are developer documentation."
            }
          ],
          review: []
        }) +
        "\n```"
      );
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.groups[0].title, "Developer Docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
});

test("AI gateway planner hides invalid model output details from product UI", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: "```json\nnot actually json\n```"
            }
          }
        ]
      };
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
        fetchImpl
      ),
    /AI 这次生成的方案格式不完整/
  );
});

test("AI gateway planner adapts schemaVersion one plans that still use tabIds", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                schemaVersion: 1,
                groups: [
                  {
                    title: "Developer Docs",
                    color: "cyan",
                    tabIds: [10, 11],
                    confidence: 0.84,
                    reason: "Both tabs are developer documentation."
                  }
                ],
                review: []
              })
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  const validation = validatePlan(plan, inventory, {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key"
  });

  assert.equal(validation.ok, true);
  assert.equal(plan.groups[0].title, "Developer Docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
});

test("AI gateway planner adapts compact ids output", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_tidy_plan_compact_v1",
                groups: [
                  {
                    key: "developer-docs",
                    title: "Developer Docs",
                    color: "cyan",
                    confidence: 0.88,
                    ids: [11, 10],
                    reason: "Both tabs are developer documentation."
                  }
                ],
                review: [{ id: 999, reason: "Unknown tab should be ignored." }]
              })
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.groups[0].groupKey, "developer-docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
  assert.deepEqual(plan.reviewTabs, []);
});

test("AI gateway planner deduplicates compact review refs", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_tidy_plan_compact_v1",
                groups: [],
                review: [{ id: 10, reason: "Unclear." }, 10, 11]
              })
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.deepEqual(plan.reviewTabs, [
    { tabId: 10, windowId: 1, reason: "Unclear." },
    { tabId: 11, windowId: 1, reason: "AI 网关把这个标签页留给复核。" }
  ]);
});

test("AI gateway planner can call a custom free gateway without an API key", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["content-type"], "application/json");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [],
                  reviewTabs: [
                    { tabId: 10, windowId: 1, reason: "Review." },
                    { tabId: 11, windowId: 1, reason: "Review." }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: ""
    },
    fetchImpl
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner uses the default free gateway without exposing authorization", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://cliproxy.sylvanyu.io/v1/chat/completions");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["x-tab-recap-install-id"], "install-test");
    assert.equal(options.headers["x-tab-recap-page-summary"], "1");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [],
                  reviewTabs: [
                    { tabId: 10, windowId: 1, reason: "Review." },
                    { tabId: 11, windowId: 1, reason: "Review." }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "" },
    fetchImpl,
    { installId: "install-test" }
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner ignores stale user keys for the built-in free gateway", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["x-tab-recap-install-id"], "install-test");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [],
                  reviewTabs: [
                    { tabId: 10, windowId: 1, reason: "Review." },
                    { tabId: 11, windowId: 1, reason: "Review." }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "stale-key" },
    fetchImpl,
    { installId: "install-test" }
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner surfaces auth failures as product copy", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: { message: "Unauthorized" } };
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "bad-key"
        },
        fetchImpl
      ),
    /请检查自定义网关地址和密钥/
  );
});

test("AI gateway planner surfaces infrastructure failures as product copy", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 502,
    async text() {
      return "error code: 502";
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "test-key"
        },
        fetchImpl
      ),
    /自定义 AI 网关暂时连不上/
  );
});

test("AI gateway planner maps built-in tunnel errors to retry copy", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 530,
    async text() {
      return "error code: 1033";
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY
        },
        fetchImpl
      ),
    /默认 AI 服务的本地源站暂时离线/
  );
});

test("AI gateway planner accepts common non-infrastructure string error payloads", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    async json() {
      return { error: "bad prompt shape" };
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "test-key"
        },
        fetchImpl
      ),
    /自定义 AI 网关这次没有完成请求（400）。bad prompt shape/
  );
});

test("AI gateway planner honors an explicit timeout", async () => {
  const fetchImpl = async () => new Promise(() => {});

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
        fetchImpl,
        { timeoutMs: 5 }
      ),
    /timed out after/
  );
});

test("AI gateway planner uses coarse then refine planning for large inventories", async () => {
  const largeInventory = {
    ...inventory,
    plannerTabs: [
      ...inventory.plannerTabs,
      { tabId: 12, windowId: 1, title: "React docs", hostname: "react.dev" },
      { tabId: 13, windowId: 1, title: "GitHub pull request", hostname: "github.com" },
      { tabId: 14, windowId: 1, title: "Home", hostname: "example.com" }
    ],
    tabs: [
      ...inventory.plannerTabs,
      { tabId: 12, windowId: 1, title: "React docs", hostname: "react.dev" },
      { tabId: 13, windowId: 1, title: "GitHub pull request", hostname: "github.com" },
      { tabId: 14, windowId: 1, title: "Home", hostname: "example.com" }
    ],
    pageSamples: []
  };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "technical-docs",
          title: "Technical Docs",
          color: "cyan",
          confidence: 0.92,
          tabIds: [10, 11, 12],
          reason: "Broad technical documentation."
        },
        {
          bucketKey: "project-work",
          title: "Project Work",
          color: "blue",
          confidence: 0.9,
          tabIds: [13],
          reason: "Project workflow."
        }
      ],
      reviewTabIds: [14]
    },
    {
      schemaVersion: 1,
      mode: "current_window",
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
      eligibleTabs: [
        { tabId: 10, windowId: 1 },
        { tabId: 11, windowId: 1 },
        { tabId: 12, windowId: 1 }
      ],
      excludedTabs: [],
      groups: [
        {
          groupKey: "browser-extension-docs",
          title: "Extension Docs",
          color: "cyan",
          confidence: 0.9,
          tabRefs: [
            { tabId: 10, windowId: 1 },
            { tabId: 11, windowId: 1 }
          ],
          reason: "Chrome extension documentation."
        },
        {
          groupKey: "frontend-docs",
          title: "Frontend Docs",
          color: "green",
          confidence: 0.85,
          tabRefs: [{ tabId: 12, windowId: 1 }],
          reason: "React documentation."
        }
      ],
      reviewTabs: []
    },
    {
      schemaVersion: 1,
      mode: "current_window",
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
      eligibleTabs: [{ tabId: 14, windowId: 1 }],
      excludedTabs: [],
      groups: [],
      reviewTabs: [{ tabId: 14, windowId: 1, reason: "Generic title." }]
    }
  ];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const responsePayload = responses[requests.length - 1];
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responsePayload) } }] };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    languageMode: "en-US",
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 3
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].reasoning_effort, "medium");
  assert.match(requests[0].messages[0].content, /fast first-pass/);
  assert.match(requests[0].messages[0].content, /Write every user-facing string in English/);
  assert.match(requests[1].messages[0].content, /JSON-only planner/);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    [...plan.groups.flatMap((group) => group.tabRefs.map((ref) => ref.tabId)), ...plan.reviewTabs.map((ref) => ref.tabId)].sort(
      (left, right) => left - right
    ),
    [10, 11, 12, 13, 14]
  );
});

test("AI gateway planner refines mid-sized buckets with repeated mixed title patterns", async () => {
  const stems = ["Chrome extension APIs", "Frontend implementation", "Product UI design"];
  const plannerTabs = Array.from({ length: 15 }, (_, index) => ({
    tabId: 30_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `${stems[index % stems.length]} - reference ${index}`,
    hostname: ["developer.chrome.com", "react.dev", "figma.com"][index % stems.length]
  }));
  const mixedInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const colors = ["blue", "green", "yellow"];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "extension-build",
          title: "Extension Build",
          color: "blue",
          confidence: 0.95,
          tabIds: plannerTabs.map((tab) => tab.tabId),
          reason: "High-confidence broad build bucket."
        }
      ],
      reviewTabIds: []
    },
    {
      groups: stems.map((stem, index) => ({
        key: stem.toLowerCase().replaceAll(" ", "-"),
        title: stem,
        color: colors[index % colors.length],
        confidence: 0.9,
        ids: plannerTabs.filter((_, tabIndex) => tabIndex % stems.length === index).map((tab) => tab.tabId),
        reason: `${stem} tabs.`
      })),
      review: []
    }
  ];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const responsePayload = responses[requests.length - 1];
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responsePayload) } }] };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(mixedInventory, settings, fetchImpl, { hierarchical: true });
  const validation = validatePlan(plan, mixedInventory, settings);

  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[1].content, /Chrome extension APIs|Frontend implementation|Product UI design/i);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [5, 5, 5]
  );
});

test("AI gateway media-type mode does not refine repeated title patterns by topic", async () => {
  const stems = ["React docs", "Chrome docs", "Cloudflare docs"];
  const plannerTabs = Array.from({ length: 15 }, (_, index) => ({
    tabId: 31_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `${stems[index % stems.length]} - guide ${index}`,
    hostname: ["react.dev", "developer.chrome.com", "developers.cloudflare.com"][index % stems.length]
  }));
  const mediaInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  buckets: [
                    {
                      bucketKey: "documentation",
                      title: "Documentation",
                      color: "blue",
                      confidence: 0.95,
                      tabIds: plannerTabs.map((tab) => tab.tabId),
                      reason: "All pages are documentation."
                    }
                  ],
                  reviewTabIds: []
                })
              }
            }
          ]
        };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    promptPreset: PROMPT_PRESETS.MEDIA_TYPE,
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(mediaInventory, settings, fetchImpl, { hierarchical: true });
  const validation = validatePlan(plan, mediaInventory, settings);

  assert.equal(requests.length, 1);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [15]
  );
});

test("AI gateway planner routes 50-tab product sessions through hierarchical workers with cleanup", async () => {
  const plannerTabs = Array.from({ length: 50 }, (_, index) => ({
    tabId: 10_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Threshold tab ${index}`,
    hostname: "example.com"
  }));
  const thresholdInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const activityOverview = {
    openTabSignals: [
      {
        tabId: 10_000,
        windowId: 1,
        index: 0,
        ageMs: 16 * 24 * 60 * 60 * 1000,
        idleMs: 12 * 24 * 60 * 60 * 1000,
        activeCount: 1,
        currentGroupTitle: "Old research"
      },
      {
        tabId: 10_049,
        windowId: 1,
        index: 49,
        ageMs: 30 * 24 * 60 * 60 * 1000,
        idleMs: 20 * 24 * 60 * 60 * 1000,
        activeCount: 0,
        currentGroupTitle: "Dormant tail"
      }
    ]
  };

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const isCoarse = /fast first-pass/.test(body.messages[0].content);
    if (isCoarse) {
      const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
      assert.equal(payload.settings.analyzeCleanup, false);
      assert.equal(payload.cleanupInstructions, undefined);
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    buckets: [
                      {
                        bucketKey: "first-half",
                        title: "First Half",
                        color: "blue",
                        confidence: 0.95,
                        tabIds: plannerTabs.slice(0, 25).map((tab) => tab.tabId),
                        reason: "First half."
                      },
                      {
                        bucketKey: "second-half",
                        title: "Second Half",
                        color: "green",
                        confidence: 0.95,
                        tabIds: plannerTabs.slice(25).map((tab) => tab.tabId),
                        reason: "Second half."
                      }
                    ],
                    reviewTabIds: []
                  })
                }
              }
            ]
          };
        }
      };
    }

    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.match(body.messages[0].content, /cleanup ranking planner/);
    assert.equal(payload.schema, "tab_tidy_cleanup_ranking_v1");
    assert.equal(payload.cleanupInstructions.actionLimit, 50);
    assert.deepEqual(
      payload.proposedGroups.map((row) => row[3].length),
      [25, 25]
    );
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Ranked cleanup checklist.",
                  candidates: [
                    { id: 10_049, priority: "high", reason: "Dormant tail tab.", evidence: ["30 days old"] },
                    { id: 10_000, priority: "medium", reason: "Old first-half tab.", evidence: ["16 days old"] }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key"
  };
  const plan = await createGatewayPlan(thresholdInventory, settings, fetchImpl, { activityOverview });
  const validation = validatePlan(plan, thresholdInventory, settings);

  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.model === "gpt-5.3-codex-spark"), true);
  assert.match(requests[0].messages[0].content, /fast first-pass/);
  assert.match(requests[1].messages[0].content, /cleanup ranking planner/);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [25, 25]
  );
  assert.equal(plan.cleanup.candidates.length, 50);
  assert.deepEqual(
    plan.cleanup.candidates.slice(0, 2).map((candidate) => candidate.tabId),
    [10_049, 10_000]
  );
  assert.equal(plan.cleanup.candidates[2].priority, "low");
});

test("AI gateway planner splits sub-50 cleanup ranking to the auxiliary model", async () => {
  const plannerTabs = Array.from({ length: 33 }, (_, index) => ({
    tabId: 30_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Small cleanup tab ${index}`,
    hostname: "example.com"
  }));
  const smallInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));

    if (/cleanup ranking planner/.test(body.messages[0].content)) {
      assert.equal(body.model, "gpt-5.3-codex-spark");
      assert.equal(payload.schema, "tab_tidy_cleanup_ranking_v1");
      assert.equal(payload.cleanupInstructions.actionLimit, 33);
      assert.equal(payload.proposedGroups.length, 2);
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Review checklist.",
                    candidates: [{ id: 30_032, priority: "high", reason: "Old tail tab.", evidence: ["end of session"] }]
                  })
                }
              }
            ]
          };
        }
      };
    }

    assert.equal(body.model, "gpt-5.4");
    assert.equal(payload.analysisFeatures.cleanup, false);
    assert.equal(payload.cleanupInstructions, undefined);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [
                    {
                      key: "small-a",
                      title: "Small A",
                      color: "blue",
                      confidence: 0.95,
                      ids: plannerTabs.slice(0, 18).map((tab) => tab.tabId),
                      reason: "First small group."
                    },
                    {
                      key: "small-b",
                      title: "Small B",
                      color: "green",
                      confidence: 0.95,
                      ids: plannerTabs.slice(18).map((tab) => tab.tabId),
                      reason: "Second small group."
                    }
                  ],
                  review: []
                })
              }
            }
          ]
        };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key"
  };
  const plan = await createGatewayPlan(smallInventory, settings, fetchImpl);
  const validation = validatePlan(plan, smallInventory, settings);

  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /JSON-only planner/);
  assert.match(requests[1].messages[0].content, /cleanup ranking planner/);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [18, 15]
  );
  assert.equal(plan.cleanup.candidates.length, 33);
  assert.equal(plan.cleanup.candidates[0].tabId, 30_032);
  assert.equal(plan.cleanup.candidates[1].priority, "low");
});

test("AI gateway planner keeps sub-50-tab sessions on the single full-detail path", async () => {
  const plannerTabs = Array.from({ length: 49 }, (_, index) => ({
    tabId: 20_000 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Small session tab ${index}`,
    hostname: "example.com"
  }));
  const smallInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [
                    {
                      key: "small-session-a",
                      title: "Small Session A",
                      color: "blue",
                      confidence: 0.95,
                      ids: plannerTabs.slice(0, 25).map((tab) => tab.tabId),
                      reason: "First small-session chunk."
                    },
                    {
                      key: "small-session-b",
                      title: "Small Session B",
                      color: "green",
                      confidence: 0.95,
                      ids: plannerTabs.slice(25).map((tab) => tab.tabId),
                      reason: "Second small-session chunk."
                    }
                  ],
                  review: []
                })
              }
            }
          ]
        };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(smallInventory, settings, fetchImpl);
  const validation = validatePlan(plan, smallInventory, settings);

  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].messages[0].content, /fast first-pass/);
  assert.match(requests[0].messages[0].content, /JSON-only planner/);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [25, 24]
  );
});

test("AI gateway planner splits oversized coarse buckets before refinement", async () => {
  const plannerTabs = [10, 11, 12, 13, 14].map((tabId) => ({
    tabId,
    windowId: 1,
    title: `Large bucket tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "large",
          title: "Large Bucket",
          color: "blue",
          confidence: 0.95,
          tabIds: [10, 11, 12, 13, 14],
          reason: "Too broad."
        }
      ],
      reviewTabIds: []
    },
    planForRefs([10, 11], "Part One"),
    planForRefs([12, 13], "Part Two"),
    planForRefs([14], "Part Three")
  ];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const responsePayload = responses[requests.length - 1];
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responsePayload) } }] };
      }
    };
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 2,
    refineMaxTabsPerRequest: 2
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 4);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests.slice(1).every((request) => request.reasoning_effort === "medium"), true);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.equal(plan.groups.length, 3);
});

test("AI gateway planner splits high-confidence fallback buckets by original order", async () => {
  const plannerTabs = [10, 11, 12, 13, 14].map((tabId, sequenceIndex) => ({
    tabId,
    windowId: 1,
    index: sequenceIndex,
    sequenceIndex,
    title: `Fallback bucket tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    buckets: [
                      {
                        bucketKey: "large",
                        title: "Large Bucket",
                        color: "blue",
                        confidence: 0.95,
                        tabIds: [14, 10, 13, 12, 11],
                        reason: "High-confidence but needs refinement."
                      }
                    ],
                    reviewTabIds: []
                  })
                }
              }
            ]
          };
        }
      };
    }
    return {
      ok: false,
      status: 503,
      async json() {
        return { error: { message: "refinement service unavailable" } };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    maxTabsPerGroup: 2,
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 2,
    refineMaxTabsPerRequest: 10
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 2);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.map((ref) => ref.tabId)),
    [
      [10, 11],
      [12, 13],
      [14]
    ]
  );
});

test("AI gateway planner caps large-job refinement thinking at medium by default", async () => {
  const plannerTabs = [10, 11, 12].map((tabId) => ({
    tabId,
    windowId: 1,
    title: `Large bucket tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "large",
          title: "Large Bucket",
          color: "blue",
          confidence: 0.95,
          tabIds: [10, 11, 12],
          reason: "Needs refinement."
        }
      ],
      reviewTabIds: []
    },
    planForRefs([10, 11, 12], "Refined")
  ];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const responsePayload = responses[requests.length - 1];
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responsePayload) } }] };
      }
    };
  };
  await createGatewayPlan(
    largeInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayApiKey: "gateway-test-key",
      analyzeCleanup: false,
      gatewayThinkingIntensity: "ultra"
    },
    fetchImpl,
    {
      hierarchical: true,
      refineBucketMinTabs: 2
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].reasoning_effort, "medium");
});

test("AI gateway media-type refinement preserves the media axis", async () => {
  const plannerTabs = [10, 11, 12].map((tabId) => ({
    tabId,
    windowId: 1,
    title: `Media type tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "docs",
          title: "Documentation",
          color: "blue",
          confidence: 0.9,
          tabIds: [10, 11, 12],
          reason: "Same media type."
        }
      ],
      reviewTabIds: []
    },
    planForRefs([10, 11, 12], "Documentation")
  ];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const responsePayload = responses[requests.length - 1];
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responsePayload) } }] };
      }
    };
  };

  await createGatewayPlan(
    largeInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayApiKey: "gateway-test-key",
      promptPreset: PROMPT_PRESETS.MEDIA_TYPE,
      analyzeCleanup: false
    },
    fetchImpl,
    {
      hierarchical: true,
      refineBucketMinTabs: 2
    }
  );

  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[0].content, /preserve the media-type axis/);
  assert.match(requests[1].messages[0].content, /not by project, topic, domain/);
});

test("AI gateway planner runs bucket refinements with bounded concurrency", async () => {
  const plannerTabs = Array.from({ length: 8 }, (_, index) => ({
    tabId: 100 + index,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Parallel refinement tab ${index + 1}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  let activeRefinements = 0;
  let maxActiveRefinements = 0;
  const requests = [];

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    buckets: [0, 1, 2, 3].map((bucketIndex) => ({
                      bucketKey: `bucket-${bucketIndex + 1}`,
                      title: `Bucket ${bucketIndex + 1}`,
                      color: "blue",
                      confidence: 0.9,
                      tabIds: [100 + bucketIndex * 2, 101 + bucketIndex * 2],
                      reason: "Needs refinement."
                    })),
                    reviewTabIds: []
                  })
                }
              }
            ]
          };
        }
      };
    }

    activeRefinements += 1;
    maxActiveRefinements = Math.max(maxActiveRefinements, activeRefinements);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRefinements -= 1;
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    const tabIds = payload.tabs.map((row) => row[0]);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(planForRefs(tabIds, `Refined ${tabIds[0]}`)) } }] };
      }
    };
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    analyzeCleanup: false
  };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 2,
    refineConcurrency: 2
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 5);
  assert.equal(maxActiveRefinements, 2);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.flatMap((group) => group.tabRefs.map((ref) => ref.tabId)),
    plannerTabs.map((tab) => tab.tabId)
  );
});

test("AI gateway planner reports a friendly error when the gateway returns an empty body", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return "";
    }
  });

  await assert.rejects(
    createGatewayPlan(
      inventory,
      {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "http://localhost:8317/v1",
        gatewayApiKey: "gateway-test-key"
      },
      fetchImpl
    ),
    /没有生成可用方案/
  );
});

function planForRefs(tabIds, title) {
  return {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: tabIds.map((tabId) => ({ tabId, windowId: 1 })),
    excludedTabs: [],
    groups: [
      {
        groupKey: title.toLowerCase().replace(/\s+/g, "-"),
        title,
        color: "blue",
        confidence: 0.86,
        tabRefs: tabIds.map((tabId) => ({ tabId, windowId: 1 })),
        reason: "Refined chunk."
      }
    ],
    reviewTabs: []
  };
}

function rowToObject(fields, row) {
  return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
}
