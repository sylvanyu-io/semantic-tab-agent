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
