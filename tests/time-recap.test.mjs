import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimeMessage } from "../src/core/controller.js";
import { buildLocalTimeRecap, buildTimeRecapInput, generateTimeRecap, normalizeTimeRecapRange } from "../src/core/time-recap.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS, URL_PRIVACY_MODES } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

const NOW = Date.parse("2026-06-27T06:00:00.000Z");

test("time recap input combines local activity, summaries, lifecycle, and current restricted tabs", async () => {
  const chrome = seededRecapChrome();

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "zh-CN" },
    { range: { preset: "7d" }, now: NOW }
  );
  const serialized = JSON.stringify(input);

  assert.equal(input.schema, "tab_recap_time_recap_input_v1");
  assert.equal(input.pages.some((page) => page.title === "Chrome extensions settings" && page.hostname === "chrome"), true);
  assert.equal(input.pages.some((page) => page.title === "Old unrelated page"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("SECRET123456789012"), false);
  assert.equal(serialized.includes("Readable forum discussion about browser extensions"), true);
  assert.equal(input.coverage.currentOpenTabs, 3);
  assert.equal(input.coverage.includedPages >= 3, true);
});

test("time recap input accumulates repeated page sessions and estimated dwell time", async () => {
  const chrome = createFakeChrome();
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      firstPass: {
        id: "firstPass",
        tabId: 10,
        windowId: 1,
        title: "上海帆船课程资料",
        hostname: "sailing.example",
        sanitizedUrl: "https://sailing.example/course",
        urlKey: "sharedSailingCourse",
        openedAt: "2026-06-27T01:00:00.000Z",
        firstObservedAt: "2026-06-27T01:00:00.000Z",
        lastObservedAt: "2026-06-27T01:20:00.000Z",
        closedAt: "2026-06-27T01:25:00.000Z",
        activeCount: 2
      },
      secondPass: {
        id: "secondPass",
        tabId: 11,
        windowId: 1,
        title: "上海帆船课程资料",
        hostname: "sailing.example",
        sanitizedUrl: "https://sailing.example/course",
        urlKey: "sharedSailingCourse",
        openedAt: "2026-06-27T02:00:00.000Z",
        firstObservedAt: "2026-06-27T02:00:00.000Z",
        lastObservedAt: "2026-06-27T02:10:00.000Z",
        closedAt: "2026-06-27T02:15:00.000Z",
        activeCount: 3
      },
      unrelated: {
        id: "unrelated",
        tabId: 12,
        windowId: 1,
        title: "天气查询",
        hostname: "weather.example",
        sanitizedUrl: "https://weather.example/today",
        urlKey: "weather",
        openedAt: "2026-06-27T01:20:00.000Z",
        firstObservedAt: "2026-06-27T01:20:00.000Z",
        lastObservedAt: "2026-06-27T02:20:00.000Z",
        closedAt: "2026-06-27T02:25:00.000Z",
        activeCount: 1
      }
    },
    events: [
      { seq: 1, type: "tab_activated", sessionId: "firstPass", tabId: 10, windowId: 1, at: "2026-06-27T01:00:00.000Z" },
      { seq: 2, type: "tab_activated", sessionId: "unrelated", tabId: 12, windowId: 1, at: "2026-06-27T01:20:00.000Z" },
      { seq: 3, type: "tab_activated", sessionId: "secondPass", tabId: 11, windowId: 1, at: "2026-06-27T02:00:00.000Z" },
      { seq: 4, type: "tab_activated", sessionId: "unrelated", tabId: 12, windowId: 1, at: "2026-06-27T02:10:00.000Z" }
    ]
  };

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "zh-CN" },
    { range: { preset: "today" }, now: NOW }
  );
  const sailingPage = input.pages.find((page) => page.title === "上海帆船课程资料");
  const localRecap = buildLocalTimeRecap(input, { ...DEFAULT_SETTINGS, languageMode: "zh-CN" });

  assert.ok(sailingPage);
  assert.equal(sailingPage.activeCount, 5);
  assert.equal(sailingPage.activeSeconds, 30 * 60);
  assert.equal(input.pageFields.includes("activeSeconds"), true);
  assert.match(localRecap.summary, /估算停留时长/);
  assert.equal(localRecap.timeline.some((item) => /估算停留约/.test(item.description)), true);
});

test("time recap dwell estimates include focused-window returns and cap long tails", async () => {
  const chrome = createFakeChrome();
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      research: {
        id: "research",
        tabId: 20,
        windowId: 1,
        title: "长线研究资料",
        hostname: "research.example",
        sanitizedUrl: "https://research.example/deep-topic",
        urlKey: "researchTopic",
        openedAt: "2026-06-27T01:00:00.000Z",
        firstObservedAt: "2026-06-27T01:00:00.000Z",
        lastObservedAt: "2026-06-27T05:00:00.000Z",
        closedAt: "2026-06-27T05:00:00.000Z",
        activeCount: 2
      },
      inbox: {
        id: "inbox",
        tabId: 21,
        windowId: 1,
        title: "邮件收件箱",
        hostname: "mail.example",
        sanitizedUrl: "https://mail.example/inbox",
        urlKey: "mailInbox",
        openedAt: "2026-06-27T01:10:00.000Z",
        firstObservedAt: "2026-06-27T01:10:00.000Z",
        lastObservedAt: "2026-06-27T01:12:00.000Z",
        closedAt: "2026-06-27T01:12:00.000Z",
        activeCount: 1
      },
      quickSearch: {
        id: "quickSearch",
        tabId: 22,
        windowId: 1,
        title: "快速查询",
        hostname: "search.example",
        sanitizedUrl: "https://search.example/query",
        urlKey: "quickSearch",
        openedAt: "2026-06-27T01:12:00.000Z",
        firstObservedAt: "2026-06-27T01:12:00.000Z",
        lastObservedAt: "2026-06-27T02:00:00.000Z",
        closedAt: "2026-06-27T02:00:00.000Z",
        activeCount: 1
      }
    },
    events: [
      { seq: 1, type: "tab_activated", sessionId: "research", tabId: 20, windowId: 1, at: "2026-06-27T01:00:00.000Z" },
      { seq: 2, type: "tab_activated", sessionId: "inbox", tabId: 21, windowId: 1, at: "2026-06-27T01:10:00.000Z" },
      { seq: 3, type: "tab_activated", sessionId: "quickSearch", tabId: 22, windowId: 1, at: "2026-06-27T01:12:00.000Z" },
      { seq: 4, type: "window_focused", sessionId: "research", tabId: 20, windowId: 1, active: true, at: "2026-06-27T02:00:00.000Z" }
    ]
  };

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "zh-CN" },
    { range: { preset: "today" }, now: NOW }
  );
  const researchPage = input.pages.find((page) => page.title === "长线研究资料");
  const localRecap = buildLocalTimeRecap(input, { ...DEFAULT_SETTINGS, languageMode: "zh-CN" });

  assert.ok(researchPage);
  assert.equal(researchPage.activeCount, 2);
  assert.equal(researchPage.activeSeconds, 70 * 60);
  assert.equal(localRecap.timeline.some((item) => /估算停留约/.test(item.description)), true);
});

test("time recap input suppresses historical URL details in title-only mode", async () => {
  const chrome = seededRecapChrome();

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "zh-CN", urlPrivacyMode: URL_PRIVACY_MODES.TITLE_ONLY },
    { range: { preset: "7d" }, now: NOW }
  );
  const serialized = JSON.stringify(input);

  assert.equal(input.pages.length >= 3, true);
  assert.equal(input.pages.every((page) => page.hostname === ""), true);
  assert.equal(input.pages.every((page) => page.sanitizedUrl === ""), true);
  assert.equal(serialized.includes("github.com"), false);
  assert.equal(serialized.includes("forum.example.com"), false);
  assert.equal(serialized.includes("https://github.com/acme"), false);
  assert.equal(serialized.includes("TabRecap release checklist"), true);
});

test("time recap input keeps high-signal closed pages when many low-signal tabs are open", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: Array.from({ length: 370 }, (_, index) => ({
          id: 1000 + index,
          title: `Open placeholder ${index}`,
          url: `https://open.example.com/page-${index}`
        }))
      }
    ]
  });

  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      closedResearch: {
        key: "closedResearch",
        title: "Closed recap design session",
        hostname: "research.example",
        sanitizedUrl: "https://research.example/closed-recap-design-session",
        firstSeenAt: "2026-06-26T01:00:00.000Z",
        lastSeenAt: "2026-06-27T05:45:00.000Z",
        seenCount: 9,
        sampleable: true,
        sample: {
          title: "Closed recap design session",
          metaDescription: "Important closed page about recap interaction design",
          contentKind: "research",
          headings: ["Timeline recap", "Closed tab signals"],
          visibleText: "Detailed notes about treating closed pages as first-class recap evidence."
        }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      closedResearch: {
        sessionId: "closedResearch",
        title: "Closed recap design session",
        hostname: "research.example",
        sanitizedUrl: "https://research.example/closed-recap-design-session",
        urlKey: "closedResearch",
        openedAt: "2026-06-26T01:00:00.000Z",
        firstObservedAt: "2026-06-26T01:00:00.000Z",
        lastObservedAt: "2026-06-27T05:45:00.000Z",
        closedAt: "2026-06-27T05:50:00.000Z",
        activeCount: 8
      }
    },
    events: []
  };

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "en-US" },
    { range: { preset: "7d" }, now: NOW }
  );
  const closedPage = input.pages.find((page) => page.title === "Closed recap design session");

  assert.equal(input.pages.length, 360);
  assert.ok(closedPage);
  assert.equal(closedPage.open, false);
  assert.equal(input.pages.some((page) => page.title === "Open placeholder 369"), false);
});

test("time recap input excludes cached incognito history unless explicitly enabled", async () => {
  const chrome = createFakeChrome();
  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      normal: {
        key: "normal",
        title: "Normal project page",
        hostname: "normal.example",
        sanitizedUrl: "https://normal.example/project",
        firstSeenAt: "2026-06-27T02:00:00.000Z",
        lastSeenAt: "2026-06-27T03:00:00.000Z",
        seenCount: 2,
        lastKnownState: { incognito: false }
      },
      privateActivity: {
        key: "privateActivity",
        title: "Private activity page",
        hostname: "private.example",
        sanitizedUrl: "https://private.example/activity",
        firstSeenAt: "2026-06-27T02:10:00.000Z",
        lastSeenAt: "2026-06-27T03:10:00.000Z",
        seenCount: 2,
        lastKnownState: { incognito: true }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      normal: {
        key: "normal",
        origin: "https://normal.example/*",
        title: "Normal project page",
        firstSeenAt: "2026-06-27T02:00:00.000Z",
        lastSeenAt: "2026-06-27T03:00:00.000Z",
        sampledAt: "2026-06-27T03:00:00.000Z",
        sample: { title: "Normal project page", visibleText: "Normal project notes" }
      },
      privateSummary: {
        key: "privateSummary",
        origin: "https://private.example/*",
        incognito: true,
        title: "Private summary page",
        firstSeenAt: "2026-06-27T02:20:00.000Z",
        lastSeenAt: "2026-06-27T03:20:00.000Z",
        sampledAt: "2026-06-27T03:20:00.000Z",
        sample: { title: "Private summary page", visibleText: "Private summary text" }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      normalSession: {
        id: "normalSession",
        title: "Normal project page",
        hostname: "normal.example",
        sanitizedUrl: "https://normal.example/project",
        urlKey: "normal",
        openedAt: "2026-06-27T02:00:00.000Z",
        lastObservedAt: "2026-06-27T03:00:00.000Z",
        closeReason: "missing_after_reconcile",
        closedAt: "2026-06-27T03:05:00.000Z",
        incognito: false
      },
      privateSession: {
        id: "privateSession",
        title: "Private lifecycle page",
        hostname: "private.example",
        sanitizedUrl: "https://private.example/lifecycle",
        urlKey: "privateLifecycle",
        openedAt: "2026-06-27T02:30:00.000Z",
        lastObservedAt: "2026-06-27T03:30:00.000Z",
        closeReason: "missing_after_reconcile",
        closedAt: "2026-06-27T03:35:00.000Z",
        incognito: true
      }
    },
    events: [
      { type: "tab_seen", sessionId: "normalSession", at: Date.parse("2026-06-27T03:00:00.000Z") },
      { type: "tab_seen", sessionId: "privateSession", at: Date.parse("2026-06-27T03:30:00.000Z") }
    ]
  };

  const defaultInput = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, includeIncognitoTabs: false },
    { range: { preset: "7d" }, now: NOW }
  );
  const defaultSerialized = JSON.stringify(defaultInput);

  assert.equal(defaultSerialized.includes("Private"), false);
  assert.equal(defaultInput.coverage.activityEntries, 1);
  assert.equal(defaultInput.coverage.summaryEntries, 1);
  assert.equal(defaultInput.coverage.lifecycleSessions, 1);
  assert.equal(defaultInput.coverage.lifecycleEvents, 1);
  assert.equal(defaultInput.coverage.inferredClosed, 1);

  const incognitoInput = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, includeIncognitoTabs: true },
    { range: { preset: "7d" }, now: NOW }
  );
  const incognitoSerialized = JSON.stringify(incognitoInput);

  assert.equal(incognitoSerialized.includes("Private activity page"), true);
  assert.equal(incognitoSerialized.includes("Private summary page"), true);
  assert.equal(incognitoSerialized.includes("Private lifecycle page"), true);
  assert.equal(incognitoInput.coverage.activityEntries, 2);
  assert.equal(incognitoInput.coverage.summaryEntries, 2);
  assert.equal(incognitoInput.coverage.lifecycleSessions, 2);
  assert.equal(incognitoInput.coverage.lifecycleEvents, 2);
  assert.equal(incognitoInput.coverage.inferredClosed, 2);
});

test("time recap gateway request parses fenced JSON and keeps page references valid", async () => {
  const chrome = seededRecapChrome();
  let capturedRequest = null;
  const fetchImpl = async (url, init) => {
    capturedRequest = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "```json\n{\"schema\":\"tab_recap_time_recap_v1\",\"language\":\"en-US\",\"headline\":\"Extension work dominated the week.\",\"summary\":\"Most useful signals point to TabRecap release and browser extension research.\",\"themes\":[{\"title\":\"Extension release work\",\"description\":\"Release and side panel pages form one thread.\",\"confidence\":\"high\",\"ids\":[1,999],\"evidence\":[\"release\"]}],\"timeline\":[{\"label\":\"This week\",\"description\":\"Mostly extension work.\",\"ids\":[1]}],\"followUps\":[{\"title\":\"Finish release QA\",\"reason\":\"The release checklist is still open.\",\"ids\":[1]}],\"reviewCandidates\":[{\"id\":2,\"priority\":\"medium\",\"reason\":\"This looks like an older research page.\",\"evidence\":[\"older\"]}],\"coverageNote\":\"Used local signals.\"}\n```"
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "en-US"
    },
    {
      range: { preset: "7d" },
      now: NOW,
      fetchImpl,
      installId: "install_test1234"
    }
  );

  assert.equal(capturedRequest.url, "http://127.0.0.1:8317/v1/chat/completions");
  assert.equal(capturedRequest.init.headers.authorization, "Bearer test-key");
  assert.equal(capturedRequest.body.model, "gpt-5.4");
  assert.match(capturedRequest.body.messages[0].content, /active_count/);
  assert.match(capturedRequest.body.messages[0].content, /tab_ids/);
  assert.match(capturedRequest.body.messages[0].content, /sequence_index/);
  assert.equal(result.source, "ai");
  assert.equal(result.recap.headline, "Extension work dominated the week.");
  assert.deepEqual(result.recap.themes[0].pageIds, [1]);
  assert.deepEqual(result.recap.followUps, []);
  assert.equal("reviewCandidates" in result.recap, false);
});

test("time recap model copy is normalized away from implementation field names", async () => {
  const chrome = seededRecapChrome();
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_recap_time_recap_v1",
                language: "zh-CN",
                headline: "pageId 1",
                summary: "activeCount 为0、pageId 1、sampleable false，但 ageDays 约 12。",
                themes: [
                  {
                    title: "currentGroupTitle 里的发布工作",
                    description: "tabId 10 和 sequenceIndex 3 指向同一条线索，hostname 是 github.com。",
                    confidence: "high",
                    ids: [1],
                    evidence: ["activeCount=3", "pageId:1", "sampleable false"]
                  }
                ],
                timeline: [
                  {
                    label: "activeCount 上午线索",
                    description: "windowId 1 的页面 lastSeenAt 很近。",
                    ids: [1]
                  }
                ],
                followUps: [
                  {
                    title: "复查 sampleable false 页面",
                    reason: "tabId 11 暂时没有摘要。",
                    ids: [2]
                  }
                ],
                reviewCandidates: [
                  {
                    id: 2,
                    priority: "medium",
                    reason: "activeCount=0，pageId 2 可以复查。",
                    evidence: ["ageDays 14", "tabId 11"]
                  }
                ],
                coverageNote: "seenCount 和 idleDays 已参考。"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "zh-CN"
    },
    {
      range: { preset: "7d" },
      now: NOW,
      fetchImpl
    }
  );

  const visibleText = [
    result.recap.headline,
    result.recap.summary,
    result.recap.coverageNote,
    result.recap.themes[0].title,
    result.recap.themes[0].description,
    ...result.recap.themes[0].evidence,
    result.recap.timeline[0].label,
    result.recap.timeline[0].description
  ].join("\n");

  assert.notEqual(result.recap.headline, "");
  assert.equal("reviewCandidates" in result.recap, false);
  assert.deepEqual(result.recap.followUps, []);
  assert.doesNotMatch(visibleText, /\b(?:activeCount|seenCount|ageDays|idleDays|sampleable|tabId|pageId|windowId|sequenceIndex|currentGroupTitle|hostname)\b/i);
  assert.doesNotMatch(visibleText, /、、/);
  assert.match(visibleText, /打开次数/);
  assert.match(visibleText, /现有分组/);
  assert.match(visibleText, /已放约 12 天/);
});

test("time recap ignores AI follow-ups because recap is recap-only", async () => {
  const chrome = seededRecapChrome();
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_recap_time_recap_v1",
                language: "zh-CN",
                headline: "这一周主要在做扩展发布",
                summary: "主要围绕 TabRecap 发布检查和权限研究推进。",
                themes: [
                  {
                    title: "扩展发布",
                    description: "发布检查和权限研究是主要线索。",
                    confidence: "high",
                    ids: [1],
                    evidence: ["发布检查"]
                  }
                ],
                timeline: [],
                followUps: [
                  {
                    title: "关闭旧标签页",
                    reason: "这个页面已经过期，值得复查是否保留。",
                    ids: [2]
                  },
                  {
                    title: "继续整理发布检查",
                    reason: "把 release checklist 的剩余步骤顺着做完。",
                    ids: [1]
                  }
                ],
                coverageNote: "使用本地线索。"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "zh-CN"
    },
    {
      range: { preset: "7d" },
      now: NOW,
      fetchImpl
    }
  );
  const visibleFollowUps = JSON.stringify(result.recap.followUps);

  assert.equal(result.source, "ai");
  assert.equal(result.recap.followUps.length, 0);
  assert.equal(visibleFollowUps.includes("关闭旧标签页"), false);
  assert.equal(visibleFollowUps.includes("继续整理发布检查"), false);
  assert.equal(visibleFollowUps.includes("值得复查"), false);
});

test("time recap strips cleanup recommendations from recap body fields", async () => {
  const chrome = seededRecapChrome();
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_recap_time_recap_v1",
                language: "zh-CN",
                headline: "这一周主要在做扩展发布",
                summary:
                  "主要围绕 TabRecap 发布检查推进。这个旧标签页可以关闭。这个页面未必需要一直挂着。已结合打开/关闭状态和活动记录。",
                themes: [
                  {
                    title: "发布检查",
                    description: "权限、发布和回顾体验是主线。YachtWorld 页面是否保留可以回头判断。后面可以收掉这几个标签页。",
                    confidence: "high",
                    ids: [1],
                    evidence: ["发布检查", "建议关闭旧页面"]
                  }
                ],
                timeline: [
                  {
                    label: "周末",
                    description: "集中做发布验证。Review whether to keep stale tabs. Check later whether to keep these tabs.",
                    ids: [1]
                  }
                ],
                followUps: [],
                coverageNote: "使用本地线索。"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "zh-CN"
    },
    {
      range: { preset: "7d" },
      now: NOW,
      fetchImpl
    }
  );
  const visibleText = JSON.stringify(result.recap);

  assert.equal(result.source, "ai");
  assert.match(result.recap.summary, /打开\/关闭状态/);
  assert.match(result.recap.themes[0].description, /权限、发布和回顾体验/);
  assert.match(result.recap.timeline[0].description, /集中做发布验证/);
  assert.doesNotMatch(visibleText, /可以关闭|未必需要一直挂着|是否保留|收掉这几个标签页|建议关闭|Review whether|stale tabs|whether to keep/);
});

test("time recap does not replace filtered cleanup follow-ups with local continuation items", async () => {
  const chrome = seededRecapChrome();
  const fetchCalls = [];
  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key"
    },
    {
      now: Date.parse("2026-06-27T12:00:00.000Z"),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      schema: "tab_recap_time_recap_v1",
                      language: "zh-CN",
                      headline: "主要在整理发布检查。",
                      summary: "这段时间主要围绕发布检查推进。",
                      themes: [],
                      timeline: [],
                      followUps: [
                        {
                          title: "关闭发布检查页",
                          reason: "这个页面已经过期，值得复查是否保留。",
                          ids: [1]
                        }
                      ],
                      coverageNote: "Used local signals."
                    })
                  }
                }
              ]
            })
        };
      }
    }
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(result.source, "ai");
  assert.deepEqual(result.recap.followUps, []);
});

test("time recap runtime message returns local fallback without mutating tabs", async () => {
  const chrome = seededRecapChrome();

  const result = await handleRuntimeMessage(chrome, {
    type: "activity:generateTimeRecap",
    settings: { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, languageMode: "en-US" },
    languageMode: "en-US",
    range: { preset: "30d" }
  });

  assert.equal(result.source, "local");
  assert.equal(result.recap.schema, "tab_recap_time_recap_v1");
  assert.equal((await chrome.tabs.query({})).length, 3);
});

test("time recap runtime message honors explicit timeout and falls back locally", async () => {
  const chrome = seededRecapChrome();
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return new Promise(() => {});
  };

  try {
    const startedAt = Date.now();
    const result = await handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      settings: {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "http://127.0.0.1:8317/v1",
        gatewayApiKey: "test-key",
        languageMode: "zh-CN"
      },
      languageMode: "zh-CN",
      range: { preset: "7d" },
      timeoutMs: 25
    });

    assert.equal(requested, true);
    assert.equal(result.source, "local_fallback");
    assert.match(result.error, /timed out/);
    assert.doesNotMatch(result.recap.coverageNote, /AI 增强|AI 回顾暂时不可用|timed out/);
    assert.match(result.recap.coverageNote, /本机页面线索/);
    assert.equal(Date.now() - startedAt < 1500, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("time recap runtime message can be canceled while AI is running", async () => {
  const chrome = seededRecapChrome();
  const originalFetch = globalThis.fetch;
  let sawAbort = false;
  let releaseFetchStart;
  const fetchStarted = new Promise((resolve) => {
    releaseFetchStart = resolve;
  });
  globalThis.fetch = async (_url, init = {}) => {
    releaseFetchStart();
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => {
          sawAbort = true;
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
    });
  };

  try {
    const pending = handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_cancel_test",
      settings: {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "http://127.0.0.1:8317/v1",
        gatewayApiKey: "test-key",
        languageMode: "zh-CN"
      },
      range: { preset: "7d" }
    });
    await fetchStarted;
    const canceled = await handleRuntimeMessage(chrome, {
      type: "activity:cancelTimeRecap",
      operationId: "recap_cancel_test"
    });

    assert.equal(canceled.canceled, true);
    await assert.rejects(pending, /已停止生成回顾/);
    assert.equal(sawAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("time recap cancellation is scoped per source window", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Window one research", url: "https://example.com/one", active: true }]
      },
      {
        id: 2,
        focused: false,
        tabs: [{ id: 20, title: "Window two research", url: "https://example.com/two", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const request = {
      requestId: init.headers?.["x-tab-recap-request-id"] || "",
      aborted: false
    };
    requests.push(request);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => {
          request.aborted = true;
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
    });
  };

  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "zh-CN"
    };
    const pendingOne = handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_window_one",
      windowId: 1,
      settings,
      range: { preset: "7d" }
    });
    const pendingTwo = handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_window_two",
      windowId: 2,
      settings,
      range: { preset: "7d" }
    });
    await waitForCondition(() => requests.length === 2, "Timed out waiting for both recap requests.");

    const canceledOne = await handleRuntimeMessage(chrome, {
      type: "activity:cancelTimeRecap",
      operationId: "recap_window_one",
      windowId: 1
    });
    assert.equal(canceledOne.canceled, true);
    await assert.rejects(pendingOne, /已停止生成回顾/);
    assert.equal(requests.find((request) => request.requestId === "recap_window_one")?.aborted, true);
    assert.equal(requests.find((request) => request.requestId === "recap_window_two")?.aborted, false);

    const wrongWindowCancel = await handleRuntimeMessage(chrome, {
      type: "activity:cancelTimeRecap",
      operationId: "recap_window_two",
      windowId: 1
    });
    assert.equal(wrongWindowCancel.canceled, false);
    assert.equal(requests.find((request) => request.requestId === "recap_window_two")?.aborted, false);

    const canceledTwo = await handleRuntimeMessage(chrome, {
      type: "activity:cancelTimeRecap",
      operationId: "recap_window_two",
      windowId: 2
    });
    assert.equal(canceledTwo.canceled, true);
    await assert.rejects(pendingTwo, /已停止生成回顾/);
    assert.equal(requests.find((request) => request.requestId === "recap_window_two")?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("time recap newer same-window requests replace stale ones", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Recap race research", url: "https://example.com/race", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const request = {
      requestId: init.headers?.["x-tab-recap-request-id"] || "",
      aborted: false
    };
    requests.push(request);
    if (request.requestId === "recap_superseded") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            request.aborted = true;
            reject(new Error("fetch aborted"));
          },
          { once: true }
        );
      });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_recap_time_recap_v1",
                language: "zh-CN",
                headline: "第二次回顾生效",
                summary: "新的同窗口回顾结果应该保留下来。",
                themes: [],
                timeline: [],
                followUps: [],
                coverageNote: "使用最新请求。"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "zh-CN"
    };
    const superseded = handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_superseded",
      windowId: 1,
      settings,
      range: { preset: "7d" }
    });
    await waitForCondition(() => requests.length === 1, "Timed out waiting for the superseded recap request.");
    const supersededRejection = assert.rejects(superseded, /已停止生成回顾/);

    const latest = await handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_latest",
      windowId: 1,
      settings,
      range: { preset: "7d" }
    });

    await supersededRejection;
    assert.equal(requests.find((request) => request.requestId === "recap_superseded")?.aborted, true);
    assert.equal(latest.source, "ai");
    assert.equal(latest.recap.headline, "第二次回顾生效");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("time recap local themes do not use existing browser groups as the primary axis", async () => {
  const chrome = seededRecapChrome();

  const result = await generateTimeRecap(
    chrome,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, languageMode: "zh-CN" },
    { range: { preset: "7d" }, now: NOW }
  );

  assert.equal(result.source, "local");
  assert.equal(result.recap.themes.some((theme) => theme.title === "Extension release"), false);
  assert.equal(result.recap.timeline.length > 0, true);
  assert.match(result.recap.summary, /打开次数/);
});

test("time recap custom range is capped and validates ordering", () => {
  const range = normalizeTimeRecapRange(
    {
      preset: "custom",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-27T06:00:00.000Z"
    },
    NOW
  );

  assert.equal(range.label, "90d");
  assert.equal(Date.parse(range.to) - Date.parse(range.from), 90 * 24 * 60 * 60 * 1000);
  assert.throws(
    () => normalizeTimeRecapRange({ preset: "custom", from: "2026-06-28T00:00:00.000Z", to: "2026-06-27T00:00:00.000Z" }, NOW),
    /after the start/
  );
});

test("time recap preset ranges support quick range buttons", () => {
  assert.equal(normalizeTimeRecapRange({ preset: "1d" }, NOW).label, "1d");
  assert.equal(normalizeTimeRecapRange({ preset: "thisWeek" }, NOW).label, "thisWeek");
  assert.equal(normalizeTimeRecapRange({ preset: "thisMonth" }, NOW).label, "thisMonth");
});

function seededRecapChrome() {
  const chrome = createFakeChrome({
    groups: [{ id: 77, windowId: 1, title: "Extension release", color: "blue" }],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          {
            id: 10,
            title: "TabRecap release checklist",
            url: "https://github.com/acme/SECRET123456789012?token=secret#release",
            active: true,
            groupId: 77
          },
          {
            id: 11,
            title: "Forum thread about extension permissions",
            url: "https://forum.example.com/thread/permissions"
          },
          {
            id: 12,
            title: "Chrome extensions settings",
            url: "chrome://extensions"
          }
        ]
      }
    ]
  });

  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      release: {
        key: "release",
        title: "TabRecap release checklist",
        hostname: "github.com",
        sanitizedUrl: "https://github.com/acme",
        firstSeenAt: "2026-06-25T02:00:00.000Z",
        lastSeenAt: "2026-06-27T05:00:00.000Z",
        seenCount: 4,
        sampleable: true,
        sample: {
          title: "Release checklist",
          metaDescription: "Extension release checklist",
          contentKind: "project",
          headings: ["QA", "Release"]
        }
      },
      old: {
        key: "old",
        title: "Old unrelated page",
        hostname: "old.example",
        sanitizedUrl: "https://old.example/archive",
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        seenCount: 1
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      forum: {
        key: "forum",
        origin: "https://forum.example.com/*",
        title: "Forum thread about extension permissions",
        firstSeenAt: "2026-06-26T03:00:00.000Z",
        lastSeenAt: "2026-06-27T03:00:00.000Z",
        sampledAt: "2026-06-27T03:00:00.000Z",
        lastUsedAt: "2026-06-27T03:00:00.000Z",
        seenCount: 2,
        sample: {
          title: "Forum thread about extension permissions",
          metaDescription: "Discussion about extension permissions",
          contentKind: "discussion",
          headings: ["Host permissions"],
          visibleText: "Readable forum discussion about browser extensions and page access."
        }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      release: {
        sessionId: "release",
        tabId: 10,
        windowId: 1,
        index: 0,
        title: "TabRecap release checklist",
        hostname: "github.com",
        sanitizedUrl: "https://github.com/acme",
        urlKey: "release",
        openedAt: "2026-06-25T02:00:00.000Z",
        firstObservedAt: "2026-06-25T02:00:00.000Z",
        lastObservedAt: "2026-06-27T05:30:00.000Z",
        lastActivatedAt: "2026-06-27T05:30:00.000Z",
        activeCount: 3,
        groupId: 77
      }
    },
    events: []
  };
  return chrome;
}

async function waitForCondition(predicate, message) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}
