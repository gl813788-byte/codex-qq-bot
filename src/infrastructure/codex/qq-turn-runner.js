import { runCodexAppServerTurn } from "../../codex-app-server-turn.js";
import { buildIsolatedCodexChildEnv } from "../../codex-child-env.js";
import { runQqCodexTurnWithFusionRecovery } from "../../qq-codex-turn-recovery.js";
import { summarizeProcessDiagnostics } from "../../process-diagnostics.js";
import { buildQqOperationLogDetails } from "../../qq-operation-log.js";

export function createQqCodexTurnRunner({
  limiter,
  state,
  codexPath,
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

  return function runQqCodexTurn(input, options = {}) {
    const replyScope = options.qqEvent ? getReplyScope(options.qqEvent) : null;
    return limiter.run(async () => {
      if (replyScope?.cancelled) throw createStoppedError();
      const startedAt = Date.now();
      const previousQuota = state.maintenance.codex.quota;
      let generationId = null;
      const generationIds = new WeakMap();
      try {
        const runAttempt = (attempt = {}) => runCodexAppServerTurn({
          codexPath,
          cwd: options.cwd,
          env: buildIsolatedCodexChildEnv({ overrides: options.env }),
          model: state.ai.model,
          reasoningEffort: state.ai.reasoningEffort,
          reasoningSummary: options.reasoningSummary || state.ai.reasoningSummary || "auto",
          personality: options.personality || state.ai.personality || null,
          serviceTier: options.serviceTier || state.ai.serviceTier || null,
          prompt: Object.hasOwn(attempt, "prompt") ? attempt.prompt : input,
          resumePrompt: Object.hasOwn(attempt, "resumePrompt") ? attempt.resumePrompt : options.resumePrompt,
          imagePaths: Object.hasOwn(attempt, "imagePaths") ? attempt.imagePaths : options.imagePaths || [],
          threadId: Object.hasOwn(attempt, "threadId") ? attempt.threadId : options.threadId || null,
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
          timeoutMs: options.timeout,
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
            logger.warn("Codex fused replacement stalled; starting one fresh app-server recovery", {
              ...buildQqTurnOperationLogDetails(options, "restarted"),
              cwd: options.cwd,
              timeoutMs: options.timeout,
              qqGenerationId: generationId,
              recoveryAttempt: 1,
              recoveryReason: error?.code || "CODEX_FUSION_TIMEOUT",
              deadlineRenewalCount: Number(error?.deadlineRenewalCount || 0),
              replacementTextChars,
              replacementImageCount,
            }, "codex", options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
          }
        });
        recordSuccess({ state, result, options, startedAt, generationId, logger, logContext });
        logModelOutput(result.finalResponse, {
          event: options.qqEvent,
          taskType: options.taskType,
          label: "qq-steerable-reply"
        });
        trackBackgroundTask(refreshQuota({ startedAtMs: startedAt, previousQuota }), () => null);
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
          logContext
        });
        if (generationId && stoppedGenerationIds.delete(generationId)) throw createStoppedError();
        throw error;
      }
    }, { signal: replyScope?.signal });
  };
}

function recordSuccess({ state, result, options, startedAt, generationId, logger, logContext }) {
  const finishedAt = Date.now();
  state.maintenance.codex.lastRunAt = new Date(finishedAt).toISOString();
  state.maintenance.codex.lastDurationMs = finishedAt - startedAt;
  state.maintenance.codex.lastOk = true;
  state.maintenance.codex.lastError = null;
  const diagnostics = summarizeProcessDiagnostics({ stderr: result.stderr, stdout: "" });
  logger.success("Codex app-server turn finished", {
    ...buildQqTurnOperationLogDetails(options, "success"),
    cwd: options.cwd,
    durationMs: state.maintenance.codex.lastDurationMs,
    timeoutMs: options.timeout,
    qqGenerationId: generationId,
    threadId: result.threadId,
    turnId: result.turnId,
    deadlineRenewalCount: Number(result.deadlineRenewalCount || 0),
    fusionRecoveryCount: Number(result.fusionRecoveryCount || 0),
    fusionRecoveryReason: result.fusionRecoveryReason || null,
    ...diagnosticFields(diagnostics)
  }, "codex", options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

function recordFailure({ state, error, options, startedAt, generationId, stoppedGenerationIds, logger, logContext }) {
  const finishedAt = Date.now();
  const stopped = Boolean(generationId && stoppedGenerationIds.has(generationId));
  state.maintenance.codex.lastRunAt = new Date(finishedAt).toISOString();
  state.maintenance.codex.lastDurationMs = finishedAt - startedAt;
  state.maintenance.codex.lastOk = false;
  state.maintenance.codex.lastError = stopped ? "QQ generation stopped by /stop" : error.message;
  const details = {
    ...buildQqTurnOperationLogDetails(options, stopped ? "stopped" : "failed"),
    cwd: options.cwd,
    durationMs: state.maintenance.codex.lastDurationMs,
    timeoutMs: options.timeout,
    qqGenerationId: generationId
  };
  if (stopped) {
    logger.warn("QQ Codex generation stopped", details, "codex", options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
    return;
  }
  const diagnostics = summarizeProcessDiagnostics({ stderr: error?.stderr || "", stdout: "" });
  logger.error("Codex app-server turn failed", {
    ...details,
    deadlineRenewalCount: Number(error?.deadlineRenewalCount || 0),
    fusionRecoveryAttempted: Boolean(error?.fusionRecoveryAttempted),
    fusionRecoveryReason: error?.fusionRecoveryReason || null,
    ...diagnosticFields(diagnostics),
    error
  }, "codex", options.qqEvent ? logContext(options.qqEvent, { spanId: generationId }) : {});
}

function buildQqTurnOperationLogDetails(options, outcome) {
  const event = options?.qqEvent || null;
  return buildQqOperationLogDetails(event, {
    operation: "agent.turn",
    outcome,
    taskType: options?.taskType || null,
    groupId: event?.groupId || null,
    senderId: event?.senderId || null
  });
}

function diagnosticFields(diagnostics) {
  return diagnostics.lines.length > 0 ? {
    diagnostic: diagnostics.summary,
    diagnosticLines: diagnostics.lines,
    diagnosticOmittedLines: diagnostics.omittedLineCount
  } : {};
}

function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}
