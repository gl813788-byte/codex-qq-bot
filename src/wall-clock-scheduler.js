export function createWallClockScheduler({
  intervalMs,
  run,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = () => undefined
} = {}) {
  if (typeof run !== "function") throw new TypeError("run is required");
  const pollMs = Math.max(1, Number(intervalMs) || 1);
  let timer = null;
  let running = null;
  let queuedReason = null;
  let lastStartedAt = null;
  let lastCompletedAt = null;
  let lastReason = null;
  let lastError = null;

  function wake(reason = "wake") {
    const requestedReason = String(reason || "wake");
    if (running) {
      if (requestedReason !== "interval") queuedReason = requestedReason;
      return running;
    }
    const current = Promise.resolve()
      .then(async () => {
        let nextReason = requestedReason;
        while (nextReason) {
          queuedReason = null;
          const startedAtMs = Number(now());
          lastStartedAt = new Date(startedAtMs).toISOString();
          lastReason = nextReason;
          lastError = null;
          try {
            await run({ reason: nextReason, now: startedAtMs });
          } catch (error) {
            lastError = String(error?.message || error || "unknown error").slice(0, 500);
            await onError(error, { reason: nextReason, now: startedAtMs });
          }
          lastCompletedAt = new Date(Number(now())).toISOString();
          nextReason = queuedReason;
        }
      })
      .finally(() => {
        if (running === current) running = null;
      });
    running = current;
    return current;
  }

  function start({ runImmediately = true } = {}) {
    if (!timer) {
      timer = setIntervalFn(() => {
        void wake("interval");
      }, pollMs);
      timer?.unref?.();
    }
    return runImmediately ? wake("startup") : Promise.resolve();
  }

  async function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    queuedReason = null;
    if (running) await running;
  }

  function snapshot() {
    return {
      running: Boolean(running),
      active: Boolean(timer),
      intervalMs: pollMs,
      lastStartedAt,
      lastCompletedAt,
      lastReason,
      lastError,
      queuedReason
    };
  }

  return { start, stop, wake, snapshot };
}
