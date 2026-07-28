import { updateQqConversationPersonAlias } from "../qq-conversation-memory.js";

const maxDetectedPeople = 12;

export function resolveQqMemoryPeople(memory = {}, event = {}) {
  const people = memory?.people && typeof memory.people === "object" ? memory.people : {};
  const directIds = collectDirectPersonIds(event);
  const query = collectIdentityQueryText(event);
  const textQqIds = new Set(
    [...query.matchAll(/(?<!\d)(\d{4,20})(?!\d)/g)]
      .map((match) => match[1])
      .filter((userId) => people[userId] && hasReusablePersonMemory(memory, userId))
  );
  const aliasOwners = new Map();

  for (const [userId, person] of Object.entries(people)) {
    if (!normalizeQqId(userId) || !hasReusablePersonMemory(memory, userId)) continue;
    for (const alias of collectPersonAliases(memory, userId, person)) {
      const key = normalizeAlias(alias);
      if (!isSearchableAlias(key)) continue;
      const owners = aliasOwners.get(key) || new Set();
      owners.add(userId);
      aliasOwners.set(key, owners);
    }
  }

  const inferredIds = new Set();
  if (query) {
    for (const [alias, owners] of aliasOwners) {
      if (owners.size !== 1 || !queryContainsAlias(query, alias)) continue;
      inferredIds.add([...owners][0]);
    }
  }

  const ids = [...new Set([...directIds, ...textQqIds, ...inferredIds])]
    .filter((id) => id && id !== normalizeQqId(event.selfId))
    .slice(0, maxDetectedPeople);
  return ids.map((userId) => describePerson(memory, userId, {
    detectedBy: directIds.has(userId)
      ? "identity"
      : textQqIds.has(userId)
        ? "qq-id"
        : "alias"
  }));
}

export function buildUnifiedPersonMemoryEntries(memory = {}, userId) {
  const normalizedUserId = normalizeQqId(userId);
  const person = memory?.people?.[normalizedUserId];
  if (!normalizedUserId || !isPromotedPerson(person)) return [];

  const aliases = collectPersonAliases(memory, normalizedUserId, person);
  const displayName = aliases.at(-1) || `QQ ${normalizedUserId}`;
  const entries = [{
    id: `qq-person-profile:${normalizedUserId}`,
    type: "personProfile",
    source: "qq_person_impression",
    channel: "qq",
    mode: "ai_promoted_person_profile",
    topic: `${displayName}的人物印象`,
    summary: compact(person.impressionSummary, 96),
    detail: compact(person.impressionDetail || person.impression, 1_200),
    confidence: 0.88,
    zone: "person",
    subjectChannel: "qq",
    subjectUserId: normalizedUserId,
    subjectAliases: aliases,
    promotionReason: compact(person.unifiedMemory?.reason, 160),
    promotedAt: person.unifiedMemory?.promotedAt || null,
    sourceScopeType: "person",
    sourceScopeId: `member:${normalizedUserId}`
  }];

  for (const [groupId, group] of Object.entries(memory?.groups || {})) {
    const scoped = group?.people?.[normalizedUserId];
    const summary = compact(scoped?.impressionSummary, 96);
    const detail = compact(scoped?.impressionDetail || scoped?.impression, 1_200);
    if (!summary && !detail) continue;
    entries.push({
      id: `qq-person-session:${normalizedUserId}:group:${groupId}`,
      type: "personSession",
      source: "qq_person_impression",
      channel: "qq",
      mode: "ai_promoted_person_session",
      topic: `${displayName}的群聊人物记忆`,
      summary: summary || summarize(detail),
      detail: detail || summary,
      confidence: 0.82,
      zone: "person",
      subjectChannel: "qq",
      subjectUserId: normalizedUserId,
      subjectAliases: aliases,
      promotionReason: compact(person.unifiedMemory?.reason, 160),
      promotedAt: person.unifiedMemory?.promotedAt || null,
      sourceScopeType: "group",
      sourceScopeId: String(groupId)
    });
  }

  const privateChat = memory?.privateChats?.[normalizedUserId];
  const privateSummary = compact(privateChat?.impressionSummary, 96);
  const privateDetail = compact(privateChat?.impressionDetail || privateChat?.impression, 1_200);
  if (privateSummary || privateDetail) {
    entries.push({
      id: `qq-person-session:${normalizedUserId}:private`,
      type: "personSession",
      source: "qq_person_impression",
      channel: "qq",
      mode: "ai_promoted_person_session",
      topic: `${displayName}的私聊人物记忆`,
      summary: privateSummary || summarize(privateDetail),
      detail: privateDetail || privateSummary,
      confidence: 0.84,
      zone: "person",
      subjectChannel: "qq",
      subjectUserId: normalizedUserId,
      subjectAliases: aliases,
      promotionReason: compact(person.unifiedMemory?.reason, 160),
      promotedAt: person.unifiedMemory?.promotedAt || null,
      sourceScopeType: "private",
      sourceScopeId: `private:${normalizedUserId}`
    });
  }

  return entries.filter((entry) => entry.summary || entry.detail);
}

export function listPromotedQqPersonIds(memory = {}) {
  return Object.entries(memory?.people || {})
    .filter(([userId, person]) => normalizeQqId(userId) && isPromotedPerson(person))
    .map(([userId]) => userId);
}

export function isPromotedQqPerson(memory = {}, userId) {
  return isPromotedPerson(memory?.people?.[normalizeQqId(userId)]);
}

export function applyQqPersonAliasToolCommand(memory, body, detectedPeople = []) {
  const normalized = String(body || "").trim();
  const people = Array.isArray(detectedPeople) ? detectedPeople : [];
  const listMatch = normalized.match(/^(?:列表|查看|list|show)\s+(\d{4,20})$/i);
  const addMatch = normalized.match(/^(?:添加|新增|add)\s+(\d{4,20})\s*\|\s*([\s\S]+)$/i);
  const removeMatch = normalized.match(/^(?:删除|移除|delete|remove)\s+(\d{4,20})\s*\|\s*([\s\S]+)$/i);
  const replaceMatch = normalized.match(/^(?:修改|替换|replace|edit)\s+(\d{4,20})\s*\|\s*([^|]+?)\s*\|\s*([\s\S]+)$/i);
  const match = listMatch || addMatch || removeMatch || replaceMatch;
  if (!match) {
    return {
      ok: false,
      reason: "invalid_format",
      reply: "人物别称格式：列表 QQ号；添加 QQ号 | 新别称；删除 QQ号 | 旧别称；修改 QQ号 | 旧别称 | 新别称。"
    };
  }
  const userId = match[1];
  const person = people.find((item) => item.userId === userId);
  if (!person) {
    return {
      ok: false,
      reason: "person_not_detected",
      reply: "只能维护本轮已按 QQ 号、引用、@ 或唯一别名识别到的人物。"
    };
  }
  if (listMatch) {
    return {
      ok: true,
      changed: false,
      userId,
      reply: `${person.displayName}（${userId}）的可识别别称：${person.aliases.length ? person.aliases.join("、") : "暂无"}。`
    };
  }
  const action = addMatch ? "add" : removeMatch ? "remove" : "replace";
  const result = updateQqConversationPersonAlias(memory, {
    userId,
    action,
    alias: match[2],
    replacement: replaceMatch ? match[3] : ""
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      reply: result.reason === "invalid_alias"
        ? "别称必须是 2–48 个字符，不能是纯 QQ 号，也不能包含敏感凭据。"
        : `人物别称更新失败：${result.reason || "未知原因"}`
    };
  }
  return {
    ok: true,
    changed: true,
    userId,
    memory: result.memory,
    person: result.person,
    reply: `已${action === "add" ? "添加" : action === "remove" ? "删除" : "修改"} ${userId} 的人物别称。当前可识别别称：${result.person.aliases.join("、") || "暂无"}。`
  };
}

export function selectDetectedQqMemoryPeople(people, selector) {
  const candidates = Array.isArray(people) ? people : [];
  if (!selector) return candidates;
  const numericId = String(selector).match(/^\d{4,20}$/)?.[0];
  if (numericId) return candidates.filter((person) => person.userId === numericId);
  const key = normalizeAlias(selector).replace(/\s+/g, "");
  const matches = candidates.filter((person) => (
    [person.displayName, ...(person.aliases || [])].some((alias) => (
      normalizeAlias(alias).replace(/\s+/g, "") === key
    ))
  ));
  return matches.length === 1 ? matches : [];
}

export function formatQqPersonMemorySource(item, currentScopeId) {
  if (item?.kind === "personProfile") return "统一人物";
  if (item?.kind === "personSession") {
    return item.metadata?.sourceScopeId === currentScopeId ? "当前会话" : "其他会话";
  }
  return "人物画像";
}

function describePerson(memory, userId, { detectedBy } = {}) {
  const person = memory?.people?.[userId] || {};
  const privateChat = memory?.privateChats?.[userId] || {};
  const aliases = collectPersonAliases(memory, userId, person);
  const summary = compact(
    person.impressionSummary || privateChat.impressionSummary || findScopedDescription(memory, userId, "summary"),
    96
  );
  const detail = compact(
    person.impressionDetail
      || person.impression
      || privateChat.impressionDetail
      || privateChat.impression
      || findScopedDescription(memory, userId, "detail"),
    1_200
  );
  return {
    userId,
    displayName: aliases.at(-1) || `QQ ${userId}`,
    aliases,
    summary,
    hasDetail: Boolean(detail),
    promoted: isPromotedPerson(person),
    detectedBy: detectedBy || "identity",
    sourceScopeIds: Array.isArray(person.unifiedMemory?.sourceScopeIds)
      ? person.unifiedMemory.sourceScopeIds.slice(-32)
      : []
  };
}

function collectDirectPersonIds(event) {
  const ids = new Set();
  addId(ids, event.senderId);
  addId(ids, event.replyContext?.senderId);
  for (const id of event.atTargets || []) addId(ids, id);
  for (const id of event.qqSemanticPersonIds || []) addId(ids, id);
  for (const queued of event.queuedEvents || []) {
    addId(ids, queued?.senderId);
    addId(ids, queued?.replyContext?.senderId);
    for (const id of queued?.atTargets || []) addId(ids, id);
  }
  ids.delete(normalizeQqId(event.selfId));
  return ids;
}

function collectIdentityQueryText(event) {
  return [
    event.text,
    event.replyContext?.text,
    ...(event.queuedEvents || []).map((entry) => entry?.text),
    ...(event.proactiveDecision?.replyContext || []).map((entry) => entry?.text)
  ].filter(Boolean).join("\n").normalize("NFKC").toLowerCase();
}

function collectPersonAliases(memory, userId, person = {}) {
  const values = [
    ...(person.aliases || []),
    ...(person.manualAliases || []),
    ...Object.values(person.groupAliases || {}).flatMap((aliases) => aliases || []),
    ...(memory?.privateChats?.[userId]?.aliases || [])
  ];
  for (const group of Object.values(memory?.groups || {})) {
    values.push(...(group?.people?.[userId]?.aliases || []));
  }
  const suppressed = new Set(
    (person.suppressedAliases || []).map((value) => normalizeAlias(value).replace(/\s+/g, ""))
  );
  return [...new Set(values
    .map((value) => compact(value, 48))
    .filter((value) => value && !suppressed.has(normalizeAlias(value).replace(/\s+/g, ""))))]
    .slice(-32);
}

function hasReusablePersonMemory(memory, userId) {
  const person = memory?.people?.[userId];
  const privateChat = memory?.privateChats?.[userId];
  if (person?.impressionSummary || person?.impressionDetail || person?.unifiedMemory?.promotedAt) return true;
  if (privateChat?.impressionSummary || privateChat?.impressionDetail) return true;
  return Object.values(memory?.groups || {}).some((group) => {
    const scoped = group?.people?.[userId];
    return Boolean(scoped?.impressionSummary || scoped?.impressionDetail);
  });
}

function findScopedDescription(memory, userId, field) {
  const suffix = field === "summary" ? "Summary" : "Detail";
  for (const group of Object.values(memory?.groups || {})) {
    const value = group?.people?.[userId]?.[`impression${suffix}`];
    if (value) return value;
  }
  return "";
}

function isPromotedPerson(person) {
  return Boolean(person?.unifiedMemory?.promotedAt);
}

function addId(set, value) {
  const id = normalizeQqId(value);
  if (id) set.add(id);
}

function normalizeQqId(value) {
  const id = String(value || "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function normalizeAlias(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/^@+/, "").trim();
}

function isSearchableAlias(value) {
  const length = [...String(value || "").replace(/\s+/g, "")].length;
  return /[\u3400-\u9fff]/u.test(value) ? length >= 2 : length >= 3;
}

function queryContainsAlias(query, alias) {
  if (/[\u3400-\u9fff]/u.test(alias) || /[^\p{L}\p{N}_]/u.test(alias)) {
    return query.replace(/\s+/g, "").includes(alias.replace(/\s+/g, ""));
  }
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(query);
}

function summarize(value) {
  const text = compact(value, 1_200);
  return compact(text.split(/(?<=[。！？!?；;])\s*/u).find(Boolean) || text, 96);
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
