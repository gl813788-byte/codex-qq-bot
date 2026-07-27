const RECOVERABLE_FUSION_CODES = new Set([
  "CODEX_REPLACEMENT_STALLED",
  "CODEX_TURN_TIMEOUT"
]);

export async function runQqCodexTurnWithFusionRecovery({
  prompt = "",
  imagePaths = [],
  runAttempt,
  onRecovery
} = {}) {
  if (typeof runAttempt !== "function") {
    throw new TypeError("runAttempt must be a function");
  }

  let acceptedReplacementInput = [];
  const captureReplacement = (details = {}) => {
    acceptedReplacementInput.push(...normalizeInput(details.input));
  };

  try {
    const result = await runAttempt({
      prompt,
      imagePaths,
      onRestarted: captureReplacement
    });
    return {
      ...result,
      fusionRecoveryCount: 0,
      fusionRecoveryReason: null
    };
  } catch (error) {
    if (!shouldRecoverFusedTurn(error, acceptedReplacementInput)) throw error;

    const recovery = buildFusedTurnRecovery({
      prompt,
      imagePaths,
      replacementInput: acceptedReplacementInput
    });
    try {
      onRecovery?.({
        error,
        replacementTextChars: recovery.replacementText.length,
        replacementImageCount: recovery.replacementImagePaths.length
      });
    } catch {
      // Recovery diagnostics must not change whether the retry runs.
    }

    try {
      const result = await runAttempt({
        prompt: recovery.prompt,
        resumePrompt: recovery.prompt,
        imagePaths: recovery.imagePaths,
        threadId: null,
        onRestarted: captureReplacement
      });
      return {
        ...result,
        fusionRecoveryCount: 1,
        fusionRecoveryReason: error.code || "CODEX_FUSION_TIMEOUT"
      };
    } catch (recoveryError) {
      try {
        recoveryError.fusionRecoveryAttempted = true;
        recoveryError.fusionRecoveryReason = error.code || "CODEX_FUSION_TIMEOUT";
      } catch {
        // Externally supplied errors may be non-extensible.
      }
      throw recoveryError;
    }
  }
}

export function shouldRecoverFusedTurn(error, replacementInput = []) {
  if (!RECOVERABLE_FUSION_CODES.has(String(error?.code || ""))) return false;
  if (error?.code === "CODEX_TURN_TIMEOUT" && Number(error?.deadlineRenewalCount || 0) < 1) {
    return false;
  }
  return normalizeInput(replacementInput).some((item) => (
    (item.type === "text" && item.text.trim())
    || (item.type === "localImage" && item.path)
  ));
}

export function buildFusedTurnRecovery({
  prompt = "",
  imagePaths = [],
  replacementInput = []
} = {}) {
  const normalizedReplacement = normalizeInput(replacementInput);
  const replacementText = normalizedReplacement
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n\n");
  const replacementImagePaths = normalizedReplacement
    .filter((item) => item.type === "localImage")
    .map((item) => item.path)
    .filter(Boolean);
  return {
    prompt: [
      String(prompt || ""),
      "",
      "QQ 融合回复可靠性恢复：上一条生成在收到后续消息后已经被截断，替代轮次没有形成可发送结果；之前的草稿从未送达 QQ。",
      "下面是截断后必须合并处理的新消息。请基于上面的完整上下文重新作答，只输出一份统一的最终 QQ 回复；不要解释超时、恢复、截断或内部流程，也不要先回答旧问题再逐条补答。",
      replacementText || "（只有随消息附带的图片，没有新增文字）"
    ].join("\n"),
    imagePaths: [...new Set([
      ...(Array.isArray(imagePaths) ? imagePaths : []),
      ...replacementImagePaths
    ].map((value) => String(value || "").trim()).filter(Boolean))],
    replacementText,
    replacementImagePaths
  };
}

function normalizeInput(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .filter((item) => item && typeof item === "object")
    .map((item) => item.type === "localImage"
      ? {
        type: "localImage",
        path: String(item.path || "").trim()
      }
      : {
        type: "text",
        text: String(item.text || "")
      })
    .filter((item) => item.type === "localImage" ? item.path : item.text);
}
