import assert from "node:assert/strict";
import test from "node:test";
import { fetchJsonWithTimeout } from "../src/core/fetch-timeout.js";

test("fetch timeout helper redacts non-json response details at the source", async () => {
  const secrets = [
    "auth-fetch-secret-123456",
    "cookie-fetch-secret",
    "query-fetch-secret",
    "body-fetch-secret"
  ];
  const responseText = [
    `Authorization: Bearer ${secrets[0]}`,
    `Cookie: sid=${secrets[1]}`,
    `https://private.example.com/path/to/secret?token=${secrets[2]}`,
    `api_key=${secrets[3]}`
  ].join("\n");

  const { response, data } = await fetchJsonWithTimeout(
    async () => new Response(responseText, { status: 502 }),
    "https://gateway.example/v1/chat/completions",
    {},
    "AI gateway planner",
    1000
  );
  const serialized = JSON.stringify(data);

  assert.equal(response.status, 502);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.match(data.error.message, /Authorization: \[redacted\]/);
  assert.match(data.error.message, /Cookie: \[redacted\]/);
  assert.match(data.error.message, /\[redacted-url\]/);
  assert.equal(serialized.includes("private.example.com"), false);
  assert.equal(serialized.includes("/path/to/secret"), false);
  assert.equal(serialized.includes("token="), false);
  assert.equal(serialized.includes("api_key=[redacted]"), true);
});
