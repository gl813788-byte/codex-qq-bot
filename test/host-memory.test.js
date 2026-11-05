import assert from "node:assert/strict";
import test from "node:test";
import { classifyHostCommandMemoryNeed, createHostMemoryGate, readAvailableMemoryBytes } from "../src/host-memory.js";
import { executeQqHostCommand } from "../src/app/qq-host-command.js";
import { createQqMediaRuntime } from "../src/qq-media/media-runtime.js";

const MB = 1024 * 1024;

test("available memory comes from MemAvailable with a fallback", async () => {
  assert.equal(await readAvailableMemoryBytes({ read: async () => "MemTotal: 8000000 kB\nMemAvailable:    2048000 kB\n" }), 2048000 * 1024);
  assert.equal(await readAvailableMemoryBytes({ read: async () => { throw new Error("no proc"); }, fallback: () => 123 }), 123);
  const gate = createHostMemoryGate({ minAvailableBytes: 1000 * MB, readAvailable: async () => 900 * MB });
  assert.deepEqual(await gate(), { ok: false, availableBytes: 900 * MB, minimumBytes: 1000 * MB });
  assert.equal((await createHostMemoryGate({ minAvailableBytes: 0 })()).ok, true);
});

test("command weights follow what has killed the phone before", () => {
  assert.equal(classifyHostCommandMemoryNeed("cd repo && npm run verify").kind, "parallel-test");
  assert.equal(classifyHostCommandMemoryNeed("node --test test/a.test.js").kind, "parallel-test");
  assert.equal(classifyHostCommandMemoryNeed("node --test --test-concurrency=1 test/a.test.js").kind, "command");
  assert.equal(classifyHostCommandMemoryNeed("tar xjf model.tar.bz2").kind, "heavy");
  assert.equal(classifyHostCommandMemoryNeed("npm install").kind, "heavy");
  assert.equal(classifyHostCommandMemoryNeed("ls -la").kind, "command");
});

test("owner host commands and media jobs are refused before starting when memory is short", async () => {
  let executed = false;
  const refused = await executeQqHostCommand({ command: "npm run verify", reason: "主人要求跑测试" }, {
    event: { isOwner: true, senderId: "10001" },
    projectDir: "/tmp",
    execute: async () => { executed = true; return { code: 0, stdout: "", stderr: "" }; },
    readAvailableMemory: async () => 2000 * MB
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /内存保护/);
  assert.equal(executed, false);

  let ran = false;
  const runtime = createQqMediaRuntime({
    toolsDir: "/tools",
    workerScript: "/worker.mjs",
    inspect: async () => ({ audio: true, ffmpeg: "/usr/bin/ffmpeg", paths: {} }),
    checkMemory: async () => ({ ok: false, availableBytes: 700 * MB, minimumBytes: 1200 * MB }),
    runProcess: async () => { ran = true; return { stdout: "{}" }; }
  });
  await assert.rejects(runtime.transcribe("/a.wav"), (error) => error.code === "MEDIA_LOW_MEMORY");
  assert.equal(ran, false);
});
