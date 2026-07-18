const runtimeVersion = 1;
const maxGroups = 500;
const maxPendingMessages = 1_000;

export function createEmptyQqPeriodicRuntime() {
  return {
    version: runtimeVersion,
    ordinaryInterestByGroupId: Object.create(null)
  };
}

export function normalizeQqPeriodicRuntime(value) {
  const output = createEmptyQqPeriodicRuntime();
  const source = value?.ordinaryInterestByGroupId && typeof value.ordinaryInterestByGroupId === "object"
    ? value.ordinaryInterestByGroupId
    : {};
  const entries = Object.entries(source)
    .map(([groupId, cycle]) => normalizeCycle(groupId, cycle))
    .filter(Boolean)
    .sort((left, right) => Date.parse(left[1].updatedAt) - Date.parse(right[1].updatedAt))
    .slice(-maxGroups);
  output.ordinaryInterestByGroupId = Object.fromEntries(entries);
  return output;
}

export function updateQqOrdinaryInterestCycle(runtime, event, {
  pendingMessageCount = 0,
  cycleStartedAt,
  at = Date.now()
} = {}) {
  const normalized = normalizeQqPeriodicRuntime(runtime);
  const groupId = normalizeId(event?.groupId);
  if (!groupId) return normalized;
  const pending = boundedCount(pendingMessageCount);
  if (pending <= 0) {
    delete normalized.ordinaryInterestByGroupId[groupId];
    return normalized;
  }
  const latestEvent = normalizeEvent(event, groupId);
  if (!latestEvent) return normalized;
  const observedAt = toIsoDate(at);
  normalized.ordinaryInterestByGroupId[groupId] = {
    pendingMessageCount: pending,
    cycleStartedAt: toIsoDate(cycleStartedAt || latestEvent.proactiveObservedAtMs || at),
    updatedAt: observedAt,
    latestEvent
  };
  normalized.ordinaryInterestByGroupId = Object.fromEntries(
    Object.entries(normalized.ordinaryInterestByGroupId)
      .sort((left, right) => Date.parse(left[1].updatedAt) - Date.parse(right[1].updatedAt))
      .slice(-maxGroups)
  );
  return normalized;
}

export function clearQqOrdinaryInterestCycle(runtime, groupId = "") {
  const normalized = normalizeQqPeriodicRuntime(runtime);
  const id = normalizeId(groupId);
  if (id) delete normalized.ordinaryInterestByGroupId[id];
  else normalized.ordinaryInterestByGroupId = Object.create(null);
  return normalized;
}

export function restoreQqOrdinaryInterestCycles(runtime) {
  const normalized = normalizeQqPeriodicRuntime(runtime);
  return Object.entries(normalized.ordinaryInterestByGroupId).map(([groupId, cycle]) => ({
    groupId,
    pendingMessageCount: cycle.pendingMessageCount,
    cycleStartedAtMs: Date.parse(cycle.cycleStartedAt),
    event: {
      ...cycle.latestEvent,
      proactiveRestoredCatchUp: true
    }
  }));
}

export function summarizeQqPeriodicRuntime(runtime) {
  const normalized = normalizeQqPeriodicRuntime(runtime);
  const pending = Object.values(normalized.ordinaryInterestByGroupId);
  return {
    version: runtimeVersion,
    ordinaryInterestPendingGroups: pending.length,
    ordinaryInterestPendingMessages: pending.reduce(
      (sum, cycle) => sum + cycle.pendingMessageCount,
      0
    )
  };
}

function normalizeCycle(groupId, value) {
  const id = normalizeId(groupId);
  if (!id || !value || typeof value !== "object") return null;
  const pendingMessageCount = boundedCount(value.pendingMessageCount);
  const cycleStartedAt = validIsoDate(value.cycleStartedAt);
  const updatedAt = validIsoDate(value.updatedAt) || cycleStartedAt;
  const latestEvent = normalizeEvent(value.latestEvent, id);
  if (pendingMessageCount <= 0 || !cycleStartedAt || !updatedAt || !latestEvent) return null;
  return [id, { pendingMessageCount, cycleStartedAt, updatedAt, latestEvent }];
}

function normalizeEvent(value, groupId) {
  if (!value || typeof value !== "object" || normalizeId(value.groupId) !== groupId) return null;
  const observedAtMs = normalizeEpoch(value.proactiveObservedAtMs || value.observedAtMs || value.raw?.time * 1000);
  const selfId = normalizeId(value.selfId);
  const atTargets = normalizeIds(value.atTargets);
  const atMentions = (Array.isArray(value.atMentions) ? value.atMentions : [])
    .map((mention) => ({
      userId: normalizeId(mention?.userId ?? mention?.id),
      name: compactText(mention?.name ?? mention?.card ?? mention?.nickname, 80)
    }))
    .filter((mention) => mention.userId)
    .slice(0, 16);
  return {
    type: "group_message",
    groupId,
    senderId: normalizeId(value.senderId) || "0",
    senderName: compactText(value.senderName, 80),
    senderLabel: compactText(value.senderLabel || value.senderName, 80),
    text: compactText(value.text, 1_200),
    selfId: selfId || undefined,
    atTargets,
    atMentions,
    images: normalizeImages(value.images),
    hasAtSegment: Boolean(value.hasAtSegment || atTargets.length > 0),
    hasReplySegment: Boolean(value.hasReplySegment || value.replyContext),
    hasSelfAtSegment: Boolean(value.hasSelfAtSegment || selfId && atTargets.includes(selfId)),
    isReplyToSelf: Boolean(value.isReplyToSelf || value.replyContext?.isSelf),
    replyContext: normalizeReplyContext(value.replyContext),
    proactiveObservedAtMs: observedAtMs,
    proactiveSource: compactText(value.proactiveSource, 40) || "onebot",
    groupActivityVersion: boundedCount(value.groupActivityVersion),
    raw: {
      message_id: compactText(value.raw?.message_id, 120) || undefined,
      time: Math.floor(observedAtMs / 1000)
    }
  };
}

function normalizeReplyContext(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    senderId: normalizeId(value.senderId) || undefined,
    senderName: compactText(value.senderName, 80),
    isSelf: Boolean(value.isSelf),
    text: compactText(value.text, 800),
    images: normalizeImages(value.images)
  };
}

function normalizeImages(value) {
  return (Array.isArray(value) ? value : []).slice(0, 4).map((image) => ({
    file: compactText(image?.file, 240),
    url: compactText(image?.url, 1_200),
    summary: compactText(image?.summary, 160),
    contentType: compactText(image?.contentType, 80)
  })).filter((image) => image.file || image.url);
}

function normalizeIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeId).filter(Boolean))].slice(0, 16);
}

function normalizeId(value) {
  const id = String(value ?? "").trim();
  return /^\d{1,24}$/.test(id) ? id : "";
}

function boundedCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.min(maxPendingMessages, Math.floor(count))) : 0;
}

function normalizeEpoch(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function validIsoDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toIsoDate(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(String(value || ""));
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

function compactText(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
