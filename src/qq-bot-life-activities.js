import {
  QQ_LIFE_ACTIVITY_KINDS,
  formatLocalDate,
  normalizeQqBotLifeState,
  normalizeQqLifeActivityKind,
  normalizeQqLifeActivityLedger,
  normalizeQqLifeExperiences,
  selectQqBotRoutineSegment
} from "./qq-bot-life-state.js";

export { QQ_LIFE_ACTIVITY_KINDS, normalizeQqLifeActivityKind, normalizeQqLifeActivityLedger, normalizeQqLifeExperiences };

const CONTEXT_HOURS = 14;

// The Bot actually does what its routine says it is doing. A routine segment
// may carry one concrete online plan (watch Bilibili videos on a topic,
// browse something it likes, visit friends' Qzone, post a mood, look up what
// it is curious about). Some minutes into such a segment the Hub opens one
// background sub-agent for it; the result becomes a dated first-person
// experience the Bot can mention naturally later. Experiences are real
// records of tool use, never invented offline events.

// The segment whose plan is due now, or null. A plan starts a stable
// 8-35 minutes into its segment so the Bot does not act on the minute.
// A planned chat (kind=chat) is not a sub-agent run: it has its own daily
// cap and is not spaced by the activity gap; the caller routes it to the
// proactive path (result.chat is true).
export function selectQqLifeActivityDue(lifeState, {
  now = Date.now(),
  timeZone = "Asia/Shanghai",
  enabled = true,
  dailyLimit = 6,
  minGapMinutes = 60,
  canDraw = false,
  chatLimit = 0
} = {}) {
  if (!enabled) return null;
  const life = normalizeQqBotLifeState(lifeState, { now, timeZone });
  const segment = selectQqBotRoutineSegment(life.routine, { now, timeZone });
  if (!segment || segment.kind === "none" || !segment.plan) return null;
  if (segment.kind === "draw" && !canDraw) return null;
  const ledger = normalizeQqLifeActivityLedger(life.activity, { now, timeZone });
  if (ledger.doneSegments.includes(segment.start)) return null;
  const chat = segment.kind === "chat";
  if (chat) {
    if (!segment.contact || ledger.chats >= Math.max(0, chatLimit)) return null;
  } else {
    if (ledger.runs >= Math.max(0, dailyLimit)) return null;
    const last = Date.parse(ledger.lastAt || "");
    if (Number.isFinite(last) && now - last < minGapMinutes * 60_000) return null;
  }
  const minutesIn = minutesSinceSegmentStart(segment, now, timeZone);
  const offset = 8 + Math.floor(stableFraction(`${life.routine.date}:${segment.start}`) * 28);
  if (minutesIn < offset) return null;
  return { segment, ledger, chat };
}

export function markQqLifeActivityStarted(lifeState, segment, { now = Date.now(), timeZone = "Asia/Shanghai" } = {}) {
  const life = normalizeQqBotLifeState(lifeState, { now, timeZone });
  const ledger = normalizeQqLifeActivityLedger(life.activity, { now, timeZone });
  if (segment?.kind === "chat") {
    ledger.chats += 1;
  } else {
    ledger.runs += 1;
    ledger.lastAt = new Date(now).toISOString();
  }
  if (segment?.start && !ledger.doneSegments.includes(segment.start)) ledger.doneSegments.push(segment.start);
  return { ...life, activity: ledger };
}

export function recordQqLifeExperience(lifeState, experience, { now = Date.now() } = {}) {
  const life = normalizeQqBotLifeState(lifeState, { now });
  const entry = normalizeQqLifeExperiences([{ ...experience, at: experience?.at || new Date(now).toISOString() }], { now })[0];
  if (!entry) return life;
  return { ...life, experiences: normalizeQqLifeExperiences([...life.experiences, entry], { now }) };
}

// Daily caps for the Bot's own visible social writes; privileged requests
// bypass them in the caller.
export function consumeQqLifeSocialAllowance(lifeState, kind, { limits = {}, now = Date.now(), timeZone = "Asia/Shanghai" } = {}) {
  const field = { qzone_post: "qzonePosts", qzone_comment: "qzoneComments", friend_request: "friendRequests" }[kind];
  const life = normalizeQqBotLifeState(lifeState, { now, timeZone });
  const ledger = normalizeQqLifeActivityLedger(life.activity, { now, timeZone });
  if (!field) return { ok: false, life, used: 0, limit: 0 };
  const limit = Math.max(0, Math.floor(Number(limits[kind]) || 0));
  if (ledger[field] >= limit) return { ok: false, life: { ...life, activity: ledger }, used: ledger[field], limit };
  ledger[field] += 1;
  return { ok: true, life: { ...life, activity: ledger }, used: ledger[field], limit };
}

const kindGuides = Object.freeze({
  surf: "像平时上网冲浪一样随手逛：先看看 B站热门（qq_media.bilibili popular），再用原生 Web Search 或 qq_search 看看今天大家在聊什么（热搜、新闻、新番新游戏、有意思的帖子），跟着好奇心点开 2-4 个真的看完；真想看的视频可以用 qq_media.video 点开。记下好玩的发现和你的反应。",
  video: "用 qq_media.bilibili（popular 看热门，或 search 搜你计划里的主题）挑 1-2 个你真感兴趣的，用 qq_media.video 真的看；记下看了什么、哪里好笑/有意思/无聊。",
  music: "用 qq_media.music(action=search) 找计划里的歌、歌手或风格，挑 1-2 首用 qq_media.music(action=listen, selector=song-N) 真的听；记下歌名、歌手、平台和听感（哪段好听、像什么心情）。",
  read: "用原生 Web Search 或 qq_search 找计划里想读的东西（一篇长文、科普、网络小说或漫画的介绍和评价、百科词条），真的读完 1-2 个来源，记下读了什么、哪里有意思、你怎么想。",
  browse: "用原生 Web Search 或 qq_search 找你计划里的东西，读 1-3 个真实来源，记下看到了什么、你怎么想。",
  learn: "认真查一个你好奇的问题，读原始资料，弄懂后用自己的话记下来；值得长期记住的事实可以写进 qq_knowledge（标题稳定、写清来源和日期）。",
  qzone: "用 qq_social.act(action=qzone_recent, target=QQ号) 看看下面几位朋友最近的空间动态；真有想说的就挑一条评论（qzone_comment，target=QQ号，value=tid 评论内容），没有就只是看看。",
  post: "想想今天真实发生过的事（下面列的经历）和最近画的画（qq_context.images list 里 d- 开头的），想发就用 qq_social.act(action=qzone_publish, value=说说内容) 发一条自然的说说；要配自己的画就先 qq_context.images(action=use, selector=d-…) 再 target=输出。不想发就算了。",
  draw: "用你的画图能力（原生生图；没有原生生图时用 qq_draw.image）真的把计划里的画画出来（一张就够；风格贴合你的人设和兴趣，可以有草稿感、可以画得不完美）。不需要发给任何人：画好的图 Hub 会自动存进你的画作。summary 写一句画完的感受，report 写这张画画了什么、你在意的细节。画不出来就如实说。"
});

export function buildQqLifeActivityTask({
  segment,
  now = Date.now(),
  timeZone = "Asia/Shanghai",
  interests = "",
  friends = [],
  experiences = [],
  limits = {}
} = {}) {
  const clock = new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
  const kind = normalizeQqLifeActivityKind(segment?.kind);
  const friendLines = friends.slice(0, 4).map((friend) => `- ${friend.name || "朋友"}（QQ ${friend.userId}）${friend.note ? `：${friend.note}` : ""}`);
  return [
    `现在是 ${formatLocalDate(now, timeZone)} ${clock}。按你今天的作息，这段时间（${segment.start}-${segment.end}）你在「${segment.activity}」${segment.state ? `，状态：${segment.state}` : ""}。`,
    `你给这段时间定的具体打算：${segment.plan}`,
    "像真人过日子一样真的去做这件事（用工具实际操作），不是写一份计划或编一段经历。时间不用太长，做到自然告一段落就停。",
    kindGuides[kind] || kindGuides.browse,
    interests ? `你的兴趣和喜好（只是参考）：${interests}` : null,
    kind === "qzone" && friendLines.length ? `可以去看看的朋友：\n${friendLines.join("\n")}` : null,
    kind === "qzone" || kind === "post"
      ? `今天你自己发说说还剩 ${Math.max(0, Number(limits.postsLeft) || 0)} 次、评论还剩 ${Math.max(0, Number(limits.commentsLeft) || 0)} 次；用完就只看不写。评论和说说要像你本人，短、自然、不营销、不刷屏，不写别人的隐私。`
      : "这次不要发说说或评论。",
    experiences.length ? `你今天已经做过的事：\n${experiences.map((item) => `- ${item.summary}`).join("\n")}` : null,
    "最后在 summary 里用第一人称写一句日记式的话（不超过 40 字，例如“刷到一个讲猫咪迷惑行为的视频，笑死”），report 里写清楚具体看了/读了/听了/做了什么（标题、UP主或歌手、来源、链接或 BV 号、你的真实感受），以后跟人聊天或把它分享给朋友时会用到（B站视频凭 BV 号就能发视频卡片）。没做成就如实写没做成。"
  ].filter(Boolean).join("\n");
}

export function formatQqLifeExperienceContext(lifeState, { now = Date.now(), scopeId = "" } = {}) {
  const life = normalizeQqBotLifeState(lifeState, { now });
  const recent = life.experiences
    .filter((entry) => now - Date.parse(entry.at) <= CONTEXT_HOURS * 3_600_000)
    .slice(-3);
  if (!recent.length) return "";
  return [
    "【你最近真实做过的事】（工具真实记录的经历，可以在合适时自然提起或分享，不用刻意；别人没问也不必汇报）：",
    ...recent.map((entry) => `- ${formatAge(now - Date.parse(entry.at))}：${entry.summary}${entry.sharedScopes.includes(scopeId) ? "（已经在这里聊过）" : ""}`)
  ].join("\n");
}

export function formatQqLifeExperienceDetail(lifeState, { now = Date.now() } = {}) {
  const life = normalizeQqBotLifeState(lifeState, { now });
  const recent = life.experiences.slice(-6);
  if (!recent.length) return "最近还没有记录到真实经历。";
  return ["最近真实做过的事：", ...recent.map((entry) => `- ${formatAge(now - Date.parse(entry.at))}：${entry.summary}${entry.detail ? `\n  ${entry.detail.slice(0, 400)}` : ""}${formatSharedVideoIds(entry.detail)}`)].join("\n");
}

// Bilibili videos named anywhere in the report, so a long report still
// leaves the ids needed to share a video card later.
function formatSharedVideoIds(detail) {
  const ids = [...new Set(String(detail || "").match(/\bBV[0-9A-Za-z]{10}\b/g) || [])].slice(0, 4);
  return ids.length ? `\n  提到的 B站视频：${ids.join("、")}` : "";
}

function minutesSinceSegmentStart(segment, now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const [hour, minute] = segment.start.split(":").map(Number);
  const start = hour * 60 + minute;
  return (current - start + 1440) % 1440;
}

function formatAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 2) return "刚才";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

function stableFraction(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

