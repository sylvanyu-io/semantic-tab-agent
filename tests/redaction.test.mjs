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

test("redacts malformed URL matches to a stable placeholder", () => {
  assert.equal(redactSensitiveUrl("https://", { fallback: "[url]" }), "[url]");
});
