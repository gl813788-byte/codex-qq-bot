import test from "node:test";
import assert from "node:assert/strict";
import { createWallClockScheduler } from "../src/wall-clock-scheduler.js";

test("runs immediately on startup and drops overlapping interval polls", async () => {
  let clock = Date.UTC(2026, 6, 19, 0, 0);
  let intervalCallback;
  let release;
  const reasons = [];
  const scheduler = createWallClockScheduler({
    intervalMs: 15_000,
    now: () => clock,
    setIntervalFn(callback) {
      intervalCallback = callback;
      return { unref() {} };
    },
    clearIntervalFn() {},
    run: async ({ reason }) => {
      reasons.push(reason);
      await new Promise((resolve) => { release = resolve; });
    }
  });

  const startup = scheduler.start();
  const duplicate = scheduler.wake("interval");
  assert.equal(startup, duplicate);
  assert.deepEqual(reasons, []);
  await Promise.resolve();
  assert.deepEqual(reasons, ["startup"]);
  intervalCallback();
  assert.deepEqual(reasons, ["startup"]);
  clock += 1_000;
  release();
  await startup;
  assert.equal(scheduler.snapshot().lastCompletedAt, "2026-07-19T00:00:01.000Z");
  await scheduler.stop();
});

test("runs again immediately when a restored channel wakes the scheduler", async () => {
  const reasons = [];
  let clock = Date.UTC(2026, 6, 19, 1, 0);
  const scheduler = createWallClockScheduler({
    intervalMs: 60_000,
    now: () => clock,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
    run: ({ reason }) => reasons.push(reason)
  });
  await scheduler.start();
  clock += 5_000;
  await scheduler.wake("channel-enabled");
  assert.deepEqual(reasons, ["startup", "channel-enabled"]);
  await scheduler.stop();
});

test("queues one immediate channel catch-up when the startup check is still running", async () => {
  const reasons = [];
  let releaseStartup;
  const scheduler = createWallClockScheduler({
    intervalMs: 60_000,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
    run: async ({ reason }) => {
      reasons.push(reason);
      if (reason === "startup") await new Promise((resolve) => { releaseStartup = resolve; });
    }
  });
  const running = scheduler.start();
  await Promise.resolve();
  scheduler.wake("channel-enabled");
  releaseStartup();
  await running;
  assert.deepEqual(reasons, ["startup", "channel-enabled"]);
  await scheduler.stop();
});
