import {
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { canSampleUrl, getTabUrl } from "./url-sanitizer.js";

export async function requestPageSample(chromeApi, tab, rawSettings, reason = "") {
  const settings = normalizeSettings(rawSettings);
  const rawUrl = getTabUrl(tab);

  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) {
    return { status: "disabled", reason: "Page context is off." };
  }
  if (settings.pageSamplingConsentMode === PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED) {
    return { status: "blocked", reason: "Page sampling risk has not been acknowledged." };
  }
  if (!canSampleUrl(rawUrl)) {
    return { status: "unsupported_url", reason: "This URL scheme cannot be sampled." };
  }
  if (!chromeApi.scripting?.executeScript) {
    return { status: "blocked", reason: "The scripting permission is not available." };
  }

  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY) {
    if (!tab.active) {
      return { status: "blocked", reason: "activeTab sampling is limited to the active tab." };
    }
    try {
      return {
        status: "ok",
        origin: hostPermissionPattern(rawUrl),
        sample: await executePageSample(chromeApi, tab, reason)
      };
    } catch {
      return {
        status: "permission_required",
        origin: hostPermissionPattern(rawUrl),
        reason: "Temporary activeTab access is not available for this tab."
      };
    }
  }

  const origin = hostPermissionPattern(rawUrl);
  const hasPermission = await containsHostPermission(chromeApi, origin);
  if (!hasPermission) {
    return { status: "permission_required", origin, reason: "Host permission is required for page sampling." };
  }

  try {
    return { status: "ok", origin, sample: await executePageSample(chromeApi, tab, reason) };
  } catch (error) {
    return {
      status: "permission_required",
      origin,
      reason: executionPermissionReason(error)
    };
  }
}

function hostPermissionPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function containsHostPermission(chromeApi, origin) {
  if (await chromeApi.permissions.contains({ origins: [origin] })) return true;
  const broadOrigin = broadHostPattern(origin);
  return Boolean(broadOrigin && (await chromeApi.permissions.contains({ origins: [broadOrigin] })));
}

function broadHostPattern(origin) {
  if (origin.startsWith("https://")) return "https://*/*";
  if (origin.startsWith("http://")) return "http://*/*";
  return "";
}

async function executePageSample(chromeApi, tab, reason) {
  const [result] = await chromeApi.scripting.executeScript({
    target: { tabId: tab.id || tab.tabId },
    func: samplePage,
    args: [reason]
  });

  return result?.result || null;
}

function executionPermissionReason(error) {
  const message = String(error?.message || "");
  if (/cannot access contents|manifest must request permission|Cannot access a chrome/i.test(message)) {
    return "Chrome did not allow reading this page. Host permission may be missing, expired, or restricted for this page.";
  }
  return "Chrome did not allow reading this page.";
}

export function samplePage(reason) {
  const TEXT_LIMIT = 2600;
  const metaDescription =
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    "";
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || "";
  const headings = [...document.querySelectorAll("h1,h2")]
    .map((node) => cleanText(node.textContent))
    .filter(Boolean)
    .slice(0, 12);
  const extraction = extractUsefulVisibleText(TEXT_LIMIT);

  return {
    reason,
    title: cleanText(document.title),
    metaDescription: cleanText(metaDescription),
    canonicalUrl,
    language: document.documentElement.lang || "",
    headings,
    contentKind: extraction.kind,
    visibleText: extraction.text
  };

  function extractUsefulVisibleText(limit) {
    const discussionSnippets = collectDiscussionSnippets();
    const bestContainer = findBestContentContainer();
    const blockText = collectReadableBlocks(limit);
    const bodyText = sanitizedElementText(document.body);
    const pieces = [];
    let kind = bestContainer.kind;

    if (bestContainer.text) pieces.push(bestContainer.text);
    if (discussionSnippets.length) {
      kind = kind === "article" && !looksLikeForumHost() ? "article" : "discussion";
      pieces.push(discussionSnippets.join(" "));
    }
    if (blockText && !pieces.some((piece) => overlapsEnough(piece, blockText))) pieces.push(blockText);
    if (!pieces.length && bodyText) {
      kind = "page";
      pieces.push(bodyText);
    }

    return {
      kind: kind || "page",
      text: stripKnownForumChrome(uniqueText(pieces.join(" "))).slice(0, limit)
    };
  }

  function findBestContentContainer() {
    const selector = [
      "article",
      "main",
      "[role='main']",
      "[itemprop='articleBody']",
      "#siteTable",
      "#thing_t3",
      ".sitetable",
      ".commentarea",
      ".commentarea .usertext-body",
      ".comment .usertext-body",
      ".comment-tree",
      ".commtext",
      ".toptext",
      ".markdown-body",
      ".entry-content",
      ".post-content",
      ".article-content",
      ".content",
      ".post",
      ".topic",
      ".thread",
      ".discussion",
      ".comment",
      ".reply",
      ".message",
      ".forum-post",
      ".topic-body",
      ".cooked",
      ".comment-body",
      ".issue-body",
      ".timeline-comment",
      ".js-comment-body"
    ].join(",");
    const specificCandidates = [...document.querySelectorAll(selector)].filter(Boolean);
    const candidates = specificCandidates.length ? specificCandidates : [document.body].filter(Boolean);
    let best = { element: null, score: 0, text: "", kind: "" };
    for (const element of candidates) {
      if (isNoiseElement(element) || isInvisible(element)) continue;
      const text = sanitizedElementText(element);
      if (text.length < 80) continue;
      const score = scoreContentElement(element, text);
      if (score > best.score) {
        best = { element, score, text: text.slice(0, 2200), kind: classifyContentElement(element) };
      }
    }
    return best;
  }

  function collectReadableBlocks(limit) {
    const selector = "h1,h2,h3,p,li,blockquote,pre";
    const blocks = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selector)) {
      if (isNoiseElement(node) || isInvisible(node)) continue;
      const text = sanitizedElementText(node);
      if (text.length < 24 || text.length > 900) continue;
      const key = text.toLowerCase();
      if (seen.has(key) || looksLikeBoilerplate(text)) continue;
      seen.add(key);
      blocks.push(text);
      if (blocks.join(" ").length >= limit) break;
    }
    return blocks.join(" ").slice(0, limit);
  }

  function collectDiscussionSnippets() {
    const selector = [
      "[itemprop='comment']",
      ".commentarea .usertext-body",
      ".comment .usertext-body",
      ".entry .usertext-body",
      ".comment-tree .commtext",
      ".commtext",
      "shreddit-comment",
      "[class*='comment' i]",
      "[class*='reply' i]",
      "[class*='post' i]",
      "[class*='message' i]",
      "[class*='topic-body' i]",
      "[class*='discussion' i]",
      "[data-testid*='comment' i]",
      "article"
    ].join(",");
    const snippets = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selector)) {
      if (isNoiseElement(node) || isInvisible(node)) continue;
      const text = sanitizedElementText(node);
      if (text.length < 50 || text.length > 1200 || looksLikeBoilerplate(text)) continue;
      const key = text.slice(0, 160).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      snippets.push(text.slice(0, 360));
      if (snippets.length >= 5) break;
    }
    return snippets;
  }

  function scoreContentElement(element, text) {
    const links = element.querySelectorAll ? [...element.querySelectorAll("a")] : [];
    const linkTextLength = links.reduce((sum, link) => sum + sanitizedElementText(link).length, 0);
    const linkDensity = text.length ? linkTextLength / text.length : 1;
    const blockCount = element.querySelectorAll?.("p,li,blockquote,pre,h1,h2,h3").length || 0;
    const codeCount = element.querySelectorAll?.("pre,code").length || 0;
    const idClass = `${element.id || ""} ${element.className || ""}`;
    const semanticBoost = /(article|post|thread|topic|comment|reply|message|discussion|content|main|markdown|cooked|body|issue)/i.test(idClass) ? 450 : 0;
    const tagBoost = ["ARTICLE", "MAIN"].includes(element.tagName) ? 350 : 0;
    return Math.min(text.length, 3500) + blockCount * 90 + codeCount * 140 + semanticBoost + tagBoost - linkDensity * 1800;
  }

  function sanitizedElementText(element) {
    if (!element || isEditableElement(element)) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(editableSelector()).forEach((node) => node.remove());
    return cleanText(clone.innerText || clone.textContent || "");
  }

  function isEditableElement(element) {
    return Boolean(element?.matches?.(editableSelector()));
  }

  function editableSelector() {
    return [
      "input",
      "textarea",
      "select",
      "option",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='textbox']",
      "[role='searchbox']",
      "[aria-multiline='true']",
      "[data-slate-editor='true']",
      "[data-lexical-editor='true']",
      ".ProseMirror",
      ".CodeMirror",
      ".cm-content",
      ".monaco-editor"
    ].join(",");
  }

  function classifyContentElement(element) {
    const idClass = `${element.id || ""} ${element.className || ""}`;
    if (looksLikeForumHost() || /(comment|reply|thread|topic|discussion|forum|message|sitetable|commtext)/i.test(idClass)) return "discussion";
    if (/(article|post|entry|markdown|cooked|issue|content)/i.test(idClass) || element.tagName === "ARTICLE") return "article";
    return "page";
  }

  function isNoiseElement(element) {
    if (!element?.closest) return false;
    return Boolean(
      element.closest(
        "nav,header,footer,aside,form,dialog,#header,.side,.titlebox,.tabmenu,.footer-parent,.nav-buttons,.infobar,.morelink,.promotedlink,[role='navigation'],[role='search'],[role='banner'],[role='contentinfo'],[aria-hidden='true']"
      )
    );
  }

  function looksLikeForumHost() {
    return /(^|\.)reddit\.com$|news\.ycombinator\.com$|discourse\.|stackoverflow\.com$|stackexchange\.com$/i.test(location.hostname);
  }

  function isInvisible(element) {
    const style = window.getComputedStyle?.(element);
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
  }

  function looksLikeBoilerplate(text) {
    const normalized = text.toLowerCase();
    if (/^(sign in|log in|register|subscribe|cookie|privacy|terms|home|menu|search)\b/.test(normalized)) return true;
    const words = normalized.split(/\s+/).filter(Boolean);
    const uniqueRatio = words.length ? new Set(words).size / words.length : 1;
    return words.length > 18 && uniqueRatio < 0.22;
  }

  function overlapsEnough(left, right) {
    if (!left || !right) return false;
    const smaller = left.length < right.length ? left : right;
    const larger = left.length < right.length ? right : left;
    return smaller.length > 120 && larger.includes(smaller.slice(0, 120));
  }

  function uniqueText(text) {
    const parts = cleanText(text).split(/(?<=[.!?。！？])\s+/u);
    const seen = new Set();
    const result = [];
    for (const part of parts) {
      const key = part.slice(0, 160).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
    return result.join(" ");
  }

  function stripKnownForumChrome(text) {
    return cleanText(text)
      .replace(/Welcome to Reddit[\s\S]{0,220}?×\s*\d+\s*/i, "")
      .replace(/Welcome to Reddit, the front page of the internet\.?/gi, "")
      .replace(/BECOME A REDDITOR and join one of thousands of communities\.?/gi, "")
      .replace(/BECOME A REDDITOR and start exploring\.?/gi, "")
      .replace(/Want to add to the discussion\?\s*Post a comment!\s*CREATE AN ACCOUNT/gi, "")
      .replace(/all \d+ comments\S* sorted by:\s*\w+/gi, "")
      .replace(/Sort by:\s*(Best|Top|New|Controversial|Old|Q&A)/gi, "");
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
}
