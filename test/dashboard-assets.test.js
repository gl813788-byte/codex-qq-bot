import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardAssetHandler } from "../src/dashboard-assets.js";

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.body = body;
    }
  };
}

test("serves only known dashboard assets with browser security headers", async () => {
  const loads = [];
  const handler = createDashboardAssetHandler({
    directory: "/virtual/dashboard",
    loadAsset: async (path) => {
      loads.push(path);
      return Buffer.from(path.endsWith("client.html") ? "<main>Hub</main>" : "asset");
    }
  });
  for (const [url, contentType] of [
    ["/", "text/html"], ["/dashboard", "text/html"], ["/client.css", "text/css"],
    ["/client.js", "text/javascript"], ["/images/nexus-core.webp", "image/webp"]
  ]) {
    const response = createResponse();
    assert.equal(await handler({ method: "GET", url, headers: {} }, response), true, url);
    assert.equal(response.statusCode, 200);
    assert.ok(response.headers["content-type"].startsWith(contentType), url);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.ok(response.headers.etag);
    if (contentType === "text/html") assert.equal(response.body.toString(), "<main>Hub</main>");
  }

  const loadCount = loads.length;
  const missing = createResponse();
  assert.equal(await handler({ method: "GET", url: "/../server.js", headers: {} }, missing), false);
  assert.equal(loads.length, loadCount);
});

test("supports HEAD, conditional requests, and in-memory asset caching", async () => {
  let loads = 0;
  const handler = createDashboardAssetHandler({
    directory: "/virtual/dashboard",
    loadAsset: async () => {
      loads += 1;
      return Buffer.from("body");
    }
  });
  const first = createResponse();
  await handler({ method: "HEAD", url: "/client.css", headers: {} }, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body, undefined);
  assert.equal(first.headers["content-length"], 4);

  const cached = createResponse();
  await handler({
    method: "GET",
    url: "/client.css",
    headers: { "if-none-match": first.headers.etag }
  }, cached);
  assert.equal(cached.statusCode, 304);
  assert.equal(loads, 1);
});
