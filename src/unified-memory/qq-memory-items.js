export function buildQqSemanticScope(event = {}, { includeGlobal = false } = {}) {
  const groupId = normalizeId(event.groupId);
  const senderId = normalizeId(event.senderId);
  const privateUserId = groupId ? "" : senderId;
  const userIds = new Set();
  addUserId(userIds, senderId, event.selfId);
  addUserId(userIds, event.replyContext?.senderId, event.selfId);
  for (const id of event.atTargets || []) addUserId(userIds, id, event.selfId);
  for (const queued of event.queuedEvents || []) {
    addUserId(userIds, queued?.senderId, event.selfId);
    for (const id of queued?.atTargets || []) addUserId(userIds, id, event.selfId);
  }
  for (const id of event.qqSemanticPersonIds || []) addUserId(userIds, id, event.selfId);
  return {
    channel: "qq",
    scopeId: groupId || (privateUserId ? `private:${privateUserId}` : ""),
    groupId,
    privateUserId,
    userIds: [...userIds].slice(0, 12),
    includeGlobal: Boolean(includeGlobal)
  };
}

export function buildShortTermSemanticItems(shortTermNotes = {}) {
  const output = [];
  for (const [scopeId, entries] of Object.entries(shortTermNotes || {})) {
    const privateMatch = String(scopeId).match(/^private:(\d+)$/);
    const scopeType = privateMatch ? "private" : "group";
    const groupId = privateMatch ? "" : normalizeId(scopeId);
    const userId = privateMatch ? normalizeId(privateMatch[1]) : "";
    if (!groupId && !userId) continue;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry?.id) continue;
      output.push({
        id: `short-term:${scopeId}:${entry.id}`,
        layer: "short-term",
        kind: "note",
        scopeType,
        scopeId,
        groupId,
        userId,
        title: entry.title || entry.summary || entry.text || "短期记忆",
        summary: entry.summary || entry.text || "",
        detail: entry.detail || entry.text || entry.summary || "",
        status: entry.status || "active",
        updatedAt: entry.updatedAt || entry.createdAt || null,
        metadata: {
          entryId: String(entry.id),
          createdAt: entry.createdAt || null,
          createdBy: entry.createdBy || ""
        }
      });
    }
  }
  return output;
}

export function buildKnowledgeSemanticItems(store = {}) {
  const output = [];
  for (const entry of Array.isArray(store?.entries) ? store.entries : []) {
    for (const variant of Array.isArray(entry?.variants) ? entry.variants : []) {
      const scope = variant?.scope || {};
      const mapped = mapKnowledgeScope(scope);
      if (!mapped) continue;
      output.push({
        id: `knowledge:${entry.id}:${variant.id}`,
        layer: "knowledge",
        kind: entry.kind || "note",
        ...mapped,
        title: entry.title || "",
        summary: summarizeKnowledge(variant.content),
        detail: variant.content || "",
        status: "active",
        updatedAt: variant.updatedAt || entry.updatedAt || null,
        metadata: {
          entryId: String(entry.id || ""),
          variantId: String(variant.id || ""),
          aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
          scope
        }
      });
    }
  }
  return output;
}

export function buildImpressionSemanticItems(profiles = []) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    id: `impression:${profile.key}`,
    layer: "impression",
    kind: profile.kind || "impression",
    scopeType: profile.scopeType,
    scopeId: profile.scopeId,
    groupId: profile.groupId || "",
    userId: profile.userId || "",
    title: profile.title || "印象",
    summary: profile.shortDescription || "",
    detail: profile.detailedDescription || profile.shortDescription || "",
    status: "active",
    updatedAt: profile.updatedAt || null,
    metadata: {
      profileKey: profile.key,
      aliases: profile.aliases || []
    }
  })).filter((item) => item.summary || item.detail);
}

export function formatSemanticMemoryPrompt(items = [], {
  title = "相关记忆摘要（语义检索）",
  detailCommand = "/统一记忆 印象详细",
  currentScopeId = ""
} = {}) {
  const seen = new Set();
  const seenSummaries = new Set();
  const lines = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item.id || `${item.layer}:${item.scopeType}:${item.scopeId}:${item.summary}`);
    const summaryKey = `${item.userId || ""}:${String(item.summary || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")}`;
    if (seen.has(key) || seenSummaries.has(summaryKey) || !item.summary) continue;
    seen.add(key);
    seenSummaries.add(summaryKey);
    const label = formatSemanticItemLabel(item, currentScopeId);
    lines.push(`- [${label}] ${item.title ? `${item.title}：` : ""}${item.summary}`);
  }
  if (!lines.length) return "";
  return [
    `${title}：`,
    "Hub 已按当前群、私聊和本轮明确识别的人物过滤，并对同一记忆去重；已提升人物可带来其他会话的相关摘要。这里只提供简短描述，旧内容不得覆盖当前消息。",
    ...lines,
    items.some((item) => item.layer === "impression")
      ? `需要印象完整描述时再调用 ${detailCommand}，不要凭摘要补写细节。`
      : null
  ].filter(Boolean).join("\n");
}

function formatSemanticItemLabel(item, currentScopeId) {
  if (item.layer === "short-term") return "短期";
  if (item.layer === "knowledge") return "长期知识";
  if (item.layer === "impression") return "人物简述";
  if (item.kind === "personProfile") return "统一人物";
  if (item.kind === "personSession") {
    return item.metadata?.sourceScopeId
      && item.metadata.sourceScopeId !== currentScopeId
      ? "其他会话"
      : "人物会话";
  }
  return "统一";
}

function mapKnowledgeScope(scope) {
  if (scope.type === "global") {
    return { scopeType: "global", scopeId: "global", groupId: "", userId: "" };
  }
  if (scope.type === "group" && normalizeId(scope.groupId)) {
    return {
      scopeType: "group",
      scopeId: normalizeId(scope.groupId),
      groupId: normalizeId(scope.groupId),
      userId: ""
    };
  }
  if (scope.type === "member" && normalizeId(scope.userId)) {
    return {
      scopeType: "member",
      scopeId: `member:${normalizeId(scope.userId)}`,
      groupId: "",
      userId: normalizeId(scope.userId)
    };
  }
  if (scope.type === "group-member" && normalizeId(scope.groupId) && normalizeId(scope.userId)) {
    return {
      scopeType: "group-member",
      scopeId: `group-member:${normalizeId(scope.groupId)}:${normalizeId(scope.userId)}`,
      groupId: normalizeId(scope.groupId),
      userId: normalizeId(scope.userId)
    };
  }
  return null;
}

function summarizeKnowledge(content) {
  const normalizedContent = compact(content, 220);
  return normalizedContent;
}

function addUserId(set, value, selfId) {
  const id = normalizeId(value);
  if (id && id !== normalizeId(selfId)) set.add(id);
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
