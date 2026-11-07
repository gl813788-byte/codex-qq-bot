// Planned chats: the daily routine decides whom the Bot reaches out to and
// roughly why ("找流光问问拔牙怎么样了", "把下午刷到的视频分享到群里"),
// the same way it plans watching videos or drawing. A routine segment of
// kind "chat" names one contact from the candidates offered to the planner.
// When the segment comes, the Hub runs the ordinary proactive path for that
// contact: the interest model still confirms that now is a good moment, and
// the main model reads the real conversation and may stay silent. The plan
// is only an intention.
//
// Privacy: candidates carry names, relationship labels and timing, never
// message text. A chat segment's contact and plan are shown only inside the
// conversation it targets; everywhere else it reads as a generic activity.

export const QQ_PLANNED_CHATS_PER_DAY_MAX = 3;
const MAX_PRIVATE_CANDIDATES = 8;
const MAX_GROUP_CANDIDATES = 6;
const CANDIDATE_DAYS = 21;
// A contact who left the Bot's last messages unanswered this many times is
// not pestered by a plan either.
const MAX_UNANSWERED_FOR_PLANNED_CHAT = 2;

export function qqPlannedChatScopeId(contact) {
  const value = normalizeQqPlannedChatContact(contact);
  if (!value) return "";
  return value.startsWith("private:") ? value : value.slice("group:".length);
}

export function normalizeQqPlannedChatContact(value, allowed = null) {
  const match = String(value || "").trim().toLowerCase().match(/^(private|group):([1-9]\d{4,12})$/);
  if (!match) return "";
  const contact = `${match[1]}:${match[2]}`;
  if (allowed && !allowed.has(contact)) return "";
  return contact;
}

// Recent private contacts and allowed groups, most relevant first. Only
// labels, relationship and timing go to the planner.
export function collectQqPlannedChatCandidates({
  recentMessages = {},
  allowedGroups = [],
  bannedUserIds = [],
  groupName = () => "",
  relationship = () => null,
  activeHours = () => "",
  now = Date.now()
} = {}) {
  const banned = new Set((bannedUserIds || []).map(String));
  const cutoff = now - CANDIDATE_DAYS * 86_400_000;
  const privates = [];
  for (const [scopeId, entries] of Object.entries(recentMessages || {})) {
    if (!scopeId.startsWith("private:") || !Array.isArray(entries) || !entries.length) continue;
    const userId = scopeId.slice("private:".length);
    if (!/^[1-9]\d{4,12}$/.test(userId) || banned.has(userId)) continue;
    const human = [...entries].reverse().find((entry) => entry && !entry.isAssistant && entry.senderId !== "assistant");
    if (!human) continue;
    const lastAt = Date.parse(entries.at(-1)?.at || "") || 0;
    if (lastAt < cutoff) continue;
    const relation = relationship(userId) || {};
    privates.push({
      contact: `private:${userId}`,
      type: "private",
      id: userId,
      name: compact(relation.nickname || human.senderLabel || human.senderName || `QQ ${userId}`, 24),
      relation: [relation.levelLabel, relation.familiarityLabel].filter(Boolean).join("、"),
      affinity: Number(relation.affinity || 0),
      lastAt,
      lastFromBot: Boolean(entries.at(-1)?.isAssistant || entries.at(-1)?.senderId === "assistant"),
      activeHours: compact(activeHours(scopeId), 20)
    });
  }
  privates.sort((left, right) => (right.affinity - left.affinity) || (right.lastAt - left.lastAt));
  const groups = [];
  for (const groupId of allowedGroups || []) {
    const id = String(groupId || "");
    if (!/^[1-9]\d{4,12}$/.test(id)) continue;
    const entries = Array.isArray(recentMessages?.[id]) ? recentMessages[id] : [];
    const lastAt = Date.parse(entries.at(-1)?.at || "") || 0;
    if (!entries.length || lastAt < cutoff) continue;
    groups.push({
      contact: `group:${id}`,
      type: "group",
      id,
      name: compact(groupName(id) || `群 ${id}`, 24),
      lastAt,
      lastFromBot: Boolean(entries.at(-1)?.isAssistant || entries.at(-1)?.senderId === "assistant"),
      activeHours: compact(activeHours(id), 20)
    });
  }
  groups.sort((left, right) => right.lastAt - left.lastAt);
  return {
    privates: privates.slice(0, MAX_PRIVATE_CANDIDATES),
    groups: groups.slice(0, MAX_GROUP_CANDIDATES)
  };
}

export function listQqPlannedChatContacts(candidates = {}) {
  return new Set([...(candidates.privates || []), ...(candidates.groups || [])].map((item) => item.contact));
}

export function formatQqPlannedChatCandidates(candidates = {}, { now = Date.now() } = {}) {
  const line = (item) => {
    const facts = [
      item.type === "private" ? "私聊" : "群聊",
      item.relation ? `你对 TA：${item.relation}` : null,
      item.lastAt ? `上次${item.type === "private" ? "聊天" : "有人说话"}：${formatAge(now - item.lastAt)}${item.lastFromBot ? "（最后一条是你发的，还没回）" : ""}` : null,
      item.activeHours ? `常在线：${item.activeHours}` : null
    ].filter(Boolean).join("；");
    return `- ${item.contact} ${item.name}（${facts}）`;
  };
  const lines = [...(candidates.privates || []).map(line), ...(candidates.groups || []).map(line)];
  return lines.length ? lines.join("\n") : "";
}

// Hard reasons not to reach out even though it was planned: the person is
// already talking with the Bot, keeps not answering, or it is outside the
// hours they (or the group) are usually around. Everything softer is left to
// the interest model and the main model.
export function getQqPlannedChatBlocker({ type = "private", adaptivePlan = {} } = {}) {
  if (Number(adaptivePlan.unansweredBotStreak || 0) >= MAX_UNANSWERED_FOR_PLANNED_CHAT) return "unanswered_streak";
  if (adaptivePlan.reason === "no_human_context") return "no_human_context";
  if (adaptivePlan.reason === "outside_social_hours") return "outside_social_hours";
  if (type === "private" && adaptivePlan.reason === "private_too_soon") return "already_talking";
  return null;
}

// What the interest model sees about the plan: the intention only.
export function summarizeQqPlannedChatForJudge(segment = {}) {
  return {
    source: "daily_routine",
    activity: compact(segment.activity, 40),
    intention: compact(segment.plan, 60),
    window: segment.start && segment.end ? `${segment.start}-${segment.end}` : ""
  };
}

export function formatQqPlannedChatPrompt({ segment = {}, type = "private", groupActive = false } = {}) {
  const intention = compact(segment.plan, 60);
  return [
    `【本轮任务：你今天计划好的主动${type === "private" ? "私聊" : "群聊"}】`,
    `按你自己的作息，现在（${segment.start || "?"}-${segment.end || "?"}）你打算「${compact(segment.activity, 40)}」，具体想法：${intention || "随便聊聊"}。兴趣模型也确认了现在可以开口；当前没有人刚给你发消息。`,
    "计划只是你早上的打算，不是台词：先读真实的最近记录和对方近况，再决定此刻怎么开口最自然，也可以换个更合适的由头。分享东西时直接把东西给出来：歌发音乐卡片、B站视频发视频卡片（qq_message），自己的经历和链接在 qq_self.state 里。",
    type === "private"
      ? "不问“在吗”，不催回复，不提“我计划了要找你”。对方这一轮没有说话，affinity.delta 填 0、nickname 留空。"
      : groupActive
        ? "群里此刻有人在聊；只有你的话能自然插进去或单独成立时才说，不要打断别人正在进行的对话。"
        : "群里现在比较安静；给一个自足、别人容易接住的开场，不要提群冷或后台判断。",
    "主模型保留最终静默权：读完上下文发现不合适（对方在忙、话题不对、会显得打扰），就把 status 设为 silent。"
  ].join("\n");
}

// A routine segment as seen from one conversation: a chat plan for someone
// else stays a generic activity.
export function describeQqRoutineSegmentForScope(segment = {}, scopeId = "") {
  if (segment.kind !== "chat") return segment.activity;
  if (scopeId && qqPlannedChatScopeId(segment.contact) === scopeId) return segment.activity;
  return String(segment.contact || "").startsWith("group:") ? "去群里冒个泡" : "找朋友聊聊天";
}

function formatAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function compact(value, max) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}
