import { randomUUID } from "node:crypto";
import { runOutsideAgentToolCall } from "./infrastructure/agent/agent-tool-context.js";

// Background submission returns before the caller releases its model slot.
// The actual work still uses the normal model limiter and permission checks.
export function createQqManualAiTaskRunner({
  running = new Map(),
  execute,
  onStarted,
  onCompleted,
  onTask,
  historyLimit = 50
} = {}) {
  if (typeof execute !== "function") throw new TypeError("execute must be a function");
  const jobs = new Map();
  return {
    run(request) {
      const { taskId, scopeId = "", background = false } = request;
      const lockKey = `${taskId}:${scopeId || "global"}`;
      if (running.has(lockKey)) {
        return Promise.resolve({ ok: false, status: 409, busy: true, taskId, scopeId, reason: "同一个 AI 手动任务正在运行。" });
      }
      const startedAt = Date.now();
      const job = {
        jobId: randomUUID(), taskId, scopeId, background,
        force: Boolean(request.force), fullHistory: Boolean(request.fullHistory),
        state: "running", startedAt: new Date(startedAt).toISOString(), completedAt: null
      };
      jobs.set(job.jobId, job);
      const task = Promise.resolve()
        .then(() => background ? runOutsideAgentToolCall(() => execute(request)) : execute(request))
        .catch((error) => ({ ok: false, status: 500, reason: String(error?.message || error) }))
        .then((result) => {
          const completed = { ...result, taskId, scopeId, jobId: job.jobId, durationMs: Date.now() - startedAt };
          Object.assign(job, {
            state: completed.ok ? "completed" : completed.busy ? "busy" : completed.skipped ? "skipped" : "failed",
            completedAt: new Date().toISOString(), durationMs: completed.durationMs,
            ok: Boolean(completed.ok), reason: completed.reason || completed.error || null
          });
          onCompleted?.(completed, request);
          return completed;
        })
        .finally(() => {
          if (running.get(lockKey) === task) running.delete(lockKey);
          for (const [id, item] of jobs) {
            if (jobs.size <= historyLimit) break;
            if (item.completedAt) jobs.delete(id);
          }
        });
      running.set(lockKey, task);
      onStarted?.(job, request);
      onTask?.(task);
      return background
        ? Promise.resolve({ ok: true, status: 202, accepted: true, taskId, scopeId, jobId: job.jobId, background: true, force: job.force })
        : task;
    },
    snapshot() {
      return [...jobs.values()].map((job) => ({ ...job }));
    }
  };
}
