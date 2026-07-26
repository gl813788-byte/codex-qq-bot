export function ensureQqProactiveCycleState(proactiveState = {}) {
  if (!proactiveState.messageCountByGroupId || typeof proactiveState.messageCountByGroupId !== "object") {
    proactiveState.messageCountByGroupId = {};
  }
  if (!proactiveState.lastJudgeAtByGroupId || typeof proactiveState.lastJudgeAtByGroupId !== "object") {
    proactiveState.lastJudgeAtByGroupId = {};
  }
  if (!proactiveState.judgeInFlightByGroupId || typeof proactiveState.judgeInFlightByGroupId !== "object") {
    proactiveState.judgeInFlightByGroupId = {};
  }
  if (!proactiveState.cycleVersionByGroupId || typeof proactiveState.cycleVersionByGroupId !== "object") {
    proactiveState.cycleVersionByGroupId = {};
  }
  return proactiveState;
}

export function getQqProactiveMessageCount(proactiveState = {}, groupId) {
  const count = Number(proactiveState.messageCountByGroupId?.[String(groupId)] || 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function incrementQqProactiveMessageCount(proactiveState = {}, groupId) {
  if (!groupId) return 0;
  ensureQqProactiveCycleState(proactiveState);
  const key = String(groupId);
  const next = getQqProactiveMessageCount(proactiveState, key) + 1;
  proactiveState.messageCountByGroupId[key] = next;
  return next;
}

export function getQqProactiveCycleVersion(proactiveState = {}, groupId) {
  const version = Number(proactiveState.cycleVersionByGroupId?.[String(groupId)] || 0);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

export function resetQqProactiveCycleAfterBotReply(proactiveState = {}, groupId) {
  const key = String(groupId || "").trim();
  if (!key) {
    return {
      changed: false,
      clearedMessageCount: 0,
      judgeInFlight: false,
      cycleVersion: 0
    };
  }
  ensureQqProactiveCycleState(proactiveState);
  const clearedMessageCount = getQqProactiveMessageCount(proactiveState, key);
  const hadCycleStart = Object.hasOwn(proactiveState.lastJudgeAtByGroupId, key);
  const judgeInFlight = Boolean(proactiveState.judgeInFlightByGroupId[key]);
  delete proactiveState.messageCountByGroupId[key];
  delete proactiveState.lastJudgeAtByGroupId[key];
  if (judgeInFlight) {
    proactiveState.cycleVersionByGroupId[key] = getQqProactiveCycleVersion(proactiveState, key) + 1;
  } else {
    delete proactiveState.cycleVersionByGroupId[key];
  }
  return {
    changed: clearedMessageCount > 0 || hadCycleStart || judgeInFlight,
    clearedMessageCount,
    judgeInFlight,
    cycleVersion: getQqProactiveCycleVersion(proactiveState, key)
  };
}

export function completeQqProactiveJudgeCycle(proactiveState = {}, groupId, {
  consumedMessageCount = 0,
  startedCycleVersion = 0,
  completedAt = Date.now()
} = {}) {
  const key = String(groupId || "").trim();
  ensureQqProactiveCycleState(proactiveState);
  const resetAfterStart = getQqProactiveCycleVersion(proactiveState, key) !== startedCycleVersion;
  if (!resetAfterStart) {
    const countAfterJudge = getQqProactiveMessageCount(proactiveState, key);
    proactiveState.messageCountByGroupId[key] = Math.max(
      0,
      countAfterJudge - Math.max(0, Number(consumedMessageCount) || 0)
    );
    proactiveState.lastJudgeAtByGroupId[key] = completedAt;
  }
  delete proactiveState.judgeInFlightByGroupId[key];
  if (resetAfterStart) delete proactiveState.cycleVersionByGroupId[key];
  return {
    resetAfterStart,
    messageCountRemaining: getQqProactiveMessageCount(proactiveState, key),
    cycleCompletedAt: resetAfterStart ? undefined : proactiveState.lastJudgeAtByGroupId[key]
  };
}
