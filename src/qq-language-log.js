const defaultCheckpointEveryMessages = 25;

export function planQqLanguageStatisticsCheckpoint(profile = {}, previousSignature = "", {
  checkpointEveryMessages = defaultCheckpointEveryMessages
} = {}) {
  const snapshot = compactLanguageProfile(profile, checkpointEveryMessages);
  const signature = [
    snapshot.checkpoint,
    ...snapshot.punctuationCandidates.map((item) => `p:${item.key}`),
    ...snapshot.phraseCandidates.map((item) => `f:${item.key}`)
  ].join("|");
  const eligible = snapshot.checkpoint > 0 || snapshot.frequentCandidateCount > 0;
  const changed = signature !== String(previousSignature || "");
  return {
    due: changed && (eligible || Boolean(previousSignature)),
    signature,
    snapshot
  };
}

export function buildQqLanguageStatisticsLogDetails({
  scopeId,
  scopeType,
  groupId,
  senderId,
  scopePlan,
  memberPlan,
  checkpointEveryMessages = defaultCheckpointEveryMessages
} = {}) {
  const checkpointKinds = [
    scopePlan?.due ? "scope" : "",
    memberPlan?.due ? "member" : ""
  ].filter(Boolean);
  const details = {
    operation: "learning.language_statistics",
    outcome: "recorded",
    source: "qq-message",
    scopeId: optionalId(scopeId),
    scopeType: String(scopeType || "unknown"),
    groupId: optionalId(groupId),
    senderId: optionalId(senderId),
    checkpointEveryMessages: normalizeCheckpoint(checkpointEveryMessages),
    checkpointKinds
  };
  if (scopePlan?.due) details.scopeLanguage = scopePlan.snapshot;
  if (memberPlan?.due) details.memberLanguage = memberPlan.snapshot;
  return details;
}

function compactLanguageProfile(profile, checkpointEveryMessages) {
  const sampleSize = Math.max(0, Math.floor(Number(profile?.sampleSize) || 0));
  const punctuationCandidates = compactCandidates(profile?.frequentPunctuation, 8);
  const phraseCandidates = compactCandidates(profile?.frequentPhrases, 6);
  return {
    sampleSize,
    checkpoint: Math.floor(sampleSize / normalizeCheckpoint(checkpointEveryMessages)),
    frequentCandidateCount: punctuationCandidates.length + phraseCandidates.length,
    punctuationCandidates,
    phraseCandidates
  };
}

function compactCandidates(value, limit) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map((item) => ({
      key: String(item?.key || "").slice(0, 80),
      ...(item?.symbol ? { symbol: String(item.symbol).slice(0, 40) } : {}),
      ...(item?.label ? { label: String(item.label).slice(0, 120) } : {}),
      occurrenceCount: Math.max(0, Math.floor(Number(item?.occurrenceCount) || 0)),
      containingMessageCount: Math.max(0, Math.floor(Number(item?.messageCount) || 0)),
      messageRatio: clampRatio(item?.messageRatio)
    }))
    .filter((item) => item.key);
}

function normalizeCheckpoint(value) {
  return Math.max(5, Math.min(500, Math.floor(Number(value) || defaultCheckpointEveryMessages)));
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function optionalId(value) {
  return value == null || value === "" ? null : String(value).slice(0, 120);
}
