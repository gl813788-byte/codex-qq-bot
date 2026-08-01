import assert from "node:assert/strict";
import test from "node:test";
import { handleHubHttpRequest } from "../src/channels/http/hub-http-server.js";

function dependencies(overrides = {}) {
  const sends = [];
  return {
    sends,
    deps: {
      handleApi: async () => false,
      handleDashboardAsset: async () => false,
      sendJson: (_res, status, body) => sends.push({ status, body }),
      logger: { error() {} },
      oneBotWebhookLimiter: { run: (task) => task() },
      shutdownSignal: new AbortController().signal,
      ...overrides
    }
  };
}

test("OneBot webhook requests pass through the bounded limiter", async () => {
  let limited = 0;
  let apiCalls = 0;
  const { sends, deps } = dependencies({
    handleApi: async () => { apiCalls += 1; },
    oneBotWebhookLimiter: { run: async (task) => { limited += 1; return task(); } }
  });
  await handleHubHttpRequest({ method: "POST", url: "/api/onebot/event" }, {}, deps);
  assert.equal(limited, 1);
  assert.equal(apiCalls, 1);
  assert.deepEqual(sends, []);
});

test("unknown routes fall through assets to a JSON 404", async () => {
  const { sends, deps } = dependencies();
  await handleHubHttpRequest({ method: "GET", url: "/missing" }, {}, deps);
  assert.deepEqual(sends, [{ status: 404, body: { error: "Not found" } }]);
});

test("HTTP errors preserve safe client status and hide internal failures", async () => {
  const badRequest = dependencies({ handleApi: async () => Object.assign(Promise.reject(new Error("bad input")), {}) });
  await handleHubHttpRequest({ method: "POST", url: "/api/test" }, {}, badRequest.deps);
  assert.deepEqual(badRequest.sends, [{ status: 500, body: { error: "Internal server error" } }]);

  const forbidden = dependencies({
    handleApi: async () => { throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); }
  });
  await handleHubHttpRequest({ method: "POST", url: "/api/test" }, {}, forbidden.deps);
  assert.deepEqual(forbidden.sends, [{ status: 403, body: { error: "Forbidden" } }]);
});
