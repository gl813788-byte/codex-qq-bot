import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQqManualAiTaskCenter,
  normalizeQqManualAiTaskId,
  parseQqManualAiTaskCommand,
  validateQqManualAiTaskRequest
} from "../src/qq-manual-ai-task.js";
import { formatQqVisualMenu } from "../src/qq-menu.js";

test("normalizes Chinese and CLI aliases for every manual AI task", () => {
  assert.equal(normalizeQqManualAiTaskId("聊天总结"), "chat-summary");
  assert.equal(normalizeQqManualAiTaskId("scope-summary"), "scope-summary");
  assert.equal(normalizeQqManualAiTaskId("风格复盘"), "style-review");
  assert.equal(normalizeQqManualAiTaskId("人设刷新"), "global-persona");
  assert.equal(normalizeQqManualAiTaskId("知识审核"), "knowledge-review");
  assert.equal(normalizeQqManualAiTaskId("全部"), "all");
});

test("parses the QQ task center and full chat history option", () => {
  assert.deepEqual(parseQqManualAiTaskCommand("/AI任务"), {
    action: "list",
    taskId: "",
    fullHistory: false,
    force: false
  });
  assert.deepEqual(parseQqManualAiTaskCommand("/AI任务 聊天总结 全部"), {
    action: "run",
    taskId: "chat-summary",
    fullHistory: true,
    force: false
  });
  assert.equal(parseQqManualAiTaskCommand("/手动触发 群风格").taskId, "style-review");
  assert.deepEqual(parseQqManualAiTaskCommand("/AI任务 强制 知识审核"), {
    action: "run",
    taskId: "knowledge-review",
    fullHistory: false,
    force: true
  });
});

test("validates group allowlists, private history, and task scope kinds", () => {
  assert.equal(validateQqManualAiTaskRequest({
    taskId: "style",
    currentScopeId: "10001",
    allowedGroups: ["10001"]
  }).ok, true);
  assert.equal(validateQqManualAiTaskRequest({
    taskId: "style",
    currentScopeId: "private:20001",
    knownPrivateScopes: ["private:20001"]
  }).status, 400);
  assert.equal(validateQqManualAiTaskRequest({
    taskId: "summary",
    scopeId: "10002",
    allowedGroups: ["10001"]
  }).status, 403);
  assert.equal(validateQqManualAiTaskRequest({
    taskId: "scope",
    scopeId: "private:20001",
    knownPrivateScopes: ["private:20001"]
  }).ok, true);
});

test("task center and QQ menu use readable visual sections", () => {
  const taskCenter = formatQqManualAiTaskCenter({ running: ["style-review"], includeNccHint: true });
  assert.match(taskCenter, /🤖 AI 手动任务中心/);
  assert.match(taskCenter, /群风格复盘 〔运行中〕/);
  assert.match(taskCenter, /ncc ai-run/);

  const menu = formatQqVisualMenu({
    owner: true,
    assistantName: "小星",
    model: "gpt-5.5",
    reasoningEffort: "low",
    allowedGroups: ["10001"],
    commands: [
      { category: "conversation", menuLine: "/新对话", description: "清空当前上下文", public: true },
      { category: "intelligence", menuLine: "/AI任务", description: "手动运行总结", public: false }
    ]
  });
  assert.match(menu, /小星 · QQ 控制台/);
  assert.match(menu, /💬 会话与上下文/);
  assert.match(menu, /🧠 AI 与学习/);
  assert.match(menu, /\/新对话  ◦ 公开/);
});
