import assert from "node:assert/strict";
import test from "node:test";
import { executeQqHostCommand } from "../src/app/qq-host-command.js";
import { buildQqNativeToolSpecs, createQqNativeToolDispatcher } from "../src/infrastructure/codex/qq-native-tools.js";
import { flattenQqDynamicTools } from "../src/infrastructure/claude/claude-code-turn.js";

const request = { command: "command -v claude", reason: "主人要求启动 Claude Code，先确认程序路径" };
const owner = { isOwner: true, senderId: "10001", text: "启动我的cc" };

test("host access checks the verified role in group and private turns, not model arguments", async () => {
  for (const type of ["group_message", "private_message"]) {
    for (const role of [{}, { isBotAdmin: true }, { isOwner: "true" }]) {
      const result = await executeQqHostCommand({ ...request, isOwner: true, senderId: "10001", confirmed: true }, {
        event: { type, senderId: "20002", ...role }, projectDir: "/project",
        execute: () => assert.fail("unprivileged command executed")
      });
      assert.equal(result.ok, false);
    }
  }
});

test("an owner request executes only the submitted command with bounded isolated runtime", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await executeQqHostCommand({ ...request, cwd: "/tmp", timeoutMs: 999999 }, {
    event: owner, projectDir: "/project", signal: controller.signal,
    baseEnv: { HOME: "/home/bot", PATH: "/usr/bin", LANG: "C", HUB_API_TOKEN: "private", ANTHROPIC_AUTH_TOKEN: "private", BASH_ENV: "/tmp/inject", NODE_OPTIONS: "--require /tmp/inject.js" },
    execute: async (...args) => { calls.push(args); return { code: 0, signal: null, stdout: "/usr/bin/claude\n", stderr: "" }; }
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.reply).exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["/bin/bash", ["--noprofile", "--norc", "-c", request.command]]);
  const options = calls[0][2];
  assert.equal(options.cwd, "/tmp");
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.killProcessGroup, true);
  assert.equal(options.signal, controller.signal);
  assert.deepEqual(options.env, { HOME: "/home/bot", PATH: "/usr/bin", LANG: "C" });
  assert.deepEqual(owner, { isOwner: true, senderId: "10001", text: "启动我的cc" });
});

test("proactive messages and malformed requests never execute", async () => {
  for (const flag of [{ qqPrivateProactive: true }, { qqColdProactive: true }, { proactiveDecision: { proactive: true } }]) {
    assert.equal((await executeQqHostCommand(request, { event: { ...owner, ...flag }, execute: () => assert.fail() })).ok, false);
  }
  for (const args of [{ ...request, reason: "" }, { ...request, cwd: "relative" }, { ...request, command: "bad\0command" }, { ...request, timeoutMs: -1 }]) {
    assert.equal((await executeQqHostCommand(args, { event: owner, projectDir: "/project", execute: () => assert.fail() })).ok, false);
  }
});

test("failed and timed-out commands are reported as failures without automatic retry", async () => {
  for (const execute of [async () => ({ code: 7, stdout: "", stderr: "failed" }), async () => { throw Object.assign(new Error("timeout"), { code: "PROCESS_TIMEOUT" }); }]) {
    let calls = 0;
    const result = await executeQqHostCommand(request, { event: owner, projectDir: "/project", execute: (...args) => { calls++; return execute(...args); } });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  }
});

test("host commands retain original authority after cross-session focus and deduplicate execution", async () => {
  for (const rootEvent of [owner, { senderId: "20002", isBotAdmin: true }]) {
    let executions = 0;
    const dispatch = createQqNativeToolDispatcher({
      event: rootEvent, executeCommand: () => assert.fail(),
      executeStructured: (call, boundEvent, context) => {
        if (call.namespace === "qq_session") return { ok: true, scopeEvent: { ...owner, senderId: "other", groupId: "30003" } };
        assert.equal(boundEvent, rootEvent);
        assert.equal(context.rootEvent, rootEvent);
        return executeQqHostCommand(call.arguments, { event: boundEvent, projectDir: "/project", execute: async () => { executions++; return { code: 0, stdout: "ok", stderr: "" }; } });
      }
    });
    await dispatch({ namespace: "qq_session", tool: "manage", callId: "focus", arguments: { action: "select" } });
    const call = { namespace: "qq_runtime", tool: "host_command", callId: "host", arguments: request };
    const [first, duplicate] = await Promise.all([dispatch(call), dispatch(call)]);
    assert.deepEqual(first, duplicate);
    assert.equal(first.ok, rootEvent.isOwner === true);
    assert.equal(executions, rootEvent.isOwner ? 1 : 0);
  }
});

test("both engines expose the same host permission request tool only in the privileged catalog", () => {
  const privileged = buildQqNativeToolSpecs({ isOwner: true });
  const host = privileged.find((ns) => ns.name === "qq_runtime").tools.find((tool) => tool.name === "host_command");
  assert.deepEqual(host.inputSchema.required, ["command", "reason"]);
  assert.ok(flattenQqDynamicTools(privileged).some((tool) => tool.name === "qq_runtime__host_command"));
  assert.equal(flattenQqDynamicTools(buildQqNativeToolSpecs()).some((tool) => tool.name === "qq_runtime__host_command"), false);
});

test("real host execution reports a command result and honours a cancelled task", async () => {
  const result = await executeQqHostCommand({ command: "printf host-access-ok", reason: "验证本机执行链" }, { event: owner, projectDir: "/tmp" });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.reply).stdout, "host-access-ok");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeQqHostCommand(request, { event: owner, projectDir: "/tmp", signal: controller.signal });
  assert.equal(cancelled.ok, false);
});
