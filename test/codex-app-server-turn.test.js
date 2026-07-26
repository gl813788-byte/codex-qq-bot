import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runCodexAppServerTurn } from "../src/codex-app-server-turn.js";

test("runs one app-server turn and steers additional input into the active turn", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    codexPath: "codex",
    cwd: "/tmp/qq",
    model: "gpt-test",
    reasoningEffort: "low",
    prompt: "first message",
    imagePaths: ["/tmp/one.png"],
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });

  const controls = await readyPromise;
  const steered = await controls.steer("消息一：later one\n\n消息二：later two");
  assert.equal(steered.turnId, "turn-1");
  server.complete("the one combined reply");

  const result = await resultPromise;
  assert.equal(result.finalResponse, "the one combined reply");
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.turnId, "turn-1");
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/steer"]
  );
  assert.deepEqual(server.messages[3].params.input, [
    { type: "text", text: "first message" },
    { type: "localImage", path: "/tmp/one.png", detail: null }
  ]);
  assert.deepEqual(server.messages[4].params, {
    threadId: "thread-1",
    expectedTurnId: "turn-1",
    input: [{ type: "text", text: "消息一：later one\n\n消息二：later two" }]
  });
});

test("rejects steering after completion and aborts an active app-server turn", async () => {
  const completedServer = createFakeAppServer();
  let completedReady;
  const completedReadyPromise = new Promise((resolve) => { completedReady = resolve; });
  const completedResult = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: completedServer.spawn,
    onReady: completedReady
  });
  const completedControls = await completedReadyPromise;
  completedServer.complete("done");
  await completedResult;
  await assert.rejects(completedControls.steer("too late"), (error) => error.code === "CODEX_TURN_NOT_ACTIVE");

  const abortedServer = createFakeAppServer();
  const controller = new AbortController();
  let abortedReady;
  const abortedReadyPromise = new Promise((resolve) => { abortedReady = resolve; });
  const abortedResult = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    signal: controller.signal,
    spawnProcess: abortedServer.spawn,
    onReady: abortedReady
  });
  await abortedReadyPromise;
  controller.abort("stopped");
  await assert.rejects(abortedResult, (error) => error.code === "ABORT_ERR");
});

test("interrupts the current turn and starts a replacement turn with new input", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const controls = await readyPromise;
  const restarted = await controls.restart([
    { type: "text", text: "merged follow-up" },
    { type: "localImage", path: "/tmp/follow-up.png" }
  ]);
  assert.deepEqual(restarted, {
    threadId: "thread-1",
    turnId: "turn-2",
    interruptedTurnId: "turn-1"
  });
  server.complete("replacement answer");

  const result = await resultPromise;
  assert.equal(result.finalResponse, "replacement answer");
  assert.equal(result.turnId, "turn-2");
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/interrupt", "turn/start"]
  );
  assert.deepEqual(server.messages[5].params.input, [
    { type: "text", text: "merged follow-up" },
    { type: "localImage", path: "/tmp/follow-up.png", detail: null }
  ]);
});

test("starts the replacement when app-server reports that the old turn already became inactive", async () => {
  const server = createFakeAppServer({ interrupt: "inactive" });
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const controls = await readyPromise;
  const restarted = await controls.restart("new fused input");
  assert.deepEqual(restarted, {
    threadId: "thread-1",
    turnId: "turn-2",
    interruptedTurnId: "turn-1"
  });
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/interrupt", "turn/start"]
  );
  server.complete("replacement after inactive race");
  assert.equal((await resultPromise).finalResponse, "replacement after inactive race");
});

test("resumes a persistent thread and falls back to a new one when it is stale", async () => {
  const resumedServer = createFakeAppServer({ resume: "ok" });
  let resumedReady;
  const resumedReadyPromise = new Promise((resolve) => { resumedReady = resolve; });
  const resumedResult = runCodexAppServerTurn({
    prompt: "full fallback context",
    resumePrompt: "merged follow-up delta",
    threadId: "thread-old",
    ephemeral: false,
    timeoutMs: 5_000,
    spawnProcess: resumedServer.spawn,
    onReady: resumedReady
  });
  await resumedReadyPromise;
  resumedServer.complete("continued");
  assert.equal((await resumedResult).resumed, true);
  assert.ok(resumedServer.messages.some((message) => message.method === "thread/resume"));
  assert.equal(resumedServer.messages.some((message) => message.method === "thread/start"), false);
  assert.equal(
    resumedServer.messages.find((message) => message.method === "turn/start").params.input[0].text,
    "merged follow-up delta"
  );

  const staleServer = createFakeAppServer({ resume: "fail" });
  let staleReady;
  const staleReadyPromise = new Promise((resolve) => { staleReady = resolve; });
  const staleResult = runCodexAppServerTurn({
    prompt: "full fallback context",
    resumePrompt: "merged follow-up delta",
    threadId: "thread-missing",
    ephemeral: false,
    timeoutMs: 5_000,
    spawnProcess: staleServer.spawn,
    onReady: staleReady
  });
  await staleReadyPromise;
  staleServer.complete("new thread");
  assert.equal((await staleResult).resumed, false);
  assert.ok(staleServer.messages.some((message) => message.method === "thread/resume"));
  assert.ok(staleServer.messages.some((message) => message.method === "thread/start"));
  assert.equal(
    staleServer.messages.find((message) => message.method === "turn/start").params.input[0].text,
    "full fallback context"
  );
});

function createFakeAppServer({ resume = "ok", interrupt = "ok" } = {}) {
  const messages = [];
  let child;
  let currentTurnId = null;
  let turnCount = 0;

  const send = (message) => {
    queueMicrotask(() => child.stdout.write(`${JSON.stringify(message)}\n`));
  };

  const spawn = () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
          const message = JSON.parse(line);
          messages.push(message);
          if (message.method === "initialize") {
            send({ id: message.id, result: { userAgent: "test" } });
          } else if (message.method === "thread/start") {
            send({ id: message.id, result: { thread: { id: "thread-1" } } });
          } else if (message.method === "thread/resume") {
            if (resume === "fail") send({ id: message.id, error: { code: -32000, message: "missing thread" } });
            else send({ id: message.id, result: { thread: { id: "thread-1" } } });
          } else if (message.method === "turn/start") {
            currentTurnId = `turn-${++turnCount}`;
            send({ id: message.id, result: { turn: { id: currentTurnId, status: "inProgress", items: [] } } });
          } else if (message.method === "turn/steer") {
            send({ id: message.id, result: { turnId: currentTurnId } });
          } else if (message.method === "turn/interrupt") {
            if (interrupt === "inactive") {
              send({ id: message.id, error: { code: -32000, message: "no active turn to interrupt" } });
            } else {
              send({ id: message.id, result: {} });
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-1",
                  turn: {
                    id: currentTurnId,
                    status: "interrupted",
                    items: []
                  }
                }
              });
            }
          }
        }
        callback();
      }
    });
    child.kill = (signal = "SIGTERM") => {
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    return child;
  };

  return {
    messages,
    spawn,
    complete(text) {
      send({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: currentTurnId,
          completedAtMs: Date.now(),
          item: { id: "message-1", type: "agentMessage", phase: "final_answer", text }
        }
      });
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: currentTurnId,
            status: "completed",
            items: [{ id: "message-1", type: "agentMessage", phase: "final_answer", text }]
          }
        }
      });
    }
  };
}
