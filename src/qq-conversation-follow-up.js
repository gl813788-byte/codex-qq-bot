export const QQ_CONVERSATION_FOLLOW_UP_QUIET_MS = 5_000;

const defaultWindowSeconds = 6 * 60;
const minimumWindowSeconds = 3 * 60;
const maximumWindowSeconds = 12 * 60;
const defaultMessageLimit = 3;
const minimumMessageLimit = 2;
const maximumMessageLimit = 6;
const maximumInterveningOtherMessages = 8;

export function detectQqConversationFollowUp(event = {}, {
  recentMessages = [],
  adaptiveSignals = null,
  now = Date.now()
} = {}) {
  const senderId = normalizeId(event.senderId);
  if (!event.groupId || !senderId) return noCandidate("not_group_sender");
  if (isExplicitBotTrigger(event)) return noCandidate("explicit_bot_trigger");
  if (event.hasAtSegment || (Array.isArray(event.atTargets) && event.atTargets.length > 0)) {
    return noCandidate("targets_another_member");
  }
  if (event.hasReplySegment || event.replyMessageId || event.replyContext) {
    return noCandidate("replies_to_another_message");
  }
  const text = String(event.text || "").trim();
  if (/^\//.test(text)) return noCandidate("command_message");
  if (!text && !(Array.isArray(event.images) && event.images.length > 0)) {
    return noCandidate("empty_message");
  }

  const entries = Array.isArray(recentMessages) ? recentMessages : [];
  const anchorIndex = findLatestAssistantIndex(entries);
  if (anchorIndex < 0) return noCandidate("no_recent_bot_reply");
  const anchor = entries[anchorIndex] || {};
  if (normalizeId(anchor.replyTargetId) !== senderId) return noCandidate("bot_replied_to_someone_else");

  const currentAt = resolveTime(now);
  const anchorAt = Date.parse(String(anchor.at || ""));
  if (!Number.isFinite(anchorAt)) return noCandidate("bot_reply_time_unknown");
  const gapSeconds = Math.max(0, Math.round((currentAt - anchorAt) / 1000));
  const windowSeconds = deriveWindowSeconds(adaptiveSignals);
  const messageLimit = deriveMessageLimit(adaptiveSignals);
  const anchorKey = buildAnchorKey(event.groupId, senderId, anchor, anchorAt);
  const bounds = { anchorKey, gapSeconds, windowSeconds, messageLimit };
  if (gapSeconds > windowSeconds) return noCandidate("continuation_window_elapsed", bounds);

  const followingEntries = entries.slice(anchorIndex + 1);
  const interveningHumans = followingEntries.filter((entry, index) => (
    !(entry?.isAssistant || entry?.senderId === "assistant")
    && !isCurrentEventEntry(entry, event, index === followingEntries.length - 1)
  ));
  const sameSenderMessageCount = interveningHumans
    .filter((entry) => normalizeId(entry?.senderId) === senderId).length + 1;
  const interveningOtherSenderCount = interveningHumans
    .filter((entry) => normalizeId(entry?.senderId) !== senderId).length;
  const candidateBounds = {
    ...bounds,
    sameSenderMessageCount,
    interveningHumanCount: interveningHumans.length,
    interveningOtherSenderCount
  };
  if (sameSenderMessageCount > messageLimit) {
    return noCandidate("continuation_message_limit_reached", candidateBounds);
  }
  if (interveningOtherSenderCount > maximumInterveningOtherMessages) {
    return noCandidate("too_many_intervening_messages", candidateBounds);
  }

  return {
    candidate: true,
    reason: "same_sender_after_bot_reply",
    senderId,
    anchorKey,
    anchorText: compact(anchor.text, 320),
    anchorAt: new Date(anchorAt).toISOString(),
    gapSeconds,
    windowSeconds,
    messageLimit,
    sameSenderMessageCount,
    interveningHumanCount: interveningHumans.length,
    interveningOtherSenderCount,
    statisticalBasis: buildStatisticalBasis(adaptiveSignals)
  };
}

export function createQqConversationFollowUpCoordinator({
  delayMs = QQ_CONVERSATION_FOLLOW_UP_QUIET_MS,
  onBatch = async () => null,
  onError = () => undefined
} = {}) {
  const sessions = new Map();
  let closed = false;

  function offer(scopeId, event, candidate) {
    const key = String(scopeId || "");
    const anchorKey = String(candidate?.anchorKey || "");
    if (closed || !key || !anchorKey || !candidate?.candidate) {
      return { accepted: false, reason: closed ? "closed" : "invalid_candidate" };
    }

    let session = sessions.get(key);
    if (session?.anchorKey !== anchorKey) {
      clearSessionTimer(session);
      session = null;
    }
    if (session && session.phase !== "collecting") {
      return {
        accepted: false,
        reason: "batch_frozen",
        phase: session.phase,
        anchorKey,
        eventCount: session.events.length
      };
    }
    if (!session) {
      session = {
        scopeId: key,
        anchorKey,
        phase: "collecting",
        candidate: { ...candidate },
        events: [],
        timer: null,
        startedAt: new Date().toISOString(),
        frozenAt: null,
        decidedAt: null
      };
      sessions.set(key, session);
    }

    const limit = clamp(
      Number(candidate.messageLimit || session.candidate.messageLimit || defaultMessageLimit),
      minimumMessageLimit,
      maximumMessageLimit
    );
    if (session.events.length >= limit) {
      return {
        accepted: false,
        reason: "message_limit_reached",
        phase: session.phase,
        anchorKey,
        eventCount: session.events.length,
        messageLimit: limit
      };
    }
    session.candidate = { ...session.candidate, ...candidate, messageLimit: limit };
    session.events.push(event);
    clearSessionTimer(session);
    session.timer = setTimeout(() => freeze(key, session), Math.max(0, Number(delayMs) || 0));
    session.timer.unref?.();
    return {
      accepted: true,
      reason: session.events.length >= limit ? "message_limit_reached_waiting_for_quiet" : "quiet_window_pending",
      phase: session.phase,
      anchorKey,
      eventCount: session.events.length,
      messageLimit: limit,
      delayMs: Math.max(0, Number(delayMs) || 0)
    };
  }

  function touch(scopeId, anchorKey) {
    const session = sessions.get(String(scopeId || ""));
    if (!session || session.anchorKey !== String(anchorKey || "") || session.phase !== "collecting") return false;
    clearSessionTimer(session);
    session.timer = setTimeout(() => freeze(session.scopeId, session), Math.max(0, Number(delayMs) || 0));
    session.timer.unref?.();
    return true;
  }

  async function freeze(scopeId, expectedSession = sessions.get(String(scopeId || ""))) {
    const key = String(scopeId || "");
    const session = sessions.get(key);
    if (closed || !session || session !== expectedSession || session.phase !== "collecting") return null;
    clearSessionTimer(session);
    session.phase = "judging";
    session.frozenAt = new Date().toISOString();
    const batch = snapshotSession(session);
    try {
      const result = await onBatch(batch);
      if (session.phase === "judging") {
        markDecision(key, session.anchorKey, Boolean(result?.decision?.ok));
      }
      return result;
    } catch (error) {
      if (session.phase === "judging") markDecision(key, session.anchorKey, false);
      onError(error, batch);
      return null;
    }
  }

  function markDecision(scopeId, anchorKey, approved) {
    const session = sessions.get(String(scopeId || ""));
    if (!session || session.anchorKey !== String(anchorKey || "") || session.phase !== "judging") return false;
    session.phase = approved ? "approved" : "declined";
    session.decidedAt = new Date().toISOString();
    return true;
  }

  function inspect(scopeId, anchorKey = "") {
    const session = sessions.get(String(scopeId || ""));
    if (!session || (anchorKey && session.anchorKey !== String(anchorKey))) return null;
    return snapshotSession(session, { includeEvents: false });
  }

  function cancel(scopeId) {
    const key = String(scopeId || "");
    const session = sessions.get(key);
    if (!session) return false;
    clearSessionTimer(session);
    sessions.delete(key);
    return true;
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const session of sessions.values()) clearSessionTimer(session);
    sessions.clear();
  }

  function reset() {
    if (closed) return false;
    for (const session of sessions.values()) clearSessionTimer(session);
    const changed = sessions.size > 0;
    sessions.clear();
    return changed;
  }

  function snapshot() {
    return [...sessions.values()].map((session) => snapshotSession(session, { includeEvents: false }));
  }

  return { offer, touch, freeze, markDecision, inspect, cancel, reset, close, snapshot };
}

function deriveWindowSeconds(signals) {
  const member = signals?.member || {};
  const group = signals?.group || {};
  const learnedMedian = Number(member.sampleSize || 0) >= 8 && Number(member.medianGapSeconds || 0) > 0
    ? Number(member.medianGapSeconds)
    : Number(group.sampleSize || 0) >= 20 && Number(group.medianGapSeconds || 0) > 0
      ? Number(group.medianGapSeconds)
      : 0;
  if (!learnedMedian) return defaultWindowSeconds;
  return clamp(Math.round(learnedMedian * 4), minimumWindowSeconds, maximumWindowSeconds);
}

function deriveMessageLimit(signals) {
  const member = signals?.member || {};
  const group = signals?.group || {};
  const ratio = Number(member.sampleSize || 0) >= 8
    ? Number(member.burstContinuationRatio || 0)
    : Number(group.sampleSize || 0) >= 20
      ? Number(group.burstContinuationRatio || 0)
      : null;
  if (!Number.isFinite(ratio)) return defaultMessageLimit;
  if (ratio <= 0.08) return 2;
  if (ratio < 0.25) return 3;
  if (ratio < 0.45) return 4;
  if (ratio < 0.65) return 5;
  return 6;
}

function buildStatisticalBasis(signals) {
  const member = signals?.member || {};
  const group = signals?.group || {};
  return {
    memberSampleSize: Math.max(0, Number(member.sampleSize || 0)),
    memberMedianGapSeconds: Math.max(0, Number(member.medianGapSeconds || 0)),
    memberBurstContinuationRatio: clamp(Number(member.burstContinuationRatio || 0), 0, 1),
    groupSampleSize: Math.max(0, Number(group.sampleSize || 0)),
    groupMedianGapSeconds: Math.max(0, Number(group.medianGapSeconds || 0)),
    groupBurstContinuationRatio: clamp(Number(group.burstContinuationRatio || 0), 0, 1)
  };
}

function buildAnchorKey(groupId, senderId, anchor, anchorAt) {
  const anchorId = String(anchor?.messageId || anchor?.raw?.message_id || "").trim();
  return [String(groupId || ""), senderId, anchorId || new Date(anchorAt).toISOString()].join(":");
}

function snapshotSession(session, { includeEvents = true } = {}) {
  return {
    scopeId: session.scopeId,
    anchorKey: session.anchorKey,
    phase: session.phase,
    candidate: { ...session.candidate },
    events: includeEvents ? [...session.events] : undefined,
    eventCount: session.events.length,
    startedAt: session.startedAt,
    frozenAt: session.frozenAt,
    decidedAt: session.decidedAt
  };
}

function clearSessionTimer(session) {
  if (!session?.timer) return;
  clearTimeout(session.timer);
  session.timer = null;
}

function findLatestAssistantIndex(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.isAssistant || entries[index]?.senderId === "assistant") return index;
  }
  return -1;
}

function isCurrentEventEntry(entry, event, isLastEntry) {
  const entryId = String(entry?.messageId || "");
  const eventId = event?.raw?.message_id == null ? "" : String(event.raw.message_id);
  if (entryId && eventId) return entryId === eventId;
  return Boolean(isLastEntry)
    && normalizeId(entry?.senderId) === normalizeId(event.senderId)
    && compact(entry?.text, 520) === compact(event?.text, 520);
}

function isExplicitBotTrigger(event) {
  return Boolean(
    event.type === "group_at"
    || event.hasSelfAtSegment
    || event.isReplyToSelf
    || event.replyContext?.isSelf
  );
}

function noCandidate(reason, extra = {}) {
  return { candidate: false, reason, ...extra };
}

function resolveTime(value) {
  if (typeof value === "function") return resolveTime(value());
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}
