export const QQ_FOLLOW_UP_WINDOW_MS = 5_000;
// "stack" keeps every Bot-triggering message that arrives during a reply in
// one pending batch until that reply's draft is complete, then rewrites the
// draft once with the whole batch. "steer" is the earlier behavior: each
// five-second quiet batch is steered into the running turn.
export const QQ_FOLLOW_UP_MODES = Object.freeze(["stack", "steer"]);
// A busy scope must still get an answer: after this many rewrites the reply
// is sent and newer follow-ups become the next reply.
export const QQ_FOLLOW_UP_MAX_REWRITE_ROUNDS = 2;

export function normalizeQqFollowUpMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return QQ_FOLLOW_UP_MODES.includes(mode) ? mode : "stack";
}

export async function fuseCompletedQqReplyFollowUps({
  scopeId,
  initialReply = "",
  handoff,
  takePendingEntries,
  restorePendingEntries,
  replaceReply,
  maxRounds = QQ_FOLLOW_UP_MAX_REWRITE_ROUNDS
} = {}) {
  const key = String(scopeId || "").trim();
  let reply = String(initialReply || "");
  let fusedCount = 0;
  let fusionRounds = 0;
  const roundLimit = Number.isFinite(Number(maxRounds)) && Number(maxRounds) >= 0
    ? Math.floor(Number(maxRounds))
    : QQ_FOLLOW_UP_MAX_REWRITE_ROUNDS;
  if (!key) return { reply, fusedCount, fusionRounds };

  while (true) {
    await handoff?.(key);
    // Entries left here stay pending and start the scope's next reply.
    if (fusionRounds >= roundLimit) break;
    const entries = [...(takePendingEntries?.(key) || [])];
    if (entries.length === 0) break;
    fusionRounds += 1;
    try {
      if (typeof replaceReply !== "function") {
        throw new TypeError("replaceReply must be a function when pending follow-ups exist");
      }
      reply = String(await replaceReply({
        scopeId: key,
        draft: reply,
        entries,
        fusionRound: fusionRounds
      }) || "");
      fusedCount += entries.length;
    } catch (error) {
      restorePendingEntries?.(key, entries);
      throw error;
    }
  }

  return { reply, fusedCount, fusionRounds };
}

export function createQqReplySteeringCoordinator({
  mode = "stack",
  delayMs = QQ_FOLLOW_UP_WINDOW_MS,
  maxDelayMs = null,
  getActiveGeneration,
  getPendingEntries,
  buildSteeringInput,
  consumeEntries,
  onResult
} = {}) {
  const scheduled = new Map();
  const followUpMode = normalizeQqFollowUpMode(mode);
  let closed = false;

  const report = (result) => {
    try {
      onResult?.(result);
    } catch {
      // Diagnostics must not alter reply delivery.
    }
    return result;
  };

  const run = async (scopeId) => {
    const generation = getActiveGeneration?.(scopeId) || null;
    if (!generation
      || (typeof generation.steer !== "function" && typeof generation.restart !== "function")) {
      return report({ ok: false, scopeId, reason: "no_controllable_generation", consumedCount: 0 });
    }
    const entries = [...(getPendingEntries?.(scopeId) || [])];
    if (entries.length === 0) {
      return report({ ok: false, scopeId, reason: "no_pending_entries", consumedCount: 0 });
    }
    try {
      const input = await buildSteeringInput?.(entries, generation);
      if (!input || (Array.isArray(input) && input.length === 0)) {
        return report({ ok: false, scopeId, reason: "empty_replacement_input", consumedCount: 0 });
      }
      const currentGeneration = getActiveGeneration?.(scopeId) || null;
      if (!isSameControllableGeneration(currentGeneration, generation)) {
        return report({ ok: false, scopeId, reason: "generation_changed", consumedCount: 0 });
      }
      let accepted;
      let deliveryMode;
      let steerFailureReason = null;
      if (typeof generation.steer === "function") {
        try {
          accepted = await generation.steer(input);
          deliveryMode = "steered";
        } catch (steerError) {
          steerFailureReason = steerError?.code || steerError?.message || "steer_failed";
          const fallbackGeneration = getActiveGeneration?.(scopeId) || null;
          if (typeof generation.restart !== "function"
            || !isSameControllableGeneration(fallbackGeneration, generation)) {
            throw steerError;
          }
          accepted = await generation.restart(input);
          deliveryMode = "restarted";
        }
      } else {
        accepted = await generation.restart(input);
        deliveryMode = "restarted";
      }
      const consumedCount = Number(consumeEntries?.(scopeId, entries, generation, accepted) || 0);
      return report({
        ok: true,
        scopeId,
        generationId: generation.id,
        threadId: accepted?.threadId || generation.threadId || null,
        turnId: accepted?.turnId || generation.turnId || null,
        interruptedTurnId: accepted?.interruptedTurnId || null,
        deadlineRenewalCount: Number(accepted?.deadlineRenewalCount || 0),
        deliveryMode,
        steerFailureReason,
        queuedCount: entries.length,
        consumedCount
      });
    } catch (error) {
      return report({
        ok: false,
        scopeId,
        generationId: generation.id,
        reason: error?.code || "restart_failed",
        error,
        consumedCount: 0
      });
    }
  };

  const schedule = (scopeId) => {
    const key = String(scopeId || "").trim();
    if (closed || !key) {
      return Promise.resolve({ ok: false, scopeId: key, reason: closed ? "closed" : "missing_scope", consumedCount: 0 });
    }
    // Stacked follow-ups wait for the reply's send boundary or the next reply.
    if (followUpMode === "stack") {
      return Promise.resolve({ ok: false, scopeId: key, reason: "stacked", consumedCount: 0 });
    }
    const existing = scheduled.get(key);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
        const normalizedMaxDelay = normalizeMaxDelay(maxDelayMs);
        if (normalizedMaxDelay == null) {
          existing.timer = setTimeout(existing.run, normalizeDelay(delayMs));
        } else {
          const elapsed = Date.now() - existing.startedAt;
          const remaining = Math.max(0, normalizedMaxDelay - elapsed);
          existing.timer = setTimeout(existing.run, Math.min(normalizeDelay(delayMs), remaining));
        }
      }
      return existing.promise;
    }

    let resolveScheduled;
    const entry = {
      timer: null,
      startedAt: Date.now(),
      run: null,
      resolve: null,
      promise: null
    };
    const promise = new Promise((resolve) => {
      resolveScheduled = resolve;
      entry.run = () => {
        entry.timer = null;
        void run(key).then(resolve);
      };
      entry.timer = setTimeout(entry.run, normalizeDelay(delayMs));
    }).then((result) => {
      const current = scheduled.get(key);
      if (current?.promise === promise) scheduled.delete(key);
      if (result.ok && !closed && (getPendingEntries?.(key) || []).length > 0) {
        const generation = getActiveGeneration?.(key);
        if (generation
          && (typeof generation.steer === "function" || typeof generation.restart === "function")) {
          void schedule(key);
        }
      }
      return result;
    });
    entry.promise = promise;
    entry.resolve = resolveScheduled;
    scheduled.set(key, entry);
    return promise;
  };

  return {
    schedule,

    async waitForIdle(scopeId) {
      const key = String(scopeId || "").trim();
      if (!key) {
        return { ok: false, scopeId: key, reason: "missing_scope", consumedCount: 0 };
      }
      let result = { ok: false, scopeId: key, reason: "not_scheduled", consumedCount: 0 };
      while (scheduled.has(key)) {
        result = await scheduled.get(key).promise;
      }
      return result;
    },

    async handoff(scopeId) {
      const key = String(scopeId || "").trim();
      if (!key) {
        return { ok: false, scopeId: key, reason: "missing_scope", consumedCount: 0 };
      }
      let result = { ok: false, scopeId: key, reason: "not_scheduled", consumedCount: 0 };
      while (scheduled.has(key)) {
        const entry = scheduled.get(key);
        if (!entry.timer) {
          result = await entry.promise;
          continue;
        }
        clearTimeout(entry.timer);
        scheduled.delete(key);
        result = { ok: false, scopeId: key, reason: "handed_off", consumedCount: 0 };
        entry.resolve?.(result);
      }
      return result;
    },

    cancel(scopeId) {
      const key = String(scopeId || "").trim();
      const entry = scheduled.get(key);
      if (!entry) return false;
      if (entry.timer) clearTimeout(entry.timer);
      scheduled.delete(key);
      entry.resolve?.({ ok: false, scopeId: key, reason: "cancelled", consumedCount: 0 });
      return true;
    },

    close() {
      if (closed) return false;
      closed = true;
      for (const [scopeId, entry] of scheduled.entries()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve?.({ ok: false, scopeId, reason: "closed", consumedCount: 0 });
      }
      scheduled.clear();
      return true;
    },

    snapshot() {
      return {
        mode: followUpMode,
        scheduled: scheduled.size,
        closed,
        delayMs: normalizeDelay(delayMs),
        maxDelayMs: normalizeMaxDelay(maxDelayMs)
      };
    }
  };
}

function isSameControllableGeneration(current, expected) {
  if (!current || !expected || current.id !== expected.id) return false;
  if (typeof expected.steer === "function" && current.steer !== expected.steer) return false;
  if (typeof expected.restart === "function" && current.restart !== expected.restart) return false;
  return true;
}

function normalizeDelay(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(10_000, Math.floor(number)))
    : QQ_FOLLOW_UP_WINDOW_MS;
}

function normalizeMaxDelay(value) {
  if (value == null || value === Infinity) return null;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(100, Math.min(10_000, Math.floor(number)))
    : null;
}
