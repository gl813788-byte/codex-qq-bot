import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachErrorFields,
  createAgentTurnErrors,
  createNdjsonReader,
  createTurnDeadlines,
  normalizeDynamicToolResult,
  normalizeImagePaths,
  normalizePositiveInteger,
  notifyObserver,
  superviseAgentChild
} from "../agent/agent-turn-process.js";

// Claude Code adapter with the same contract as runCodexAppServerTurn: one
// `claude -p` stream-json process per QQ turn, dynamic QQ tools served over a
// per-turn MCP bridge, structured output through --json-schema, and
// steer/restart/interrupt controls for fused follow-ups. Deadlines, framing,
// child supervision and the CODEX_* error codes come from the shared agent
// turn module so recovery and steering policies stay engine-neutral.

// Replayed user messages echo base64 images, so allow more than Codex does.
const DEFAULT_MAX_PROTOCOL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 3_750_000;
const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";
const MCP_SERVER_NAME = "qq";
const THREAD_ID_PREFIX = "claude:";
const bridgeScriptPath = fileURLToPath(new URL("./qq-mcp-bridge.mjs", import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claudeEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);
const errors = createAgentTurnErrors("Claude Code");

// Text Claude writes right before a tool call becomes QQ-visible progress, the
// same way Codex commentary does, so the adapter tells the model about it.
const CLAUDE_ADAPTER_INSTRUCTIONS = [
  "运行环境说明：你通过 Claude Code 为 QQ Bot 执行本轮任务。",
  "Hub 提供的 QQ 动态工具以 mcp__qq__<命名空间>__<工具名> 的形式出现，按工具说明直接调用。",
  "在工具调用之前写出的可见文字会作为任务进度发给 QQ 用户；不要写过渡性旁白，只在长任务取得阶段性结果时写一句自然中文进度。",
  "最终答案必须通过结构化输出提交，不要在结构化输出之外重复最终回复。"
].join("\n");

export function toClaudeThreadId(sessionId) {
  return sessionId ? `${THREAD_ID_PREFIX}${sessionId}` : null;
}

// Persistent scopes store Claude sessions beside Codex threads; Codex must
// never try to resume one of these ids after an engine switch.
export function isClaudeThreadId(threadId) {
  return String(threadId || "").startsWith(THREAD_ID_PREFIX);
}

export function claudeSessionIdFromThreadId(threadId) {
  const value = String(threadId || "").trim();
  if (!value.startsWith(THREAD_ID_PREFIX)) return null;
  const sessionId = value.slice(THREAD_ID_PREFIX.length);
  return uuidPattern.test(sessionId) ? sessionId : null;
}

export function normalizeClaudeEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  if (claudeEfforts.has(effort)) return effort;
  if (effort === "ultra") return "max";
  if (effort === "none" || effort === "minimal") return "low";
  return null;
}

export function flattenQqDynamicTools(dynamicTools = []) {
  const tools = [];
  for (const entry of Array.isArray(dynamicTools) ? dynamicTools : []) {
    if (entry?.type === "namespace" && Array.isArray(entry.tools)) {
      for (const tool of entry.tools) {
        if (!tool?.name) continue;
        tools.push({
          name: `${entry.name}__${tool.name}`,
          namespace: String(entry.name),
          tool: String(tool.name),
          description: [entry.description, tool.description].filter(Boolean).join(" "),
          inputSchema: tool.inputSchema || { type: "object", properties: {} }
        });
      }
    } else if (entry?.name) {
      tools.push({
        name: String(entry.name),
        namespace: entry.namespace ? String(entry.namespace) : "",
        tool: String(entry.name),
        description: String(entry.description || ""),
        inputSchema: entry.inputSchema || { type: "object", properties: {} }
      });
    }
  }
  return tools;
}

// Maps the Codex sandbox vocabulary onto Claude Code flags. Every turn runs in
// --restricted mode: file tools are confined to cwd plus --add-dir roots, and
// Bash exists only when the caller grants shellAccess (verified owner/admin
// file tasks). WebFetch stays off because it could reach loopback services.
export function buildClaudeCodeArgs({
  model = null,
  reasoningEffort = null,
  cwd = null,
  sandbox = "read-only",
  sandboxPolicy = null,
  runtimeWorkspaceRoots = [],
  webSearchMode = null,
  shellAccess = false,
  mcpToolNames = [],
  mcpConfigPath = null,
  outputSchema = null,
  systemPromptPath = null,
  replaceSystemPrompt = false,
  sessionId,
  resume = false,
  ephemeral = true
} = {}) {
  const writable = sandbox !== "read-only";
  const builtinTools = ["Read", "Glob", "Grep"];
  if (writable) builtinTools.push("Write", "Edit");
  if (writable && shellAccess) builtinTools.push("Bash");
  if (webSearchMode && webSearchMode !== "disabled") builtinTools.push("WebSearch");
  const mcpTools = mcpToolNames.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`);
  const extraRoots = [...new Set([
    ...(Array.isArray(sandboxPolicy?.writableRoots) ? sandboxPolicy.writableRoots : []),
    ...(Array.isArray(runtimeWorkspaceRoots) ? runtimeWorkspaceRoots : [])
  ].map((path) => String(path || "").trim()).filter((path) => path.startsWith("/") && path !== cwd))];

  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--restricted",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--tools", builtinTools.join(","),
    "--allowedTools", [...builtinTools, ...mcpTools].join(",")
  ];
  if (model) args.push("--model", String(model));
  const effort = normalizeClaudeEffort(reasoningEffort);
  if (effort) args.push("--effort", effort);
  for (const root of extraRoots) args.push("--add-dir", root);
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
  if (outputSchema) args.push("--json-schema", JSON.stringify(outputSchema));
  if (systemPromptPath) {
    args.push(replaceSystemPrompt ? "--system-prompt-file" : "--append-system-prompt-file", systemPromptPath);
  }
  if (resume) args.push("--resume", sessionId);
  else args.push("--session-id", sessionId);
  if (ephemeral && !resume) args.push("--no-session-persistence");
  return args;
}

export function runClaudeCodeTurn(options = {}) {
  const resumeSessionId = claudeSessionIdFromThreadId(options.threadId);
  const attempt = runClaudeCodeTurnOnce({ ...options, resumeSessionId });
  if (!resumeSessionId) return attempt;
  // A mapping can outlive its Claude session (pruned history, another
  // machine); like a stale Codex thread, start fresh with the full prompt.
  return attempt.catch((error) => {
    if (error?.code !== "CLAUDE_SESSION_NOT_FOUND") throw error;
    return runClaudeCodeTurnOnce({ ...options, resumeSessionId: null });
  });
}

function runClaudeCodeTurnOnce({
  claudePath = "claude",
  cwd,
  env,
  model = null,
  reasoningEffort = null,
  prompt,
  resumePrompt = null,
  imagePaths = [],
  developerInstructions = null,
  baseInstructions = null,
  dynamicTools = [],
  outputSchema = null,
  webSearchMode = null,
  sandbox = "read-only",
  sandboxPolicy = null,
  runtimeWorkspaceRoots = [],
  shellAccess = false,
  resumeSessionId = null,
  ephemeral = true,
  timeoutMs,
  maxProtocolBytes = DEFAULT_MAX_PROTOCOL_BYTES,
  maxStderrBytes,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  killGraceMs,
  replacementIdleTimeoutMs,
  signal,
  spawnProcess = spawn,
  startToolBridge = startClaudeToolBridge,
  onSpawn,
  onReady,
  onRestarted,
  onDynamicToolCall,
  onNotification,
  onItem,
  onProgress,
  onExit
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errors.abort(signal.reason));
      return;
    }

    const resumed = Boolean(resumeSessionId);
    const sessionId = resumeSessionId || randomUUID();
    const threadId = toClaudeThreadId(sessionId);
    const pendingInputIds = new Set();
    const pendingControls = new Map();
    const completedItems = [];
    let workDir = null;
    let bridge = null;
    let child = null;
    let supervisor = null;
    let settled = false;
    let sawProtocolOutput = false;
    let turnSequence = 1;
    let turnId = `claude-turn-${turnSequence}`;
    let turnActive = false;
    let restartInProgress = false;
    let commentaryBuffer = { messageId: null, texts: [] };

    const interruptActiveTurn = () => {
      if (!turnActive) return;
      void controlRequest({ subtype: "interrupt" }).catch(() => undefined);
    };

    const deadlines = createTurnDeadlines({
      errors,
      timeoutMs,
      replacementIdleTimeoutMs,
      isSettled: () => settled,
      isTurnActive: () => turnActive,
      onExpire: (error) => {
        interruptActiveTurn();
        finish(error);
      }
    });

    const cleanup = () => {
      try {
        bridge?.close();
      } catch {
        // The bridge only owns a private socket inside workDir.
      }
      if (workDir) rmSync(workDir, { recursive: true, force: true });
    };

    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      turnActive = false;
      deadlines.clear();
      signal?.removeEventListener("abort", abortTurn);
      for (const pending of pendingControls.values()) pending.reject(error || errors.inactive());
      pendingControls.clear();
      const stderr = supervisor?.stderr() || "";
      const deadlineRenewalCount = deadlines.renewalCount;
      if (error) attachErrorFields(error, { deadlineRenewalCount, stderr });
      supervisor?.terminate();
      cleanup();
      if (error) reject(error);
      else resolve({ ...result, stderr, deadlineRenewalCount });
    };

    const send = (message) => {
      if (settled || !child?.stdin?.writable || child.stdin.destroyed) {
        throw errors.protocol("Claude Code stdin is not writable");
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const sendUserInput = (content) => {
      const uuid = randomUUID();
      pendingInputIds.add(uuid);
      send({
        type: "user",
        uuid,
        session_id: "",
        parent_tool_use_id: null,
        message: { role: "user", content }
      });
      return uuid;
    };

    const controlRequest = (request) => {
      const requestId = `ctl-${randomUUID()}`;
      return new Promise((controlResolve, controlReject) => {
        const timer = setTimeout(() => {
          pendingControls.delete(requestId);
          controlReject(errors.protocol(`Claude Code ${request.subtype} request timed out`));
        }, CONTROL_REQUEST_TIMEOUT_MS);
        timer.unref?.();
        pendingControls.set(requestId, {
          resolve: (value) => {
            clearTimeout(timer);
            controlResolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            controlReject(error);
          }
        });
        try {
          send({ type: "control_request", request_id: requestId, request });
        } catch (error) {
          pendingControls.get(requestId)?.reject(error);
          pendingControls.delete(requestId);
        }
      });
    };

    const flushCommentary = () => {
      const text = commentaryBuffer.texts.join("\n").trim();
      commentaryBuffer = { messageId: null, texts: [] };
      if (!text) return;
      const item = { type: "agentMessage", phase: "commentary", text };
      completedItems.push(item);
      notifyObserver(onProgress, { type: "commentary", text, item });
    };

    const handleAssistant = (message) => {
      const messageId = message.message?.id || null;
      if (commentaryBuffer.messageId && commentaryBuffer.messageId !== messageId) {
        commentaryBuffer = { messageId: null, texts: [] };
      }
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block?.type === "text" && block.text) {
          commentaryBuffer.messageId = messageId;
          commentaryBuffer.texts.push(String(block.text));
        } else if (block?.type === "tool_use") {
          if (block.name === STRUCTURED_OUTPUT_TOOL) {
            commentaryBuffer = { messageId: null, texts: [] };
            continue;
          }
          flushCommentary();
          const item = { type: "claudeToolCall", tool: block.name, arguments: block.input ?? null };
          completedItems.push(item);
          notifyObserver(onItem, { method: "item/completed", threadId, turnId, item });
        }
      }
    };

    const handleResult = (message) => {
      // Input steered in after this turn began, or a replacement turn that is
      // still being submitted, means another result will follow.
      if (restartInProgress || pendingInputIds.size > 0) return;
      turnActive = false;
      if (message.subtype !== "success" || message.is_error) {
        const detail = Array.isArray(message.errors) && message.errors.length
          ? message.errors.join("; ")
          : String(message.result || message.subtype || "unknown");
        const error = new Error(`Claude Code turn ended with ${message.subtype || "error"}: ${detail}`);
        error.code = message.subtype === "error_during_execution" ? "CODEX_TURN_INTERRUPTED" : "CODEX_TURN_FAILED";
        error.turnStatus = message.subtype || null;
        finish(error);
        return;
      }
      const finalResponse = message.structured_output !== undefined && message.structured_output !== null
        ? JSON.stringify(message.structured_output)
        : String(message.result || "");
      completedItems.push({ type: "agentMessage", phase: "final_answer", text: finalResponse });
      finish(null, {
        finalResponse,
        threadId,
        turnId,
        status: "completed",
        resumed,
        items: completedItems,
        usage: message.usage || null,
        totalCostUsd: Number.isFinite(message.total_cost_usd) ? message.total_cost_usd : null
      });
    };

    const handleControlRequest = (message) => {
      // Permission prompts are disabled; refuse anything else the CLI asks.
      try {
        send({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: message.request_id,
            error: `Codex QQ Bot does not handle ${message.request?.subtype || "unknown"} requests`
          }
        });
      } catch {
        // The turn is already finishing.
      }
    };

    const handleProtocolMessage = (message) => {
      notifyObserver(onNotification, message);
      if (message?.type === "user" && message.isReplay && message.uuid) {
        pendingInputIds.delete(message.uuid);
        return;
      }
      if (message?.type === "assistant") {
        handleAssistant(message);
        return;
      }
      if (message?.type === "result") {
        handleResult(message);
        return;
      }
      if (message?.type === "control_response") {
        const response = message.response || {};
        const pending = pendingControls.get(response.request_id);
        if (!pending) return;
        pendingControls.delete(response.request_id);
        if (response.subtype === "error") pending.reject(errors.protocol(response.error || "Claude Code control request failed"));
        else pending.resolve(response.response ?? null);
        return;
      }
      if (message?.type === "control_request") handleControlRequest(message);
    };

    const readProtocol = createNdjsonReader({
      errors,
      maxBytes: normalizePositiveInteger(maxProtocolBytes, DEFAULT_MAX_PROTOCOL_BYTES),
      isClosed: () => settled,
      onMessage: handleProtocolMessage,
      onError: (error) => finish(error)
    });

    const steer = async (input) => {
      if (!turnActive) throw errors.inactive();
      sendUserInput(buildUserContent(input, { maxImageBytes }));
      deadlines.arm({ renewal: true });
      return { threadId, turnId, deadlineRenewalCount: deadlines.renewalCount };
    };

    const restart = async (input) => {
      if (!turnActive) throw errors.inactive();
      if (restartInProgress) throw errors.restarting();
      const interruptedTurnId = turnId;
      restartInProgress = true;
      deadlines.arm({ renewal: true });
      try {
        await controlRequest({ subtype: "interrupt" });
        if (settled) throw errors.inactive();
        commentaryBuffer = { messageId: null, texts: [] };
        // The replacement input already carries every fused follow-up, so
        // steered messages the interrupt may have dropped are not awaited.
        pendingInputIds.clear();
        turnSequence += 1;
        turnId = `claude-turn-${turnSequence}`;
        const content = buildUserContent(input, { maxImageBytes });
        sendUserInput(content);
        const deadlineRenewalCount = deadlines.renewalCount;
        const restarted = { threadId, turnId, interruptedTurnId, deadlineRenewalCount, input };
        deadlines.armReplacementIdle();
        notifyObserver(onRestarted, restarted);
        return { threadId, turnId, interruptedTurnId, deadlineRenewalCount };
      } catch (error) {
        if (!settled) finish(error);
        throw error;
      } finally {
        restartInProgress = false;
      }
    };

    const interrupt = async () => {
      if (!turnActive) return false;
      await controlRequest({ subtype: "interrupt" });
      return true;
    };

    function abortTurn() {
      interruptActiveTurn();
      finish(errors.abort(signal?.reason));
    }

    const launch = async () => {
      workDir = mkdtempSync(join(tmpdir(), "cqb-claude-"));
      const tools = flattenQqDynamicTools(dynamicTools);
      if (tools.length) {
        bridge = await startToolBridge({ workDir, tools, onCall: onDynamicToolCall, getTurn: () => ({ threadId, turnId }) });
      }
      if (settled) return;
      const systemPrompt = [
        baseInstructions ? String(baseInstructions) : null,
        developerInstructions ? String(developerInstructions) : null,
        CLAUDE_ADAPTER_INSTRUCTIONS
      ].filter(Boolean).join("\n\n");
      const systemPromptPath = join(workDir, "system-prompt.md");
      writeFileSync(systemPromptPath, systemPrompt, { mode: 0o600 });

      const args = buildClaudeCodeArgs({
        model,
        reasoningEffort,
        cwd,
        sandbox,
        sandboxPolicy,
        runtimeWorkspaceRoots,
        webSearchMode,
        shellAccess,
        mcpToolNames: tools.map((tool) => tool.name),
        mcpConfigPath: bridge?.mcpConfigPath || null,
        outputSchema,
        systemPromptPath,
        replaceSystemPrompt: Boolean(baseInstructions),
        sessionId,
        resume: resumed,
        ephemeral
      });
      child = spawnProcess(claudePath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      supervisor = superviseAgentChild(child, {
        maxStderrBytes,
        killGraceMs,
        isSettled: () => settled,
        onStdout: (chunk) => {
          sawProtocolOutput = true;
          deadlines.noteActivity();
          readProtocol(chunk);
        },
        onExit,
        onFailure: (error) => finish(error),
        onClose: (exit) => {
          const error = errors.exited(exit);
          if (resumed && !sawProtocolOutput && /no conversation found|session.*not found/i.test(exit.detail)) {
            error.code = "CLAUDE_SESSION_NOT_FOUND";
          }
          finish(error);
        }
      });
      notifyObserver(onSpawn, child);

      const turnText = resumed && resumePrompt != null ? String(resumePrompt) : String(prompt || "");
      sendUserInput(buildUserContent([
        { type: "text", text: turnText },
        ...normalizeImagePaths(imagePaths)
      ], { maxImageBytes }));
      turnActive = true;
      notifyObserver(onReady, { child, threadId, turnId, steer, restart, interrupt, resumed });
    };

    deadlines.arm();
    signal?.addEventListener("abort", abortTurn, { once: true });
    launch().catch((error) => finish(error));
  });
}

// Serves one turn's dynamic tools to the MCP bridge over a private Unix
// socket and routes each call through the Hub's onDynamicToolCall handler.
export async function startClaudeToolBridge({ workDir, tools, onCall, getTurn = () => ({}) }) {
  const socketPath = join(workDir, "qq.sock");
  const toolsPath = join(workDir, "qq-tools.json");
  const mcpConfigPath = join(workDir, "mcp.json");
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  writeFileSync(toolsPath, JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema
  }))), { mode: 0o600 });
  writeFileSync(mcpConfigPath, JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: process.execPath,
        args: [bridgeScriptPath],
        env: {
          CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET: socketPath,
          CODEX_REMOTE_CONTACT_QQ_MCP_TOOLS: toolsPath
        }
      }
    }
  }), { mode: 0o600 });

  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) void answerToolCall(socket, line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });

  const answerToolCall = async (socket, line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    const reply = { id: request.id };
    try {
      const tool = byName.get(String(request.name || ""));
      if (!tool) throw new Error(`Unknown QQ tool: ${request.name}`);
      if (typeof onCall !== "function") throw new Error(`No handler registered for dynamic tool ${tool.name}`);
      const result = await onCall({
        namespace: tool.namespace,
        tool: tool.tool,
        arguments: request.arguments && typeof request.arguments === "object" ? request.arguments : {},
        callId: `claude-call-${randomUUID()}`,
        ...getTurn()
      });
      reply.result = toMcpToolResult(result);
    } catch (error) {
      reply.error = String(error?.message || error || "QQ tool call failed");
    }
    if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`);
  };

  await new Promise((listenResolve, listenReject) => {
    server.once("error", listenReject);
    server.listen(socketPath, () => {
      server.off("error", listenReject);
      listenResolve();
    });
  });
  return {
    mcpConfigPath,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  };
}

// Converts the shared Codex-shaped tool result into MCP tool content.
export function toMcpToolResult(result) {
  const { contentItems, success } = normalizeDynamicToolResult(result);
  const content = contentItems.map((item) => {
    const dataUrl = String(item?.imageUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (item?.type === "inputImage" && dataUrl) return { type: "image", mimeType: dataUrl[1], data: dataUrl[2] };
    return { type: "text", text: String(item?.text ?? JSON.stringify(item)) };
  });
  return { content, isError: !success };
}

export function buildUserContent(input, { maxImageBytes = DEFAULT_MAX_IMAGE_BYTES, readFile = readFileSync } = {}) {
  const entries = Array.isArray(input) ? input : [{ type: "text", text: String(input || "") }];
  const content = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "localImage" && entry.path) {
      content.push(localImageBlock(String(entry.path), { maxImageBytes, readFile }));
      continue;
    }
    const text = String(entry.text || "");
    if (text) content.push({ type: "text", text });
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

function localImageBlock(path, { maxImageBytes, readFile }) {
  let data;
  try {
    data = readFile(path);
  } catch {
    return { type: "text", text: `[图片无法读取：${path}]` };
  }
  const mediaType = sniffImageMediaType(data);
  if (!mediaType) return { type: "text", text: `[不支持的图片格式：${path}]` };
  if (data.length > maxImageBytes) return { type: "text", text: `[图片过大未附带：${path}]` };
  return { type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } };
}

export function sniffImageMediaType(data) {
  if (!data || data.length < 12) return null;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
