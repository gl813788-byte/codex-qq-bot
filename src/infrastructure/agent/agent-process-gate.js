import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { formatMegabytes, readAvailableMemoryBytes } from "../../host-memory.js";

// Android 12+ kills an app whose child ("phantom") processes exceed 32, and
// on Termux that app is the whole Bot: QQ, the Hub and every agent CLI go
// down together. Each agent turn adds its CLI (and a QQ tool bridge), so the
// gate checks live process headroom and available memory right before a turn
// starts its CLI: when there is no room the turn waits, and a turn that
// cannot get room in time is refused instead of crashing everything.

export const ANDROID_PHANTOM_PROCESS_LIMIT = 32;
export const AGENT_HOST_BUSY_CODE = "CODEX_HOST_BUSY";
const DEFAULT_ANDROID_MIN_AVAILABLE_MB = 500;
const MIB = 1024 * 1024;

export function isAndroidHost({ exists = existsSync, env = process.env } = {}) {
  if (env.TERMUX_VERSION || env.ANDROID_ROOT || env.ANDROID_DATA) return true;
  try {
    return exists("/system/bin/app_process") || exists("/system/build.prop");
  } catch {
    return false;
  }
}

// "auto" limits processes only where the phantom-process killer exists.
export function resolveAgentProcessLimit(configured, { android = isAndroidHost } = {}) {
  if (configured === "auto" || configured == null || configured === "") {
    return (typeof android === "function" ? android() : android) ? ANDROID_PHANTOM_PROCESS_LIMIT : 0;
  }
  return Math.max(0, Math.trunc(Number(configured)) || 0);
}

export function resolveAgentMinAvailableBytes(configured, { android = isAndroidHost } = {}) {
  if (configured === "auto" || configured == null || configured === "") {
    return (typeof android === "function" ? android() : android) ? DEFAULT_ANDROID_MIN_AVAILABLE_MB * MIB : 0;
  }
  return Math.max(0, Math.trunc(Number(configured)) || 0) * MIB;
}

// Processes this user can see, minus the app process itself; memguard counts
// the same way, so both report one number. null when /proc is unreadable.
export async function countHostProcesses({ list = readdir } = {}) {
  try {
    const entries = await list("/proc");
    return Math.max(0, entries.filter((name) => /^\d+$/.test(String(name))).length - 1);
  } catch {
    return null;
  }
}

export function createAgentProcessGate({
  processLimit = 0,
  reserveProcesses = 2,
  minAvailableBytes = 0,
  // A spawned CLI takes a few seconds to appear in /proc and to grow; until
  // then its reservation stands in for it.
  turnMemoryBytes = 300 * MIB,
  settleMs = 15_000,
  pollMs = 2_000,
  countProcesses = countHostProcesses,
  readAvailable = readAvailableMemoryBytes,
  now = Date.now,
  wait = waitFor
} = {}) {
  const limit = Math.max(0, Math.trunc(Number(processLimit)) || 0);
  const reserve = Math.max(0, Math.trunc(Number(reserveProcesses)) || 0);
  const minimum = Math.max(0, Number(minAvailableBytes) || 0);
  const enabled = limit > 0 || minimum > 0;
  const reservations = new Set();
  let checking = Promise.resolve();

  function pending(at) {
    let processes = 0;
    let memoryBytes = 0;
    for (const reservation of reservations) {
      if (at - reservation.at >= settleMs) continue;
      processes += reservation.processes;
      memoryBytes += reservation.memoryBytes;
    }
    return { processes, memoryBytes };
  }

  async function inspect(processes = 0) {
    const [processCount, available] = await Promise.all([
      limit > 0 ? Promise.resolve().then(() => countProcesses()).catch(() => null) : null,
      minimum > 0 ? Promise.resolve().then(() => readAvailable()).catch(() => null) : null
    ]);
    const queued = pending(now());
    const ceiling = limit > 0 ? Math.max(0, limit - reserve) : null;
    // An unreadable /proc or meminfo never blocks a turn.
    const processesOk = limit <= 0 || processCount == null
      || processCount + queued.processes + processes <= ceiling;
    const availableBytes = available == null ? null : Math.max(0, available - queued.memoryBytes);
    const memoryOk = minimum <= 0 || availableBytes == null || availableBytes >= minimum;
    return {
      ok: processesOk && memoryOk,
      reason: !processesOk ? "processes" : !memoryOk ? "memory" : null,
      processCount,
      pendingProcesses: queued.processes,
      requestedProcesses: processes,
      processLimit: limit,
      processCeiling: ceiling,
      availableBytes,
      minAvailableBytes: minimum
    };
  }

  // Check and reserve under one lock so two turns never claim the same room.
  function tryReserve(processes) {
    const attempt = checking.then(async () => {
      const status = await inspect(processes);
      if (!status.ok) return { status, reservation: null };
      const reservation = { processes, memoryBytes: minimum > 0 ? turnMemoryBytes : 0, at: now() };
      reservations.add(reservation);
      return { status, reservation };
    });
    checking = attempt.catch(() => {});
    return attempt;
  }

  async function acquire({ processes = 1, waitMs = 0, signal = null, onWait = null } = {}) {
    const startedAt = now();
    if (!enabled) return { release() {}, waitedMs: 0, status: null };
    const requested = Math.max(0, Math.trunc(Number(processes)) || 0);
    const deadline = startedAt + Math.max(0, Number(waitMs) || 0);
    let notified = false;
    for (;;) {
      throwIfAborted(signal);
      const { status, reservation } = await tryReserve(requested);
      if (reservation) {
        let released = false;
        return {
          status,
          waitedMs: now() - startedAt,
          release() {
            if (released) return;
            released = true;
            reservations.delete(reservation);
          }
        };
      }
      const remaining = deadline - now();
      if (remaining <= 0) throw createAgentHostBusyError(status);
      if (!notified) {
        notified = true;
        try { onWait?.(status); } catch { /* observers never block a turn */ }
      }
      await wait(Math.min(pollMs, remaining), signal);
    }
  }

  return Object.freeze({
    enabled,
    acquire,
    inspect,
    describe: () => ({
      enabled,
      processLimit: limit,
      reserveProcesses: reserve,
      minAvailableBytes: minimum,
      activeReservations: reservations.size
    })
  });
}

export function createAgentHostBusyError(status = {}) {
  const message = status.reason === "memory"
    ? `手机可用内存不足（${formatMegabytes(status.availableBytes)}，至少需要 ${formatMegabytes(status.minAvailableBytes)}），为避免整个 Bot 被系统杀掉，这次没有启动模型。`
    : `手机上的进程数接近 Android 上限（${status.processCount}/${status.processLimit}），为避免整个 Bot 被系统杀掉，这次没有启动模型。`;
  return Object.assign(new Error(message), {
    code: AGENT_HOST_BUSY_CODE,
    hostCapacity: {
      reason: status.reason || null,
      processCount: status.processCount ?? null,
      processLimit: status.processLimit ?? null,
      availableBytes: status.availableBytes ?? null,
      minAvailableBytes: status.minAvailableBytes ?? null
    }
  });
}

// Log fields for a capacity status; byte counts become readable MB strings.
export function describeAgentHostCapacity(status) {
  if (!status) return {};
  return {
    capacityReason: status.reason || null,
    processCount: status.processCount ?? null,
    processLimit: status.processLimit || null,
    requestedProcesses: status.requestedProcesses ?? null,
    availableMemory: status.availableBytes == null ? null : formatMegabytes(status.availableBytes),
    minimumMemory: status.minAvailableBytes ? formatMegabytes(status.minAvailableBytes) : null
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw Object.assign(new Error("Agent turn aborted while waiting for host capacity"), { name: "AbortError", code: "ABORT_ERR" });
}

function waitFor(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, Math.max(0, ms));
    timer.unref?.();
    signal?.addEventListener?.("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    }
  });
}
