export function redactSensitiveText(value, options = {}) {
  return String(value || "")
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(authorization)\s*([:=])\s*[^\n\r<>]+/gi, (_match, key, separator) =>
      separator === ":" ? `${key}: [redacted]` : `${key}=[redacted]`
    )
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\n\r<>]+/gi, (_match, key) => `${key}: [redacted]`)
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/\bre_[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]")
    .replace(/\bghp_[A-Za-z0-9_]{36,}\b/g, "[redacted-key]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, "[redacted-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted-key]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]")
    .replace(
      /((?:["']?)(?:api[_-]?key|private[_-]?key|session[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password)(?:["']?)\s*[:=]\s*)(["']?)[^"',\s;&<>}]+(\2)/gi,
      "$1$2[redacted]$3"
    )
    .replace(/([?&](?:access_token|refresh_token|api[_-]?key|private[_-]?key|session[_-]?key|token|secret|password|key)=)[^&\s"')<>]+/gi, "$1[redacted]")
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
