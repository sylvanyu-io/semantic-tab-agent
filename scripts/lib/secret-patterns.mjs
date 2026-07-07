export const SECRET_PATTERNS = [
  {
    name: "provider_api_key",
    pattern: /\b(?:sk-proj|sk-ant|sk-or|sk)-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    name: "resend_api_key",
    pattern: /\bre_[A-Za-z0-9_-]{20,}\b/g
  }
];
