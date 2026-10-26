import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDynamicToolResult } from "./agent-turn-process.js";

// Engine-neutral MCP transport for the Hub's QQ tools. Both engines receive
// the same per-turn stdio MCP server (qq-mcp-bridge.mjs); every call comes
// back over a private Unix socket and runs through the Hub's
// onDynamicToolCall dispatcher with the original sender's permissions. Codex
// and Claude Code both defer MCP tool schemas behind their tool search, so a
// turn only pays for the definitions the model actually selects.

export const QQ_MCP_SERVER_NAME = "qq";
export const qqMcpBridgeScriptPath = fileURLToPath(new URL("./qq-mcp-bridge.mjs", import.meta.url));

// Per-call MCP deadline inside the engine. The Hub keeps the real turn
// deadline; this only has to exceed the slowest tool (host commands allow
// 120 s, image downloads and compression stay below that).
const DEFAULT_TOOL_TIMEOUT_SEC = 300;
const DEFAULT_STARTUP_TIMEOUT_SEC = 30;

export function flattenQqDynamicTools(dynamicTools = []) {
  const tools = [];
  for (const entry of Array.isArray(dynamicTools) ? dynamicTools : []) {
    if (entry?.type === "namespace" && Array.isArray(entry.tools)) {
      for (const tool of entry.tools) {
        if (!tool?.name) continue;
        tools.push(withAnnotations({
          name: `${entry.name}__${tool.name}`,
          namespace: String(entry.name),
          tool: String(tool.name),
          description: [entry.description, tool.description].filter(Boolean).join(" "),
          inputSchema: tool.inputSchema || { type: "object", properties: {} }
        }, tool.annotations));
      }
    } else if (entry?.name) {
      tools.push(withAnnotations({
        name: String(entry.name),
        namespace: entry.namespace ? String(entry.namespace) : "",
        tool: String(entry.name),
        description: String(entry.description || ""),
        inputSchema: entry.inputSchema || { type: "object", properties: {} }
      }, entry.annotations));
    }
  }
  return tools;
}

// App Server dynamic tools accept only name/description/inputSchema and the
// deferLoading flag; annotations stay an MCP-only hint.
export function toCodexDynamicToolSpecs(dynamicTools = [], { deferLoading = true } = {}) {
  const strip = (tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(deferLoading ? { deferLoading: true } : {})
  });
  return (Array.isArray(dynamicTools) ? dynamicTools : []).map((entry) => {
    if (entry?.type === "namespace" && Array.isArray(entry.tools)) {
      return { type: "namespace", name: entry.name, description: entry.description, tools: entry.tools.map(strip) };
    }
    return strip(entry || {});
  });
}

// Serves one turn's tools to the MCP bridge over a private Unix socket and
// routes each call through the Hub's onDynamicToolCall handler.
export async function startQqMcpToolServer({
  workDir,
  tools,
  onCall,
  getTurn = () => ({}),
  callIdPrefix = "mcp-call"
}) {
  const socketPath = join(workDir, "qq.sock");
  const toolsPath = join(workDir, "qq-tools.json");
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  writeFileSync(toolsPath, JSON.stringify(tools.map(toMcpToolListing)), { mode: 0o600 });

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
      // An engine-supplied call id lets the Hub deduplicate a retried call.
      const engineCallId = String(request.callId || "").replace(/[^\w.:-]+/g, "").slice(0, 120);
      const result = await onCall({
        namespace: tool.namespace,
        tool: tool.tool,
        arguments: request.arguments && typeof request.arguments === "object" ? request.arguments : {},
        callId: `${callIdPrefix}-${engineCallId || randomUUID()}`,
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
    socketPath,
    toolsPath,
    toolNames: tools.map((tool) => tool.name),
    launch: {
      command: process.execPath,
      args: [qqMcpBridgeScriptPath],
      env: {
        CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET: socketPath,
        CODEX_REMOTE_CONTACT_QQ_MCP_TOOLS: toolsPath
      }
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  };
}

// Codex mcp_servers entry for one turn. Hub permissions stay authoritative,
// so the engine's own MCP approval prompt is pre-approved: with approval
// policy "never" an unapproved write tool would otherwise always fail.
export function buildCodexQqMcpServerConfig(launch, {
  toolTimeoutSec = DEFAULT_TOOL_TIMEOUT_SEC,
  startupTimeoutSec = DEFAULT_STARTUP_TIMEOUT_SEC
} = {}) {
  return {
    command: launch.command,
    args: [...launch.args],
    env: { ...launch.env },
    default_tools_approval_mode: "approve",
    startup_timeout_sec: startupTimeoutSec,
    tool_timeout_sec: toolTimeoutSec
  };
}

export function buildClaudeQqMcpConfig(launch) {
  return {
    mcpServers: {
      [QQ_MCP_SERVER_NAME]: {
        type: "stdio",
        command: launch.command,
        args: [...launch.args],
        env: { ...launch.env }
      }
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

function toMcpToolListing({ name, description, inputSchema, annotations }) {
  return { name, description, inputSchema, ...(annotations ? { annotations } : {}) };
}

function withAnnotations(tool, annotations) {
  if (!annotations || typeof annotations !== "object") return tool;
  const normalized = {};
  for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
    if (typeof annotations[key] === "boolean") normalized[key] = annotations[key];
  }
  if (typeof annotations.title === "string" && annotations.title.trim()) normalized.title = annotations.title.trim();
  return Object.keys(normalized).length ? { ...tool, annotations: normalized } : tool;
}
