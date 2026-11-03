import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSubscriptionModelTaskRunner, decodeTaskImageDataUrl } from "../src/infrastructure/agent/subscription-model-task.js";
import { splitInterestChatMessages, resolveInterestModelRuntimeConfig, isSubscriptionInterestProvider } from "../src/interest-model-provider.js";

const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

test("subscription tasks run one at a time, refuse a full queue and clean up", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "sub-task-"));
  try {
    const seen = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const runner = createSubscriptionModelTaskRunner({
      workspaceDir,
      maxConcurrent: 1,
      maxQueued: 1,
      runTask: async (engine, options) => {
        seen.push({ engine, model: options.model, images: options.imagePaths.length, cwdExists: existsSync(options.cwd), schema: options.outputSchema });
        await gate;
        return { finalResponse: " {\"ok\":true} " };
      }
    });
    const first = runner({ engine: "codex", model: "gpt-x", userText: "hi", images: [{ dataUrl: png }, { dataUrl: "data:text/plain;base64,AA==" }], outputSchema: { type: "object" } });
    const second = runner({ engine: "claude", userText: "hi" });
    const third = await runner({ engine: "claude", userText: "hi" });
    assert.equal(third.ok, false);
    assert.equal(third.code, "SUBSCRIPTION_TASK_BUSY");
    assert.equal(runner.snapshot().waiting, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.ok, true);
    assert.equal(a.content, "{\"ok\":true}");
    assert.equal(a.imageCount, 1, "only a valid raster data URL becomes a file");
    assert.equal(b.ok, true);
    assert.deepEqual(seen.map((item) => item.engine), ["codex", "claude"]);
    assert.equal(seen[0].cwdExists, true);
    assert.deepEqual(readdirSync(workspaceDir), [], "task directories are removed");
    assert.equal(runner.snapshot().completed, 2);
    assert.equal(runner.snapshot().active, 0);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("subscription task failures are reported without throwing", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "sub-task-"));
  try {
    const runner = createSubscriptionModelTaskRunner({
      workspaceDir,
      runTask: async () => { throw Object.assign(new Error("not logged in"), { code: "CODEX_EXITED" }); }
    });
    const result = await runner({ engine: "codex", userText: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "CODEX_EXITED");
    assert.match(result.reason, /not logged in/);
    assert.equal(runner.snapshot().failed, 1);
    assert.equal(runner.snapshot().last.ok, false);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("image data URLs are bounded and typed", () => {
  assert.equal(decodeTaskImageDataUrl(png).extension, "png");
  assert.equal(decodeTaskImageDataUrl(png, 3), null, "oversized pictures are dropped");
  assert.equal(decodeTaskImageDataUrl("data:image/svg+xml;base64,AA=="), null);
});

test("subscription providers need no key and split chat messages into one turn", () => {
  assert.equal(isSubscriptionInterestProvider("codex"), true);
  assert.equal(isSubscriptionInterestProvider("openrouter"), false);
  const runtime = resolveInterestModelRuntimeConfig("claude", { customInterestModelApiKey: "secret" });
  assert.equal(runtime.apiKeyConfigured, true);
  assert.equal(runtime.apiKey, "");
  assert.equal(runtime.baseUrl, "");
  const split = splitInterestChatMessages([
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "text", text: "{\"a\":1}" }, { type: "image_url", image_url: { url: png } }, { type: "image_url", image_url: { url: "https://x/y.png" } }] }
  ]);
  assert.equal(split.systemPrompt, "rules");
  assert.equal(split.userText, "{\"a\":1}");
  assert.equal(split.images.length, 1, "remote URLs are never forwarded");
});
