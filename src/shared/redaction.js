export function redactSensitiveText(value, options = {}) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/([?&](?:access_token|refresh_token|api[_-]?key|token|secret|password|key)=)[^&\s"')<>]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"')<>]+/gi, (rawUrl) => redactSensitiveUrl(rawUrl, options));
}

export function redactSensitiveUrl(rawUrl, options = {}) {
  const fallback = options.fallback || "[redacted-url]";
  try {
    const url = new URL(String(rawUrl || ""));
    return `${url.protocol}//${url.hostname}${url.pathname && url.pathname !== "/" ? "/..." : ""}`;
  } catch {
    return fallback;
  }
}
