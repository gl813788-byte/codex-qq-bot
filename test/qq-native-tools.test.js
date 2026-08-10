import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqNativeToolSpecs,
  createQqNativeToolDispatcher,
  mapQqNativeToolToCommand
} from "../src/infrastructure/codex/qq-native-tools.js";

test("native QQ tools expose owner runtime controls only to verified owners", () => {
  const ordinary = buildQqNativeToolSpecs({ toolsEnabled: true });
  assert.ok(ordinary.some((entry) => entry.name === "qq_context"));
  assert.ok(ordinary.find((entry) => entry.name === "qq_context").tools.some((tool) => tool.name === "download_file"));
  assert.ok(ordinary.some((entry) => entry.name === "qq_search"));
  assert.ok(ordinary.find((entry) => entry.name === "qq_memory").tools.some((tool) => tool.name === "impression"));
  assert.equal(ordinary.some((entry) => entry.name === "qq_runtime"), false);

  const owner = buildQqNativeToolSpecs({ isOwner: true, hasMemoryPeople: true, hasStickerCandidates: true });
  assert.ok(owner.some((entry) => entry.name === "qq_runtime"));
  assert.ok(owner.some((entry) => entry.name === "qq_session"));
  assert.ok(owner.find((entry) => entry.name === "qq_memory").tools.some((tool) => tool.name === "person_detail"));
  assert.ok(owner.some((entry) => entry.name === "qq_sticker"));
  const sessionSchema = owner.find((entry) => entry.name === "qq_session").tools[0].inputSchema;
  assert.deepEqual(sessionSchema.required, ["action"]);
  const socialSchema = owner.find((entry) => entry.name === "qq_social").tools[0].inputSchema;
  assert.deepEqual(socialSchema.required, ["action"]);
  assert.equal(socialSchema.properties.action.enum.includes("add_friend"), false);
  assert.equal(socialSchema.properties.action.enum.includes("join_group"), true);
});

test("native file download remains structured and bound to the original trigger event", async () => {
  const event = { senderId: "10001", files: [{ name: "input.txt" }] };
  const calls = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeCommand: async () => ({ ok: false }),
    executeStructured: async (call, boundEvent, context) => {
      calls.push({ call, boundEvent, context });
      return { ok: true, reply: "/task/input/input.txt" };
    }
  });
  const result = await dispatch({
    callId: "file-1",
    namespace: "qq_context",
    tool: "download_file",
    arguments: { selector: "file-1" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, "/task/input/input.txt");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].boundEvent, event);
  assert.equal(calls[0].context.rootEvent, event);
});

test("owner session selection routes subsequent QQ tools to the selected event", async () => {
  const event = { isOwner: true, groupId: "10001", senderId: "90001" };
  const focusedEvent = {
    isOwner: true,
    groupId: "20002",
    senderId: "",
    qqCrossSessionScopeId: "20002"
  };
  const calls = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeStructured: async (call) => {
      assert.equal(call.namespace, "qq_session");
      return { ok: true, scopeId: "20002", scopeEvent: focusedEvent, reply: "已选择" };
    },
    executeCommand: async (command, boundEvent) => {
      calls.push({ command, boundEvent });
      return { ok: true, reply: "已读取" };
    }
  });

  const selected = await dispatch({
    callId: "select-1",
    namespace: "qq_session",
    tool: "manage",
    arguments: { action: "select", scopeId: "group:20002", value: "" }
  });
  const history = await dispatch({
    callId: "history-1",
    namespace: "qq_context",
    tool: "history",
    arguments: { query: "最近 20" }
  });

  assert.equal(selected.scopeId, "20002");
  assert.equal(history.scopeId, "20002");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/聊天记录 最近 20");
  assert.equal(calls[0].boundEvent, focusedEvent);
});

test("structured impression updates stay bound to the turn event and are deduplicated", async () => {
  const event = { senderId: "10001" };
  const calls = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeCommand: async () => ({ ok: false }),
    executeStructured: async (call, boundEvent) => {
      calls.push({ call, boundEvent });
      return { ok: true, reply: "已暂存" };
    }
  });
  const request = {
    callId: "impression-1",
    namespace: "qq_memory",
    tool: "impression",
    arguments: { personImpressionSummary: "喜欢研究 Agent 架构" }
  };
  assert.deepEqual(await dispatch(request), await dispatch(request));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].boundEvent, event);
});

test("native tool arguments map to existing validated Hub commands", () => {
  assert.equal(mapQqNativeToolToCommand("qq_context", "history", { query: "最近 50" }), "/聊天记录 最近 50");
  assert.equal(mapQqNativeToolToCommand("qq_search", "chinese_web", { query: "Codex 最新版本" }), "/联网 Codex 最新版本");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "思考强度 high" }, { event: { isOwner: true } }), "/思考强度 high");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "思考强度 high" }, { event: { isOwner: false } }), "");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "思考强度 high" }, { event: { isBotAdmin: true } }), "/思考强度 high");
  assert.equal(mapQqNativeToolToCommand("qq_social", "act", { action: "like", target: "发送者", value: "2" }), "/点赞 发送者 2");
  assert.equal(mapQqNativeToolToCommand("qq_social", "act", { action: "requests", target: "#abc123", value: "同意" }), "/申请 同意 #abc123");
  assert.equal(mapQqNativeToolToCommand("qq_social", "act", { action: "add_friend", target: "123456", value: "" }), "");
});

test("native dispatcher binds the original event and deduplicates writes by call id", async () => {
  const event = { isOwner: true, senderId: "10001" };
  const calls = [];
  const toolEvents = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    onToolEvent: (toolEvent) => toolEvents.push(toolEvent),
    executeCommand: async (command, boundEvent) => {
      calls.push({ command, boundEvent });
      return { ok: true, reply: "设置已持久化" };
    }
  });
  const request = {
    callId: "call-1",
    namespace: "qq_runtime",
    tool: "configure",
    arguments: { command: "会话模式 长期" }
  };
  const first = await dispatch(request);
  const second = await dispatch(request);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/会话模式 长期");
  assert.equal(calls[0].boundEvent, event);
  assert.equal(event.qqCurrentToolRound, 1);
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].namespace, "qq_runtime");
  assert.equal(toolEvents[0].tool, "configure");
  assert.equal(toolEvents[0].outcome, "success");
  assert.equal(toolEvents[0].toolRound, 1);
  assert.equal(toolEvents[0].sourceEvent, event);
});

test("native tool observer receives safe failure metadata without changing the result", async () => {
  const toolEvents = [];
  const dispatch = createQqNativeToolDispatcher({
    event: { senderId: "10001" },
    executeCommand: async () => ({ ok: true }),
    onToolEvent: (toolEvent) => toolEvents.push(toolEvent)
  });
  const result = await dispatch({
    callId: "unknown-1",
    namespace: "qq_unknown",
    tool: "missing",
    arguments: { privateText: "must not enter lifecycle metadata" }
  });
  assert.equal(result.ok, false);
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].errorCode, "unknown_tool");
  assert.equal(Object.hasOwn(toolEvents[0], "arguments"), false);
});
