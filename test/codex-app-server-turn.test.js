import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runCodexAppServerTurn } from "../src/codex-app-server-turn.js";
import { fingerprintQqCodexDynamicTools, resolveQqCodexReusableThreadId, QQ_CODEX_SESSION_PROTOCOL_VERSION } from "../src/qq-codex-session.js";

test("a changed QQ tool catalog starts a fresh thread with complete context", async () => {
  const oldTools = [{ type: "function", name: "old_tool", description: "old", inputSchema: { type: "object" } }];
  const newTools = [{ ...oldTools[0], name: "new_tool" }];
  const plan = { persistent: true, existingThread: {
    threadId: "thread-old", protocolVersion: QQ_CODEX_SESSION_PROTOCOL_VERSION,
    dynamicToolsFingerprint: fingerprintQqCodexDynamicTools(oldTools)
  } };
  const server = createFakeAppServer();
  const result = await runCodexAppServerTurn({
    threadId: resolveQqCodexReusableThreadId(plan, newTools),
    dynamicTools: newTools,
    prompt: "complete conversation and current task",
    resumePrompt: "only the latest delta",
    ephemeral: false,
    spawnProcess: server.spawn,
    onReady: () => server.complete("done")
  });
  assert.equal(result.resumed, false);
  assert.equal(server.messages.some((message) => message.method === "thread/resume"), false);
  assert.deepEqual(server.messages.find((message) => message.method === "thread/start").params.dynamicTools, newTools);
  assert.equal(server.messages.find((message) => message.method === "turn/start").params.input[0].text, "complete conversation and current task");
});

test("runs one app-server turn and steers additional input into the active turn", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    codexPath: "codex",
    cwd: "/tmp/qq",
    model: "gpt-test",
    reasoningEffort: "low",
    prompt: "first message",
    imagePaths: ["/tmp/one.png"],
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });

  const controls = await readyPromise;
  const steered = await controls.steer("消息一：later one\n\n消息二：later two");
  assert.equal(steered.turnId, "turn-1");
  assert.equal(steered.deadlineRenewalCount, 1);
  server.complete("the one combined reply");

  const result = await resultPromise;
  assert.equal(result.finalResponse, "the one combined reply");
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.turnId, "turn-1");
  assert.equal(result.deadlineRenewalCount, 1);
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/steer"]
  );
  assert.deepEqual(server.messages[3].params.input, [
    { type: "text", text: "first message" },
    { type: "localImage", path: "/tmp/one.png", detail: null }
  ]);
  assert.deepEqual(server.messages[4].params, {
    threadId: "thread-1",
    expectedTurnId: "turn-1",
    input: [{ type: "text", text: "消息一：later one\n\n消息二：later two" }]
  });
});

test("rejects steering after completion and aborts an active app-server turn", async () => {
  const completedServer = createFakeAppServer();
  let completedReady;
  const completedReadyPromise = new Promise((resolve) => { completedReady = resolve; });
  const completedResult = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: completedServer.spawn,
    onReady: completedReady
  });
  const completedControls = await completedReadyPromise;
  completedServer.complete("done");
  await completedResult;
  await assert.rejects(completedControls.steer("too late"), (error) => error.code === "CODEX_TURN_NOT_ACTIVE");

  const abortedServer = createFakeAppServer();
  const controller = new AbortController();
  let abortedReady;
  const abortedReadyPromise = new Promise((resolve) => { abortedReady = resolve; });
  const abortedResult = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    signal: controller.signal,
    spawnProcess: abortedServer.spawn,
    onReady: abortedReady
  });
  await abortedReadyPromise;
  controller.abort("stopped");
  await assert.rejects(abortedResult, (error) => error.code === "ABORT_ERR");
});

test("interrupts the current turn and starts a replacement turn with new input", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const controls = await readyPromise;
  const restarted = await controls.restart([
    { type: "text", text: "merged follow-up" },
    { type: "localImage", path: "/tmp/follow-up.png" }
  ]);
  assert.deepEqual(restarted, {
    threadId: "thread-1",
    turnId: "turn-2",
    interruptedTurnId: "turn-1",
    deadlineRenewalCount: 1
  });
  server.complete("replacement answer");

  const result = await resultPromise;
  assert.equal(result.finalResponse, "replacement answer");
  assert.equal(result.turnId, "turn-2");
  assert.equal(result.deadlineRenewalCount, 1);
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/interrupt", "turn/start"]
  );
  assert.deepEqual(server.messages[5].params.input, [
    { type: "text", text: "merged follow-up" },
    { type: "localImage", path: "/tmp/follow-up.png", detail: null }
  ]);
});

test("renews the full turn deadline when a follow-up starts a replacement", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 300,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const observedResult = resultPromise.then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error })
  );
  const controls = await readyPromise;

  await delay(200);
  const restarted = await controls.restart("late merged follow-up");
  await delay(200);
  server.complete("completed inside the renewed window");

  const outcome = await observedResult;
  assert.equal(outcome.error, null);
  assert.equal(outcome.value.finalResponse, "completed inside the renewed window");
  assert.equal(outcome.value.deadlineRenewalCount, 1);
  assert.equal(restarted.deadlineRenewalCount, 1);
});

test("starts the replacement when app-server reports that the old turn already became inactive", async () => {
  const server = createFakeAppServer({ interrupt: "inactive" });
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const controls = await readyPromise;
  const restarted = await controls.restart("new fused input");
  assert.deepEqual(restarted, {
    threadId: "thread-1",
    turnId: "turn-2",
    interruptedTurnId: "turn-1",
    deadlineRenewalCount: 1
  });
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ["initialize", "initialized", "thread/start", "turn/start", "turn/interrupt", "turn/start"]
  );
  server.complete("replacement after inactive race");
  assert.equal((await resultPromise).finalResponse, "replacement after inactive race");
});

test("fails a silent replacement early and exposes its accepted input for fresh-process recovery", async () => {
  const server = createFakeAppServer();
  let ready;
  let restarted;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 500,
    replacementIdleTimeoutMs: 30,
    spawnProcess: server.spawn,
    onReady: ready,
    onRestarted: (details) => { restarted = details; }
  });
  const controls = await readyPromise;
  await controls.restart([
    { type: "text", text: "fused follow-up" },
    { type: "localImage", path: "/tmp/fused.png" }
  ]);

  const keepEventLoopAlive = delay(60);
  await assert.rejects(resultPromise, (error) => {
    assert.equal(error.code, "CODEX_REPLACEMENT_STALLED");
    assert.equal(error.deadlineRenewalCount, 1);
    return true;
  });
  await keepEventLoopAlive;
  assert.equal(restarted.turnId, "turn-2");
  assert.deepEqual(restarted.input, [
    { type: "text", text: "fused follow-up" },
    { type: "localImage", path: "/tmp/fused.png", detail: null }
  ]);
});

test("allows a replacement to stay quiet through its configured task-specific idle window", async () => {
  const server = createFakeAppServer();
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "first",
    timeoutMs: 500,
    replacementIdleTimeoutMs: 120,
    spawnProcess: server.spawn,
    onReady: ready
  });
  const controls = await readyPromise;
  await controls.restart("long-running replacement tool");

  await delay(70);
  server.complete("completed after the former fixed idle window");

  const result = await resultPromise;
  assert.equal(result.finalResponse, "completed after the former fixed idle window");
  assert.equal(result.deadlineRenewalCount, 1);
});

test("resumes a persistent thread and falls back to a new one when it is stale", async () => {
  const resumedServer = createFakeAppServer({ resume: "ok" });
  const resumedTools = [{
    type: "function",
    name: "qq_runtime",
    description: "current-turn tools",
    inputSchema: { type: "object", properties: {} }
  }];
  let resumedReady;
  const resumedReadyPromise = new Promise((resolve) => { resumedReady = resolve; });
  const resumedResult = runCodexAppServerTurn({
    prompt: "full fallback context",
    resumePrompt: "merged follow-up delta",
    threadId: "thread-old",
    dynamicTools: resumedTools,
    ephemeral: false,
    timeoutMs: 5_000,
    spawnProcess: resumedServer.spawn,
    onReady: resumedReady
  });
  await resumedReadyPromise;
  resumedServer.complete("continued");
  assert.equal((await resumedResult).resumed, true);
  assert.ok(resumedServer.messages.some((message) => message.method === "thread/resume"));
  assert.equal(
    resumedServer.messages.find((message) => message.method === "thread/resume").params.dynamicTools,
    undefined
  );
  assert.equal(resumedServer.messages.some((message) => message.method === "thread/start"), false);
  assert.equal(
    resumedServer.messages.find((message) => message.method === "turn/start").params.input[0].text,
    "merged follow-up delta"
  );

  const staleServer = createFakeAppServer({ resume: "fail" });
  let staleReady;
  const staleReadyPromise = new Promise((resolve) => { staleReady = resolve; });
  const staleResult = runCodexAppServerTurn({
    prompt: "full fallback context",
    resumePrompt: "merged follow-up delta",
    threadId: "thread-missing",
    ephemeral: false,
    timeoutMs: 5_000,
    spawnProcess: staleServer.spawn,
    onReady: staleReady
  });
  await staleReadyPromise;
  staleServer.complete("new thread");
  assert.equal((await staleResult).resumed, false);
  assert.ok(staleServer.messages.some((message) => message.method === "thread/resume"));
  assert.ok(staleServer.messages.some((message) => message.method === "thread/start"));
  assert.equal(
    staleServer.messages.find((message) => message.method === "turn/start").params.input[0].text,
    "full fallback context"
  );
});

test("large image tool echoes do not consume the ordinary protocol output budget", async () => {
  const server = createFakeAppServer();
  const imageUrl = `data:image/png;base64,${"A".repeat(5 * 1024 * 1024)}`;
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "inspect two images",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready,
    onDynamicToolCall: () => ({ contentItems: [{ type: "inputImage", imageUrl }], success: true })
  });
  await readyPromise;
  for (const index of [1, 2]) {
    const response = await Promise.race([
      server.requestTool({ requestId: 900 + index, callId: `image-${index}`, tool: "images", arguments: {} }),
      resultPromise
    ]);
    server.notify({
      method: "item/completed",
      params: { item: { id: `image-${index}`, type: "dynamicToolCall", ...response.result } }
    });
    server.notify({
      method: "codex/event/dynamic_tool_call_end",
      params: { msg: { call_id: `image-${index}`, ...response.result } }
    });
  }
  server.complete("images inspected");
  assert.equal((await resultPromise).finalResponse, "images inspected");
});

test("image allowance cannot be spent on text, unknown images or unlimited replay", async () => {
  const imageUrl = `data:image/png;base64,${"A".repeat(5_000)}`;
  for (const mode of ["text", "unknown-image", "replayed-image"]) {
    const server = createFakeAppServer();
    let ready;
    const readyPromise = new Promise((resolve) => { ready = resolve; });
    let calls = 0;
    const resultPromise = runCodexAppServerTurn({
      prompt: "bounded image output",
      maxProtocolBytes: 4_000,
      timeoutMs: 5_000,
      spawnProcess: server.spawn,
      onReady: ready,
      onDynamicToolCall: () => {
        calls += 1;
        return { contentItems: [{ type: "inputImage", imageUrl }], success: true };
      }
    });
    const rejected = assert.rejects(resultPromise, (error) => error.code === "CODEX_APP_SERVER_OUTPUT_LIMIT");
    await readyPromise;
    for (const requestId of [900, 901]) {
      await server.requestTool({ requestId, callId: "same-image", tool: "images", arguments: {} });
    }
    assert.equal(calls, 1);
    if (mode === "replayed-image") {
      for (let index = 0; index < 5; index += 1) {
        server.notify({ method: "item/completed", params: { item: { type: "inputImage", imageUrl } } });
      }
    } else {
      server.notify({ method: "item/completed", params: { item: {
        type: "inputImage", imageUrl
      } } });
      server.notify({ method: "item/completed", params: { item: mode === "text"
        ? { type: "agentMessage", text: "x".repeat(5_000) }
        : { type: "inputImage", imageUrl: imageUrl.replace(/A/g, "B") }
      } });
    }
    await rejected;
  }
});

test("handles dynamic tools as server requests and forwards native turn settings", async () => {
  const server = createFakeAppServer();
  const calls = [];
  const progress = [];
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const outputSchema = { type: "object", properties: { text: { type: "string" } } };
  const dynamicTools = [{
    type: "function",
    name: "qq_history",
    description: "read history",
    inputSchema: { type: "object", properties: {} }
  }];
  const resultPromise = runCodexAppServerTurn({
    prompt: "native turn",
    cwd: "/tmp/qq-task",
    developerInstructions: "native agent instructions",
    dynamicTools,
    outputSchema,
    webSearchMode: "live",
    sandbox: "workspace-write",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/tmp/qq-task"],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true
    },
    runtimeWorkspaceRoots: ["/tmp/qq-task"],
    reasoningSummary: "auto",
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: ready,
    onDynamicToolCall: async (call) => {
      calls.push(call);
      return { ok: true, rows: ["one", "two"] };
    },
    onProgress: (item) => progress.push(item)
  });
  await readyPromise;

  const first = await server.requestTool({
    requestId: 900,
    callId: "tool-call-1",
    namespace: "qq_context",
    tool: "history",
    arguments: { query: "recent" }
  });
  const duplicate = await server.requestTool({
    requestId: 901,
    callId: "tool-call-1",
    namespace: "qq_context",
    tool: "history",
    arguments: { query: "recent" }
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(first.result, duplicate.result);
  assert.equal(first.result.success, true);
  assert.match(first.result.contentItems[0].text, /"rows"/);

  server.notify({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "commentary-1", type: "agentMessage", phase: "commentary", text: "正在核对" }
    }
  });
  server.notify({
    method: "turn/plan/updated",
    params: { turnId: "turn-1", explanation: "计划", plan: [{ step: "完成", status: "completed" }] }
  });
  server.complete('{"text":"done"}');
  const result = await resultPromise;

  const initialize = server.messages.find((message) => message.method === "initialize");
  const threadStart = server.messages.find((message) => message.method === "thread/start");
  const turnStart = server.messages.find((message) => message.method === "turn/start");
  assert.equal(initialize.params.capabilities.experimentalApi, true);
  assert.equal(threadStart.params.developerInstructions, "native agent instructions");
  assert.deepEqual(threadStart.params.dynamicTools, dynamicTools);
  assert.equal(threadStart.params.config.web_search, "live");
  assert.deepEqual(turnStart.params.outputSchema, outputSchema);
  assert.deepEqual(turnStart.params.sandboxPolicy.writableRoots, ["/tmp/qq-task"]);
  assert.deepEqual(turnStart.params.runtimeWorkspaceRoots, ["/tmp/qq-task"]);
  assert.equal(progress.some((item) => item.type === "commentary"), true);
  assert.equal(progress.some((item) => item.type === "plan"), true);
  assert.ok(result.items.some((item) => item.id === "commentary-1"));
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeAppServer({ resume = "ok", interrupt = "ok" } = {}) {
  const messages = [];
  let child;
  let currentTurnId = null;
  let turnCount = 0;
  const serverResponses = new Map();

  const send = (message) => {
    queueMicrotask(() => child.stdout.write(`${JSON.stringify(message)}\n`));
  };

  const spawn = () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
          const message = JSON.parse(line);
          messages.push(message);
          if (!message.method && Object.hasOwn(message, "id") && serverResponses.has(message.id)) {
            serverResponses.get(message.id)(message);
            serverResponses.delete(message.id);
            continue;
          }
          if (message.method === "initialize") {
            send({ id: message.id, result: { userAgent: "test" } });
          } else if (message.method === "thread/start") {
            send({ id: message.id, result: { thread: { id: "thread-1" } } });
          } else if (message.method === "thread/resume") {
            if (resume === "fail") send({ id: message.id, error: { code: -32000, message: "missing thread" } });
            else send({ id: message.id, result: { thread: { id: "thread-1" } } });
          } else if (message.method === "turn/start") {
            currentTurnId = `turn-${++turnCount}`;
            send({ id: message.id, result: { turn: { id: currentTurnId, status: "inProgress", items: [] } } });
          } else if (message.method === "turn/steer") {
            send({ id: message.id, result: { turnId: currentTurnId } });
          } else if (message.method === "turn/interrupt") {
            if (interrupt === "inactive") {
              send({ id: message.id, error: { code: -32000, message: "no active turn to interrupt" } });
            } else {
              send({ id: message.id, result: {} });
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-1",
                  turn: {
                    id: currentTurnId,
                    status: "interrupted",
                    items: []
                  }
                }
              });
            }
          }
        }
        callback();
      }
    });
    child.kill = (signal = "SIGTERM") => {
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    return child;
  };

  return {
    messages,
    spawn,
    notify(message) {
      send(message);
    },
    requestTool({ requestId, callId, namespace, tool, arguments: args }) {
      const response = new Promise((resolve) => serverResponses.set(requestId, resolve));
      send({
        method: "item/tool/call",
        id: requestId,
        params: {
          threadId: "thread-1",
          turnId: currentTurnId,
          callId,
          namespace,
          tool,
          arguments: args
        }
      });
      return response;
    },
    complete(text) {
      send({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: currentTurnId,
          completedAtMs: Date.now(),
          item: { id: "message-1", type: "agentMessage", phase: "final_answer", text }
        }
      });
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: currentTurnId,
            status: "completed",
            items: [{ id: "message-1", type: "agentMessage", phase: "final_answer", text }]
          }
        }
      });
    }
  };
}

test("the MCP transport serves QQ tools from a per-turn server instead of dynamic tools", async () => {
  const server = createFakeAppServer();
  const calls = [];
  let started = null;
  let closed = false;
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "mcp turn",
    config: { "features.apps": false },
    toolTransport: "mcp",
    dynamicTools: [{
      type: "namespace",
      name: "qq_sticker",
      description: "Stickers.",
      tools: [{
        type: "function",
        name: "manage",
        description: "Search stickers.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true }
      }]
    }],
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    startToolServer: async (options) => {
      started = options;
      return {
        launch: { command: "/usr/bin/node", args: ["/bridge.mjs"], env: { CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET: "/s.sock" } },
        close: () => { closed = true; }
      };
    },
    onReady: ready,
    onDynamicToolCall: async (call) => {
      calls.push(call);
      return { ok: true, result: "#3f2a9c 无语猫猫" };
    }
  });
  await readyPromise;
  assert.deepEqual(started.tools.map((tool) => tool.name), ["qq_sticker__manage"]);
  assert.deepEqual(started.tools[0].annotations, { readOnlyHint: true });
  const result = await started.onCall({ namespace: "qq_sticker", tool: "manage", arguments: { action: "search" }, callId: "codex-mcp-1" });
  assert.equal(result.success, true);
  assert.equal(calls[0].threadId, "thread-1");
  assert.equal(calls[0].turnId, "turn-1");
  server.complete("done");
  await resultPromise;

  const threadStart = server.messages.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.dynamicTools, undefined);
  assert.equal(threadStart.params.config["features.apps"], false);
  assert.deepEqual(threadStart.params.config.mcp_servers.qq, {
    command: "/usr/bin/node",
    args: ["/bridge.mjs"],
    env: { CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET: "/s.sock" },
    default_tools_approval_mode: "approve",
    startup_timeout_sec: 30,
    tool_timeout_sec: 300
  });
  assert.equal(closed, true);
});

test("MCP image results echoed as bare base64 stay inside the image allowance", async () => {
  const server = createFakeAppServer();
  const payload = `iVBORw0KGgo${"A".repeat(5 * 1024 * 1024)}`;
  let started = null;
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const resultPromise = runCodexAppServerTurn({
    prompt: "inspect via mcp",
    toolTransport: "mcp",
    dynamicTools: [{ type: "function", name: "qq_image", description: "image", inputSchema: { type: "object" } }],
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    startToolServer: async (options) => {
      started = options;
      return { launch: { command: "node", args: [], env: {} }, close() {} };
    },
    onReady: ready,
    onDynamicToolCall: () => ({ contentItems: [{ type: "inputImage", imageUrl: `data:image/png;base64,${payload}` }], success: true })
  });
  await readyPromise;
  await started.onCall({ namespace: "", tool: "qq_image", arguments: {}, callId: "codex-mcp-img" });
  server.notify({
    method: "item/completed",
    params: { item: { id: "mcp-1", type: "mcpToolCall", server: "qq", tool: "qq_image", result: { content: [{ type: "image", data: payload, mimeType: "image/png" }] } } }
  });
  server.complete("seen");
  assert.equal((await resultPromise).finalResponse, "seen");
});

test("dynamic tools can be deferred and never carry MCP-only annotations", async () => {
  const server = createFakeAppServer();
  await runCodexAppServerTurn({
    prompt: "deferred",
    deferToolLoading: true,
    dynamicTools: [{
      type: "namespace",
      name: "qq_context",
      description: "Context.",
      tools: [{ type: "function", name: "history", description: "History.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
    }],
    timeoutMs: 5_000,
    spawnProcess: server.spawn,
    onReady: () => server.complete("ok")
  });
  const threadStart = server.messages.find((message) => message.method === "thread/start");
  assert.deepEqual(threadStart.params.dynamicTools, [{
    type: "namespace",
    name: "qq_context",
    description: "Context.",
    tools: [{ type: "function", name: "history", description: "History.", inputSchema: { type: "object" }, deferLoading: true }]
  }]);
  assert.equal(threadStart.params.config?.mcp_servers, undefined);
});
