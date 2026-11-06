import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_HOST_BUSY_CODE,
  ANDROID_PHANTOM_PROCESS_LIMIT,
  countHostProcesses,
  createAgentProcessGate,
  describeAgentHostCapacity,
  isAndroidHost,
  resolveAgentMinAvailableBytes,
  resolveAgentProcessLimit
} from "../src/infrastructure/agent/agent-process-gate.js";
import { countAgentTurnProcesses } from "../src/infrastructure/agent/agent-engines.js";

const MIB = 1024 * 1024;

function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => { current += ms; },
    wait: async (ms) => { current += ms; }
  };
}

test("auto limits apply only on Android hosts; explicit values win", () => {
  assert.equal(resolveAgentProcessLimit("auto", { android: true }), ANDROID_PHANTOM_PROCESS_LIMIT);
  assert.equal(resolveAgentProcessLimit("auto", { android: false }), 0);
  assert.equal(resolveAgentProcessLimit(undefined, { android: () => true }), 32);
  assert.equal(resolveAgentProcessLimit(0, { android: true }), 0);
  assert.equal(resolveAgentProcessLimit(40, { android: false }), 40);
  assert.equal(resolveAgentMinAvailableBytes("auto", { android: true }), 500 * MIB);
  assert.equal(resolveAgentMinAvailableBytes("auto", { android: false }), 0);
  assert.equal(resolveAgentMinAvailableBytes(800, { android: false }), 800 * MIB);
  assert.equal(isAndroidHost({ env: {}, exists: (path) => path === "/system/bin/app_process" }), true);
  assert.equal(isAndroidHost({ env: { TERMUX_VERSION: "0.118" }, exists: () => false }), true);
  assert.equal(isAndroidHost({ env: {}, exists: () => false }), false);
});

test("host process count matches memguard: numeric /proc entries minus the app process", async () => {
  assert.equal(await countHostProcesses({ list: async () => ["1", "22", "333", "self", "meminfo", "4"] }), 3);
  assert.equal(await countHostProcesses({ list: async () => { throw new Error("hidden"); } }), null);
});

test("engine facts give the processes one turn starts", () => {
  assert.equal(countAgentTurnProcesses("claude"), 1);
  assert.equal(countAgentTurnProcesses("claude", { tools: true }), 2);
  assert.equal(countAgentTurnProcesses("codex"), 2);
  assert.equal(countAgentTurnProcesses("codex", { tools: true }), 3);
});

test("a disabled gate never checks the host", async () => {
  const gate = createAgentProcessGate({
    countProcesses: () => { throw new Error("must not count"); },
    readAvailable: () => { throw new Error("must not read"); }
  });
  assert.equal(gate.enabled, false);
  const slot = await gate.acquire({ processes: 5, waitMs: 0 });
  slot.release();
});

test("a turn that would pass the process ceiling is refused with a Chinese reason", async () => {
  const gate = createAgentProcessGate({ processLimit: 32, reserveProcesses: 2, countProcesses: async () => 29 });
  await gate.acquire({ processes: 1 }).then((slot) => slot.release());
  await assert.rejects(gate.acquire({ processes: 2, waitMs: 0 }), (error) => {
    assert.equal(error.code, AGENT_HOST_BUSY_CODE);
    assert.match(error.message, /进程数接近 Android 上限（29\/32）/);
    assert.deepEqual(error.hostCapacity, {
      reason: "processes",
      processCount: 29,
      processLimit: 32,
      availableBytes: null,
      minAvailableBytes: 0
    });
    return true;
  });
});

test("a waiting turn starts once room appears and reports the wait once", async () => {
  const clock = fakeClock();
  const counts = [31, 31, 31, 27];
  const waits = [];
  const gate = createAgentProcessGate({
    processLimit: 32,
    reserveProcesses: 2,
    pollMs: 2_000,
    countProcesses: async () => counts.shift() ?? 27,
    now: clock.now,
    wait: clock.wait
  });
  const slot = await gate.acquire({ processes: 2, waitMs: 60_000, onWait: (status) => waits.push(status) });
  assert.equal(waits.length, 1);
  assert.equal(waits[0].reason, "processes");
  assert.equal(slot.waitedMs, 6_000);
  slot.release();
});

test("a turn still without room at its wait limit is refused", async () => {
  const clock = fakeClock();
  const gate = createAgentProcessGate({ processLimit: 32, countProcesses: async () => 31, now: clock.now, wait: clock.wait });
  await assert.rejects(gate.acquire({ processes: 1, waitMs: 5_000 }), { code: AGENT_HOST_BUSY_CODE });
});

test("concurrent turns cannot claim the same room before their CLIs appear", async () => {
  const clock = fakeClock();
  const gate = createAgentProcessGate({
    processLimit: 32,
    reserveProcesses: 2,
    settleMs: 15_000,
    countProcesses: async () => 27,
    now: clock.now,
    wait: clock.wait
  });
  const [first, second] = await Promise.allSettled([
    gate.acquire({ processes: 2, waitMs: 0 }),
    gate.acquire({ processes: 2, waitMs: 0 })
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.equal(second.reason.code, AGENT_HOST_BUSY_CODE);
  // After the settle window the live count is authoritative again.
  clock.advance(15_000);
  const later = await gate.acquire({ processes: 2, waitMs: 0 });
  later.release();
  first.value.release();
  first.value.release();
  assert.equal(gate.describe().activeReservations, 0);
});

test("released reservations free their room immediately", async () => {
  const gate = createAgentProcessGate({ processLimit: 10, reserveProcesses: 0, countProcesses: async () => 7 });
  const slot = await gate.acquire({ processes: 3 });
  await assert.rejects(gate.acquire({ processes: 1 }), { code: AGENT_HOST_BUSY_CODE });
  slot.release();
  (await gate.acquire({ processes: 3 })).release();
});

test("low available memory refuses a turn, counting recently started ones", async () => {
  const gate = createAgentProcessGate({
    minAvailableBytes: 500 * MIB,
    turnMemoryBytes: 300 * MIB,
    readAvailable: async () => 700 * MIB
  });
  const slot = await gate.acquire({ processes: 1 });
  await assert.rejects(gate.acquire({ processes: 1 }), (error) => {
    assert.equal(error.code, AGENT_HOST_BUSY_CODE);
    assert.equal(error.hostCapacity.reason, "memory");
    assert.match(error.message, /手机可用内存不足（400MB，至少需要 500MB）/);
    return true;
  });
  slot.release();
});

test("an unreadable host never blocks a turn", async () => {
  const gate = createAgentProcessGate({
    processLimit: 32,
    minAvailableBytes: 500 * MIB,
    countProcesses: async () => { throw new Error("no /proc"); },
    readAvailable: async () => { throw new Error("no meminfo"); }
  });
  (await gate.acquire({ processes: 4 })).release();
});

test("aborting a waiting turn rejects it without taking room", async () => {
  const controller = new AbortController();
  const gate = createAgentProcessGate({
    processLimit: 32,
    pollMs: 5,
    countProcesses: async () => 31,
    wait: async () => controller.abort(Object.assign(new Error("stopped"), { code: "QQ_STOPPED" }))
  });
  await assert.rejects(gate.acquire({ processes: 1, waitMs: 60_000, signal: controller.signal }), { code: "QQ_STOPPED" });
  assert.equal(gate.describe().activeReservations, 0);
});

test("capacity log fields are readable", () => {
  assert.deepEqual(describeAgentHostCapacity({
    reason: "memory",
    processCount: 20,
    processLimit: 32,
    requestedProcesses: 2,
    availableBytes: 450 * MIB,
    minAvailableBytes: 500 * MIB
  }), {
    capacityReason: "memory",
    processCount: 20,
    processLimit: 32,
    requestedProcesses: 2,
    availableMemory: "450MB",
    minimumMemory: "500MB"
  });
  assert.deepEqual(describeAgentHostCapacity(null), {});
});
