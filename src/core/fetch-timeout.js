import { redactSensitiveText } from "../shared/redaction.js";

export async function fetchJsonWithTimeout(
  fetchImpl,
  url,
  options,
  label,
  timeoutMs = null,
  externalSignal = null
) {
  if (externalSignal?.aborted) {
    throw new Error(`${label} was canceled.`);
  }

  const controller = new AbortController();
  let timeoutId = null;
  let abortedByExternalSignal = false;
  const timeout = Number(timeoutMs);
  const shouldUseTimeout = Number.isFinite(timeout) && timeout > 0;
  const abortFromExternalSignal = () => {
    abortedByExternalSignal = true;
    controller.abort();
  };

  externalSignal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });

  const timeoutPromise = shouldUseTimeout
    ? new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out after ${Math.round(timeout / 1000)} seconds.`));
        }, Math.max(10, timeout));
      })
    : null;

  try {
    const fetchPromise = (async () => {
      try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const data = await readJsonResponse(response, label);
        return { response, data };
      } catch (error) {
        if (abortedByExternalSignal) {
          throw new Error(`${label} was canceled.`);
        }
        throw error;
      }
    })();
    return await (timeoutPromise ? Promise.race([fetchPromise, timeoutPromise]) : fetchPromise);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
  }
}

async function readJsonResponse(response, label) {
  if (typeof response.text !== "function") {
    return response.json();
  }

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const message = compactResponseText(text) || error.message;
    if (!response.ok) {
      return {
        error: {
          message
        },
        rawText: message
      };
    }
    return {
      output_text: text,
      rawText: message
    };
  }
}

function compactResponseText(text) {
  return redactSensitiveText(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
