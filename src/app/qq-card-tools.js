// Special QQ messages the Bot can send the way a person does: a music card
// (NetEase Cloud Music search, signed by NapCat's music-card service), a dice
// roll, rock-paper-scissors, and a recommended contact or group card from
// NapCat's Ark share actions. Each is one real QQ write in the original
// conversation and is reported only after OneBot confirms it.

const MAX_CARDS_PER_TURN = 2;
const NETEASE_SEARCH = "https://music.163.com/api/search/get/web";

export async function executeQqCardAction(args = {}, {
  event = {},
  sendSegments,
  callOneBotAction,
  searchMusic,
  allowedContactIds = new Set(),
  assertActive = () => {}
} = {}) {
  if (typeof sendSegments !== "function") return { ok: false, error: "发送卡片不可用。" };
  event.qqCardCount = Number(event.qqCardCount || 0);
  if (event.qqCardCount >= MAX_CARDS_PER_TURN) return { ok: false, error: `本轮最多发 ${MAX_CARDS_PER_TURN} 张卡片。` };
  const action = String(args.action || "");
  let segments;
  let label;
  let detail = "";
  if (action === "dice") {
    segments = [{ type: "dice", data: {} }];
    label = "[骰子]";
  } else if (action === "rps") {
    segments = [{ type: "rps", data: {} }];
    label = "[猜拳]";
  } else if (action === "music") {
    const query = String(args.query || "").trim().slice(0, 60);
    let songId = String(args.songId || "").replace(/\D/g, "").slice(0, 16);
    if (!songId) {
      if (!query) return { ok: false, error: "发音乐卡片需要 query（歌名 歌手）或 songId。" };
      if (typeof searchMusic !== "function") return { ok: false, error: "搜歌不可用。" };
      const songs = await searchMusic(query).catch(() => []);
      assertActive();
      if (!songs.length) return { ok: false, error: `没搜到「${query}」，换个写法试试。` };
      const pick = songs[Math.max(0, Math.min(songs.length - 1, (Number(args.index) || 1) - 1))];
      songId = pick.id;
      detail = `《${pick.name}》- ${pick.artists}`;
    }
    segments = [{ type: "music", data: { type: "163", id: songId } }];
    label = `[音乐分享] ${detail || `网易云 ${songId}`}`;
  } else if (action === "contact") {
    const target = String(args.target || "").trim();
    if (target === "group" || target === "群") {
      if (!event.groupId) return { ok: false, error: "私聊里没有可分享的群。" };
      const ark = await callOneBotAction("ArkShareGroup", { group_id: String(event.groupId) });
      assertActive();
      const json = extractArkJson(ark);
      if (!json) return { ok: false, error: "QQ 没有返回群名片。" };
      segments = [{ type: "json", data: { data: json } }];
      label = "[群名片] 本群";
    } else {
      const userId = target.match(/[1-9][0-9]{4,12}/)?.[0] || "";
      if (!userId || !allowedContactIds.has(userId)) return { ok: false, error: "只能推荐这段对话里出现过的人（或你自己）的名片。" };
      const ark = await callOneBotAction("ArkSharePeer", { user_id: userId });
      assertActive();
      const json = extractArkJson(ark);
      if (!json) return { ok: false, error: "QQ 没有返回这个人的名片。" };
      segments = [{ type: "json", data: { data: json } }];
      label = `[名片] QQ ${userId}`;
    }
  } else {
    return { ok: false, error: "未知卡片类型。" };
  }
  const result = await sendSegments(segments, { label });
  assertActive();
  if (!result?.ok) return { ok: false, error: `发送失败：${result?.error || `HTTP ${result?.status || "未知"}`}。不要声称已经发出。` };
  event.qqCardCount += 1;
  return { ok: true, reply: `已发出${label}。${action === "dice" || action === "rps" ? "结果由 QQ 随机决定，你看不到点数，别编具体结果。" : ""}` };
}

function extractArkJson(result) {
  if (!result?.ok) return "";
  const data = result.body?.data;
  const value = typeof data === "string" ? data : data?.arkJson || data?.ark || data?.data || (data && typeof data === "object" ? JSON.stringify(data) : "");
  const text = String(value || "").trim();
  return text.startsWith("{") ? text.slice(0, 20_000) : "";
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
