import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTick } from "node:timers/promises";
import { createConcurrencyLimiter } from "../src/concurrency-limiter.js";
import { createQqManualAiTaskRunner } from "../src/qq-manual-ai-task-runner.js";
import { createQqNativeToolDispatcher } from "../src/infrastructure/codex/qq-native-tools.js";
import { parseQqManualAiTaskCommand } from "../src/qq-manual-ai-task.js";
import { assertAgentTurnNotNested, runAgentToolCall } from "../src/infrastructure/agent/agent-tool-context.js";

test("forced native background task completes with one model slot after the reply releases it", { timeout: 2000 }, async () => {
  const limiter = createConcurrencyLimiter(1);
  const running = new Map();
  let executions = 0;
  let finished;
  const completion = new Promise((resolve) => { finished = resolve; });
  const runner = createQqManualAiTaskRunner({
    running,
    execute: (request) => {
      assertAgentTurnNotNested();
      return limiter.run(async () => {
        executions += 1;
        assert.equal(request.force, true);
        return { ok: true };
      });
    },
    onCompleted: finished
  });
  const dispatch = createQqNativeToolDispatcher({
    event: { isOwner: true },
    executeCommand: async (command) => {
      const parsed = parseQqManualAiTaskCommand(command);
      const result = await runner.run({ ...parsed, scopeId: "10001" });
      assert.equal(result.accepted, true);
      assert.equal(result.status, 202);
      return { ...result, reply: `已提交 ${result.jobId}` };
    }
  });
  const call = { callId: "all-1", namespace: "qq_runtime", tool: "configure", arguments: { command: "AI任务 强制 全部" } };
  await limiter.run(() => runAgentToolCall(async () => {
    const result = await dispatch(call);
    assert.equal(result.ok, true);
    assert.deepEqual(await dispatch(call), result);
    assert.equal(executions, 0);
    assert.equal(limiter.snapshot().active, 1);
    assert.equal(limiter.snapshot().pending, 1);
    assert.equal((await runner.run({ taskId: "all", scopeId: "10001", background: true })).status, 409);
  }));
  assert.equal((await completion).ok, true);
  await nextTick();
  assert.equal(executions, 1);
  assert.equal(running.size, 0);
  assert.equal(runner.snapshot()[0].state, "completed");
});

test("foreground nested model work fails promptly instead of waiting on its parent", async () => {
  const runner = createQqManualAiTaskRunner({ execute: async () => { assertAgentTurnNotNested(); return { ok: true }; } });
  const result = await runAgentToolCall(() => runner.run({ taskId: "chat-summary", scopeId: "10001" }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /不能同步启动/);
  assert.equal(runner.snapshot()[0].state, "failed");
});

test("background failures are recorded and release the lock; foreground calls return actual results", async () => {
  const running = new Map();
  let attempts = 0;
  const runner = createQqManualAiTaskRunner({
    running, historyLimit: 1,
    execute: async () => { if (++attempts === 1) throw new Error("provider failed"); return { ok: true, summary: "actual summary" }; }
  });
  const request = { taskId: "chat-summary", scopeId: "10001" };
  const accepted = await runner.run({ ...request, background: true });
  const pending = running.get("chat-summary:10001");
  assert.equal(accepted.accepted, true);
  assert.equal((await pending).ok, false);
  assert.equal(runner.snapshot()[0].reason, "provider failed");
  assert.equal(running.size, 0);
  const result = await runner.run(request);
  assert.equal(result.summary, "actual summary");
  assert.equal(runner.snapshot().length, 1);
  assert.equal(runner.snapshot()[0].jobId, result.jobId);
});
