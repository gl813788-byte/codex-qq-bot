import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  createCodexProtocolQuota,
  normalizeAppServerRateLimitWindow,
  normalizeAppServerTokenUsage,
  readCodexAccountRateLimits,
  selectCodexRateLimitSnapshot,
  shouldReadCodexRateLimits
} from "../src/infrastructure/codex/codex-protocol-quota.js";
import { createQqCodexTurnRunner } from "../src/infrastructure/codex/qq-turn-runner.js";

const READ_RESULT = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1793816347 },
    secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1794403147 },
    planType: "plus"
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1793816347 },
      secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1794403147 },
      planType: "plus"
    },
    other: {
      limitId: "other",
      primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 1 },
      secondary: null,
      planType: "plus"
    }
  }
};

function createClock(startMs = Date.parse("2026-11-05T00:00:00Z")) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
    }
  };
}

test("normalizes App Server rate-limit windows and token usage", () => {
  assert.deepEqual(normalizeAppServerRateLimitWindow({ usedPercent: 31, windowDurationMins: 300, resetsAt: 1793037147 }), {
    usedPercent: 31,
    remainingPercent: 69,
    resetsAt: 1793037147,
    windowMinutes: 300
  });
  assert.deepEqual(normalizeAppServerRateLimitWindow({ usedPercent: 120, windowDurationMins: null, resetsAt: null }), {
    usedPercent: 120,
    remainingPercent: 0,
    resetsAt: null,
    windowMinutes: null
  });
  assert.equal(normalizeAppServerRateLimitWindow({ usedPercent: null }), null);
  assert.equal(normalizeAppServerRateLimitWindow(null), null);

  assert.deepEqual(normalizeAppServerTokenUsage({
    total: { totalTokens: 900, inputTokens: 800, cachedInputTokens: 600, cacheWriteInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 40 },
    last: { totalTokens: 90 },
    modelContextWindow: 475000
  }), {
    totalTokens: 900,
    inputTokens: 800,
    cachedInputTokens: 600,
    outputTokens: 100,
    reasoningOutputTokens: 40,
    modelContextWindow: 475000
  });
  assert.equal(normalizeAppServerTokenUsage({ total: {} }), null);
});

test("a rate-limit read shows the main Codex bucket", () => {
  assert.equal(selectCodexRateLimitSnapshot(READ_RESULT), READ_RESULT.rateLimitsByLimitId.codex);
  const legacy = { rateLimits: READ_RESULT.rateLimits, rateLimitsByLimitId: null };
  assert.equal(selectCodexRateLimitSnapshot(legacy), READ_RESULT.rateLimits);

  const clock = createClock();
  const quota = createCodexProtocolQuota({ now: clock.now });
  assert.equal(quota.snapshot(), null);
  assert.equal(quota.applyRateLimitsRead(READ_RESULT), true);
  const snapshot = quota.snapshot();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "app-server");
  assert.equal(snapshot.planType, "plus");
  assert.equal(snapshot.primary.usedPercent, 5);
  assert.equal(snapshot.secondary.remainingPercent, 99);
  assert.equal(snapshot.updatedAt, new Date(clock.now()).toISOString());
});

test("rolling notifications merge sparsely and ignore other limit buckets", () => {
  const clock = createClock();
  const quota = createCodexProtocolQuota({ now: clock.now });
  quota.applyRateLimitsRead(READ_RESULT);
  clock.advance(1_000);

  // Only the 5-hour window changed; the weekly window and plan stay known.
  assert.equal(quota.observeNotification({
    method: "account/rateLimits/updated",
    params: { rateLimits: { limitId: "codex", primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 1793816347 }, secondary: null, planType: null } }
  }), true);
  let snapshot = quota.snapshot();
  assert.equal(snapshot.primary.usedPercent, 7);
  assert.equal(snapshot.secondary.usedPercent, 1);
  assert.equal(snapshot.planType, "plus");
  assert.equal(snapshot.updatedAt, new Date(clock.now()).toISOString());

  assert.equal(quota.observeNotification({
    method: "account/rateLimits/updated",
    params: { rateLimits: { limitId: "model-alias", primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } } }
  }), false);
  assert.equal(quota.snapshot().primary.usedPercent, 7);

  clock.advance(1_000);
  assert.equal(quota.observeNotification({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: { total: { totalTokens: 1200, inputTokens: 1000, cachedInputTokens: 700, cacheWriteInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50 }, last: {}, modelContextWindow: 400000 }
    }
  }), true);
  snapshot = quota.snapshot();
  assert.equal(snapshot.totalTokens, 1200);
  assert.equal(snapshot.threadId, "thread-1");
  assert.equal(snapshot.modelContextWindow, 400000);
  // The dashboard's "recorded" time follows the rate-limit windows it shows.
  assert.equal(snapshot.updatedAt, new Date(clock.now() - 1_000).toISOString());

  assert.equal(quota.observeNotification({ method: "item/completed", params: {} }), false);
});

test("explicit reads are throttled, skipped while a turn reports, and back off after failure", () => {
  const nowMs = 10_000_000;
  const minute = 60_000;
  assert.equal(shouldReadCodexRateLimits({ nowMs }), true);
  assert.equal(shouldReadCodexRateLimits({ nowMs, busy: true }), true);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - minute }), false);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - 6 * minute, attemptedAtMs: nowMs - 6 * minute }), true);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - 6 * minute, attemptedAtMs: nowMs - 6 * minute, busy: true }), false);
  assert.equal(shouldReadCodexRateLimits({ nowMs, attemptedAtMs: nowMs - 2 * minute }), false);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - 30_000, force: true }), false);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - 2 * minute, force: true }), true);
  assert.equal(shouldReadCodexRateLimits({ nowMs, observedAtMs: nowMs - 2 * minute, attemptedAtMs: nowMs - 30_000, force: true }), false);
});

test("refresh shares one in-flight read and reports failures without throwing", async () => {
  const clock = createClock();
  let reads = 0;
  let release;
  const errors = [];
  const quota = createCodexProtocolQuota({
    now: clock.now,
    readRateLimits: () => {
      reads += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    onReadError: (error) => errors.push(error.message)
  });
  const first = quota.refresh();
  const second = quota.refresh({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  release(READ_RESULT);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(a.primary.usedPercent, 5);
  assert.deepEqual(a, b);

  // Fresh data: no new read until the probe interval passes.
  assert.equal((await quota.refresh()).primary.usedPercent, 5);
  assert.equal(reads, 1);

  const failing = createCodexProtocolQuota({
    now: clock.now,
    readRateLimits: () => {
      reads += 1;
      throw new Error("network down");
    },
    onReadError: (error) => errors.push(error.message)
  });
  assert.equal(await failing.refresh(), null);
  assert.equal(await failing.refresh({ force: true }), null);
  assert.equal(reads, 2);
  assert.deepEqual(errors, ["network down"]);
});

test("reads account rate limits through one short-lived App Server", async () => {
  const messages = [];
  let killed = false;
  const spawnProcess = (command, args) => {
    assert.equal(command, "codex-test");
    assert.deepEqual(args, ["app-server", "--stdio"]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const reply = (message) => queueMicrotask(() => child.stdout.write(`${JSON.stringify(message)}\n`));
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split("\n").filter(Boolean)) {
          const message = JSON.parse(line);
          messages.push(message);
          if (message.method === "initialize") reply({ id: message.id, result: { userAgent: "test" } });
          if (message.method === "account/rateLimits/read") {
            reply({ method: "account/updated", params: { authMode: "chatgpt" } });
            reply({ id: message.id, result: READ_RESULT });
          }
        }
        callback();
      }
    });
    child.kill = () => {
      killed = true;
      return true;
    };
    return child;
  };

  const result = await readCodexAccountRateLimits({ codexPath: "codex-test", spawnProcess, timeoutMs: 1_000 });
  assert.deepEqual(result, READ_RESULT);
  assert.deepEqual(messages.map((message) => message.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(messages.some((message) => message.method === "thread/start" || message.method === "turn/start"), false);
  assert.equal(killed, true);
});

test("a rate-limit read rejects cleanly when the App Server cannot answer", async () => {
  await assert.rejects(
    readCodexAccountRateLimits({ codexPath: "/bin/false", timeoutMs: 2_000 }),
    /EPIPE|exited with|stdin closed/
  );
  await assert.rejects(
    readCodexAccountRateLimits({ codexPath: "/nonexistent/codex-quota-regression", timeoutMs: 2_000 }),
    /ENOENT/
  );
});

test("Codex turn notifications reach the quota observer and the caller's observer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cqb-quota-"));
  const fakeCodex = join(dir, "codex");
  writeFileSync(fakeCodex, `#!${process.execPath}
const lines = require("node:readline").createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
  if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thread-q" } } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-q", status: "inProgress", items: [] } } });
    send({ method: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1793816347 }, secondary: null, planType: null } } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-q", turnId: "turn-q", tokenUsage: { total: { totalTokens: 42, inputTokens: 40, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0 }, last: {}, modelContextWindow: 1000 } } });
    send({ method: "turn/completed", params: { threadId: "thread-q", turn: { id: "turn-q", status: "completed", items: [{ type: "agentMessage", text: "ok", phase: "final_answer" }] } } });
  }
});
`);
  chmodSync(fakeCodex, 0o755);
  try {
    const quota = createCodexProtocolQuota();
    const callerMethods = [];
    const noop = () => null;
    const state = { ai: { model: "test-model", reasoningEffort: "low" }, maintenance: { codex: { quota: null }, agent: {} } };
    const runner = createQqCodexTurnRunner({
      limiter: { run: (operation) => operation() }, state,
      codexPath: fakeCodex, activeChildren: new Set(),
      stoppedGenerationIds: new Set(), getReplyScope: noop,
      createStoppedError: noop, trackGeneration: noop, attachSteering: noop,
      clearGeneration: noop, logContext: noop, logModelOutput: noop,
      logger: { info: noop, success: noop, warn: noop, error: noop, debug: noop },
      observeQuotaNotification: (message) => quota.observeNotification(message)
    });
    const result = await runner("hello", {
      cwd: dir,
      timeout: 10_000,
      onNotification: (message) => callerMethods.push(message.method)
    });
    assert.equal(result.finalResponse, "ok");
    const snapshot = quota.snapshot();
    assert.equal(snapshot.primary.usedPercent, 12);
    assert.equal(snapshot.totalTokens, 42);
    assert.equal(snapshot.threadId, "thread-q");
    assert.ok(callerMethods.includes("account/rateLimits/updated"));
    assert.ok(callerMethods.includes("turn/completed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
