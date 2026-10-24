import { formatQqIdentity } from "./channels/qq/mention-identities.js";
import { createQqContextSemanticScorer } from "./qq-context-relevance.js";
import { describeQqCrossSessionScope } from "./qq-cross-session.js";
import { formatQqContextTime } from "./qq-context-time.js";
import { createQqCqCodePattern } from "./qq-message-content.js";

const maxQueryTerms = 8;
const maxResultLimit = 40;
const maxContextLines = 3;
const scanYieldEvery = 64;

export function canSearchQqCrossSessionScope(scopeId, { privileged = false, requesterId = "" } = {}) {
  const normalized = String(scopeId || "");
  if (/^[1-9][0-9]{3,19}$/.test(normalized)) return true;
  const privateMatch = normalized.match(/^private:([1-9][0-9]{4,12})$/);
  if (!privateMatch) return false;
  return Boolean(privileged) || (Boolean(requesterId) && privateMatch[1] === String(requesterId));
}

export function parseQqCrossSessionSearchTerms(query) {
  return [...new Set(normalizeSearchText(query)
    .split(/[\s,，、;；|]+/)
    .map((term) => term.trim())
    .filter(Boolean))]
    .slice(0, maxQueryTerms);
}

// Chat-history tool queries may carry structured filters ahead of the free-text query, for
// example "人物:12345 会话:group:67890 上下文:2 原神".
export function parseQqHistorySearchQuery(text) {
  let userId = "";
  let scopeSelector = "";
  let contextLines = 0;
  const rest = [];
  for (const token of String(text || "").trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^(人物|会话|上下文)[:：](.+)$/);
    if (match?.[1] === "人物" && /^[1-9][0-9]{4,12}$/.test(match[2])) userId = match[2];
    else if (match?.[1] === "会话") scopeSelector = match[2];
    else if (match?.[1] === "上下文" && /^[0-9]+$/.test(match[2])) contextLines = Math.min(maxContextLines, Number(match[2]));
    else rest.push(token);
  }
  return { userId, scopeSelector, contextLines, query: rest.join(" ") };
}

// Resolves one or more requested sessions (selectors, bare ids, group names or private contact
// names) among the scopes this requester may search. Names only match permitted scopes, so an
// ordinary requester cannot probe whether someone else's private chat exists.
export function resolveQqHistorySearchScopes(source = {}, selectorText, {
  privileged = false,
  requesterId = "",
  currentScopeId = "",
  maxScopes = 5
} = {}) {
  const permission = { privileged, requesterId };
  const candidates = Object.entries(source.recentMessages || {})
    .filter(([scopeId, entries]) => isSearchableScopeId(scopeId)
      && Array.isArray(entries) && entries.length > 0
      && canSearchQqCrossSessionScope(scopeId, permission))
    .map(([scopeId]) => describeQqCrossSessionScope(source, scopeId, { currentScopeId }))
    .sort((left, right) => Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0));
  const resolved = [];
  const ambiguous = [];
  const missing = [];
  const denied = [];
  const accept = (scopeId) => {
    if (!canSearchQqCrossSessionScope(scopeId, permission)) denied.push(scopeId);
    else resolved.push(scopeId);
  };
  const tokens = String(selectorText || "").split(/[,，、;；|]+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^(?:current|当前|本会话)$/.test(lower)) {
      if (currentScopeId) resolved.push(currentScopeId);
      continue;
    }
    const privateMatch = lower.match(/^(?:private|私聊):([1-9][0-9]{4,12})$/);
    const groupMatch = lower.match(/^(?:group|群):([1-9][0-9]{3,19})$/);
    if (privateMatch || groupMatch) {
      accept(privateMatch ? `private:${privateMatch[1]}` : groupMatch[1]);
      continue;
    }
    if (/^[1-9][0-9]{3,19}$/.test(lower)) {
      const matches = candidates.filter((scope) => scope.scopeId === lower || scope.scopeId === `private:${lower}`);
      if (matches.length === 1) resolved.push(matches[0].scopeId);
      else if (matches.length > 1) ambiguous.push({ token, candidates: matches });
      else missing.push(token);
      continue;
    }
    const key = normalizeScopeName(token);
    const named = candidates.filter((scope) => scopeNames(scope).some((name) => name.includes(key)));
    const exact = named.filter((scope) => scopeNames(scope).some((name) => name === key));
    if (exact.length === 1 || named.length === 1) resolved.push((exact.length === 1 ? exact : named)[0].scopeId);
    else if (named.length > 1) ambiguous.push({ token, candidates: named.slice(0, 8) });
    else missing.push(token);
  }
  const scopeIds = [...new Set(resolved)];
  return {
    scopeIds: scopeIds.slice(0, Math.max(1, Number(maxScopes) || 5)),
    truncated: scopeIds.length > Math.max(1, Number(maxScopes) || 5),
    ambiguous,
    missing,
    denied: [...new Set(denied)],
    candidates
  };
}

export function formatQqHistoryScopeResolutionNotice(resolution = {}, { includeCandidates = false } = {}) {
  const lines = [];
  for (const item of resolution.ambiguous || []) {
    lines.push(`「${item.token}」对应多个会话，请改用选择器：${item.candidates.map((scope) => `${scope.selector}（${scope.label}）`).join("、")}`);
  }
  if (resolution.missing?.length) {
    lines.push(`没有找到可检索的会话：${resolution.missing.map((token) => `「${token}」`).join("、")}`);
  }
  if (resolution.denied?.length) {
    lines.push(`${resolution.denied.join("、")} 是他人私聊，只有主人或 Bot 管理员可以检索。`);
  }
  if (resolution.truncated) lines.push(`一次最多指定 ${resolution.scopeIds.length} 个会话，其余已忽略。`);
  if (includeCandidates && resolution.candidates?.length) {
    lines.push("本轮可检索的会话：");
    lines.push(...resolution.candidates.slice(0, 15).map((scope) => `- ${scope.selector} · ${scope.label}${scope.current ? " · 当前会话" : ""}`));
  }
  return lines.join("\n");
}

export function isQqHistoryWindowQuery(query) {
  const text = String(query || "").trim();
  return !text
    || /^(?:最近|last|latest)(?:\s*[0-9]{1,3}\s*(?:行|条)?)?$/i.test(text)
    || /^[0-9]{1,4}\s*(?:-|~|到|至|,|，|\s+)\s*[0-9]{1,4}$/.test(text);
}

// Chat-history tool flow: window reads and keyword/person searches, optionally limited to named
// sessions. Hub state access stays behind the injected callbacks.
export async function runQqHistorySearch(rawQuery, {
  source = {},
  eventScopeId = "",
  rootScopeId = eventScopeId,
  privileged = false,
  requesterId = "",
  readHistory,
  countHistoryMatches = () => 0,
  personLabel = () => "",
  onSearch = () => {},
  now = Date.now()
} = {}) {
  const parsed = parseQqHistorySearchQuery(rawQuery);
  let scopeIds = null;
  let notice = "";
  if (parsed.scopeSelector) {
    const resolution = resolveQqHistorySearchScopes(source, parsed.scopeSelector, {
      privileged,
      requesterId,
      currentScopeId: eventScopeId
    });
    notice = formatQqHistoryScopeResolutionNotice(resolution, {
      includeCandidates: resolution.scopeIds.length === 0
    });
    if (!resolution.scopeIds.length) return { ok: false, reply: notice || "没有指定可检索的会话。" };
    scopeIds = resolution.scopeIds;
  }
  const withNotice = (reply) => [notice, reply].filter(Boolean).join("\n\n");
  const onlyCurrent = scopeIds?.length === 1 && scopeIds[0] === eventScopeId;

  if (!parsed.userId && isQqHistoryWindowQuery(parsed.query)) {
    const sections = (scopeIds || [eventScopeId]).map((scopeId) => {
      const reply = readHistory(scopeId, parsed.query);
      if (!scopeIds || onlyCurrent) return reply;
      const scope = describeQqCrossSessionScope(source, scopeId, { currentScopeId: rootScopeId });
      return `【${scope.label} · ${scope.selector}${scope.current ? " · 当前会话" : ""}】\n${reply}`;
    });
    return { ok: true, reply: withNotice(sections.join("\n\n")) };
  }

  const startedAt = Date.now();
  const sections = [];
  let currentHitCount = 0;
  if (!parsed.userId && (!scopeIds || onlyCurrent)) {
    currentHitCount = countHistoryMatches(eventScopeId, parsed.query);
    sections.push(readHistory(eventScopeId, parsed.query));
    if (onlyCurrent) return { ok: true, reply: withNotice(sections.join("\n\n")) };
  }
  const result = await searchQqCrossSessionMessages(source, {
    query: parsed.query.slice(0, 200),
    userId: parsed.userId,
    scopeIds,
    excludeScopeIds: scopeIds || parsed.userId ? [] : [eventScopeId],
    privileged,
    requesterId,
    currentScopeId: rootScopeId,
    semantic: currentHitCount > 0 ? "off" : "fallback",
    contextLines: parsed.contextLines,
    limit: 24,
    perScopeLimit: scopeIds ? Math.ceil(24 / scopeIds.length) : 8,
    now
  });
  sections.push(formatQqCrossSessionSearchResult(result, {
    now,
    personLabel: parsed.userId ? personLabel(parsed.userId) : ""
  }));
  const singleTarget = scopeIds?.length === 1 ? scopeIds[0] : "";
  try {
    onSearch({
      outcome: !result.ok ? "rejected" : result.shownMatches + currentHitCount > 0 ? "success" : "no-match",
      targetScopeId: singleTarget,
      targetType: singleTarget ? (singleTarget.startsWith("private:") ? "private" : "group") : "all",
      durationMs: Math.max(0, Date.now() - startedAt),
      searchMode: result.mode || null,
      queryTermCount: result.terms?.length || 0,
      personFilter: Boolean(parsed.userId),
      requestedScopeCount: scopeIds?.length || 0,
      currentResultCount: currentHitCount,
      scannedScopeCount: result.scannedScopeCount || 0,
      matchedScopeCount: result.sessions?.length || 0,
      resultCount: result.shownMatches || 0,
      privacySkippedScopeCount: result.privacySkippedScopeCount || 0
    });
  } catch {
    // Logging must never change the tool result.
  }
  return { ok: result.ok !== false, reply: withNotice(sections.join("\n\n")) };
}

export async function searchQqCrossSessionMessages(source = {}, {
  query = "",
  userId = "",
  scopeIds = null,
  excludeScopeIds = [],
  privileged = false,
  requesterId = "",
  currentScopeId = "",
  semantic = "fallback",
  minSemanticScore = 0.18,
  recentPerScope = 200,
  maxAgeMs = 0,
  now = Date.now(),
  limit = 20,
  perScopeLimit = 8,
  contextLines = 0
} = {}) {
  const terms = parseQqCrossSessionSearchTerms(query);
  const personId = normalizeUserId(userId);
  const semanticQuery = String(query || "").replace(/\s+/g, " ").trim();
  if (!terms.length && !personId) return { ok: false, error: "跨会话搜索需要关键词或人物 QQ 号。" };

  const excluded = new Set((Array.isArray(excludeScopeIds) ? excludeScopeIds : []).map(String).filter(Boolean));
  const requested = Array.isArray(scopeIds) ? new Set(scopeIds.map(String)) : null;
  const oldestAt = Number(maxAgeMs) > 0 ? Number(now) - Number(maxAgeMs) : null;
  const scanLimit = Math.max(1, Math.min(1_000, Number(recentPerScope) || 200));
  const scopes = [];
  let privacySkippedScopeCount = 0;
  for (const [scopeId, entries] of Object.entries(source.recentMessages || {})) {
    if (!isSearchableScopeId(scopeId) || excluded.has(scopeId)) continue;
    if (requested && !requested.has(scopeId)) continue;
    if (!canSearchQqCrossSessionScope(scopeId, { privileged, requesterId })) {
      privacySkippedScopeCount += 1;
      continue;
    }
    if (Array.isArray(entries) && entries.length) scopes.push({ scopeId, entries });
  }

  // Local embeddings cost about a millisecond per uncached message on small hosts; yield so a
  // cold semantic scan never blocks OneBot intake.
  const collect = async (matcher) => {
    const hits = [];
    let scanned = 0;
    for (const { scopeId, entries } of scopes) {
      for (let index = Math.max(0, entries.length - scanLimit); index < entries.length; index += 1) {
        scanned += 1;
        if (scanned % scanYieldEvery === 0) await new Promise((resolve) => setImmediate(resolve));
        const entry = entries[index];
        if (!entry || typeof entry !== "object") continue;
        if (oldestAt != null && !(Date.parse(entry.at || "") >= oldestAt)) continue;
        const personMatch = personId ? matchQqCrossSessionPerson(entry, personId) : "";
        if (personId && !personMatch) continue;
        const match = matcher(entry);
        if (!match) continue;
        hits.push({
          scopeId,
          index,
          entry,
          score: match.score + (personMatch === "sender" ? 0.05 : 0),
          matchedBy: [...(personMatch ? [personMatch] : []), ...match.matchedBy]
        });
      }
    }
    return hits;
  };

  let mode = terms.length ? "keyword" : "person";
  let hits = [];
  if (terms.length && semantic !== "only") {
    hits = await collect((entry) => {
      const haystack = normalizeSearchText([
        entry.text,
        entry.senderLabel,
        entry.senderName,
        entry.replyContext?.text,
        entry.replyContext?.senderName
      ].filter(Boolean).join(" "));
      const matched = terms.filter((term) => haystack.includes(term));
      return matched.length ? { score: matched.length / terms.length, matchedBy: ["keyword"] } : null;
    });
  } else if (!terms.length) {
    hits = await collect(() => ({ score: 0, matchedBy: [] }));
  }
  if (semanticQuery && terms.length && semantic !== "off" && (semantic === "only" || hits.length === 0)) {
    const scoreRelevance = createQqContextSemanticScorer(semanticQuery);
    const threshold = Math.max(0.05, Math.min(1, Number(minSemanticScore) || 0.18));
    mode = "semantic";
    hits = await collect((entry) => {
      const text = compactText(entry.text, 400);
      if (normalizeSearchText(text).length < 4) return null;
      const relevance = scoreRelevance(text).score;
      return relevance >= threshold ? { score: relevance, matchedBy: ["semantic"] } : null;
    });
  }

  const ranked = hits.sort((left, right) => (
    right.score - left.score
    || Date.parse(right.entry.at || 0) - Date.parse(left.entry.at || 0)
    || right.index - left.index
  ));
  const boundedLimit = Math.max(1, Math.min(maxResultLimit, Number(limit) || 20));
  const boundedPerScope = Math.max(1, Math.min(boundedLimit, Number(perScopeLimit) || 8));
  const perScopeCount = new Map();
  const selected = [];
  for (const hit of ranked) {
    if (selected.length >= boundedLimit) break;
    const count = perScopeCount.get(hit.scopeId) || 0;
    if (count >= boundedPerScope) continue;
    perScopeCount.set(hit.scopeId, count + 1);
    selected.push(hit);
  }

  const radius = Math.max(0, Math.min(maxContextLines, Math.trunc(Number(contextLines) || 0)));
  const sessionOrder = [...new Set(selected.map((hit) => hit.scopeId))];
  const sessions = sessionOrder.map((scopeId) => {
    const entries = source.recentMessages[scopeId];
    const scopeHits = selected.filter((hit) => hit.scopeId === scopeId);
    const hitByIndex = new Map(scopeHits.map((hit) => [hit.index, hit]));
    const indexes = new Set();
    for (const hit of scopeHits) {
      for (let index = hit.index - radius; index <= hit.index + radius; index += 1) {
        if (index >= 0 && index < entries.length) indexes.add(index);
      }
    }
    return {
      ...describeQqCrossSessionScope(source, scopeId, { currentScopeId }),
      messageCount: entries.length,
      hitCount: scopeHits.length,
      lines: [...indexes].sort((left, right) => left - right).map((index) => {
        const hit = hitByIndex.get(index);
        return {
          ...summarizeEntry(entries[index]),
          line: index + 1,
          hit: Boolean(hit),
          ...(hit ? { matchedBy: hit.matchedBy, score: roundScore(hit.score) } : {})
        };
      })
    };
  });

  return {
    ok: true,
    mode,
    query: String(query || "").trim(),
    terms,
    userId: personId,
    scannedScopeCount: scopes.length,
    privacySkippedScopeCount,
    totalMatches: ranked.length,
    shownMatches: selected.length,
    sessions
  };
}

export function formatQqCrossSessionSearchResult(result = {}, {
  now = Date.now(),
  maxChars = 6_000,
  personLabel = ""
} = {}) {
  if (!result.ok) return result.error || "跨会话搜索失败。";
  const conditions = [
    result.terms?.length ? `关键词「${result.terms.join(" ")}」` : null,
    result.userId ? `人物 ${personLabel || `QQ ${result.userId}`}` : null,
    result.mode === "semantic" ? "无字面命中，改用语义近似" : null
  ].filter(Boolean).join("；");
  const lines = [
    `跨会话搜索（${conditions}）：检索 ${result.scannedScopeCount} 个会话，命中 ${result.totalMatches} 条${result.shownMatches < result.totalMatches ? `，展示前 ${result.shownMatches} 条` : ""}。`
  ];
  if (result.privacySkippedScopeCount > 0) {
    lines.push(`另有 ${result.privacySkippedScopeCount} 个他人私聊不在本轮检索范围内（只有主人或 Bot 管理员可检索他人私聊）。`);
  }
  if (!result.sessions?.length) {
    lines.push("没有找到匹配的聊天记录。");
    return lines.join("\n");
  }
  for (const session of result.sessions) {
    lines.push(`【${session.label} · ${session.selector}${session.current ? " · 当前会话" : ""}】缓冲共 ${session.messageCount} 行，命中 ${session.hitCount} 条：`);
    for (const line of session.lines) {
      const time = line.at ? formatQqContextTime(line.at, { now }) : "";
      const quote = line.quote ? `（引用 ${line.quote.speaker}：${line.quote.text}）` : "";
      const via = line.hit && line.matchedBy?.length ? ` [${line.matchedBy.map(formatMatchedBy).join("、")}]` : "";
      lines.push(`${line.hit ? "▶" : " ·"} 第${line.line}行 ${time} ${line.speaker}：${line.text}${quote}${via}`);
    }
  }
  lines.push("以上每条都标明了来源会话；引用时说明来自哪个会话，不要把其他会话的内容说成当前会话里发生的事。");
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 12)}\n…（已截断）` : text;
}

export async function buildQqInterestCrossSessionContext(source = {}, event = {}, {
  currentScopeId = "",
  query = "",
  personLimit = 6,
  topicLimit = 5,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
  minSemanticScore = 0.2,
  now = Date.now()
} = {}) {
  const requesterId = normalizeUserId(event.senderId);
  // Background judges never read third-party private chats, even for privileged senders.
  const shared = {
    excludeScopeIds: [currentScopeId],
    privileged: false,
    requesterId,
    currentScopeId,
    maxAgeMs,
    now,
    perScopeLimit: 3
  };
  const person = requesterId
    ? await searchQqCrossSessionMessages(source, { ...shared, userId: requesterId, limit: personLimit })
    : null;
  const seen = new Set();
  const aboutSender = flattenInterestLines(person, { now, seen });
  const topicQuery = String(query || "").replace(/\s+/g, " ").trim();
  const topic = normalizeSearchText(topicQuery).length >= 4
    ? await searchQqCrossSessionMessages(source, {
      ...shared,
      query: topicQuery,
      semantic: "only",
      minSemanticScore,
      recentPerScope: 80,
      limit: topicLimit + personLimit
    })
    : null;
  const relatedElsewhere = flattenInterestLines(topic, { now, seen }).slice(0, topicLimit);
  if (!aboutSender.length && !relatedElsewhere.length) return null;
  return {
    aboutSender,
    relatedElsewhere,
    privacySkippedScopeCount: Math.max(person?.privacySkippedScopeCount || 0, topic?.privacySkippedScopeCount || 0)
  };
}

export function matchQqCrossSessionPerson(entry = {}, userId) {
  const id = String(userId || "");
  if (!id) return "";
  if (String(entry.senderId || "") === id) return "sender";
  const mentioned = [
    ...(Array.isArray(entry.atTargets) ? entry.atTargets : []),
    ...(Array.isArray(entry.atMentions) ? entry.atMentions.map((mention) => mention?.userId) : [])
  ].map(String);
  if (mentioned.includes(id)) return "mention";
  if (String(entry.replyContext?.senderId || "") === id) return "quote";
  return "";
}

function flattenInterestLines(result, { now, seen }) {
  if (!result?.ok) return [];
  return result.sessions.flatMap((session) => session.lines
    .filter((line) => line.hit)
    .map((line) => ({ session, line })))
    .filter(({ session, line }) => {
      const key = `${session.scopeId}:${line.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Date.parse(right.line.at || 0) - Date.parse(left.line.at || 0))
    .map(({ session, line }) => ({
      session: session.label,
      selector: session.selector,
      ...(line.at ? { time: formatQqContextTime(line.at, { now }) } : {}),
      sender: line.speaker,
      text: line.text.slice(0, 200),
      matchedBy: line.matchedBy || []
    }));
}

function summarizeEntry(entry = {}) {
  return {
    at: entry.at || null,
    senderId: entry.senderId == null ? "" : String(entry.senderId),
    speaker: entry.isAssistant || entry.senderId === "assistant"
      ? "Bot"
      : formatQqIdentity({ userId: entry.senderId, name: entry.senderName || entry.senderLabel }),
    text: compactText(entry.text, 300) || "（空消息）",
    ...(entry.replyContext?.text ? {
      quote: {
        speaker: entry.replyContext.isSelf
          ? "Bot"
          : formatQqIdentity({ userId: entry.replyContext.senderId, name: entry.replyContext.senderName }),
        text: compactText(entry.replyContext.text, 120)
      }
    } : {})
  };
}

function formatMatchedBy(value) {
  return {
    sender: "本人发言",
    mention: "被 @",
    quote: "被引用",
    keyword: "关键词",
    semantic: "语义近似"
  }[value] || value;
}

function scopeNames(scope) {
  const label = String(scope.label || "");
  return [
    label,
    label.replace(/^(?:群|私聊)\s+/, ""),
    label.replace(/^群\s+/, "").replace(/\([0-9]+\)$/, "")
  ].map(normalizeScopeName).filter(Boolean);
}

function normalizeScopeName(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function isSearchableScopeId(scopeId) {
  return /^private:[1-9][0-9]{4,12}$/.test(scopeId) || /^[1-9][0-9]{3,19}$/.test(scopeId);
}

function normalizeUserId(value) {
  const id = String(value ?? "").trim();
  return /^[1-9][0-9]{4,12}$/.test(id) ? id : "";
}

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function compactText(value, limit) {
  return String(value || "")
    .replace(createQqCqCodePattern("image", "gi"), "[图片]")
    .replace(createQqCqCodePattern("face", "gi"), "[表情]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
