import { runCodexAppServerTurn } from "../../codex-app-server-turn.js";
import { buildIsolatedCodexChildEnv } from "../../codex-child-env.js";
import { buildIsolatedClaudeChildEnv } from "../claude/claude-child-env.js";
import { isClaudeThreadId, runClaudeCodeTurn } from "../claude/claude-code-turn.js";
import { runQqCodexTurnWithFusionRecovery } from "../../qq-codex-turn-recovery.js";
import { summarizeProcessDiagnostics } from "../../process-diagnostics.js";
import { buildQqOperationLogDetails } from "../../qq-operation-log.js";
import { AGENT_LOG_CATEGORY, countAgentTurnProcesses, getAgentEngine } from "../agent/agent-engines.js";
import { describeAgentHostCapacity } from "../agent/agent-process-gate.js";
import { assertAgentTurnNotNested, runAgentToolCall } from "../agent/agent-tool-context.js";
import { notifyObserver } from "../agent/agent-turn-process.js";
import { describeNativeAgentItem, summarizeAgentTurnTools } from "../agent/agent-tool-activity.js";
import { buildCodexLeanQqConfig } from "./codex-lean-config.js";

// Every difference between the two engines lives in this table (display
// facts and model selection come from agent-engines.js); the runner below
// stays engine-neutral. Both adapters share one options/result contract.
const qqAgentEngines = Object.freeze({
  codex: Object.freeze({
    ...getAgentEngine("codex"),
    runTurn: runCodexAppServerTurn,
    buildEnv: buildIsolatedCodexChildEnv,
    // A Claude session id left in a persistent scope after an engine switch
    // cannot be resumed; Codex starts a fresh thread with full context.
    canResume: (threadId) => !isClaudeThreadId(threadId),
    buildConfig: (config, { leanContext, keepProjectDocs }) => buildCodexLeanQqConfig(config, {
      enabled: leanContext,
      keepProjectDocs
    }),
    resolveToolTransport: (configured) => configured === "dynamic" ? "dynamic" : "mcp"
  }),
  claude: Object.freeze({
    ...getAgentEngine("claude"),
    runTurn: runClaudeCodeTurn,
    buildEnv: buildIsolatedClaudeChildEnv,
    canResume: () => true,
    // Claude Code always serves QQ tools over MCP and has no Codex config.
    buildConfig: (config) => config,
    resolveToolTransport: () => "mcp"
  })
});

export function selectQqAgentEngine(engine) {
  return qqAgentEngines[getAgentEngine(engine).id];
}

// The transport that actually carries QQ tools for an engine; persistent
// session reuse depends on it.
export function resolveQqAgentToolTransport(engine, configured = "mcp") {
  return selectQqAgentEngine(engine).resolveToolTransport(configured);
}

// One tool-free, read-only, ephemeral structured turn on a chosen engine,
// independent of the configured reply engine. Background classifiers (the
// subscription interest model) use it; they are not QQ agent turns, so the
// Codex side uses the lean per-thread config and no QQ tools are offered.
export function runQqAgentBackgroundTask(engine, {
  codexPath = "codex",
  claudePath = "claude",
  cwd,
  model = null,
  reasoningEffort = null,
  prompt,
  imagePaths = [],
  developerInstructions = null,
  baseInstructions = null,
  outputSchema = null,
  timeoutMs,
  signal,
  onSpawn,
  onExit,
  // Optional host capacity gate (agent-process-gate.js); background
  // judgments do not wait for room by default.
  processGate = null,
  capacityWaitMs = 0
} = {}) {
  const agent = selectQqAgentEngine(engine);
  const runTurn = () => agent.runTurn({
    codexPath,
    claudePath,
    cwd,
    env: agent.buildEnv({}),
    model,
    reasoningEffort,
    prompt,
    imagePaths,
    developerInstructions,
    baseInstructions,
    dynamicTools: [],
    outputSchema,
    config: agent.buildConfig(null, { leanContext: true, keepProjectDocs: false }),
    webSearchMode: "disabled",
    sandbox: "read-only",
    ephemeral: true,
    timeoutMs,
    signal,
    onSpawn,
    onExit
  });
  if (!processGate) return runTurn();
  return processGate.acquire({
    processes: countAgentTurnProcesses(agent, { tools: false }),
    waitMs: capacityWaitMs,
    signal
  }).then((slot) => runTurn().finally(() => slot.release()));
}

export function createQqCodexTurnRunner({
  limiter,
  state,
  codexPath,
  engine = "codex",
  claudePath = "claude",
  claudeModel = null,
  claudeReasoningEffort = null,
  toolTransport = "mcp",
  leanContext = false,
  activeChildren,
  stoppedGenerationIds,
  getReplyScope,
  createStoppedError,
  trackGeneration,
  attachSteering,
  clearGeneration,
  logContext,
  logger,
  logModelOutput,
  trackBackgroundTask,
  refreshQuota,
  observeQuotaNotification,
  // Host capacity gate checked before each turn starts its CLI. Turns tied
  // to a QQ event wait up to replyCapacityWaitMs for room, other turns up to
  // backgroundCapacityWaitMs; a turn may pass options.capacityWaitMs.
  processGate = null,
  replyCapacityWaitMs = 90_000,
  backgroundCapacityWaitMs = 30_000
} = {}) {
  assertFunction(limiter?.run, "limiter.run");
  assertFunction(getReplyScope, "getReplyScope");
  assertFunction(createStoppedError, "createStoppedError");
  assertFunction(trackGeneration, "trackGeneration");
  assertFunction(attachSteering, "attachSteering");
  assertFunction(clearGeneration, "clearGeneration");
  const agent = selectQqAgentEngine(engine);

  return function runQqCodexTurn(input, options = {}) {
    try {
      assertAgentTurnNotNested();
    } catch (error) {
      return Promise.reject(error);
    }
    const replyScope = options.qqEvent ? getReplyScope(options.qqEvent) : null;
    return limiter.run(async () => {
      if (replyScope?.cancelled) throw createStoppedError();
      const startedAt = Date.now();
      const previousQuota = state.maintenance.codex.quota;
      let generationId = null;
      const generationIds = new WeakMap();
      const engineSettings = { ai: state.ai, claudeModel, claudeReasoningEffort };
      const model = agent.selectModel(engineSettings);
      const reasoningEffort = agent.selectReasoningEffort(engineSettings);
      let capacitySlot = null;
      // Every tool the engine itself ran in this turn (QQ tools included),
      // for the native-tool log lines and the turn's tool-step summary.
      const toolItems = [];
      const observeItem = (notification) => {
        if (notification?.method === "item/completed" && notification.item) {
          toolItems.push(notification.item);
          logNativeToolItem({ logger, logContext, options, agent, item: notification.item, generationId });
        }
        notifyObserver(options.onItem, notification);
      };
      try {
        capacitySlot = await acquireCapacity(options, replyScope, agent, model);
        if (replyScope?.cancelled) throw createStoppedError();
        const requestedThreadId = (threadId) => agent.canResume(threadId) ? threadId : null;
        const runAttempt = (attempt = {}) => agent.runTurn({
          codexPath,
          claudePath,
          cwd: options.cwd,
          env: agent.buildEnv({ overrides: options.env }),
          model,
          reasoningEffort,
          reasoningSummary: options.reasoningSummary || state.ai.reasoningSummary || "auto",
          personality: options.personality || state.ai.personality || null,
          serviceTier: options.serviceTier || state.ai.serviceTier || null,
          prompt: Object.hasOwn(attempt, "prompt") ? attempt.prompt : input,
          resumePrompt: Object.hasOwn(attempt, "resumePrompt") ? attempt.resumePrompt : options.resumePrompt,
          imagePaths: Object.hasOwn(attempt, "imagePaths") ? attempt.imagePaths : options.imagePaths || [],
          threadId: requestedThreadId(Object.hasOwn(attempt, "threadId") ? attempt.threadId : options.threadId || null),
          ephemeral: Object.hasOwn(attempt, "ephemeral") ? attempt.ephemeral : options.ephemeral !== false,
          developerInstructions: options.developerInstructions,
          baseInstructions: options.baseInstructions,
          dynamicTools: options.dynamicTools || [],
          // Both transports defer QQ tool schemas until the model selects one.
          toolTransport: agent.resolveToolTransport(toolTransport),
          deferToolLoading: true,
          outputSchema: options.outputSchema || null,
          config: agent.buildConfig(options.config || null, {
            leanContext: options.leanContext ?? leanContext,
            keepProjectDocs: Boolean(options.keepProjectDocs)
          }),
          webSearchMode: options.webSearchMode || null,
          sandbox: options.sandbox || "read-only",
          sandboxPolicy: options.sandboxPolicy || null,
          permissions: options.permissions || null,
          runtimeWorkspaceRoots: options.runtimeWorkspaceRoots || [],
          shellAccess: Boolean(options.shellAccess),
          timeoutMs: options.timeout,
          replacementIdleTimeoutMs: options.replacementIdleTimeoutMs,
          workloadMessageCount: normalizedWorkloadMessageCount(options),
          signal: replyScope?.signal,
          onDynamicToolCall: typeof options.onDynamicToolCall === "function"
            ? (...args) => runAgentToolCall(() => options.onDynamicToolCall(...args))
            : undefined,
          onServerRequest: options.onServerRequest,
          // Codex streams account rate limits and token usage as protocol
          // notifications; an engine without a usage feed skips the observer.
          onNotification: agent.reportsQuota && typeof observeQuotaNotification === "function"
            ? (message) => {
              notifyObserver(observeQuotaNotification, message);
              notifyObserver(options.onNotification, message);
            }
            : options.onNotification,
          onItem: observeItem,
          onProgress: options.onProgress,
          onRestarted: attempt.onRestarted,
          onSpawn: (child) => {
            activeChildren.add(child);
            const id = trackGeneration(child, options);
            generationIds.set(child, id);
            generationId = id;
          },
          onReady: (controls) => attachSteering(generationIds.get(controls.child), controls),
          onExit: (child) => {
            activeChildren.delete(child);
            clearGeneration(generationIds.get(child));
            generationIds.delete(child);
          }
        });
        const result = await runQqCodexTurnWithFusionRecovery({
          prompt: input,
          imagePaths: options.imagePaths || [],
          runAttempt,
          onRecovery: ({ error, replacementTextChars, replacementImageCount }) => {
            logger.warn("Agent fused replacement stalled; starting one fresh recovery", {
              ...buildQqTurnOperationLogDetails(options, "restarted", agent),
              cwd: options.cwd,
              timeoutMs: options.timeout,
              replacementIdleTimeoutMs: normalizedReplacementIdleTimeout(options),
              qqGenerationId: generationId,
              recoveryAttempt: 1,
              recoveryReason: error?.code || "CODEX_FUSION_TIMEOUT",
              deadlineRenewalCount: Number(error?.deadlineRenewalCount || 0),
              replacementTextChars,
              replacementImageCount,
            }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
          }
        });
        recordSuccess({ state, result, options, startedAt, generationId, logger, logContext, agent, model, reasoningEffort, toolItems });
        logModelOutput(result.finalResponse, {
          event: options.qqEvent,
          taskType: options.taskType,
          label: "qq-steerable-reply",
          engine: agent.id,
          model,
          reasoningEffort
        });
        if (agent.reportsQuota && typeof refreshQuota === "function") {
          trackBackgroundTask(refreshQuota({ startedAtMs: startedAt, previousQuota }), () => null);
        }
        return result;
      } catch (error) {
        recordFailure({
          state,
          error,
          options,
          startedAt,
          generationId,
          stoppedGenerationIds,
          logger,
          logContext,
          agent,
          model,
          reasoningEffort,
          toolItems
        });
        if (generationId && stoppedGenerationIds.delete(generationId)) throw createStoppedError();
        if (replyScope?.cancelled && error?.code === "ABORT_ERR") throw createStoppedError();
        throw error;
      } finally {
        capacitySlot?.release();
      }
    }, { signal: replyScope?.signal });
  };

  function acquireCapacity(options, replyScope, agent, model) {
    if (!processGate) return null;
    const waitMs = Number.isFinite(Number(options.capacityWaitMs))
      ? Number(options.capacityWaitMs)
      : options.qqEvent ? replyCapacityWaitMs : backgroundCapacityWaitMs;
    return processGate.acquire({
      processes: countAgentTurnProcesses(agent, { tools: (options.dynamicTools || []).length > 0 }),
      waitMs,
      signal: replyScope?.signal,
      onWait: (status) => logger?.warn?.("Agent turn waiting for host capacity", {
        ...buildQqTurnOperationLogDetails(options, "waiting", agent),
        operation: "agent.capacity",
        model,
        waitLimitMs: waitMs,
        ...describeAgentHostCapacity(status)
      }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext?.(options.qqEvent, {}) || {} : {})
    });
  }
}

function recordSuccess({ state, result, options, startedAt, generationId, logger, logContext, agent, model, reasoningEffort, toolItems = [] }) {
  const run = recordAgentRun(state, { startedAt, ok: true, error: null });
  const diagnostics = summarizeProcessDiagnostics({ stderr: result.stderr, stdout: "" });
  logger.success(`${agent.logLabel} turn finished`, {
    ...buildQqTurnOperationLogDetails(options, "success", agent),
    model,
    reasoningEffort,
    cwd: options.cwd,
    durationMs: run.lastDurationMs,
    timeoutMs: options.timeout,
    replacementIdleTimeoutMs: normalizedReplacementIdleTimeout(options),
    qqGenerationId: generationId,
    threadId: result.threadId,
    turnId: result.turnId,
    deadlineRenewalCount: Number(result.deadlineRenewalCount || 0),
    fusionRecoveryCount: Number(result.fusionRecoveryCount || 0),
    fusionRecoveryReason: result.fusionRecoveryReason || null,
    ...toolStepFields(toolItems.length ? toolItems : result.items),
    ...diagnosticFields(diagnostics)
  }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

// "ToolSearch → qq_sticker.manage → qq_chat.send ×2" on the turn's own line.
function toolStepFields(items) {
  const summary = summarizeAgentTurnTools(items);
  return summary.toolCallCount > 0 ? summary : {};
}

// One line per tool the engine ran itself (shell, file edits, web search,
// Claude Read/Grep/Bash/ToolSearch, Codex image generation…). QQ tools are
// logged by the Hub's dispatcher with their results instead.
function logNativeToolItem({ logger, logContext, options, agent, item, generationId }) {
  if (typeof logger?.info !== "function") return;
  let activity;
  try {
    activity = describeNativeAgentItem(item, { cwd: options.cwd || "" });
  } catch {
    activity = null;
  }
  if (!activity) return;
  const failed = /失败|被拒绝/.test(activity.outcome);
  const durationMs = Number(item.durationMs);
  logger[failed ? "warn" : "info"]("Agent native tool completed", {
    activity: `${activity.label} ${activity.line}`.trim(),
    activityResult: activity.outcome || null,
    ...buildQqTurnOperationLogDetails(options, failed ? "failed" : "success", agent),
    operation: "agent.native_tool",
    toolName: activity.label,
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {})
  }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

function recordFailure({ state, error, options, startedAt, generationId, stoppedGenerationIds, logger, logContext, agent, model, reasoningEffort, toolItems = [] }) {
  const stopped = Boolean(generationId && stoppedGenerationIds.has(generationId));
  const run = recordAgentRun(state, {
    startedAt,
    ok: false,
    error: stopped ? "QQ generation stopped by /stop" : error.message
  });
  const details = {
    ...buildQqTurnOperationLogDetails(options, stopped ? "stopped" : "failed", agent),
    model,
    reasoningEffort,
    cwd: options.cwd,
    durationMs: run.lastDurationMs,
    timeoutMs: options.timeout,
    replacementIdleTimeoutMs: normalizedReplacementIdleTimeout(options),
    qqGenerationId: generationId,
    ...toolStepFields(toolItems)
  };
  if (stopped) {
    logger.warn("QQ Agent generation stopped", details, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
    return;
  }
  const diagnostics = summarizeProcessDiagnostics({ stderr: error?.stderr || "", stdout: "" });
  logger.error(`${agent.logLabel} turn failed`, {
    ...details,
    deadlineRenewalCount: Number(error?.deadlineRenewalCount || 0),
    fusionRecoveryAttempted: Boolean(error?.fusionRecoveryAttempted),
    fusionRecoveryReason: error?.fusionRecoveryReason || null,
    ...diagnosticFields(diagnostics),
    error
  }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

// Run statistics are engine-neutral; the dashboard reads them as agent status.
function recordAgentRun(state, { startedAt, ok, error }) {
  const finishedAt = Date.now();
  const run = state.maintenance.agent;
  run.lastRunAt = new Date(finishedAt).toISOString();
  run.lastDurationMs = finishedAt - startedAt;
  run.lastOk = ok;
  run.lastError = error;
  return run;
}

function buildQqTurnOperationLogDetails(options, outcome, agent) {
  const event = options?.qqEvent || null;
  return {
    ...buildQqOperationLogDetails(event, {
      operation: "agent.turn",
      outcome,
      taskType: options?.taskType || null,
      groupId: event?.groupId || null,
      senderId: event?.senderId || null
    }),
    engine: agent.id,
    ...(normalizedWorkloadMessageCount(options) > 1
      ? { workloadMessageCount: normalizedWorkloadMessageCount(options) }
      : {})
  };
}

function diagnosticFields(diagnostics) {
  return diagnostics.lines.length > 0 ? {
    diagnostic: diagnostics.summary,
    diagnosticLines: diagnostics.lines,
    diagnosticOmittedLines: diagnostics.omittedLineCount
  } : {};
}

// How many QQ messages this turn answers at once; widens the protocol budget.
function normalizedWorkloadMessageCount(options) {
  const value = Number(options?.workloadMessageCount);
  return Number.isFinite(value) && value >= 1 ? Math.min(100, Math.floor(value)) : 1;
}

function normalizedReplacementIdleTimeout(options) {
  const value = Number(options?.replacementIdleTimeoutMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}
