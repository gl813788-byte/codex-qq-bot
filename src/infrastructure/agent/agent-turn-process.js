// Process plumbing shared by the Codex App Server and Claude Code turn
// adapters. Each adapter keeps its own wire protocol; this module owns what
// both need identically: deadlines, NDJSON framing, child supervision, tool
// result normalization and the CODEX_* error vocabulary that the steering and
// recovery layers depend on regardless of engine.

export const DEFAULT_TURN_TIMEOUT_MS = 180_000;
export const DEFAULT_MAX_STDERR_BYTES = 32 * 1024;
export const DEFAULT_KILL_GRACE_MS = 1_000;
export const DEFAULT_REPLACEMENT_IDLE_TIMEOUT_MS = 60_000;
const EXIT_DETAIL_CHARS = 4_000;

export function createAgentTurnErrors(label) {
  const protocol = (message, protocolCode = null) => {
    const error = new Error(message);
    error.code = "CODEX_APP_SERVER_PROTOCOL";
    error.protocolCode = protocolCode;
    return error;
  };
  return {
    protocol,
    inactive: () => withCode(new Error(`${label} turn is no longer active`), "CODEX_TURN_NOT_ACTIVE"),
    restarting: () => withCode(new Error(`${label} turn is already being restarted`), "CODEX_TURN_RESTARTING"),
    abort(reason) {
      if (reason instanceof Error) return reason;
      const error = new Error(reason == null ? `${label} turn aborted` : String(reason));
      error.name = "AbortError";
      return withCode(error, "ABORT_ERR");
    },
    timeout: (ms) => withCode(new Error(`${label} turn timed out after ${ms}ms`), "CODEX_TURN_TIMEOUT"),
    replacementStalled: (ms) => withCode(
      new Error(`${label} replacement turn produced no protocol activity for ${ms}ms`),
      "CODEX_REPLACEMENT_STALLED"
    ),
    outputLimit: () => withCode(protocol(`${label} protocol output exceeded its limit`), "CODEX_APP_SERVER_OUTPUT_LIMIT"),
    invalidJson: (cause) => withCode(protocol(`Invalid ${label} JSON: ${cause?.message || cause}`), "CODEX_APP_SERVER_INVALID_JSON"),
    exited({ code, signal, detail = "" }) {
      const error = new Error(
        `${label} exited before turn completion (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`
      );
      error.exitCode = code;
      error.signal = signal;
      return withCode(error, "CODEX_APP_SERVER_EXIT");
    }
  };
}

// The overall turn deadline, renewed by each steer/restart, plus the idle
// deadline that catches a replacement turn which never produces output.
export function createTurnDeadlines({
  errors,
  timeoutMs,
  replacementIdleTimeoutMs,
  isSettled,
  isTurnActive,
  onExpire
}) {
  const turnTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_TURN_TIMEOUT_MS);
  let timeoutTimer = null;
  let idleTimer = null;
  let renewalCount = 0;

  const expire = (error) => {
    error.deadlineRenewalCount = renewalCount;
    onExpire(error);
  };

  const deadlines = {
    get renewalCount() {
      return renewalCount;
    },
    arm({ renewal = false } = {}) {
      if (isSettled()) return false;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (renewal) renewalCount += 1;
      timeoutTimer = setTimeout(() => expire(errors.timeout(turnTimeoutMs)), turnTimeoutMs);
      timeoutTimer.unref?.();
      return true;
    },
    armReplacementIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      if (isSettled() || !isTurnActive() || renewalCount < 1) return false;
      const idleTimeoutMs = Math.min(
        turnTimeoutMs,
        normalizePositiveInteger(replacementIdleTimeoutMs, DEFAULT_REPLACEMENT_IDLE_TIMEOUT_MS)
      );
      idleTimer = setTimeout(() => expire(errors.replacementStalled(idleTimeoutMs)), idleTimeoutMs);
      idleTimer.unref?.();
      return true;
    },
    // Any protocol output proves a replacement turn is still alive.
    noteActivity() {
      if (idleTimer && isTurnActive() && renewalCount > 0) deadlines.armReplacementIdle();
    },
    clear() {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
  };
  return deadlines;
}

// Splits child stdout into JSON lines under a total byte budget. A handler
// exception is reported like malformed output instead of escaping the stream.
export function createNdjsonReader({ errors, maxBytes, isClosed = () => false, onMessage, onError }) {
  let buffer = "";
  let bytes = 0;
  return (chunk) => {
    const text = String(chunk || "");
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) {
      onError(errors.outputLimit());
      return;
    }
    buffer += text;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          onError(errors.invalidJson(error));
          return;
        }
        if (isClosed()) return;
      }
      newlineIndex = buffer.indexOf("\n");
    }
  };
}

// Owns one agent CLI child: a bounded stderr tail, benign stdin errors,
// graceful-then-forced termination and exactly one exit notification.
export function superviseAgentChild(child, {
  maxStderrBytes,
  killGraceMs,
  isSettled,
  onStdout,
  onExit,
  onFailure,
  onClose
}) {
  const stderrLimit = normalizePositiveInteger(maxStderrBytes, DEFAULT_MAX_STDERR_BYTES);
  let stderr = "";
  let exited = false;
  let forceKillTimer = null;

  const notifyExit = () => {
    if (exited) return;
    exited = true;
    notifyObserver(onExit, child);
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk || "")).slice(-stderrLimit);
  });
  child.stdin?.on("error", (error) => {
    if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED" || isSettled()) return;
    onFailure(error);
  });
  child.once("error", (error) => {
    notifyExit();
    onFailure(error);
  });
  child.once("close", (code, signal) => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    notifyExit();
    if (isSettled()) return;
    onClose({ code, signal, detail: stderr.trim().slice(-EXIT_DETAIL_CHARS) });
  });

  return {
    stderr: () => stderr,
    terminate() {
      try {
        child.stdin?.end?.();
      } catch {
        // The child may already have closed its input.
      }
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
      if (forceKillTimer) return;
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process exited during the graceful window.
        }
      }, normalizePositiveInteger(killGraceMs, DEFAULT_KILL_GRACE_MS));
      forceKillTimer.unref?.();
    }
  };
}

// Hub dynamic-tool handlers return a string, a plain object, or Codex content
// items; both engines consume this canonical Codex shape.
export function normalizeDynamicToolResult(result) {
  if (result && typeof result === "object" && Array.isArray(result.contentItems)) {
    return {
      contentItems: result.contentItems,
      success: result.success !== false
    };
  }
  const text = typeof result === "string"
    ? result
    : JSON.stringify(result ?? { ok: true });
  return {
    contentItems: [{ type: "inputText", text }],
    success: result?.ok !== false && result?.success !== false
  };
}

export function normalizeImagePaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "").trim()).filter(Boolean))]
    .map((path) => ({ type: "localImage", path }));
}

export function notifyObserver(observer, value) {
  try {
    observer?.(value);
  } catch {
    // Observers must not change the turn outcome.
  }
}

export function attachErrorFields(error, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (error[key] != null) continue;
    try {
      error[key] = value;
    } catch {
      // Some externally supplied errors may be non-extensible.
    }
  }
}

export function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function withCode(error, code) {
  error.code = code;
  return error;
}
