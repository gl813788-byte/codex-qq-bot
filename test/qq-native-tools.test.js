import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqNativeToolSpecs,
  createQqNativeToolDispatcher,
  mapQqNativeToolToCommand
} from "../src/infrastructure/codex/qq-native-tools.js";
import { normalizeDynamicToolResult } from "../src/infrastructure/agent/agent-turn-process.js";

test("native image recall remains bound to the original conversation and preserves visual tool results", async () => {
  const event = { groupId: "g1", isOwner: true };
  const focused = { groupId: "g2", isOwner: true };
  const imageResult = [{ type: "inputText", text: "image selected" }, { type: "inputImage", imageUrl: "data:image/png;base64,AAAA" }];
  let inspections = 0;
  const dispatch = createQqNativeToolDispatcher({
    event, executeCommand: async () => { assert.fail("must be structured"); },
    executeStructured: async (call, bound, context) => {
      if (call.namespace === "qq_session") return { ok: true, scopeEvent: focused };
      inspections += 1;
      assert.equal(bound, event);
      assert.equal(context.rootEvent, event);
      return { ok: true, reply: "selected", contentItems: imageResult };
    }
  });
  await dispatch({ namespace: "qq_session", tool: "manage", arguments: { action: "select" }, callId: "focus" });
  const call = { namespace: "qq_context", tool: "images", arguments: { action: "inspect", selector: "image-x" }, callId: "inspect" };
  const result = await dispatch(call);
  assert.deepEqual(normalizeDynamicToolResult(result), { success: true, contentItems: imageResult });
  assert.deepEqual(await dispatch(call), result);
  assert.equal(inspections, 1);
  const spec = buildQqNativeToolSpecs().find((item) => item.name === "qq_context").tools.find((item) => item.name === "images");
  assert.deepEqual(spec.inputSchema.properties.action.enum, ["list", "inspect"]);
  assert.deepEqual(spec.inputSchema.properties.mode.enum, ["original", "compressed"]);
  assert.deepEqual(buildQqNativeToolSpecs({ toolsEnabled: false }), []);
});

test("native QQ tools expose owner runtime controls only to verified owners", () => {
  const ordinary = buildQqNativeToolSpecs({ toolsEnabled: true });
  assert.ok(ordinary.some((entry) => entry.name === "qq_context"));
  assert.ok(ordinary.find((entry) => entry.name === "qq_context").tools.some((tool) => tool.name === "download_file"));
  assert.ok(ordinary.some((entry) => entry.name === "qq_search"));
  assert.ok(ordinary.find((entry) => entry.name === "qq_memory").tools.some((tool) => tool.name === "impression"));
  assert.equal(ordinary.find((entry) => entry.name === "qq_memory").tools.some((tool) => tool.name === "robot_profile"), false);
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

  const withRobots = buildQqNativeToolSpecs({ canRecordRobotProfiles: true });
  const robotTool = withRobots.find((entry) => entry.name === "qq_memory").tools
    .find((tool) => tool.name === "robot_profile");
  assert.deepEqual(robotTool.inputSchema.required, ["action", "userId"]);
  assert.deepEqual(robotTool.inputSchema.properties.action.enum, ["select", "upsert", "replace", "mark_human"]);
  assert.deepEqual(robotTool.inputSchema.properties.commands.items.required, ["command", "effect", "requiresMention"]);
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

test("structured robot profile calls stay native and bound to the turn event", async () => {
  const event = { groupId: "10001", senderId: "20002" };
  const calls = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeCommand: async () => ({ ok: false }),
    executeStructured: async (call, boundEvent) => {
      calls.push({ call, boundEvent });
      return { ok: true, reply: "已展开" };
    }
  });
  const result = await dispatch({
    callId: "robot-select-1",
    namespace: "qq_memory",
    tool: "robot_profile",
    arguments: { action: "select", userId: "30003" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.result, "已展开");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].boundEvent, event);
});

test("native tool arguments map to existing validated Hub commands", () => {
  assert.equal(mapQqNativeToolToCommand("qq_context", "history", { query: "最近 50" }), "/聊天记录 最近 50");
  assert.equal(mapQqNativeToolToCommand("qq_context", "history", { query: "" }), "/聊天记录 最近 50");
  assert.equal(
    mapQqNativeToolToCommand("qq_context", "history", { query: "原神 角色", userId: "12345", sessions: "group: 67890, 学习 群", contextLines: 9 }),
    "/聊天记录 人物:12345 会话:group:67890,学习群 上下文:3 原神 角色"
  );
  assert.equal(mapQqNativeToolToCommand("qq_context", "history", { query: "", userId: "12345" }), "/聊天记录 人物:12345");
  const historySchema = buildQqNativeToolSpecs().find((item) => item.name === "qq_context").tools
    .find((tool) => tool.name === "history").inputSchema;
  assert.deepEqual(historySchema.required, ["query"]);
  assert.deepEqual(Object.keys(historySchema.properties), ["query", "userId", "sessions", "contextLines"]);
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

test("native runtime AI tasks always submit in the background without changing force", () => {
  const owner = { event: { isOwner: true } };
  const admin = { event: { isBotAdmin: true } };
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "AI任务 强制 全部" }, owner), "/AI任务 强制 全部 后台");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "AI任务 聊天总结" }, admin), "/AI任务 聊天总结 后台");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "AI任务 强制 后台 全部" }, owner), "/AI任务 强制 后台 全部");
  assert.equal(mapQqNativeToolToCommand("qq_runtime", "configure", { command: "AI任务 强制 全部" }, { event: {} }), "");
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

test("avatar and knowledge picture tools are structured visual tools bound to the original conversation", async () => {
  const event = { groupId: "g1", isOwner: true };
  const focused = { groupId: "g2", isOwner: true };
  const visual = [{ type: "inputText", text: "avatar" }, { type: "inputImage", imageUrl: "data:image/jpeg;base64,AAAA" }];
  const seen = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeCommand: async () => { assert.fail("visual memory tools must be structured"); },
    executeStructured: async (call, bound) => {
      if (call.namespace === "qq_session") return { ok: true, scopeEvent: focused };
      seen.push(`${call.namespace}.${call.tool}`);
      assert.equal(bound, event);
      return { ok: true, reply: "shown", contentItems: visual };
    }
  });
  await dispatch({ namespace: "qq_session", tool: "manage", arguments: { action: "select" }, callId: "focus" });
  const avatar = await dispatch({ namespace: "qq_memory", tool: "avatar", arguments: { action: "inspect", userId: "10001" }, callId: "avatar" });
  const picture = await dispatch({ namespace: "qq_knowledge", tool: "image", arguments: { action: "inspect", title: "猫猫拳" }, callId: "picture" });
  assert.deepEqual(normalizeDynamicToolResult(avatar), { success: true, contentItems: visual });
  assert.deepEqual(normalizeDynamicToolResult(picture), { success: true, contentItems: visual });
  assert.deepEqual(seen, ["qq_memory.avatar", "qq_knowledge.image"]);

  const specs = buildQqNativeToolSpecs();
  const avatarSpec = specs.find((item) => item.name === "qq_memory").tools.find((tool) => tool.name === "avatar");
  assert.deepEqual(avatarSpec.inputSchema.properties.action.enum, ["list", "search", "inspect", "record"]);
  assert.deepEqual(avatarSpec.inputSchema.required, ["action"]);
  const imageSpec = specs.find((item) => item.name === "qq_knowledge").tools.find((tool) => tool.name === "image");
  assert.deepEqual(imageSpec.inputSchema.properties.action.enum, ["attach", "replace", "caption", "remove", "inspect"]);
  assert.deepEqual(imageSpec.inputSchema.required, ["action", "title"]);
});

test("sticker, message, lookup and self-state tools stay structured and bound to the original conversation", async () => {
  const event = { isOwner: true, groupId: "10001", senderId: "90001" };
  const focusedEvent = { isOwner: true, groupId: "20002", qqCrossSessionScopeId: "20002" };
  const bound = [];
  const dispatch = createQqNativeToolDispatcher({
    event,
    executeStructured: async (call, boundEvent) => {
      if (call.namespace === "qq_session") return { ok: true, scopeId: "20002", scopeEvent: focusedEvent, reply: "已选择" };
      bound.push({ tool: `${call.namespace}.${call.tool}`, boundEvent });
      return call.namespace === "qq_sticker"
        ? { ok: true, reply: "看图", contentItems: [{ type: "inputText", text: "看图" }, { type: "inputImage", imageUrl: "data:image/png;base64,AAAA" }] }
        : { ok: true, reply: "完成" };
    },
    executeCommand: async () => {
      throw new Error("new tools must not fall back to slash commands");
    }
  });
  await dispatch({ callId: "s1", namespace: "qq_session", tool: "manage", arguments: { action: "select", scopeId: "group:20002" } });
  const inspected = await dispatch({ callId: "t1", namespace: "qq_sticker", tool: "manage", arguments: { action: "inspect", selector: "#abcdef" } });
  await dispatch({ callId: "t2", namespace: "qq_message", tool: "act", arguments: { action: "react", emoji: "赞" } });
  await dispatch({ callId: "t3", namespace: "qq_context", tool: "lookup", arguments: { action: "member" } });
  await dispatch({ callId: "t4", namespace: "qq_self", tool: "state", arguments: {} });
  assert.deepEqual(bound.map((entry) => entry.tool), ["qq_sticker.manage", "qq_message.act", "qq_context.lookup", "qq_self.state"]);
  assert.ok(bound.every((entry) => entry.boundEvent === event));
  // Sticker inspection returns real visual input like the other visual tools.
  assert.equal(normalizeDynamicToolResult(inspected).contentItems.some((item) => item.type === "inputImage"), true);
  assert.equal(mapQqNativeToolToCommand("qq_sticker", "manage", { action: "inspect", selector: "x" }), "");
});
