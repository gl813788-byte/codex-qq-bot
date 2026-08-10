import assert from "node:assert/strict";
import test from "node:test";
import { createQqSocialBridgeClient } from "../src/qq-social-bridge-client.js";

test("QQ social bridge client stays explicitly unavailable when it is not configured", async () => {
  const client = createQqSocialBridgeClient();
  assert.equal(client.configured, false);
  const result = await client.handleRequest({ request_type: "friend", flag: "1", approve: true });
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.ambiguous, false);
});

test("QQ social bridge client posts bounded request operations and parses success", async () => {
  const calls = [];
  const client = createQqSocialBridgeClient({
    baseUrl: "http://127.0.0.1:6099/api/Plugin/ext/napcat-plugin-builtin/",
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { ok: true, status: "approved" }; } };
    }
  });
  const result = await client.handleRequest({ request_type: "friend", flag: "1", approve: true });
  assert.equal(result.ok, true);
  assert.equal(result.unavailable, false);
  assert.equal(calls[0].url.endsWith("/handle-request"), true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { request_type: "friend", flag: "1", approve: true });
});

test("QQ social bridge client distinguishes a missing route from an absent request", async () => {
  const responses = [
    { error: "Route POST:/handle-request not found" },
    { error: "request_not_found" }
  ];
  const client = createQqSocialBridgeClient({
    baseUrl: "http://127.0.0.1:6099/plugin",
    fetchImpl: async () => ({ ok: false, status: 404, async json() { return responses.shift(); } })
  });
  assert.equal((await client.handleRequest({})).unavailable, true);
  assert.equal((await client.handleRequest({})).unavailable, false);
});

test("QQ social bridge client marks transport failures ambiguous so writes are not retried elsewhere", async () => {
  const client = createQqSocialBridgeClient({
    baseUrl: "http://127.0.0.1:6099/plugin",
    fetchImpl: async () => { throw new Error("connection reset"); }
  });
  const result = await client.handleRequest({ request_type: "group", flag: "2", approve: false });
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, false);
  assert.equal(result.ambiguous, true);
});
