import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Codex 0.16x reports account usage only through the App Server protocol:
// rollout files and websocket log lines no longer carry rate limits. Every
// Codex turn already streams `account/rateLimits/updated` and
// `thread/tokenUsage/updated`; an explicit `account/rateLimits/read` covers a
// fresh Hub and idle periods.

export const CODEX_QUOTA_PROTOCOL_SOURCE = "codex app-server";
const DEFAULT_READ_TIMEOUT_MS = 8_000;
const DEFAULT_PROBE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MIN_PROBE_INTERVAL_MS = 60_000;
const PRIMARY_LIMIT_ID = "codex";

export function normalizeAppServerRateLimitWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = finiteOrNull(window.usedPercent);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetsAt: finiteOrNull(window.resetsAt),
    windowMinutes: finiteOrNull(window.windowDurationMins)
  };
}

// A read returns the multi-bucket view; the dashboard shows the main Codex
// bucket, which the backward-compatible `rateLimits` field mirrors.
export function selectCodexRateLimitSnapshot(readResult) {
  const byLimitId = readResult?.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === "object" && byLimitId[PRIMARY_LIMIT_ID]) {
    return byLimitId[PRIMARY_LIMIT_ID];
  }
  return readResult?.rateLimits || null;
}

export function isPrimaryCodexRateLimitSnapshot(rateLimits) {
  if (!rateLimits || typeof rateLimits !== "object") return false;
  return rateLimits.limitId == null || rateLimits.limitId === PRIMARY_LIMIT_ID;
}

export function normalizeAppServerTokenUsage(tokenUsage) {
  const total = tokenUsage?.total;
  if (!total || typeof total !== "object") return null;
  const totalTokens = finiteOrNull(total.totalTokens);
  if (totalTokens == null) return null;
  return {
    totalTokens,
    inputTokens: finiteOrNull(total.inputTokens),
    cachedInputTokens: finiteOrNull(total.cachedInputTokens),
    outputTokens: finiteOrNull(total.outputTokens),
    reasoningOutputTokens: finiteOrNull(total.reasoningOutputTokens),
    modelContextWindow: finiteOrNull(tokenUsage.modelContextWindow)
  };
}

// Throttles explicit reads. Turn notifications keep the data fresh while the
// Bot is active, so an idle read happens at most once per probe interval and a
// forced (dashboard refresh / after-run) read at most once per minimum interval.
// Failures back off the same way, so a network outage costs one short read per
// interval rather than one per dashboard poll.
export function shouldReadCodexRateLimits({
  nowMs,
  observedAtMs = 0,
  attemptedAtMs = 0,
  force = false,
  busy = false,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  minProbeIntervalMs = DEFAULT_MIN_PROBE_INTERVAL_MS
} = {}) {
  const dataAgeMs = observedAtMs ? nowMs - observedAtMs : Infinity;
  const attemptAgeMs = attemptedAtMs ? nowMs - attemptedAtMs : Infinity;
  if (force) return dataAgeMs >= minProbeIntervalMs && attemptAgeMs >= minProbeIntervalMs;
  // A running Codex turn reports its own rate limits.
  if (busy && observedAtMs) return false;
  return dataAgeMs >= probeIntervalMs && attemptAgeMs >= probeIntervalMs;
}

export function createCodexProtocolQuota({
  readRateLimits,
  now = Date.now,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  minProbeIntervalMs = DEFAULT_MIN_PROBE_INTERVAL_MS,
  onReadError
} = {}) {
  let primary = null;
  let secondary = null;
  let planType = null;
  let rateLimitsObservedAtMs = 0;
  let usage = null;
  let threadId = null;
  let usageObservedAtMs = 0;
  let readAttemptedAtMs = 0;
  let pendingRead = null;

  // Rolling updates are sparse: a missing window or plan keeps the last value.
  const mergeRateLimits = (rateLimits, { replace = false } = {}) => {
    if (!isPrimaryCodexRateLimitSnapshot(rateLimits)) return false;
    const nextPrimary = normalizeAppServerRateLimitWindow(rateLimits.primary);
    const nextSecondary = normalizeAppServerRateLimitWindow(rateLimits.secondary);
    if (!replace && !nextPrimary && !nextSecondary) return false;
    primary = replace ? nextPrimary : nextPrimary || primary;
    secondary = replace ? nextSecondary : nextSecondary || secondary;
    if (typeof rateLimits.planType === "string" && rateLimits.planType) planType = rateLimits.planType;
    rateLimitsObservedAtMs = now();
    return true;
  };

  const applyRateLimitsRead = (readResult) => mergeRateLimits(
    selectCodexRateLimitSnapshot(readResult),
    { replace: true }
  );

  const snapshot = () => {
    const hasWindows = Boolean(primary || secondary);
    if (!hasWindows && !usage) return null;
    const updatedAtMs = Math.max(rateLimitsObservedAtMs, usageObservedAtMs);
    return {
      available: true,
      source: "app-server",
      sourcePath: CODEX_QUOTA_PROTOCOL_SOURCE,
      threadId,
      threadTitle: null,
      updatedAt: new Date(hasWindows ? rateLimitsObservedAtMs : updatedAtMs).toISOString(),
      rateLimitsUpdatedAt: rateLimitsObservedAtMs ? new Date(rateLimitsObservedAtMs).toISOString() : null,
      tokenUsageUpdatedAt: usageObservedAtMs ? new Date(usageObservedAtMs).toISOString() : null,
      planType,
      totalTokens: usage?.totalTokens ?? null,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      reasoningOutputTokens: usage?.reasoningOutputTokens ?? null,
      modelContextWindow: usage?.modelContextWindow ?? null,
      primary: primary ? { ...primary } : null,
      secondary: secondary ? { ...secondary } : null,
      lastError: null
    };
  };

  return {
    observeNotification(message) {
      if (message?.method === "account/rateLimits/updated") {
        return mergeRateLimits(message.params?.rateLimits);
      }
      if (message?.method === "thread/tokenUsage/updated") {
        const next = normalizeAppServerTokenUsage(message.params?.tokenUsage);
        if (!next) return false;
        usage = next;
        threadId = typeof message.params?.threadId === "string" ? message.params.threadId : threadId;
        usageObservedAtMs = now();
        return true;
      }
      return false;
    },
    applyRateLimitsRead,
    hasRateLimits() {
      return Boolean(primary || secondary);
    },
    async refresh({ force = false, busy = false } = {}) {
      if (pendingRead) return pendingRead;
      if (typeof readRateLimits !== "function") return snapshot();
      const due = shouldReadCodexRateLimits({
        nowMs: now(),
        observedAtMs: rateLimitsObservedAtMs,
        attemptedAtMs: readAttemptedAtMs,
        force,
        busy,
        probeIntervalMs,
        minProbeIntervalMs
      });
      if (!due) return snapshot();
      readAttemptedAtMs = now();
      pendingRead = Promise.resolve()
        .then(() => readRateLimits())
        .then((result) => {
          applyRateLimitsRead(result);
        })
        .catch((error) => {
          try {
            onReadError?.(error);
          } catch {
            // Reporting must not turn a failed read into a failed dashboard request.
          }
        })
        .then(() => snapshot())
        .finally(() => {
          pendingRead = null;
        });
      return pendingRead;
    },
    snapshot
  };
}

// One short-lived `codex app-server --stdio` that only initializes and reads
// account rate limits: no thread, no model turn, no quota spent.
export function readCodexAccountRateLimits({
  codexPath = "codex",
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  spawnProcess = spawn
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(codexPath, ["app-server", "--stdio"], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    let initialized = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    };
    const send = (message) => {
      if (settled) return;
      if (!child.stdin?.writable || child.stdin.destroyed) {
        finish(new Error("Codex app-server stdin closed before the rate-limit read was sent"));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) finish(error);
      });
    };
    const timer = setTimeout(() => finish(new Error(`Timed out after ${timeoutMs}ms reading Codex rate limits`)), timeoutMs);

    child.stdin.on("error", (error) => finish(error));
    // Drain stderr so a chatty app-server never blocks on a full pipe.
    child.stderr?.resume?.();
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (!settled) finish(new Error(`Codex app-server exited with ${code ?? signal} before returning rate limits`));
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message?.id === 1 && message.result && !initialized) {
        initialized = true;
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "account/rateLimits/read", params: null });
        return;
      }
      if (message?.id === 1 && message.error) {
        finish(new Error(message.error.message || "Codex app-server initialization failed"));
        return;
      }
      if (message?.id === 2 && message.error) {
        finish(new Error(message.error.message || "Codex account/rateLimits/read failed"));
        return;
      }
      if (message?.id === 2 && Object.hasOwn(message, "result")) finish(null, message.result);
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "codex_qq_bot", title: "Codex QQ Bot", version: "2" },
        capabilities: { experimentalApi: false, requestAttestation: false }
      }
    });
  });
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
