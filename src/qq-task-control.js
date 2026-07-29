export const QQ_TASK_CONTROL_LIMITS = Object.freeze({
  maxTotalRounds: 24,
  maxExtraRoundsPerRequest: 8,
  maxExtraMinutesPerRequest: 15,
  maxBudgetRequests: 2,
  maxProgressMessages: 4,
  maxProgressChars: 160
});

const progressMarkerPattern = /\[\[qq_progress:([^\]\n]*)\]\]/g;
const progressMarkerStripPattern = /\[\[qq_progress:[^\]\n]*\]\]/g;
const budgetMarkerPattern = /\[\[qq_task_budget:([^\]\n]*)\]\]/g;
const budgetMarkerStripPattern = /\[\[qq_task_budget:[^\]\n]*\]\]/g;
const continueMarkerPattern = /\[\[qq_task_continue\]\]/g;

export function createQqTaskControl({
  roundLimit = 8,
  timeoutMs = 120_000,
  maximumTimeoutMs = 30 * 60_000,
  limits = {}
} = {}) {
  const resolvedLimits = {
    ...QQ_TASK_CONTROL_LIMITS,
    ...limits
  };
  const baseRoundLimit = clampInteger(roundLimit, 1, resolvedLimits.maxTotalRounds, 8);
  const maximumMs = clampInteger(maximumTimeoutMs, 10_000, 60 * 60_000, 30 * 60_000);
  return {
    baseRoundLimit,
    roundLimit: baseRoundLimit,
    maxRoundLimit: Math.max(baseRoundLimit, resolvedLimits.maxTotalRounds),
    roundsUsed: 0,
    timeoutMs: clampInteger(timeoutMs, 10_000, maximumMs, 120_000),
    maximumTimeoutMs: maximumMs,
    budgetRequestsUsed: 0,
    progressMessagesSent: 0,
    progressTexts: new Set(),
    limits: resolvedLimits
  };
}

export function extractQqTaskControlMarkers(reply) {
  const text = String(reply || "");
  const progresses = [...text.matchAll(progressMarkerPattern)]
    .map((match) => normalizeProgress(match[1]))
    .filter(Boolean);
  const budgetRequests = [...text.matchAll(budgetMarkerPattern)]
    .map((match) => parseBudgetRequest(match[1]));
  const continueRequested = continueMarkerPattern.test(text);
  continueMarkerPattern.lastIndex = 0;
  return {
    visibleText: stripQqTaskControlMarkers(text),
    progresses,
    budgetRequests,
    continueRequested,
    hadControl: progresses.length > 0
      || budgetRequests.length > 0
      || continueRequested
      || progressMarkerStripPattern.test(text)
      || budgetMarkerStripPattern.test(text)
  };
}

export function stripQqTaskControlMarkers(reply) {
  progressMarkerStripPattern.lastIndex = 0;
  budgetMarkerStripPattern.lastIndex = 0;
  continueMarkerPattern.lastIndex = 0;
  return String(reply || "")
    .replace(progressMarkerStripPattern, "")
    .replace(budgetMarkerStripPattern, "")
    .replace(continueMarkerPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function takeQqTaskProgress(control, progresses = []) {
  if (!control || control.progressMessagesSent >= control.limits.maxProgressMessages) return [];
  const accepted = [];
  for (const candidate of progresses) {
    const text = normalizeProgress(candidate).slice(0, control.limits.maxProgressChars);
    const key = text.toLowerCase();
    if (!text || control.progressTexts.has(key)) continue;
    control.progressTexts.add(key);
    control.progressMessagesSent += 1;
    accepted.push(text);
    if (control.progressMessagesSent >= control.limits.maxProgressMessages) break;
  }
  return accepted;
}

export function applyQqTaskBudgetRequest(control, request) {
  if (!control) return budgetResult(false, "任务控制状态不可用。");
  if (!request?.ok) return budgetResult(false, request?.reason || "预算申请不是有效 JSON。");
  if (control.budgetRequestsUsed >= control.limits.maxBudgetRequests) {
    return budgetResult(false, `预算申请次数已达上限 ${control.limits.maxBudgetRequests} 次。`);
  }
  control.budgetRequestsUsed += 1;

  const extraMinutes = clampInteger(
    request.extraMinutes,
    0,
    control.limits.maxExtraMinutesPerRequest,
    0
  );
  const extraRounds = clampInteger(
    request.extraRounds,
    0,
    control.limits.maxExtraRoundsPerRequest,
    0
  );
  if (extraMinutes === 0 && extraRounds === 0) {
    return budgetResult(false, "至少要申请额外时长或额外轮数之一。");
  }

  const previousTimeoutMs = control.timeoutMs;
  const previousRoundLimit = control.roundLimit;
  control.timeoutMs = Math.min(
    control.maximumTimeoutMs,
    control.timeoutMs + extraMinutes * 60_000
  );
  control.roundLimit = Math.min(
    control.maxRoundLimit,
    control.roundLimit + extraRounds
  );
  const grantedMinutes = Math.max(0, Math.round((control.timeoutMs - previousTimeoutMs) / 60_000));
  const grantedRounds = Math.max(0, control.roundLimit - previousRoundLimit);
  if (grantedMinutes === 0 && grantedRounds === 0) {
    return budgetResult(false, "任务时长与轮数都已到 Hub 上限。");
  }
  return {
    ok: true,
    grantedMinutes,
    grantedRounds,
    timeoutMs: control.timeoutMs,
    roundLimit: control.roundLimit,
    reason: String(request.reason || "").trim().slice(0, 160),
    reply: `预算申请已批准：增加 ${grantedMinutes} 分钟、${grantedRounds} 轮；当前单轮最长 ${formatMinutes(control.timeoutMs)} 分钟，总工具循环上限 ${control.roundLimit} 轮。`
  };
}

function parseBudgetRequest(value) {
  try {
    const parsed = JSON.parse(String(value || "").trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "预算申请必须是 JSON 对象。" };
    }
    return {
      ok: true,
      extraMinutes: parsed.extraMinutes,
      extraRounds: parsed.extraRounds,
      reason: parsed.reason
    };
  } catch {
    return { ok: false, reason: "预算申请不是有效 JSON。" };
  }
}

function budgetResult(ok, reply) {
  return {
    ok,
    grantedMinutes: 0,
    grantedRounds: 0,
    reply
  };
}

function normalizeProgress(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function formatMinutes(value) {
  return Math.round(Number(value || 0) / 6_000) / 10;
}
