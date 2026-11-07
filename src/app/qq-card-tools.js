import { getQqMediaTurnState } from "./qq-media-tool.js";
import { findQqMediaCandidate } from "../qq-media/media-candidates.js";
import { isBilibiliShortLink, parseBilibiliVideoId } from "../qq-media/bilibili.js";

// Special QQ messages the Bot can send the way a person does: a song card
// (NetEase, QQ Music, Kugou or Kuwo, signed by NapCat's music-card service),
// a Bilibili video card (a signed mini-program card from NapCat's
// get_mini_app_ark), a forwarded chat-record card written by the Bot itself,
// a dice roll, rock-paper-scissors, and a recommended contact or group card
// from NapCat's Ark share actions. Each is one real QQ write in the original
// conversation and is reported only after OneBot confirms it.

export const QQ_CARD_ACTIONS = Object.freeze(["music", "bilibili", "forward", "dice", "rps", "contact"]);

const MAX_CARDS_PER_TURN = 2;
const NETEASE_SEARCH = "https://music.163.com/api/search/get/web";
// NapCat's music-card service names platforms by these types.
const MUSIC_CARD_TYPES = Object.freeze({ netease: "163", tencent: "qq", kugou: "kugou", kuwo: "kuwo" });
const SONG_ID_PATTERNS = Object.freeze({
  netease: /^\d{1,16}$/,
  tencent: /^[0-9A-Za-z]{8,24}$/,
  kugou: /^[0-9A-Fa-f]{32}$/,
  kuwo: /^\d{1,20}$/
});
const MAX_FORWARD_ITEMS = 12;
const MAX_FORWARD_ITEM_CHARS = 1500;
const MAX_FORWARD_TOTAL_CHARS = 6000;

export async function executeQqCardAction(args = {}, {
  event = {},
  sendSegments,
  callOneBotAction,
  searchMusic,
  describeSong,
  bilibili = null,
  mediaCandidates = {},
  self = {},
  cleanText = (text) => text,
  allowedContactIds = new Set(),
  assertActive = () => {}
} = {}) {
  if (typeof sendSegments !== "function") return { ok: false, error: "发送卡片不可用。" };
  event.qqCardCount = Number(event.qqCardCount || 0);
  if (event.qqCardCount >= MAX_CARDS_PER_TURN) return { ok: false, error: `本轮最多发 ${MAX_CARDS_PER_TURN} 张卡片。` };
  const action = String(args.action || "");
  let built;
  if (action === "dice") {
    built = { segments: [{ type: "dice", data: {} }], label: "[骰子]" };
  } else if (action === "rps") {
    built = { segments: [{ type: "rps", data: {} }], label: "[猜拳]" };
  } else if (action === "music") {
    built = await buildMusicCard(args, { event, searchMusic, describeSong, mediaCandidates, assertActive });
  } else if (action === "bilibili") {
    built = await buildBilibiliCard(args, { event, bilibili, mediaCandidates, callOneBotAction, assertActive });
  } else if (action === "forward") {
    built = buildForwardCard(args, { self, cleanText });
  } else if (action === "contact") {
    built = await buildContactCard(args, { event, callOneBotAction, allowedContactIds, assertActive });
  } else {
    return { ok: false, error: "未知卡片类型。" };
  }
  if (!built?.ok && built?.error) return { ok: false, error: built.error };
  const result = await sendSegments(built.segments, { label: built.label, extra: built.extra });
  assertActive();
  if (!result?.ok) return { ok: false, error: `发送失败：${result?.error || `HTTP ${result?.status || "未知"}`}。不要声称已经发出。` };
  event.qqCardCount += 1;
  const note = action === "dice" || action === "rps"
    ? "结果由 QQ 随机决定，你看不到点数，别编具体结果。"
    : action === "forward"
      ? "这是一张聊天记录卡片，大家点开才看得到内容；正文不用再重复一遍。"
      : "卡片里已经有标题和链接，正文不用再贴链接。";
  return { ok: true, reply: `已发出${built.label}。${note}` };
}

async function buildMusicCard(args, { event, searchMusic, describeSong, mediaCandidates, assertActive }) {
  const selector = String(args.selector || "").trim().toLowerCase();
  let song = null;
  if (selector.startsWith("song-")) {
    const entry = getQqMediaTurnState(event).songs.find((item) => item.selector === selector);
    if (!entry) return { error: "这个 song-N 不是本轮 qq_media.music search 的结果，先搜一下。" };
    song = { site: entry.site, id: entry.id, title: entry.title, artist: entry.artist, cover: "" };
    const resolved = getQqMediaTurnState(event).resolved?.get?.(selector);
    if (resolved?.cover) song.cover = resolved.cover;
  } else if (selector.startsWith("music-")) {
    const candidate = findQqMediaCandidate(mediaCandidates, selector);
    if (!candidate) return { error: "这个 music-N 不在本轮媒体目录里。" };
    const resolved = typeof describeSong === "function" ? await describeSong(candidate).catch(() => null) : null;
    assertActive();
    if (!resolved?.site || !resolved?.id) return { error: "没认出这张音乐卡片是哪首歌，换成 qq_media.music search 搜到的 song-N 再发。" };
    song = { site: resolved.site, id: resolved.id, title: resolved.title, artist: (resolved.artists || []).join("/"), cover: resolved.cover || "" };
  } else if (String(args.songId || "").trim()) {
    const site = siteFor(args.platform);
    const id = String(args.songId || "").trim();
    if (!SONG_ID_PATTERNS[site].test(id)) return { error: "songId 和 platform 对不上（网易云/酷我是数字，QQ音乐是 songmid，酷狗是 32 位 hash）。" };
    song = { site, id, title: "", artist: "", cover: "" };
  } else {
    const query = String(args.query || "").trim().slice(0, 60);
    if (!query) return { error: "发音乐卡片需要 selector（song-N）、platform+songId 或 query（歌名 歌手）。" };
    if (typeof searchMusic !== "function") return { error: "搜歌不可用。" };
    const songs = await searchMusic(query).catch(() => []);
    assertActive();
    if (!songs.length) return { error: `没搜到「${query}」，换个写法试试。` };
    const pick = songs[Math.max(0, Math.min(songs.length - 1, (Number(args.index) || 1) - 1))];
    song = { site: "netease", id: pick.id, title: pick.name, artist: pick.artists, cover: "" };
  }
  if (!MUSIC_CARD_TYPES[song.site] || !SONG_ID_PATTERNS[song.site].test(String(song.id || ""))) {
    return { error: "这首歌所在的平台发不了音乐卡片。" };
  }
  // The signing service needs a title; the cover makes the card look like
  // the song. Both come from the platform's own song facts when missing.
  if ((!song.title || !song.cover) && typeof describeSong === "function") {
    const facts = await describeSong({ site: song.site, id: song.id }).catch(() => null);
    assertActive();
    if (facts) {
      song.title ||= String(facts.title || "");
      song.artist ||= (facts.artists || []).join("/");
      song.cover ||= String(facts.cover || "");
    }
  }
  const data = { type: MUSIC_CARD_TYPES[song.site], id: String(song.id) };
  if (song.title) data.title = clip(song.title, 60);
  if (song.artist) data.singer = clip(song.artist, 60);
  if (isHttpsUrl(song.cover)) data.image = song.cover;
  const label = song.title
    ? `[音乐分享]《${clip(song.title, 40)}》${song.artist ? `- ${clip(song.artist, 30)}` : ""}`
    : `[音乐分享] ${platformName(song.site)} ${song.id}`;
  return { ok: true, segments: [{ type: "music", data }], label };
}

async function buildBilibiliCard(args, { event, bilibili, mediaCandidates, callOneBotAction, assertActive }) {
  if (!bilibili || typeof bilibili.view !== "function") return { error: "B站卡片不可用。" };
  if (typeof callOneBotAction !== "function") return { error: "发送卡片不可用。" };
  const selector = String(args.selector || "").trim().toLowerCase();
  let url = "";
  if (selector.startsWith("bili-")) {
    url = getQqMediaTurnState(event).browse.find((item) => item.selector === selector)?.url || "";
    if (!url) return { error: "这个 bili-N 不是本轮 B站 浏览结果，先用 qq_media.bilibili 列出来。" };
  } else if (selector.startsWith("video-")) {
    const candidate = findQqMediaCandidate(mediaCandidates, selector);
    if (!candidate || candidate.platform !== "bilibili" || !candidate.url) return { error: "这个 video-N 不是 B站视频，发不了 B站卡片。" };
    url = candidate.url;
  } else {
    url = String(args.url || args.target || "").trim();
  }
  if (!url) return { error: "B站卡片需要 selector（bili-N / video-N）或一个 B站视频链接/BV号（url）。" };
  // Only a BV/av id or a b23.tv short link is accepted; the card always
  // points at the canonical www.bilibili.com page built from that id.
  let id = parseBilibiliVideoId(url);
  if (!id && isBilibiliShortLink(url) && typeof bilibili.resolve === "function") {
    id = await bilibili.resolve(url).catch(() => null);
    assertActive();
  }
  if (!id) return { error: "这不是 B站视频链接或 BV 号。" };
  const info = await bilibili.view(id).catch(() => null);
  assertActive();
  if (!info?.title || !info?.bvid) return { error: "没拿到这个 B站视频的信息（可能已失效），可以直接发链接。" };
  const jumpUrl = `https://www.bilibili.com/video/${info.bvid}`;
  const ark = await callOneBotAction("get_mini_app_ark", {
    type: "bili",
    title: clip(info.title, 60),
    desc: clip(info.owner ? `UP ${info.owner}${info.description ? `｜${info.description}` : ""}` : info.description || info.title, 80),
    picUrl: info.cover || "https://i0.hdslb.com/bfs/static/jinkela/long/images/vip-login-banner.png",
    jumpUrl,
    webUrl: jumpUrl
  });
  assertActive();
  const json = extractArkJson(ark);
  if (!json) return { error: "QQ 没有生成 B站卡片（这台 NapCat 可能不支持小程序卡片），可以直接发链接。" };
  return { ok: true, segments: [{ type: "json", data: { data: json } }], label: `[B站视频]《${clip(info.title, 40)}》` };
}

// A merged chat-record card whose every node is written by the Bot itself
// under its own account and nickname; it never forges anyone else.
function buildForwardCard(args, { self = {}, cleanText = (text) => text }) {
  const userId = String(self.userId || "").trim();
  if (!/^[1-9]\d{4,12}$/.test(userId)) return { error: "还不知道自己的 QQ 号，发不了聊天记录卡片。" };
  const nickname = clip(self.nickname || "我", 20);
  const raw = Array.isArray(args.items) ? args.items : String(args.items || "").split(/\n{2,}/);
  let total = 0;
  const items = [];
  for (const value of raw) {
    const text = clip(cleanControlText(cleanText(String(value ?? ""))), MAX_FORWARD_ITEM_CHARS);
    if (!text) continue;
    if (total + text.length > MAX_FORWARD_TOTAL_CHARS || items.length >= MAX_FORWARD_ITEMS) break;
    total += text.length;
    items.push(text);
  }
  if (!items.length) return { error: "聊天记录卡片需要 items（每条一段文字，最多 12 条）。" };
  const title = clip(cleanControlText(cleanText(String(args.title || ""))), 20) || `${nickname}的聊天记录`;
  const segments = items.map((text) => ({
    type: "node",
    data: { user_id: userId, nickname, content: [{ type: "text", data: { text } }] }
  }));
  const extra = {
    source: title,
    prompt: `[聊天记录] ${title}`,
    summary: `查看${items.length}条转发消息`,
    news: items.slice(0, 4).map((text) => ({ text: `${nickname}: ${clip(text.replace(/\s+/g, " "), 40)}` }))
  };
  return { ok: true, segments, extra, label: `[聊天记录] ${title}` };
}

async function buildContactCard(args, { event, callOneBotAction, allowedContactIds, assertActive }) {
  const target = String(args.target || "").trim();
  if (target === "group" || target === "群") {
    if (!event.groupId) return { error: "私聊里没有可分享的群。" };
    const ark = await callOneBotAction("ArkShareGroup", { group_id: String(event.groupId) });
    assertActive();
    const json = extractArkJson(ark);
    if (!json) return { error: "QQ 没有返回群名片。" };
    return { ok: true, segments: [{ type: "json", data: { data: json } }], label: "[群名片] 本群" };
  }
  const userId = target.match(/[1-9][0-9]{4,12}/)?.[0] || "";
  if (!userId || !allowedContactIds.has(userId)) return { error: "只能推荐这段对话里出现过的人（或你自己）的名片。" };
  const ark = await callOneBotAction("ArkSharePeer", { user_id: userId });
  assertActive();
  const json = extractArkJson(ark);
  if (!json) return { error: "QQ 没有返回这个人的名片。" };
  return { ok: true, segments: [{ type: "json", data: { data: json } }], label: `[名片] QQ ${userId}` };
}

export function extractArkJson(result) {
  if (!result?.ok) return "";
  const data = result.body?.data;
  const inner = data && typeof data === "object" ? data.arkJson || data.ark || data.data || data : data;
  const value = typeof inner === "string" ? inner : inner && typeof inner === "object" ? JSON.stringify(inner) : "";
  const text = String(value || "").trim();
  return text.startsWith("{") ? text.slice(0, 20_000) : "";
}

function siteFor(platform) {
  const value = String(platform || "").toLowerCase();
  if (/qq|tencent/.test(value)) return "tencent";
  if (/kugou|酷狗/.test(value)) return "kugou";
  if (/kuwo|酷我/.test(value)) return "kuwo";
  return "netease";
}

function platformName(site) {
  return { netease: "网易云", tencent: "QQ音乐", kugou: "酷狗", kuwo: "酷我" }[site] || site;
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function cleanControlText(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function clip(value, max) {
  return [...String(value ?? "").trim()].slice(0, max).join("");
}

// NetEase's public web search; results are only song facts.
export function createNeteaseMusicSearch({ fetchJson } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("fetchJson must be a function");
  return async function searchMusic(query, { limit = 5, signal } = {}) {
    const url = `${NETEASE_SEARCH}?s=${encodeURIComponent(String(query || "").slice(0, 60))}&type=1&offset=0&limit=${Math.max(1, Math.min(10, limit))}`;
    const body = await fetchJson(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: "https://music.163.com/"
      },
      signal
    });
    const songs = Array.isArray(body?.result?.songs) ? body.result.songs : [];
    return songs.slice(0, limit).map((song) => ({
      id: String(song?.id || ""),
      name: String(song?.name || "").slice(0, 80),
      artists: (Array.isArray(song?.artists) ? song.artists : []).map((artist) => String(artist?.name || "")).filter(Boolean).join("/").slice(0, 60)
    })).filter((song) => /^\d+$/.test(song.id));
  };
}
