import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  createAgentTurnErrors,
  createNdjsonReader,
  createTurnDeadlines,
  normalizeDynamicToolResult,
  normalizeImagePaths,
  superviseAgentChild
} from "../src/infrastructure/agent/agent-turn-process.js";

const errors = createAgentTurnErrors("Test engine");

test("agent turn errors keep the engine-neutral CODEX_* codes with the engine label", () => {
  assert.equal(errors.inactive().code, "CODEX_TURN_NOT_ACTIVE");
  assert.equal(errors.inactive().message, "Test engine turn is no longer active");
  assert.equal(errors.restarting().code, "CODEX_TURN_RESTARTING");
  assert.equal(errors.timeout(5).message, "Test engine turn timed out after 5ms");
  assert.equal(errors.replacementStalled(5).code, "CODEX_REPLACEMENT_STALLED");
  assert.equal(errors.outputLimit().code, "CODEX_APP_SERVER_OUTPUT_LIMIT");
  assert.equal(errors.protocol("bad", -32600).protocolCode, -32600);

  const abort = errors.abort(undefined);
  assert.equal(abort.name, "AbortError");
  assert.equal(abort.code, "ABORT_ERR");
  const reason = new Error("stopped");
  assert.equal(errors.abort(reason), reason);

  const exited = errors.exited({ code: 1, signal: null, detail: "boom" });
  assert.equal(exited.code, "CODEX_APP_SERVER_EXIT");
  assert.equal(exited.exitCode, 1);
  assert.equal(exited.message, "Test engine exited before turn completion (1): boom");
});

test("NDJSON reader frames split lines, stops once closed and reports bad output", () => {
  const messages = [];
  const failures = [];
  let closed = false;
  const read = createNdjsonReader({
    errors,
    maxBytes: 1024,
    isClosed: () => closed,
    onMessage: (message) => {
      messages.push(message);
      if (message.close) closed = true;
    },
    onError: (error) => failures.push(error)
  });
  read('{"a":1}\n{"b"');
  read(':2}\n\n{"close":true}\n{"ignored":true}\n');
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }, { close: true }]);
  assert.deepEqual(failures, []);

  const invalid = [];
  createNdjsonReader({ errors, maxBytes: 1024, onMessage: () => undefined, onError: (error) => invalid.push(error) })("{oops\n");
  assert.equal(invalid[0].code, "CODEX_APP_SERVER_INVALID_JSON");

  const thrown = [];
  createNdjsonReader({
    errors,
    maxBytes: 1024,
    onMessage: () => {
      throw new Error("handler broke");
    },
    onError: (error) => thrown.push(error)
  })("{}\n");
  assert.match(thrown[0].message, /handler broke/);

  const limited = [];
  createNdjsonReader({ errors, maxBytes: 4, onMessage: () => undefined, onError: (error) => limited.push(error) })("{\"a\":1}\n");
  assert.equal(limited[0].code, "CODEX_APP_SERVER_OUTPUT_LIMIT");
});

test("turn deadlines renew, expire with the renewal count and catch stalled replacements", async () => {
  const expired = [];
  let active = true;
  const deadlines = createTurnDeadlines({
    errors,
    timeoutMs: 40,
    replacementIdleTimeoutMs: 10,
    isSettled: () => false,
    isTurnActive: () => active,
    onExpire: (error) => expired.push(error)
  });
  assert.equal(deadlines.armReplacementIdle(), false, "idle deadline needs a renewal first");
  deadlines.arm();
  deadlines.arm({ renewal: true });
  assert.equal(deadlines.renewalCount, 1);
  assert.equal(deadlines.armReplacementIdle(), true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  deadlines.clear();
  assert.equal(expired.length, 1);
  assert.equal(expired[0].code, "CODEX_REPLACEMENT_STALLED");
  assert.equal(expired[0].deadlineRenewalCount, 1);

  const timedOut = [];
  const overall = createTurnDeadlines({
    errors,
    timeoutMs: 5,
    isSettled: () => false,
    isTurnActive: () => active,
    onExpire: (error) => timedOut.push(error)
  });
  overall.arm();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(timedOut[0].code, "CODEX_TURN_TIMEOUT");
  active = false;
});

test("child supervisor keeps a bounded stderr tail and notifies exit exactly once", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  const exits = [];
  const closes = [];
  const stdout = [];
  let settled = false;
  const supervisor = superviseAgentChild(child, {
    maxStderrBytes: 8,
    killGraceMs: 5,
    isSettled: () => settled,
    onStdout: (chunk) => stdout.push(chunk),
    onExit: (value) => exits.push(value),
    onFailure: (error) => closes.push(error),
    onClose: (exit) => closes.push(exit)
  });
  child.stdout.write("line\n");
  child.stderr.write("0123456789abcdef");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stdout, ["line\n"]);
  assert.equal(supervisor.stderr(), "89abcdef");

  child.emit("close", 2, null);
  child.emit("close", 3, null);
  assert.deepEqual(exits, [child]);
  assert.deepEqual(closes, [{ code: 2, signal: null, detail: "89abcdef" }]);

  settled = true;
  supervisor.terminate();
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("dynamic tool results normalize to the shared Codex content shape", () => {
  assert.deepEqual(normalizeDynamicToolResult("plain"), {
    contentItems: [{ type: "inputText", text: "plain" }],
    success: true
  });
  assert.deepEqual(normalizeDynamicToolResult({ ok: false, error: "denied" }), {
    contentItems: [{ type: "inputText", text: "{\"ok\":false,\"error\":\"denied\"}" }],
    success: false
  });
  const items = [{ type: "inputText", text: "x" }];
  assert.deepEqual(normalizeDynamicToolResult({ contentItems: items, success: false }), {
    contentItems: items,
    success: false
  });
  assert.deepEqual(normalizeImagePaths([" /a.png ", "/a.png", "", null]), [{ type: "localImage", path: "/a.png" }]);
});
