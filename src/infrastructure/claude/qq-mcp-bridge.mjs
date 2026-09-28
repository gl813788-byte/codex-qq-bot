#!/usr/bin/env node
// Stdio MCP server that Claude Code spawns for one QQ turn. It exposes the
// turn's dynamic QQ tools and forwards every call to the Hub over a private
// Unix socket, so tool execution keeps the Hub's sender-scoped authorization.
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const socketPath = process.env.CODEX_REMOTE_CONTACT_QQ_MCP_SOCKET || "";
const toolsPath = process.env.CODEX_REMOTE_CONTACT_QQ_MCP_TOOLS || "";
const tools = JSON.parse(readFileSync(toolsPath, "utf8"));
const pendingCalls = new Map();
let nextCallId = 0;
let hubBuffer = "";

const hub = createConnection(socketPath);
hub.setEncoding("utf8");
hub.on("data", (chunk) => {
  hubBuffer += chunk;
  let newlineIndex = hubBuffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = hubBuffer.slice(0, newlineIndex).trim();
    hubBuffer = hubBuffer.slice(newlineIndex + 1);
    if (line) settleHubReply(JSON.parse(line));
    newlineIndex = hubBuffer.indexOf("\n");
  }
});
hub.on("error", () => failPendingCalls("QQ Hub tool channel failed"));
hub.on("close", () => failPendingCalls("QQ Hub tool channel closed"));

function settleHubReply(reply) {
  const pending = pendingCalls.get(reply?.id);
  if (!pending) return;
  pendingCalls.delete(reply.id);
  pending(reply);
}

function failPendingCalls(message) {
  for (const pending of pendingCalls.values()) pending({ error: message });
  pendingCalls.clear();
}

function callHub(name, args) {
  const id = ++nextCallId;
  return new Promise((resolve) => {
    pendingCalls.set(id, resolve);
    hub.write(`${JSON.stringify({ id, name, arguments: args })}\n`);
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "codex-qq-bot", version: "1" }
      }
    });
    return;
  }
  if (method === "tools/list") {
    send({ id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    const reply = await callHub(String(params?.name || ""), params?.arguments || {});
    if (reply.error) {
      send({ id, result: { content: [{ type: "text", text: String(reply.error) }], isError: true } });
      return;
    }
    send({ id, result: reply.result });
    return;
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: `Unsupported method: ${method}` } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  void handle(message);
}).on("close", () => {
  hub.destroy();
  process.exit(0);
});
