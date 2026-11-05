import assert from "node:assert/strict";
import test from "node:test";
import { createQqSubagentManager, formatQqSubagentStatus } from "../src/qq-subagents.js";
import { executeQqSubagentTool } from "../src/app/qq-subagent-tool.js";
import {
  buildQqSubagentTurn,
  filterQqSubagentToolSpecs,
  formatQqSubagentReportPrompt,
  parseQqSubagentOutput,
  qqSubagentOutputSchema
} from "../src/app/qq-subagent-turn.js";
import { buildQqNativeToolSpecs } from "../src/infrastructure/codex/qq-native-tools.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("sub-agents run in their own slots, queue, refuse when full and report once", async () => {
  const gates = [];
  const finished = [];
  const manager = createQqSubagentManager({
    maxConcurrent: 1,
    maxQueued: 1,
    runTask: async (job) => {
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return { ok: true, threadId: `thread-${job.id}`, result: { summary: `done ${job.title}`, report: "full report" } };
    },
    onFinished: (job) => finished.push(job)
  });
  const first = manager.spawn({ title: "查资料", task: "查一下", scopeId: "123456", requester: { userId: "22", name: "甲" } });
  const second = manager.spawn({ title: "写文章", task: "写一篇", scopeId: "123456" });
  const third = manager.spawn({ title: "第三个", task: "x", scopeId: "123456" });
  assert.equal(first.ok, true);
  assert.equal(second.position, 1);
  assert.equal(third.ok, false);
  assert.equal(third.code, "SUBAGENT_BUSY");
  await tick();
  assert.equal(manager.get(first.id, { scopeId: "123456" }).status, "running");
  assert.equal(manager.get(first.id, { scopeId: "999999" }), null);
  gates[0].resolve();
  await tick();
  await tick();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].result.summary, "done 查资料");
  assert.equal(manager.get(second.id, { scopeId: "123456" }).status, "running");
  assert.match(formatQqSubagentStatus(manager.get(first.id, { scopeId: "123456" })), /已完成（甲 要的）/);
});

test("messages steer a running sub-agent or continue a finished one on its thread", async () => {
  const steered = [];
  const runs = [];
  const gates = [];
  const manager = createQqSubagentManager({
    maxConcurrent: 1,
    maxQueued: 2,
    runTask: async (job, { followUps, threadId, onControls }) => {
      runs.push({ followUps, threadId });
      onControls({ steer: async (text) => steered.push(text) });
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return { ok: true, threadId: "thread-1", result: { summary: "ok" } };
    }
  });
  const { id } = manager.spawn({ title: "任务", task: "做事", scopeId: "s" });
  await tick();
  const live = await manager.message(id, "改成英文", { scopeId: "s", from: "甲" });
  assert.equal(live.delivered, "steered");
  assert.match(steered[0], /改成英文/);
  gates[0].resolve();
  await tick();
  await tick();
  const later = await manager.message(id, "再补一段", { scopeId: "s" });
  assert.equal(later.delivered, "follow_up");
  await tick();
  assert.deepEqual(runs[1], { followUps: ["再补一段"], threadId: "thread-1" });
  assert.equal((await manager.message(id, "x", { scopeId: "other" })).ok, false);
  const cancel = manager.cancel(id, { scopeId: "s" });
  assert.equal(cancel.status, "cancelling");
  gates[1].resolve();
  await tick();
  await tick();
  assert.equal(manager.get(id, { scopeId: "s" }).status, "cancelled");
});

test("a disabled pool refuses work and the tool explains spawn results", async () => {
  const disabled = createQqSubagentManager({ maxConcurrent: 0, runTask: async () => ({}) });
  assert.equal(disabled.spawn({ task: "x" }).code, "SUBAGENT_DISABLED");
  const manager = createQqSubagentManager({ maxConcurrent: 1, runTask: () => new Promise(() => {}) });
  const spawned = await executeQqSubagentTool({ action: "spawn", title: "长任务", task: "整理资料" }, {
    manager, scopeId: "123456", requester: { userId: "22", name: "甲" }, origin: { scopeId: "123456", groupId: "123456", messageId: "7" }
  });
  assert.equal(spawned.ok, true);
  assert.match(spawned.reply, /已在后台开了子代理 sa-[0-9a-f]{4}/);
  const refused = await executeQqSubagentTool({ action: "spawn", task: "x" }, { manager, scopeId: "1", allowSpawn: false });
  assert.equal(refused.ok, false);
  const listed = await executeQqSubagentTool({ action: "list" }, { manager, scopeId: "123456" });
  assert.match(listed.reply, /长任务/);
});

test("sub-agent turns get a research-only tool subset and a strict report contract", () => {
  const specs = buildQqNativeToolSpecs({ isOwner: true, canUseSubagents: true, hasStickerCandidates: true });
  const task = filterQqSubagentToolSpecs(specs, { kind: "task" });
  assert.deepEqual(task.map((namespace) => namespace.name).sort(), ["qq_context", "qq_knowledge", "qq_media", "qq_search"]);
  assert.deepEqual(task.find((namespace) => namespace.name === "qq_context").tools.map((tool) => tool.name), ["history"]);
  const life = filterQqSubagentToolSpecs(specs, { kind: "life" }).map((namespace) => namespace.name);
  assert.ok(life.includes("qq_social"));
  assert.equal(life.includes("qq_runtime") || life.includes("qq_agent") || life.includes("qq_session"), false);
  assert.deepEqual(qqSubagentOutputSchema.required, ["summary", "report", "attachments", "needsUser", "question"]);
  const turn = buildQqSubagentTurn({
    job: { task: "查一下最新的 Node 版本", requester: { name: "甲", userId: "22" }, kind: "task", context: { background: "当前消息：帮我查" } },
    assistantName: "麦麦",
    taskWorkspace: { root: "/w", inputDir: "/w/input", outputDir: "/w/output" },
    followUps: ["顺便看 LTS"]
  });
  assert.match(turn.developerInstructions, /不直接在 QQ 里说话/);
  assert.match(turn.prompt, /任务：\n查一下最新的 Node 版本/);
  assert.match(turn.prompt, /1\. 顺便看 LTS/);
  const resumed = buildQqSubagentTurn({ job: { task: "x", requester: {} }, resumed: true, followUps: ["继续"] });
  assert.doesNotMatch(resumed.prompt, /任务：/);
  const report = formatQqSubagentReportPrompt({ id: "sa-1", title: "查资料", status: "done", requester: { name: "甲" }, result: { summary: "查到了", report: "详细" } }, { attachmentPaths: ["/w/output/a.md"] });
  assert.match(report, /子代理结果回来了/);
  assert.match(report, /\/w\/output\/a\.md/);
  assert.deepEqual(parseQqSubagentOutput("```json\n{\"summary\":\"s\",\"report\":\"r\",\"attachments\":[\"/a\"],\"needsUser\":false,\"question\":\"\"}\n```"), {
    summary: "s", report: "r", attachments: ["/a"], needsUser: false, question: ""
  });
  assert.equal(parseQqSubagentOutput("plain answer").report, "plain answer");
});
