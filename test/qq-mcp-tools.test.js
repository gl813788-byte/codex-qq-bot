import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeQqMcpConfig,
  buildCodexQqMcpServerConfig,
  flattenQqDynamicTools,
  qqMcpBridgeScriptPath,
  toCodexDynamicToolSpecs
} from "../src/infrastructure/agent/qq-mcp-tools.js";
import { buildQqNativeToolSpecs } from "../src/infrastructure/codex/qq-native-tools.js";
import { getQqTypingDelayMs } from "../src/qq-human-behavior.js";

test("every QQ tool carries MCP annotations and a namespaced MCP name", () => {
  const tools = flattenQqDynamicTools(buildQqNativeToolSpecs({
    isOwner: true,
    hasStickerCandidates: true,
    hasMemoryPeople: true,
    canRecordRobotProfiles: true,
    canSearchImages: true
  }));
  const names = tools.map((tool) => tool.name);
  for (const name of ["qq_context__lookup", "qq_message__act", "qq_self__state", "qq_sticker__manage", "qq_runtime__host_command"]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(tools.every((tool) => typeof tool.annotations?.readOnlyHint === "boolean"));
  assert.equal(tools.find((tool) => tool.name === "qq_context__history").annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === "qq_message__act").annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === "qq_runtime__host_command").annotations.destructiveHint, true);
  // Ordinary turns never see the privileged namespaces.
  const ordinary = flattenQqDynamicTools(buildQqNativeToolSpecs({})).map((tool) => tool.name);
  assert.equal(ordinary.some((name) => /^qq_(?:runtime|session)__/.test(name)), false);
  assert.ok(ordinary.includes("qq_message__act"));
});

test("App Server dynamic specs drop annotations and can defer loading", () => {
  const specs = toCodexDynamicToolSpecs(buildQqNativeToolSpecs({}), { deferLoading: true });
  for (const namespace of specs) {
    for (const tool of namespace.tools) {
      assert.deepEqual(Object.keys(tool).sort(), ["deferLoading", "description", "inputSchema", "name", "type"]);
    }
  }
});

test("engine MCP configs launch the shared bridge with the per-turn socket", () => {
  const launch = { command: process.execPath, args: [qqMcpBridgeScriptPath], env: { CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET: "/tmp/q.sock" } };
  assert.match(qqMcpBridgeScriptPath, /infrastructure\/agent\/qq-mcp-bridge\.mjs$/);
  const codex = buildCodexQqMcpServerConfig(launch);
  assert.equal(codex.default_tools_approval_mode, "approve");
  assert.ok(codex.tool_timeout_sec >= 120);
  assert.deepEqual(codex.env, launch.env);
  assert.equal(buildClaudeQqMcpConfig(launch).mcpServers.qq.type, "stdio");
});

test("follow-up bubbles wait in proportion to their length", () => {
  const fixed = () => 0;
  const short = getQqTypingDelayMs("嗯嗯", 650, { random: fixed });
  const long = getQqTypingDelayMs("这个我之前也遇到过，后来把缓存清掉就好了", 650, { random: fixed });
  assert.ok(short >= 650 && short < long, `${short} < ${long}`);
  assert.ok(getQqTypingDelayMs("字".repeat(500), 650, { random: () => 1 }) <= 4200);
  assert.ok(getQqTypingDelayMs("[[qq_sticker:#abcdef]]", 650, { random: fixed }) < 650);
});
