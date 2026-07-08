import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, redactSensitiveUrl } from "../src/shared/redaction.js";

test("redacts provider keys, bearer tokens, tokenized query params, and URL paths", () => {
  const providerKey = ["sk", "private", "provider", "token", "1234567890"].join("-");
  const bearer = "live-provider-secret-1234567890";
  const input = [
    `Bearer ${bearer}`,
    providerKey,
    "https://private.example.com/secret/project?token=abc123&api_key=def456",
    "https://public.example.com/"
  ].join(" ");
  const output = redactSensitiveText(input);

  assert.match(output, /Bearer \[redacted\]/);
  assert.match(output, /\[redacted-key\]/);
  assert.match(output, /https:\/\/private\.example\.com\/\.\.\./);
  assert.match(output, /https:\/\/public\.example\.com\b/);
  assert.equal(output.includes(providerKey), false);
  assert.equal(output.includes(bearer), false);
  assert.equal(output.includes("token=abc123"), false);
  assert.equal(output.includes("api_key=def456"), false);
  assert.equal(output.includes("/secret/project"), false);
});

test("redacts common cloud and developer token shapes covered by release scanning", () => {
  const keys = [
    ["re", "A".repeat(22)].join("_"),
    ["ghp", "B".repeat(36)].join("_"),
    ["github", "pat", "C".repeat(80)].join("_"),
    `AIza${"D".repeat(35)}`,
    `AKIA${"E".repeat(16)}`
  ];
  const output = redactSensitiveText(keys.join(" "));

  for (const key of keys) {
    assert.equal(output.includes(key), false);
  }
  assert.equal(output.match(/\[redacted-key\]/g)?.length, keys.length);
});

test("redacts pem private key blocks", () => {
  const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const end = ["-----END", "PRIVATE KEY-----"].join(" ");
  const privateKeyBody = "abc123-private-key-material";
  const output = redactSensitiveText(`prefix ${begin}\n${privateKeyBody}\n${end} suffix`);

  assert.equal(output.includes(privateKeyBody), false);
  assert.equal(output.includes(begin), false);
  assert.equal(output.includes(end), false);
  assert.match(output, /\[redacted-key\]/);
});

test("redacts structured auth headers, cookies, and secret fields", () => {
  const secrets = {
    authorization: "auth-header-secret-123456",
    cookie: "cookie-session-secret",
    setCookie: "set-cookie-secret",
    apiKey: "plain-api-secret",
    jsonApiKey: "json-api-secret",
    privateKey: "private-key-secret",
    sessionKey: "session-key-secret",
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    password: "hunter2-secret"
  };
  const input = [
    `Authorization: Bearer ${secrets.authorization}`,
    `Cookie: session=${secrets.cookie}; theme=dark`,
    `Set-Cookie: sid=${secrets.setCookie}; HttpOnly`,
    `api_key=${secrets.apiKey}`,
    `"apiKey":"${secrets.jsonApiKey}"`,
    `private_key=${secrets.privateKey}`,
    `"session-key":"${secrets.sessionKey}"`,
    `'accessToken': '${secrets.accessToken}'`,
    `refresh-token:${secrets.refreshToken}`,
    `password: ${secrets.password}`
  ].join("\n");
  const output = redactSensitiveText(input);

  for (const secret of Object.values(secrets)) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /Authorization: \[redacted\]/);
  assert.match(output, /Cookie: \[redacted\]/);
  assert.match(output, /Set-Cookie: \[redacted\]/);
  assert.match(output, /api_key=\[redacted\]/);
  assert.match(output, /"apiKey":"\[redacted\]"/);
  assert.match(output, /private_key=\[redacted\]/);
  assert.match(output, /"session-key":"\[redacted\]"/);
  assert.match(output, /'accessToken': '\[redacted\]'/);
  assert.match(output, /refresh-token:\[redacted\]/);
  assert.match(output, /password: \[redacted\]/);
});

test("redacts malformed URL matches to a stable placeholder", () => {
  assert.equal(redactSensitiveUrl("https://", { fallback: "[url]" }), "[url]");
});

test("can fully hide URLs for visible UI diagnostics", () => {
  const output = redactSensitiveText("failed at https://private.example.com/path?token=abc123", { redactUrls: true });

  assert.equal(output, "failed at [redacted-url]");
  assert.equal(output.includes("private.example.com"), false);
});
