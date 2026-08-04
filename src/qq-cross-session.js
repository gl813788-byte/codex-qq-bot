export function listQqCrossSessionScopes(source = {}, {
  query = "",
  limit = 30,
  currentScopeId = ""
} = {}) {
  const scopeIds = new Set([
    ...Object.keys(source.recentMessages || {}),
    ...Object.keys(source.exchanges || {}),
    ...Object.keys(source.shortTermNotes || {}),
    ...(source.allowedGroups || []).map(String),
    ...Object.keys(source.privateChats || {}).map((userId) => `private:${userId}`),
    ...Object.keys(source.people || {}).map((userId) => `private:${userId}`),
    ...Object.keys(source.threads || {})
  ]);
  if (currentScopeId) scopeIds.add(currentScopeId);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return [...scopeIds]
    .filter(isQqCrossSessionScopeId)
    .map((scopeId) => describeQqCrossSessionScope(source, scopeId, { currentScopeId }))
    .filter((scope) => !normalizedQuery || [scope.scopeId, scope.selector, scope.label]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0);
    })
    .slice(0, Math.max(1, Math.min(80, Number(limit) || 30)));
}

export function describeQqCrossSessionScope(source = {}, scopeId, { currentScopeId = "" } = {}) {
  const normalizedScopeId = String(scopeId || "");
  const privateMatch = normalizedScopeId.match(/^private:([1-9][0-9]{4,12})$/);
  const entries = source.recentMessages?.[normalizedScopeId] || [];
  const exchanges = source.exchanges?.[normalizedScopeId] || [];
  const lastActivityAt = [...entries, ...exchanges]
    .map((entry) => String(entry?.at || ""))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
  if (privateMatch) {
    const userId = privateMatch[1];
    const chat = source.privateChats?.[userId];
    const person = source.people?.[userId];
    const label = chat?.aliases?.at(-1) || person?.aliases?.at(-1) || person?.displayName || `QQ ${userId}`;
    return {
      scopeId: normalizedScopeId,
      selector: normalizedScopeId,
      kind: "private",
      label: `私聊 ${label}`,
      messageCount: entries.length,
      lastActivityAt: lastActivityAt || chat?.updatedAt || person?.updatedAt || null,
      contactOnly: !chat && entries.length === 0 && exchanges.length === 0,
      current: normalizedScopeId === currentScopeId
    };
  }
  const groupName = String(source.getGroupName?.(normalizedScopeId) || "");
  return {
    scopeId: normalizedScopeId,
    selector: `group:${normalizedScopeId}`,
    kind: "group",
    label: groupName ? `群 ${groupName}(${normalizedScopeId})` : `群 ${normalizedScopeId}`,
    messageCount: entries.length,
    lastActivityAt,
    current: normalizedScopeId === currentScopeId
  };
}

export function resolveQqCrossSessionScope(source = {}, selector, {
  currentScopeId = "",
  allowCurrent = true
} = {}) {
  const requested = String(selector || "").trim().toLowerCase();
  if (allowCurrent && (!requested || /^(current|当前|本会话)$/.test(requested))) return currentScopeId;
  const privateMatch = requested.match(/^private:([1-9][0-9]{4,12})$/);
  if (privateMatch) return `private:${privateMatch[1]}`;
  const groupMatch = requested.match(/^(?:group|群):([1-9][0-9]{3,19})$/);
  if (groupMatch) return groupMatch[1];
  if (/^[1-9][0-9]{3,19}$/.test(requested)) {
    const candidates = listQqCrossSessionScopes(source, {
      query: requested,
      limit: 80,
      currentScopeId
    }).filter((scope) => scope.scopeId === requested || scope.scopeId === `private:${requested}`);
    if (candidates.length === 1) return candidates[0].scopeId;
  }
  return "";
}

export function createQqCrossSessionEvent(source = {}, scopeId, rootEvent = {}) {
  const currentScopeId = source.currentScopeId || "";
  const scope = describeQqCrossSessionScope(source, scopeId, { currentScopeId });
  return {
    ...rootEvent,
    type: scope.kind === "group" ? "group_message" : "private_message",
    messageType: scope.kind === "group" ? "group" : "private",
    groupId: scope.kind === "group" ? scope.scopeId : "",
    groupName: scope.kind === "group" ? String(source.getGroupName?.(scope.scopeId) || "") : "",
    senderId: scope.kind === "private" ? scope.scopeId.slice("private:".length) : "",
    senderName: scope.kind === "private" ? scope.label.replace(/^私聊\s+/, "") : "",
    senderLabel: scope.kind === "private" ? scope.label.replace(/^私聊\s+/, "") : "",
    text: "",
    contentContext: null,
    replyContext: null,
    atMentions: [],
    atTargets: [],
    images: [],
    raw: {},
    isOwner: Boolean(rootEvent.isOwner),
    isBotAdmin: Boolean(rootEvent.isBotAdmin),
    qqCrossSessionScopeId: scope.scopeId,
    qqCrossSessionRootEvent: rootEvent
  };
}

function isQqCrossSessionScopeId(scopeId) {
  return /^private:[1-9][0-9]{4,12}$/.test(scopeId) || /^[1-9][0-9]{3,19}$/.test(scopeId);
}
