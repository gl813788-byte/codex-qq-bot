import { spawn } from "node:child_process";
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
} from "./infrastructure/agent/agent-turn-process.js";

const DEFAULT_MAX_PROTOCOL_BYTES = 8 * 1024 * 1024;
const errors = createAgentTurnErrors("Codex app-server");

export function runCodexAppServerTurn({
  codexPath = "codex",
  cwd,
  env,
  model,
  reasoningEffort,
  reasoningSummary = null,
  personality = null,
  serviceTier = null,
  prompt,
  resumePrompt = null,
  imagePaths = [],
  developerInstructions = null,
  baseInstructions = null,
  dynamicTools = [],
  outputSchema = null,
  config = null,
  webSearchMode = null,
  sandbox = "read-only",
  sandboxPolicy = null,
  permissions = null,
  runtimeWorkspaceRoots = [],
  approvalPolicy = "never",
  experimentalApi = null,
  threadId: requestedThreadId = null,
  ephemeral = true,
  timeoutMs,
  maxProtocolBytes = DEFAULT_MAX_PROTOCOL_BYTES,
  maxStderrBytes,
  killGraceMs,
  replacementIdleTimeoutMs,
  signal,
  spawnProcess = spawn,
  onSpawn,
  onReady,
  onRestarted,
  onDynamicToolCall,
  onServerRequest,
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

    let child;
    try {
      child = spawnProcess(codexPath, ["app-server", "--stdio"], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let supervisor = null;
    let requestId = 0;
    let threadId = null;
    let resumed = false;
    let turnId = null;
    let turnActive = false;
    let restartInProgress = false;
    let pendingRestart = null;
    const pendingRequests = new Map();
    const dynamicToolCalls = new Map();
    const agentMessages = [];
    const completedItems = [];
    const supersededTurnIds = new Set();

    const interruptActiveTurn = () => {
      if (turnActive && threadId && turnId) {
        void request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      }
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

    const rejectPendingRequests = (error) => {
      for (const pending of pendingRequests.values()) pending.reject(error);
      pendingRequests.clear();
    };

    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      turnActive = false;
      if (pendingRestart) {
        pendingRestart.reject(error || errors.inactive());
        pendingRestart = null;
      }
      deadlines.clear();
      signal?.removeEventListener("abort", abortTurn);
      const stderr = supervisor?.stderr() || "";
      const deadlineRenewalCount = deadlines.renewalCount;
      if (error) attachErrorFields(error, { deadlineRenewalCount, stderr });
      rejectPendingRequests(error || errors.inactive());
      supervisor?.terminate();
      if (error) reject(error);
      else resolve({ ...result, stderr, deadlineRenewalCount });
    };

    const send = (message) => {
      if (settled || !child.stdin?.writable || child.stdin.destroyed) {
        throw errors.protocol("Codex app-server stdin is not writable");
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const request = (method, params) => {
      if (settled) return Promise.reject(errors.inactive());
      const id = ++requestId;
      return new Promise((requestResolve, requestReject) => {
        pendingRequests.set(id, { method, resolve: requestResolve, reject: requestReject });
        try {
          send({ method, id, params });
        } catch (error) {
          pendingRequests.delete(id);
          requestReject(error);
        }
      });
    };

    const respond = (id, result) => send({ id, result });

    const respondError = (id, error) => send({
      id,
      error: {
        code: Number.isInteger(error?.protocolCode) ? error.protocolCode : -32000,
        message: String(error?.message || error || "Codex QQ Bot tool request failed")
      }
    });

    const recordAgentMessage = (item) => {
      if (item?.type !== "agentMessage" || typeof item.text !== "string") return;
      agentMessages.push({
        text: item.text,
        phase: item.phase || null
      });
    };

    const selectFinalResponse = (turn) => {
      const turnMessages = Array.isArray(turn?.items)
        ? turn.items.filter((item) => item?.type === "agentMessage" && typeof item.text === "string")
        : [];
      const candidates = turnMessages.length > 0 ? turnMessages : agentMessages;
      const final = [...candidates].reverse().find((item) => item.phase === "final_answer")
        || [...candidates].reverse().find((item) => item.phase !== "commentary");
      return String(final?.text || "");
    };

    const handleNotification = (message) => {
      notifyObserver(onNotification, message);
      if (message.method === "item/started" || message.method === "item/completed") {
        const item = message.params?.item;
        if (message.method === "item/completed" && item) completedItems.push(item);
        notifyObserver(onItem, {
          method: message.method,
          threadId: message.params?.threadId || threadId,
          turnId: message.params?.turnId || turnId,
          item
        });
        if (item?.type === "agentMessage" && item.phase === "commentary") {
          notifyObserver(onProgress, { type: "commentary", text: String(item.text || ""), item });
        }
      }
      if (message.method === "turn/plan/updated") {
        notifyObserver(onProgress, {
          type: "plan",
          explanation: message.params?.explanation || "",
          plan: Array.isArray(message.params?.plan) ? message.params.plan : []
        });
      }
      if (message.method === "item/completed") {
        recordAgentMessage(message.params?.item);
        return;
      }
      if (message.method !== "turn/completed") return;
      const completedTurn = message.params?.turn;
      if (threadId && message.params?.threadId && message.params.threadId !== threadId) return;
      const completedTurnId = completedTurn?.id || null;
      if (completedTurnId && supersededTurnIds.delete(completedTurnId)) return;
      if (pendingRestart?.turnId && completedTurnId === pendingRestart.turnId) {
        turnActive = false;
        const waiter = pendingRestart;
        pendingRestart = null;
        waiter.resolve(completedTurn);
        return;
      }
      if (turnId && completedTurnId && completedTurnId !== turnId) return;
      turnActive = false;
      const status = completedTurn?.status;
      if (status !== "completed") {
        const error = new Error(
          completedTurn?.error?.message
          || `Codex app-server turn ended with status ${status || "unknown"}`
        );
        error.code = status === "interrupted" ? "CODEX_TURN_INTERRUPTED" : "CODEX_TURN_FAILED";
        error.turnStatus = status || null;
        finish(error);
        return;
      }
      finish(null, {
        finalResponse: selectFinalResponse(completedTurn),
        threadId: message.params?.threadId || threadId,
        turnId: completedTurn?.id || turnId,
        status,
        resumed,
        items: completedItems
      });
    };

    const handleServerRequest = async (message) => {
      try {
        if (message.method === "item/tool/call") {
          if (typeof onDynamicToolCall !== "function") {
            throw errors.protocol(`No handler registered for dynamic tool ${message.params?.tool || "unknown"}`);
          }
          const callId = String(message.params?.callId || message.id);
          let call = dynamicToolCalls.get(callId);
          if (!call) {
            call = Promise.resolve(onDynamicToolCall({
              ...message.params,
              threadId: message.params?.threadId || threadId,
              turnId: message.params?.turnId || turnId
            })).then(normalizeDynamicToolResult);
            dynamicToolCalls.set(callId, call);
          }
          respond(message.id, await call);
          return;
        }
        if (typeof onServerRequest === "function") {
          const handled = await onServerRequest(message);
          if (handled !== undefined) {
            respond(message.id, handled);
            return;
          }
        }
        respond(message.id, defaultServerRequestResponse(message.method));
      } catch (error) {
        respondError(message.id, error);
      }
    };

    const handleProtocolMessage = (message) => {
      if (message?.method && Object.hasOwn(message, "id")) {
        void handleServerRequest(message);
        return;
      }
      if (message && Object.hasOwn(message, "id")) {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        if (message.error) {
          const error = errors.protocol(
            message.error.message || `${pending.method} failed`,
            message.error.code
          );
          pending.reject(error);
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      if (message?.method) handleNotification(message);
    };

    const readProtocol = createNdjsonReader({
      errors,
      maxBytes: normalizePositiveInteger(maxProtocolBytes, DEFAULT_MAX_PROTOCOL_BYTES),
      isClosed: () => settled,
      onMessage: handleProtocolMessage,
      onError: (error) => finish(error)
    });

    const steer = async (input) => {
      if (!turnActive || !threadId || !turnId) throw errors.inactive();
      const result = await request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: normalizeUserInput(input)
      });
      deadlines.arm({ renewal: true });
      return {
        threadId,
        turnId: result?.turnId || turnId,
        deadlineRenewalCount: deadlines.renewalCount
      };
    };

    const restart = async (input) => {
      if (!turnActive || !threadId || !turnId) throw errors.inactive();
      if (restartInProgress || pendingRestart) throw errors.restarting();
      const interruptedTurnId = turnId;
      restartInProgress = true;
      deadlines.arm({ renewal: true });
      const completion = new Promise((restartResolve, restartReject) => {
        pendingRestart = {
          turnId: interruptedTurnId,
          resolve: restartResolve,
          reject: restartReject
        };
      });
      let interruptionCompleted = false;
      try {
        try {
          await request("turn/interrupt", { threadId, turnId: interruptedTurnId });
          await completion;
        } catch (error) {
          if (!isNoActiveTurnProtocolError(error)) throw error;
          supersededTurnIds.add(interruptedTurnId);
          if (pendingRestart?.turnId === interruptedTurnId) pendingRestart = null;
          turnActive = false;
        }
        interruptionCompleted = true;
        if (settled || !threadId) throw errors.inactive();
        agentMessages.length = 0;
        const nextTurn = await request("turn/start", buildTurnStartParams({
          threadId,
          input: normalizeUserInput(input),
          cwd,
          model,
          reasoningEffort,
          reasoningSummary,
          personality,
          serviceTier,
          outputSchema,
          sandboxPolicy,
          permissions,
          runtimeWorkspaceRoots,
          approvalPolicy
        }));
        turnId = nextTurn?.turn?.id || null;
        if (!turnId) throw errors.protocol("Codex app-server did not return a replacement turn id");
        turnActive = true;
        const restarted = {
          threadId,
          turnId,
          interruptedTurnId,
          deadlineRenewalCount: deadlines.renewalCount,
          input: normalizeUserInput(input)
        };
        deadlines.armReplacementIdle();
        notifyObserver(onRestarted, restarted);
        return {
          threadId: restarted.threadId,
          turnId: restarted.turnId,
          interruptedTurnId: restarted.interruptedTurnId,
          deadlineRenewalCount: restarted.deadlineRenewalCount
        };
      } catch (error) {
        if (pendingRestart?.turnId === interruptedTurnId) {
          pendingRestart = null;
        }
        if (interruptionCompleted && !settled && !turnActive) {
          finish(error);
        }
        throw error;
      } finally {
        restartInProgress = false;
      }
    };

    const interrupt = async () => {
      if (!turnActive || !threadId || !turnId) return false;
      await request("turn/interrupt", { threadId, turnId });
      return true;
    };

    const abortTurn = () => {
      interruptActiveTurn();
      finish(errors.abort(signal?.reason));
    };

    deadlines.arm();
    supervisor = superviseAgentChild(child, {
      maxStderrBytes,
      killGraceMs,
      isSettled: () => settled,
      onStdout: (chunk) => {
        deadlines.noteActivity();
        readProtocol(chunk);
      },
      onExit,
      onFailure: (error) => finish(error),
      onClose: (exit) => finish(errors.exited(exit))
    });

    signal?.addEventListener("abort", abortTurn, { once: true });
    notifyObserver(onSpawn, child);

    void (async () => {
      try {
        await request("initialize", {
          clientInfo: {
            name: "codex_qq_bot",
            title: "Codex QQ Bot",
            version: "2"
          },
          capabilities: {
            experimentalApi: experimentalApi == null
              ? Boolean(dynamicTools.length || permissions || runtimeWorkspaceRoots.length)
              : Boolean(experimentalApi),
            requestAttestation: false
          }
        });
        send({ method: "initialized", params: {} });
        let thread;
        const existingThreadId = String(requestedThreadId || "").trim();
        if (existingThreadId) {
          try {
            thread = await request("thread/resume", buildThreadParams({
              threadId: existingThreadId,
              cwd,
              model,
              reasoningEffort,
              developerInstructions,
              baseInstructions,
              config,
              webSearchMode,
              sandbox,
              permissions,
              runtimeWorkspaceRoots,
              approvalPolicy,
              personality,
              serviceTier
            }));
            resumed = true;
          } catch (error) {
            if (!isStaleThreadProtocolError(error)) throw error;
            thread = null;
          }
        }
        if (!thread) {
          thread = await request("thread/start", buildThreadParams({
            cwd,
            model,
            reasoningEffort,
            developerInstructions,
            baseInstructions,
            dynamicTools,
            config,
            webSearchMode,
            sandbox,
            permissions,
            runtimeWorkspaceRoots,
            approvalPolicy,
            personality,
            serviceTier,
            ephemeral: Boolean(ephemeral),
          }));
          resumed = false;
        }
        threadId = thread?.thread?.id || null;
        if (!threadId) throw errors.protocol("Codex app-server did not return a thread id");
        const turnInputText = resumed && resumePrompt != null ? String(resumePrompt) : String(prompt || "");
        const turn = await request("turn/start", buildTurnStartParams({
          threadId,
          input: normalizeUserInput([
            { type: "text", text: turnInputText },
            ...normalizeImagePaths(imagePaths)
          ]),
          cwd,
          model,
          reasoningEffort,
          reasoningSummary,
          personality,
          serviceTier,
          outputSchema,
          sandboxPolicy,
          permissions,
          runtimeWorkspaceRoots,
          approvalPolicy
        }));
        turnId = turn?.turn?.id || null;
        if (!turnId) throw errors.protocol("Codex app-server did not return a turn id");
        turnActive = true;
        notifyObserver(onReady, { child, threadId, turnId, steer, restart, interrupt, resumed });
      } catch (error) {
        finish(error);
      }
    })();
  });
}

function buildThreadParams({
  threadId,
  cwd,
  model,
  reasoningEffort,
  developerInstructions,
  baseInstructions,
  dynamicTools,
  config,
  webSearchMode,
  sandbox,
  permissions,
  runtimeWorkspaceRoots,
  approvalPolicy,
  personality,
  serviceTier,
  ephemeral
}) {
  const mergedConfig = {
    ...(config && typeof config === "object" ? config : {}),
    ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}),
    ...(webSearchMode ? { web_search: webSearchMode } : {})
  };
  return compactObject({
    threadId,
    cwd,
    model: model || null,
    serviceTier: serviceTier || null,
    approvalPolicy: approvalPolicy || "never",
    ...(permissions ? { permissions } : { sandbox: sandbox || "read-only" }),
    runtimeWorkspaceRoots: normalizeAbsolutePathList(runtimeWorkspaceRoots),
    config: Object.keys(mergedConfig).length ? mergedConfig : null,
    baseInstructions: baseInstructions || null,
    developerInstructions: developerInstructions || null,
    personality: personality || null,
    dynamicTools: Array.isArray(dynamicTools) && dynamicTools.length ? dynamicTools : undefined,
    ephemeral
  });
}

function buildTurnStartParams({
  threadId,
  input,
  cwd,
  model,
  reasoningEffort,
  reasoningSummary,
  personality,
  serviceTier,
  outputSchema,
  sandboxPolicy,
  permissions,
  runtimeWorkspaceRoots,
  approvalPolicy
}) {
  return compactObject({
    threadId,
    input,
    cwd,
    runtimeWorkspaceRoots: normalizeAbsolutePathList(runtimeWorkspaceRoots),
    approvalPolicy: approvalPolicy || "never",
    ...(permissions ? { permissions } : {}),
    ...(!permissions && sandboxPolicy ? { sandboxPolicy } : {}),
    model: model || null,
    serviceTier: serviceTier || null,
    effort: reasoningEffort || null,
    summary: reasoningSummary || null,
    personality: personality || null,
    outputSchema: outputSchema || null
  });
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeAbsolutePathList(paths) {
  const normalized = [...new Set((Array.isArray(paths) ? paths : [])
    .map((path) => String(path || "").trim())
    .filter((path) => path.startsWith("/")))];
  return normalized.length ? normalized : undefined;
}

function defaultServerRequestResponse(method) {
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    return { decision: "decline" };
  }
  if (method === "item/permissions/requestApproval") {
    return { permissions: { network: null, fileSystem: null }, scope: "turn" };
  }
  if (method === "item/tool/requestUserInput") return { answers: {} };
  if (method === "mcpServer/elicitation/request") return { action: "decline", content: null };
  throw errors.protocol(`Unsupported Codex app-server request: ${method || "unknown"}`);
}

function normalizeUserInput(value) {
  const entries = Array.isArray(value)
    ? value
    : [{ type: "text", text: String(value || "") }];
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      if (entry.type === "localImage" && entry.path) {
        return { type: "localImage", path: String(entry.path), detail: entry.detail || null };
      }
      return { type: "text", text: String(entry.text || "") };
    })
    .filter((entry) => entry.type !== "text" || entry.text.length > 0);
}

function isNoActiveTurnProtocolError(error) {
  return error?.code === "CODEX_APP_SERVER_PROTOCOL"
    && /no active turn|turn (?:is )?not active|already completed/i.test(String(error?.message || ""));
}

function isStaleThreadProtocolError(error) {
  return error?.code === "CODEX_APP_SERVER_PROTOCOL"
    && /thread.*(?:not found|does not exist|unknown|missing|archived)|missing thread|rollout.*(?:not found|missing)|no rollout/i
      .test(String(error?.message || ""));
}
