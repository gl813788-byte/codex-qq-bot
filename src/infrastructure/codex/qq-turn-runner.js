import { runCodexAppServerTurn } from "../../codex-app-server-turn.js";
import { buildIsolatedCodexChildEnv } from "../../codex-child-env.js";
import { buildIsolatedClaudeChildEnv } from "../claude/claude-child-env.js";
import { isClaudeThreadId, runClaudeCodeTurn } from "../claude/claude-code-turn.js";
import { runQqCodexTurnWithFusionRecovery } from "../../qq-codex-turn-recovery.js";
import { summarizeProcessDiagnostics } from "../../process-diagnostics.js";
import { buildQqOperationLogDetails } from "../../qq-operation-log.js";
import { AGENT_LOG_CATEGORY, getAgentEngine } from "../agent/agent-engines.js";

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
    canResume: (threadId) => !isClaudeThreadId(threadId)
  }),
  claude: Object.freeze({
    ...getAgentEngine("claude"),
    runTurn: runClaudeCodeTurn,
    buildEnv: buildIsolatedClaudeChildEnv,
    canResume: () => true
  })
});

export function selectQqAgentEngine(engine) {
  return qqAgentEngines[getAgentEngine(engine).id];
}

export function createQqCodexTurnRunner({
  limiter,
  state,
  codexPath,
  engine = "codex",
  claudePath = "claude",
  claudeModel = null,
  claudeReasoningEffort = null,
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
  refreshQuota
} = {}) {
  assertFunction(limiter?.run, "limiter.run");
  assertFunction(getReplyScope, "getReplyScope");
  assertFunction(createStoppedError, "createStoppedError");
  assertFunction(trackGeneration, "trackGeneration");
  assertFunction(attachSteering, "attachSteering");
  assertFunction(clearGeneration, "clearGeneration");
  const agent = selectQqAgentEngine(engine);

  return function runQqCodexTurn(input, options = {}) {
    const replyScope = options.qqEvent ? getReplyScope(options.qqEvent) : null;
    return limiter.run(async () => {
      if (replyScope?.cancelled) throw createStoppedError();
      const startedAt = Date.now();
      const previousQuota = state.maintenance.codex.quota;
      let generationId = null;
      const generationIds = new WeakMap();
      try {
        const engineSettings = { ai: state.ai, claudeModel, claudeReasoningEffort };
        const model = agent.selectModel(engineSettings);
        const reasoningEffort = agent.selectReasoningEffort(engineSettings);
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
          outputSchema: options.outputSchema || null,
          config: options.config || null,
          webSearchMode: options.webSearchMode || null,
          sandbox: options.sandbox || "read-only",
          sandboxPolicy: options.sandboxPolicy || null,
          permissions: options.permissions || null,
          runtimeWorkspaceRoots: options.runtimeWorkspaceRoots || [],
          shellAccess: Boolean(options.shellAccess),
          timeoutMs: options.timeout,
          replacementIdleTimeoutMs: options.replacementIdleTimeoutMs,
          signal: replyScope?.signal,
          onDynamicToolCall: options.onDynamicToolCall,
          onServerRequest: options.onServerRequest,
          onNotification: options.onNotification,
          onItem: options.onItem,
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
        recordSuccess({ state, result, options, startedAt, generationId, logger, logContext, agent, model, reasoningEffort });
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
          reasoningEffort
        });
        if (generationId && stoppedGenerationIds.delete(generationId)) throw createStoppedError();
        throw error;
      }
    }, { signal: replyScope?.signal });
  };
}

function recordSuccess({ state, result, options, startedAt, generationId, logger, logContext, agent, model, reasoningEffort }) {
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
    ...diagnosticFields(diagnostics)
  }, AGENT_LOG_CATEGORY, options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

function recordFailure({ state, error, options, startedAt, generationId, stoppedGenerationIds, logger, logContext, agent, model, reasoningEffort }) {
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
    qqGenerationId: generationId
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
    engine: agent.id
  };
}

function diagnosticFields(diagnostics) {
  return diagnostics.lines.length > 0 ? {
    diagnostic: diagnostics.summary,
    diagnosticLines: diagnostics.lines,
    diagnosticOmittedLines: diagnostics.omittedLineCount
  } : {};
}

function normalizedReplacementIdleTimeout(options) {
  const value = Number(options?.replacementIdleTimeoutMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}
