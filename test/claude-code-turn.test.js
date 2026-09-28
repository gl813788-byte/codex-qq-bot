import assert from "node:assert/strict";
import { spawn as spawnChild } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  buildClaudeCodeArgs,
  buildUserContent,
  claudeSessionIdFromThreadId,
  flattenQqDynamicTools,
  normalizeClaudeEffort,
  runClaudeCodeTurn,
  startClaudeToolBridge,
  toMcpToolResult
} from "../src/infrastructure/claude/claude-code-turn.js";
import { buildIsolatedClaudeChildEnv } from "../src/infrastructure/claude/claude-child-env.js";

const schema = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("public turns get restricted file tools without a shell or WebFetch", () => {
  const args = buildClaudeCodeArgs({
    cwd: "/runtime/task-1",
    sandbox: "workspace-write",
    sandboxPolicy: { writableRoots: ["/runtime/task-1"] },
    runtimeWorkspaceRoots: ["/runtime/task-1"],
    webSearchMode: "live",
    mcpToolNames: ["qq_context__history"],
    mcpConfigPath: "/tmp/x/mcp.json",
    outputSchema: schema,
    sessionId: "11111111-2222-4333-8444-555555555555",
    ephemeral: true
  });
  assert.ok(args.includes("--restricted"));
  assert.equal(valueAfter(args, "--tools"), "Read,Glob,Grep,Write,Edit,WebSearch");
  assert.equal(valueAfter(args, "--allowedTools"), "Read,Glob,Grep,Write,Edit,WebSearch,mcp__qq__qq_context__history");
  assert.equal(valueAfter(args, "--permission-mode"), "dontAsk");
  assert.equal(valueAfter(args, "--permission-prompts"), "none");
  assert.equal(valueAfter(args, "--setting-sources"), "");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args.includes("--add-dir"), false);
  assert.deepEqual(JSON.parse(valueAfter(args, "--json-schema")), schema);
  assert.equal(valueAfter(args, "--session-id"), "11111111-2222-4333-8444-555555555555");
  assert.ok(args.includes("--no-session-persistence"));
});

test("privileged file tasks add Bash and the project root; summaries stay read-only", () => {
  const privileged = buildClaudeCodeArgs({
    cwd: "/project",
    sandbox: "workspace-write",
    sandboxPolicy: { writableRoots: ["/runtime/task-1", "/project"] },
    runtimeWorkspaceRoots: ["/project", "/runtime/task-1"],
    shellAccess: true,
    webSearchMode: "disabled",
    model: "opus",
    reasoningEffort: "xhigh",
    sessionId: "11111111-2222-4333-8444-555555555555",
    resume: true,
    ephemeral: false
  });
  assert.equal(valueAfter(privileged, "--tools"), "Read,Glob,Grep,Write,Edit,Bash");
  assert.deepEqual(valuesAfter(privileged, "--add-dir"), ["/runtime/task-1"]);
  assert.equal(valueAfter(privileged, "--model"), "opus");
  assert.equal(valueAfter(privileged, "--effort"), "xhigh");
  assert.equal(valueAfter(privileged, "--resume"), "11111111-2222-4333-8444-555555555555");
  assert.equal(privileged.includes("--no-session-persistence"), false);

  const summary = buildClaudeCodeArgs({ sandbox: "read-only", shellAccess: true, sessionId: "s" });
  assert.equal(valueAfter(summary, "--tools"), "Read,Glob,Grep");
});

test("maps Codex effort names and namespaced dynamic tools", () => {
  assert.equal(normalizeClaudeEffort("minimal"), "low");
  assert.equal(normalizeClaudeEffort("ultra"), "max");
  assert.equal(normalizeClaudeEffort("HIGH"), "high");
  assert.equal(normalizeClaudeEffort("auto"), null);
  assert.deepEqual(flattenQqDynamicTools([{
    type: "namespace",
    name: "qq_memory",
    description: "Memory.",
    tools: [{ type: "function", name: "short_term", description: "Short.", inputSchema: schema }]
  }]), [{
    name: "qq_memory__short_term",
    namespace: "qq_memory",
    tool: "short_term",
    description: "Memory. Short.",
    inputSchema: schema
  }]);
  assert.equal(claudeSessionIdFromThreadId("claude:11111111-2222-4333-8444-555555555555"), "11111111-2222-4333-8444-555555555555");
  assert.equal(claudeSessionIdFromThreadId("thread-1"), null);
  assert.equal(claudeSessionIdFromThreadId("claude:not-a-uuid"), null);
});

test("converts local images to base64 blocks and reports unusable ones as text", () => {
  const files = { "/in/a.png": pngBytes, "/in/b.txt": Buffer.from("plain text file") };
  const readFile = (path) => {
    if (!files[path]) throw new Error("ENOENT");
    return files[path];
  };
  const content = buildUserContent([
    { type: "text", text: "看图" },
    { type: "localImage", path: "/in/a.png" },
    { type: "localImage", path: "/in/b.txt" },
    { type: "localImage", path: "/in/missing.png" }
  ], { readFile });
  assert.deepEqual(content[0], { type: "text", text: "看图" });
  assert.deepEqual(content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: pngBytes.toString("base64") } });
  assert.match(content[2].text, /不支持的图片格式/);
  assert.match(content[3].text, /图片无法读取/);
  assert.match(buildUserContent([{ type: "localImage", path: "/in/a.png" }], { readFile, maxImageBytes: 4 })[0].text, /图片过大/);
});

test("runs one turn, returns structured output and forwards only pre-tool text as progress", async () => {
  const claude = createFakeClaude();
  const progress = [];
  const images = mkdtempSync(join(tmpdir(), "claude-turn-test-"));
  const imagePath = join(images, "photo.png");
  writeFileSync(imagePath, pngBytes);
  try {
    const resultPromise = runClaudeCodeTurn({
      claudePath: "claude",
      cwd: "/tmp",
      prompt: "你好",
      imagePaths: [imagePath],
      outputSchema: schema,
      spawnProcess: claude.spawn,
      onProgress: (entry) => progress.push(entry.text),
      onReady: () => {
        const input = claude.lastUserInput();
        claude.replay(input);
        claude.assistant("m1", [{ type: "text", text: "我先翻一下聊天记录。" }]);
        claude.assistant("m1", [{ type: "tool_use", name: "mcp__qq__qq_context__history", input: { query: "最近 20" } }]);
        claude.assistant("m2", [{ type: "text", text: "这句是最终回复的草稿，不该当进度。" }]);
        claude.assistant("m2", [{ type: "tool_use", name: "StructuredOutput", input: { text: "好的" } }]);
        claude.result({ text: "好的" });
      }
    });
    const result = await resultPromise;
    assert.equal(result.finalResponse, JSON.stringify({ text: "好的" }));
    assert.match(result.threadId, /^claude:[0-9a-f-]{36}$/);
    assert.equal(result.resumed, false);
    assert.deepEqual(progress, ["我先翻一下聊天记录。"]);
    const first = claude.userInputs()[0].message.content;
    assert.deepEqual(first[0], { type: "text", text: "你好" });
    assert.equal(first[1].type, "image");
    assert.equal(first[1].source.media_type, "image/png");
    assert.equal(valueAfter(claude.args(), "--session-id"), result.threadId.slice("claude:".length));
  } finally {
    rmSync(images, { recursive: true, force: true });
  }
});

test("a result that arrives before steered input is consumed does not end the turn", async () => {
  const claude = createFakeClaude();
  let controls;
  const ready = new Promise((resolve) => { controls = resolve; });
  const resultPromise = runClaudeCodeTurn({ prompt: "first", spawnProcess: claude.spawn, onReady: controls });
  const turn = await ready;
  claude.replay(claude.lastUserInput());
  const steered = await turn.steer("追问：还有一件事");
  assert.equal(steered.deadlineRenewalCount, 1);
  claude.result(null, "draft that ignored the follow-up");
  await tick();
  claude.replay(claude.lastUserInput());
  claude.result(null, "combined reply");
  const result = await resultPromise;
  assert.equal(result.finalResponse, "combined reply");
  assert.equal(result.deadlineRenewalCount, 1);
  await assert.rejects(turn.steer("too late"), { code: "CODEX_TURN_NOT_ACTIVE" });
});

test("restart interrupts the active turn and completes with the replacement", async () => {
  const claude = createFakeClaude();
  let controls;
  const ready = new Promise((resolve) => { controls = resolve; });
  const restarted = [];
  const resultPromise = runClaudeCodeTurn({
    prompt: "original",
    spawnProcess: claude.spawn,
    onReady: controls,
    onRestarted: (entry) => restarted.push(entry)
  });
  const turn = await ready;
  claude.replay(claude.lastUserInput());
  claude.onInterrupt = (request) => {
    claude.controlResponse(request.request_id);
    claude.result(null, "", "error_during_execution");
  };
  const replacement = await turn.restart("replacement prompt");
  assert.equal(replacement.interruptedTurnId, "claude-turn-1");
  assert.equal(replacement.turnId, "claude-turn-2");
  assert.equal(restarted.length, 1);
  assert.equal(claude.lastUserInput().message.content[0].text, "replacement prompt");
  claude.replay(claude.lastUserInput());
  claude.result(null, "replacement reply");
  const result = await resultPromise;
  assert.equal(result.finalResponse, "replacement reply");
  assert.equal(result.turnId, "claude-turn-2");
});

test("a missing resumed session starts one fresh session with the full prompt", async () => {
  const sessionId = "11111111-2222-4333-8444-555555555555";
  const spawns = [];
  const claude = createFakeClaude({
    onSpawn: (fake, args) => {
      spawns.push(args);
      if (args.includes("--resume")) {
        fake.exitWith(1, `No conversation found with session ID: ${sessionId}`);
        return;
      }
      queueMicrotask(() => {
        fake.replay(fake.lastUserInput());
        fake.result(null, "fresh reply");
      });
    }
  });
  const result = await runClaudeCodeTurn({
    prompt: "full context",
    resumePrompt: "delta only",
    threadId: `claude:${sessionId}`,
    ephemeral: false,
    spawnProcess: claude.spawn
  });
  assert.equal(spawns.length, 2);
  assert.equal(valueAfter(spawns[0], "--resume"), sessionId);
  assert.ok(spawns[1].includes("--session-id"));
  assert.equal(result.resumed, false);
  assert.equal(result.finalResponse, "fresh reply");
  assert.equal(claude.lastUserInput().message.content[0].text, "full context");
});

test("the per-turn MCP bridge routes QQ tool calls through the Hub handler", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "claude-bridge-test-"));
  const calls = [];
  const bridge = await startClaudeToolBridge({
    workDir,
    tools: flattenQqDynamicTools([{
      type: "namespace",
      name: "qq_context",
      description: "Context.",
      tools: [{ type: "function", name: "history", description: "History.", inputSchema: schema }]
    }]),
    onCall: async (call) => {
      calls.push(call);
      return { ok: true, text: "最近 3 条消息" };
    },
    getTurn: () => ({ threadId: "claude:t", turnId: "claude-turn-1" })
  });
  const config = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(bridge.mcpConfigPath, "utf8")));
  const server = config.mcpServers.qq;
  const child = spawnChild(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const rpc = createLineClient(child);
    const init = await rpc.request({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    assert.equal(init.result.capabilities.tools !== undefined, true);
    const list = await rpc.request({ id: 2, method: "tools/list", params: {} });
    assert.deepEqual(list.result.tools.map((tool) => tool.name), ["qq_context__history"]);
    const call = await rpc.request({ id: 3, method: "tools/call", params: { name: "qq_context__history", arguments: { query: "最近 3" } } });
    assert.equal(call.result.isError, false);
    assert.match(call.result.content[0].text, /最近 3 条消息/);
    const unknown = await rpc.request({ id: 4, method: "tools/call", params: { name: "nope", arguments: {} } });
    assert.equal(unknown.result.isError, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].namespace, "qq_context");
    assert.equal(calls[0].tool, "history");
    assert.deepEqual(calls[0].arguments, { query: "最近 3" });
    assert.equal(calls[0].turnId, "claude-turn-1");
  } finally {
    child.kill();
    bridge.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("maps Hub tool results to MCP content", () => {
  assert.deepEqual(toMcpToolResult({ ok: false, error: "denied" }), {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: "denied" }) }],
    isError: true
  });
  assert.deepEqual(toMcpToolResult({
    contentItems: [{ type: "inputText", text: "hi" }, { type: "inputImage", imageUrl: "data:image/png;base64,AAAA" }],
    success: true
  }), {
    content: [{ type: "text", text: "hi" }, { type: "image", mimeType: "image/png", data: "AAAA" }],
    isError: false
  });
});

test("Claude child env keeps the login, applies a profile and drops Hub secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-env-test-"));
  try {
    const baseEnv = {
      HOME: "/home/bot",
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "inherited",
      TAVILY_API_KEY: "hub-secret",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "parent"
    };
    const overrides = { ...baseEnv, CODEX_REMOTE_CONTACT_QQ_MODE: "1", CODEX_REMOTE_CONTACT_API_TOKEN: "t" };
    const noProfile = buildIsolatedClaudeChildEnv({ baseEnv, profileEnvPath: join(dir, "missing.env"), overrides });
    assert.equal(noProfile.ANTHROPIC_API_KEY, "inherited");
    assert.equal(noProfile.CODEX_REMOTE_CONTACT_QQ_MODE, "1");
    assert.equal(noProfile.CODEX_REMOTE_CONTACT_API_TOKEN, undefined);
    assert.equal(noProfile.TAVILY_API_KEY, undefined);
    assert.equal(noProfile.CLAUDECODE, undefined);
    assert.equal(noProfile.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(noProfile.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");

    const profilePath = join(dir, "active.env");
    writeFileSync(profilePath, "export ANTHROPIC_BASE_URL='https://relay.example'\nexport ANTHROPIC_AUTH_TOKEN='relay-token'\n");
    const relay = buildIsolatedClaudeChildEnv({ baseEnv, profileEnvPath: profilePath });
    assert.equal(relay.ANTHROPIC_BASE_URL, "https://relay.example");
    assert.equal(relay.ANTHROPIC_AUTH_TOKEN, "relay-token");
    assert.equal(relay.ANTHROPIC_API_KEY, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFakeClaude({ onSpawn = null } = {}) {
  const inputs = [];
  let child;
  let lastArgs = [];
  const fake = {
    onInterrupt: null,
    spawn(_command, args) {
      lastArgs = args;
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
            const message = JSON.parse(line);
            if (message.type === "user") inputs.push(message);
            if (message.type === "control_request" && message.request?.subtype === "interrupt") {
              queueMicrotask(() => fake.onInterrupt?.(message));
            }
          }
          callback();
        }
      });
      if (onSpawn) queueMicrotask(() => onSpawn(fake, args));
      return child;
    },
    args: () => lastArgs,
    userInputs: () => inputs,
    lastUserInput: () => inputs.at(-1),
    emit(message) {
      child.stdout.write(`${JSON.stringify(message)}\n`);
    },
    replay(input) {
      fake.emit({ type: "user", isReplay: true, uuid: input.uuid, message: input.message });
    },
    assistant(id, content) {
      fake.emit({ type: "assistant", message: { id, role: "assistant", content } });
    },
    result(structuredOutput, text = "", subtype = "success") {
      fake.emit({
        type: "result",
        subtype,
        is_error: subtype !== "success",
        result: text,
        ...(structuredOutput ? { structured_output: structuredOutput } : {})
      });
    },
    controlResponse(requestId) {
      fake.emit({ type: "control_response", response: { subtype: "success", request_id: requestId } });
    },
    exitWith(code, stderrText) {
      child.stderr.write(stderrText);
      setTimeout(() => child.emit("close", code, null), 5);
    }
  };
  return fake;
}

function createLineClient(child) {
  const waiting = new Map();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      index = buffer.indexOf("\n");
    }
  });
  return {
    request(message) {
      return new Promise((resolve) => {
        waiting.set(message.id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      });
    }
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(args, flag) {
  return args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : []);
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
