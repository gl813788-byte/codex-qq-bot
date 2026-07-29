import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQqTaskBudgetRequest,
  createQqTaskControl,
  extractQqTaskControlMarkers,
  stripQqTaskControlMarkers,
  takeQqTaskProgress
} from "../src/qq-task-control.js";

test("extracts optional progress, budget, and continue controls without exposing them", () => {
  const parsed = extractQqTaskControlMarkers([
    "[[qq_progress:已经整理完资料，正在交叉核对。]]",
    '[[qq_task_budget:{"extraMinutes":5,"extraRounds":4,"reason":"还要验证两处来源"}]]',
    "[[qq_task_continue]]"
  ].join("\n"));

  assert.deepEqual(parsed.progresses, ["已经整理完资料，正在交叉核对。"]);
  assert.equal(parsed.budgetRequests[0].ok, true);
  assert.equal(parsed.budgetRequests[0].extraMinutes, 5);
  assert.equal(parsed.budgetRequests[0].extraRounds, 4);
  assert.equal(parsed.continueRequested, true);
  assert.equal(parsed.visibleText, "");
  assert.equal(stripQqTaskControlMarkers("正文\n[[qq_task_continue]]"), "正文");
});

test("grants bounded extra duration and rounds for a complex task", () => {
  const control = createQqTaskControl({
    roundLimit: 8,
    timeoutMs: 120_000,
    maximumTimeoutMs: 30 * 60_000
  });
  const result = applyQqTaskBudgetRequest(control, {
    ok: true,
    extraMinutes: 5,
    extraRounds: 4,
    reason: "需要继续核验"
  });

  assert.equal(result.ok, true);
  assert.equal(control.timeoutMs, 420_000);
  assert.equal(control.roundLimit, 12);
  assert.equal(control.roundsUsed, 0);
  assert.match(result.reply, /已批准/);
});

test("caps repeated task requests and deduplicates progress updates", () => {
  const control = createQqTaskControl({
    limits: {
      maxBudgetRequests: 1,
      maxProgressMessages: 2,
      maxProgressChars: 20
    }
  });
  assert.equal(applyQqTaskBudgetRequest(control, {
    ok: true,
    extraMinutes: 99,
    extraRounds: 99
  }).ok, true);
  assert.equal(control.timeoutMs, 17 * 60_000);
  assert.equal(control.roundLimit, 16);
  assert.equal(applyQqTaskBudgetRequest(control, {
    ok: true,
    extraMinutes: 1,
    extraRounds: 1
  }).ok, false);

  assert.deepEqual(
    takeQqTaskProgress(control, ["正在处理", "正在处理", "已经进入第二阶段，接下来继续检查边界情况"]),
    ["正在处理", "已经进入第二阶段，接下来继续检查边界情况"]
  );
  assert.deepEqual(takeQqTaskProgress(control, ["第三条"]), []);
});
