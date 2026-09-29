import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildLogsResponse } from "../src/log-api.js";
import { createLogger } from "../src/logger.js";

test("log API exposes full diagnostics by default and supports compact mode explicitly", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, minLevel: "debug", consoleOutput: false });
  logger.debug("QQ message details received", { text: "private message" }, "qq");
  logger.info("OneBot message received", { textLength: 14 }, "onebot");
  logger.success("Codex CLI finished", {
    durationMs: 42,
    taskType: "qq-image-generation",
    timeoutMs: 600_000,
    deadlineRenewalCount: 2,
    stderr: "internal detail"
  }, "codex");
  logger.debug("Codex model output captured", {
    taskType: "qq-reply",
    outputChars: 18,
    outputTruncated: false,
    modelOutput: "这是模型的具体输出"
  }, "codex");
  logger.warn("QQ web lookup failed", { error: "timeout", query: "private query" }, "search");
  await logger.flush();

  const compact = await buildLogsResponse(filePath, new URLSearchParams("verbose=0"));
  assert.deepEqual(compact.entries.map((entry) => entry.message), ["Codex CLI finished", "QQ web lookup failed"]);
  assert.deepEqual(compact.entries.map((entry) => entry.messageZh), ["Codex CLI 执行完成", "QQ 联网搜索失败"]);
  assert.equal(compact.entries[1].errorZh, "timeout");
  assert.deepEqual(compact.entries[0].details, {
    durationMs: 42,
    taskType: "qq-image-generation",
    timeoutMs: 600_000,
    deadlineRenewalCount: 2
  });

  const verbose = await buildLogsResponse(filePath, new URLSearchParams());
  assert.equal(verbose.entries.length, 5);
  assert.equal(verbose.entries[0].details.text, "private message");
  assert.equal(verbose.entries[0].messageZh, "收到 QQ 消息详情");
  const outputEntry = verbose.entries.find((entry) => entry.message === "Codex model output captured");
  assert.equal(outputEntry.details.modelOutput, "这是模型的具体输出");
  assert.equal(outputEntry.detailsZh["模型具体输出"], "这是模型的具体输出");
  assert.equal(outputEntry.detailsZh["任务类型"], "QQ 文字回复");

  const info = await buildLogsResponse(filePath, new URLSearchParams("level=info"));
  assert.deepEqual(info.entries.map((entry) => entry.message), ["OneBot message received"]);
});

test("log API filters complete traces and returns aggregate diagnostics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-api-trace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false });
  logger.debug("QQ reply lifecycle started", { groupId: "123", senderId: "456" }, "lifecycle", { traceId: "trace-main-123" });
  logger.success("Codex CLI finished", { groupId: "123", senderId: "456", durationMs: 1800 }, "codex", { traceId: "trace-main-123" });
  logger.success("QQ reply lifecycle completed", {
    groupId: "123",
    senderId: "456",
    outcome: "sent",
    totalDurationMs: 2200,
    generationDurationMs: 1800
  }, "lifecycle", { traceId: "trace-main-123" });
  logger.error("other failure", { groupId: "999", durationMs: 5000 }, "system", { traceId: "trace-other" });
  await logger.flush();

  const trace = await buildLogsResponse(filePath, new URLSearchParams("trace=trace-main&verbose=0"));
  assert.equal(trace.matched, 3);
  assert.equal(trace.entries.length, 3);
  assert.equal(trace.entries[0].level, "debug");
  assert.equal(trace.summary.traceCount, 1);
  // Legacy "codex" entries are presented as agent entries from Codex.
  assert.deepEqual(trace.summary.byCategory, { lifecycle: 2, agent: 1 });
  assert.deepEqual(trace.summary.byEngine, { codex: 1 });
  assert.deepEqual(trace.summary.duration, { sampleCount: 2, p50Ms: 1800, p95Ms: 2200, maxMs: 2200 });

  const slow = await buildLogsResponse(filePath, new URLSearchParams("group=123&slow=2000&q=sent"));
  assert.deepEqual(slow.entries.map((entry) => entry.message), ["QQ reply lifecycle completed"]);
  assert.equal(slow.filters.groupId, "123");
  assert.equal(slow.filters.minDurationMs, 2000);
});

test("log API filters unified operations across source and target sessions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-api-operation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false });
  logger.success("QQ cross-session message completed", {
    operation: "session.send",
    outcome: "success",
    actorRole: "administrator",
    actorUserId: "10001",
    sourceScopeId: "20002",
    targetScopeId: "private:30003",
    targetType: "private",
    durationMs: 18
  }, "qq");
  logger.debug("QQ native Agent tool completed", {
    operation: "agent.tool",
    outcome: "success",
    sourceScopeId: "20002",
    targetScopeId: "20002"
  }, "codex");
  await logger.flush();

  const response = await buildLogsResponse(filePath, new URLSearchParams("scope=private:30003&operation=session"));
  assert.equal(response.matched, 1);
  assert.equal(response.filters.scopeId, "private:30003");
  assert.equal(response.filters.operation, "session");
  assert.equal(response.entries[0].detailsZh["操作者角色"], "Bot 管理员");
  assert.deepEqual(response.summary.byOperation, { "session.send": 1 });
  assert.deepEqual(response.summary.byOutcome, { success: 1 });
});

test("log API tags agent entries with their engine and filters by engine", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-api-engine-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, minLevel: "debug", consoleOutput: false });
  logger.success("Codex app-server turn finished", { durationMs: 10 }, "codex");
  logger.success("Claude Code turn finished", { durationMs: 20, threadId: "claude:11111111-2222-4333-8444-555555555555" }, "codex");
  logger.success("Claude Code turn finished", { engine: "claude", model: "opus", durationMs: 30 }, "agent");
  logger.debug("QQ native Agent progress", { engine: "codex", progressText: "working" }, "agent");
  logger.info("OneBot message received", {}, "onebot");
  await logger.flush();

  const all = await buildLogsResponse(filePath, new URLSearchParams());
  assert.deepEqual(all.entries.map((entry) => [entry.category, entry.engine]), [
    ["agent", "codex"],
    ["agent", "claude"],
    ["agent", "claude"],
    ["agent", "codex"],
    ["onebot", null]
  ]);
  assert.deepEqual(all.summary.byCategory, { agent: 4, onebot: 1 });
  assert.deepEqual(all.summary.byEngine, { codex: 2, claude: 2 });
  assert.equal(all.entries[2].detailsZh["AI 引擎"], "Claude Code");
  assert.equal(all.entries[3].messageZh, "QQ 原生智能体进度已记录");

  const claude = await buildLogsResponse(filePath, new URLSearchParams("engine=claude"));
  assert.deepEqual(claude.entries.map((entry) => entry.details.durationMs), [20, 30]);
  assert.equal(claude.filters.engine, "claude");

  const agentCategory = await buildLogsResponse(filePath, new URLSearchParams("category=agent&verbose=0"));
  assert.equal(agentCategory.matched, 4);
  assert.equal(agentCategory.entries.at(-1).details.engine, "codex");
});
