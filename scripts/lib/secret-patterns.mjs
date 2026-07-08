export const SECRET_PATTERNS = [
  {
    name: "provider_api_key",
    pattern: /\b(?:sk-proj|sk-ant|sk-or|sk)-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    name: "resend_api_key",
    pattern: /\bre_[A-Za-z0-9_-]{20,}\b/g
  },
  {
    name: "github_classic_token",
    pattern: /\bghp_[A-Za-z0-9_]{36,}\b/g
  },
  {
    name: "github_fine_grained_token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/g
  },
  {
    name: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    name: "aws_access_key_id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  }
];

export function findSecretPatternMatches(text) {
  const value = String(text || "");
  const findings = [];
  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0;
    for (const match of value.matchAll(rule.pattern)) {
      findings.push({
        rule: rule.name,
        value: match[0],
        offset: match.index
      });
    }
  }
  return findings;
}

export function matchesSecretPattern(ruleName, value) {
  return findSecretPatternMatches(value).some((finding) => finding.rule === ruleName);
}
