const minuteMs = 60 * 1000;

export function getQqRelationshipInterestPlan(entries = [], {
  senderId,
  now = Date.now(),
  baseMessages = 20,
  baseMinutes = 5,
  unansweredBotStreak = 0
} = {}) {
  const targetId = normalizeId(senderId);
  const currentAt = resolveNow(now);
  const messageBaseline = clampInteger(baseMessages, 1, 1000, 20);
  const minuteBaseline = clampInteger(baseMinutes, 0, 1440, 5);
  const list = Array.isArray(entries) ? entries : [];
  const interaction = findLatestBotInteraction(list, targetId);
  const unanswered = clampInteger(unansweredBotStreak, 0, 1000, 0);
  const suppression = round(Math.max(0.08, 1 / (1 + unanswered * 0.85)));

  if (!interaction) {
    return {
      hasInteraction: false,
      senderId: targetId || null,
      lastInteractionAt: null,
      messagesSinceInteraction: null,
      minutesSinceInteraction: null,
      recency: 0,
      interestBoost: 0,
      interestMultiplier: suppression,
      unansweredBotStreak: unanswered,
      judgeEveryMessages: messageBaseline,
      judgeEveryMinutes: minuteBaseline,
      baselineMessages: messageBaseline,
      baselineMinutes: minuteBaseline
    };
  }

  const messagesSinceInteraction = Math.max(0, list.length - interaction.index - 1);
  const interactionAtMs = Date.parse(interaction.at || "");
  const minutesSinceInteraction = Number.isFinite(interactionAtMs)
    ? Math.max(0, (currentAt - interactionAtMs) / minuteMs)
    : null;
  const messageDecay = clamp(messagesSinceInteraction / messageBaseline, 0, 1);
  const timeDecay = minuteBaseline > 0 && minutesSinceInteraction != null
    ? clamp(minutesSinceInteraction / minuteBaseline, 0, 1)
    : messageDecay;
  const recency = round(clamp(1 - (messageDecay + timeDecay) / 2, 0, 1));

  return {
    hasInteraction: true,
    senderId: targetId || null,
    lastInteractionAt: Number.isFinite(interactionAtMs) ? new Date(interactionAtMs).toISOString() : null,
    messagesSinceInteraction,
    minutesSinceInteraction: minutesSinceInteraction == null ? null : round(minutesSinceInteraction),
    recency,
    interestBoost: Math.round(32 * recency * suppression),
    interestMultiplier: suppression,
    unansweredBotStreak: unanswered,
    judgeEveryMessages: interpolateInterval(1, messageBaseline, messageDecay),
    judgeEveryMinutes: minuteBaseline === 0 ? 0 : interpolateInterval(1, minuteBaseline, timeDecay),
    baselineMessages: messageBaseline,
    baselineMinutes: minuteBaseline
  };
}

export function chooseQqReplyAddressing(event = {}, entries = [], {
  now = Date.now(),
  baseMessages = 20,
  baseMinutes = 5,
  random
} = {}) {
  const senderId = normalizeId(event.senderId);
  const explicit = Boolean(
    event.groupId
    && senderId
    && (event.type === "group_at" || event.hasSelfAtSegment || event.isReplyToSelf || event.replyContext?.isSelf)
  );
  if (!explicit) {
    return { mode: "plain", probability: 0, senderId: senderId || null, relationship: null };
  }

  const relationship = getQqRelationshipInterestPlan(entries, {
    senderId,
    now,
    baseMessages,
    baseMinutes
  });
  const distance = relationship.hasInteraction
    ? clamp(1 - relationship.recency, 0, 1)
    : 1;
  const probability = round(0.12 + distance * 0.8);
  const seed = [
    event.groupId,
    senderId,
    event.raw?.message_id || "",
    event.text || "",
    relationship.lastInteractionAt || "first"
  ].join(":");
  const choiceRoll = resolveFraction(random, `${seed}:address`);
  if (choiceRoll >= probability) {
    return { mode: "plain", probability, senderId, relationship };
  }

  const quoteShare = event.isReplyToSelf || event.replyContext?.isSelf ? 0.72 : 0.56;
  const mode = resolveFraction(random, `${seed}:mode`) < quoteShare ? "quote" : "mention";
  return { mode, probability, senderId, relationship };
}

function findLatestBotInteraction(entries, senderId) {
  if (!senderId) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] || {};
    if (!(entry.isAssistant || entry.senderId === "assistant")) continue;
    if (normalizeId(entry.replyTargetId) === senderId) return { ...entry, index };
    const previous = entries[index - 1] || {};
    if (normalizeId(previous.senderId) === senderId && !(previous.isAssistant || previous.senderId === "assistant")) {
      return { ...entry, index };
    }
  }
  return null;
}

function interpolateInterval(minimum, maximum, progress) {
  if (maximum <= minimum) return maximum;
  return clampInteger(Math.floor(minimum + (maximum - minimum) * clamp(progress, 0, 1)), minimum, maximum, maximum);
}

function resolveNow(value) {
  if (typeof value === "function") return resolveNow(value());
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function resolveFraction(random, seed) {
  if (typeof random === "function") {
    const value = Number(random(seed));
    if (Number.isFinite(value)) return clamp(value, 0, 0.999999);
  }
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
