import { normalizeQqOfficialRobotMarker } from "./qq-robot-profile.js";

export async function fetchQqHistoryForSummary({
  event,
  callAction,
  maxMessages = 300,
  pageSize = 100,
  maxPages = 8
} = {}) {
  const groupId = normalizeId(event?.groupId);
  const userId = normalizeId(event?.senderId);
  const endpoint = groupId ? "get_group_msg_history" : "get_friend_msg_history";
  const peerKey = groupId ? "group_id" : "user_id";
  const peerId = groupId || userId;
  if (!peerId || typeof callAction !== "function") {
    return { ok: false, messages: [], source: "local-fallback", reason: "missing peer" };
  }
  const requestedLimit = Math.max(1, Math.min(600, Number(maxMessages) || 300));
  const boundedPageSize = Math.max(1, Math.min(100, Number(pageSize) || 100));
  const collected = new Map();
  let cursor = "0";
  let pages = 0;
  let lastError = "";
  while (collected.size < requestedLimit && pages < Math.max(1, Number(maxPages) || 8)) {
    const count = Math.min(boundedPageSize, requestedLimit - collected.size);
    const result = await callAction(endpoint, {
      [peerKey]: peerId,
      message_seq: cursor,
      count,
      reverse_order: false,
      disable_get_url: true,
      parse_mult_msg: true
    }).catch((error) => ({ ok: false, error: error.message }));
    if (!result?.ok) {
      lastError = result?.error || result?.body?.message || "history request failed";
      break;
    }
    const rawMessages = extractOneBotHistoryMessages(result.body);
    if (!rawMessages.length) break;
    pages += 1;
    let added = 0;
    for (const raw of rawMessages) {
      const normalized = normalizeOneBotHistoryMessage(raw, event);
      if (!normalized) continue;
      const key = historyMessageKey(normalized);
      if (!collected.has(key)) {
        collected.set(key, normalized);
        added += 1;
      }
    }
    const nextCursor = findOldestHistoryCursor(rawMessages);
    if (!nextCursor || nextCursor === cursor || added === 0 || rawMessages.length < count) break;
    cursor = nextCursor;
  }
  const messages = [...collected.values()]
    .sort(compareHistoryMessages)
    .slice(-requestedLimit);
  return {
    ok: messages.length > 0,
    messages,
    source: messages.length > 0 ? "onebot-history" : "local-fallback",
    pages,
    reason: lastError
  };
}

export function mergeQqHistoryMessages(remote = [], local = [], { limit = 600 } = {}) {
  const merged = new Map();
  for (const entry of [...remote, ...local]) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = {
      ...entry,
      messageId: entry.messageId == null ? undefined : String(entry.messageId),
      senderId: entry.senderId == null ? "" : String(entry.senderId),
      text: compactText(entry.text, 2_000),
      at: normalizeMessageTime(entry.at || entry.time)
    };
    const key = historyMessageKey(normalized);
    if (!merged.has(key)) merged.set(key, normalized);
    else merged.set(key, { ...merged.get(key), ...normalized });
  }
  return [...merged.values()]
    .sort(compareHistoryMessages)
    .slice(-Math.max(1, Math.min(1_000, Number(limit) || 600)));
}

export function extractOneBotHistoryMessages(body) {
  const candidates = [
    body?.data?.messages,
    body?.messages,
    body?.data?.message_list,
    body?.message_list
  ];
  return candidates.find(Array.isArray) || [];
}

export function normalizeOneBotHistoryMessage(raw, event = {}) {
  if (!raw || typeof raw !== "object") return null;
  const senderId = normalizeId(raw.user_id || raw.sender?.user_id || raw.sender?.uin);
  const selfId = normalizeId(event.selfId);
  const message = raw.message ?? raw.raw_message ?? "";
  const segments = Array.isArray(message) ? message : [];
  const text = compactText(
    raw.raw_message || formatOneBotSegments(segments) || (typeof message === "string" ? message : ""),
    2_000
  );
  if (!text && !segments.some((segment) => segment?.type === "image")) return null;
  const atTargets = segments
    .filter((segment) => segment?.type === "at")
    .map((segment) => normalizeId(segment?.data?.qq))
    .filter(Boolean);
  const officialRobotMarker = normalizeQqOfficialRobotMarker(
    raw.sender?.is_robot,
    raw.sender?.isRobot,
    raw.is_robot,
    raw.isRobot
  );
  return {
    at: normalizeMessageTime(raw.time || raw.timestamp),
    messageId: raw.message_id == null ? (raw.id == null ? undefined : String(raw.id)) : String(raw.message_id),
    messageSeq: raw.message_seq == null ? (raw.seq == null ? undefined : String(raw.seq)) : String(raw.message_seq),
    senderId,
    senderLabel: compactText(raw.sender?.card || raw.sender?.nickname || raw.sender?.name || senderId || "群友", 80),
    senderName: compactText(raw.sender?.nickname || raw.sender?.card || "", 80),
    ...(officialRobotMarker === undefined ? {} : { officialRobotMarker }),
    selfId,
    isAssistant: Boolean(senderId && selfId && senderId === selfId),
    text: text || "（图片消息）",
    atTargets,
    atMentions: atTargets.map((userId) => ({ userId }))
  };
}

function formatOneBotSegments(segments) {
  return segments.map((segment) => {
    const type = String(segment?.type || "").toLowerCase();
    const data = segment?.data || {};
    if (type === "text") return data.text || "";
    if (type === "at") return `@${data.name || data.qq || "成员"}`;
    if (type === "image") return `[图片${data.summary ? `：${data.summary}` : ""}]`;
    if (type === "face") return "[表情]";
    if (type === "reply") return "";
    if (type === "record") return "[语音]";
    if (type === "video") return "[视频]";
    if (type === "file") return `[文件：${data.file || data.name || ""}]`;
    if (type === "forward") return "[合并转发]";
    return "";
  }).join("");
}

function findOldestHistoryCursor(messages) {
  const candidates = messages
    .map((message) => ({
      cursor: message?.message_seq ?? message?.seq ?? message?.message_id ?? message?.id,
      time: Number(message?.time || message?.timestamp || 0)
    }))
    .filter((item) => item.cursor != null && String(item.cursor) !== "0")
    .sort((left, right) => left.time - right.time);
  return candidates.length ? String(candidates[0].cursor) : "";
}

function historyMessageKey(entry) {
  if (entry.messageId) return `id:${entry.messageId}`;
  return `content:${entry.at || ""}:${entry.senderId || ""}:${compactText(entry.text, 320)}`;
}

function compareHistoryMessages(left, right) {
  const timeDiff = Date.parse(left.at || "") - Date.parse(right.at || "");
  if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
  return Number(left.messageSeq || 0) - Number(right.messageSeq || 0);
}

function normalizeMessageTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function compactText(value, limit) {
  return String(value || "")
    .replace(/\[CQ:image,[^\]]*\]/gi, "[图片]")
    .replace(/\[CQ:face,[^\]]*\]/gi, "[表情]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
