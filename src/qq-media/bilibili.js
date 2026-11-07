import { createHash } from "node:crypto";

// A small read-only Bilibili web client: short-link resolution, video facts,
// hot comments, subtitles, the popular list and keyword search. Every request
// goes through an injected fetchJson (the Hub's safe-fetch policy), so this
// module never chooses hosts on its own; all URLs below are fixed public
// api.bilibili.com endpoints. Results are untrusted material for the model.

const API = "https://api.bilibili.com";
const BROWSER_HEADERS = Object.freeze({
  "user-agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  referer: "https://www.bilibili.com/",
  origin: "https://www.bilibili.com",
  accept: "application/json, text/plain, */*"
});
// Fixed permutation from Bilibili's public web player for WBI request signing.
const WBI_MIXIN_TABLE = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]);
const WBI_KEY_TTL_MS = 6 * 60 * 60_000;

export function parseBilibiliVideoId(value = "") {
  const text = String(value || "");
  const bvid = text.match(/\b(BV[0-9A-Za-z]{10})\b/)?.[1] || "";
  const aid = bvid ? "" : (text.match(/(?:\/video\/av|[?&]aid=|\bav)(\d{1,12})\b/i)?.[1] || "");
  const page = Number(text.match(/[?&]p=(\d{1,3})\b/)?.[1] || 1);
  return bvid || aid ? { bvid, aid, page: Number.isFinite(page) && page > 0 ? page : 1 } : null;
}

export function isBilibiliShortLink(url = "") {
  try {
    return /(?:^|\.)(?:b23\.tv|bili2233\.cn)$/i.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

export function signBilibiliWbiParams(params = {}, { imgKey = "", subKey = "", now = Date.now() } = {}) {
  const raw = `${imgKey}${subKey}`;
  const mixinKey = WBI_MIXIN_TABLE.map((index) => raw[index] || "").join("").slice(0, 32);
  const entries = Object.entries({ ...params, wts: Math.floor(now / 1000) })
    .map(([key, value]) => [key, String(value ?? "").replace(/[!'()*]/g, "")])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const wRid = createHash("md5").update(`${query}${mixinKey}`).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

export function createBilibiliClient({ fetchJson, resolveRedirect, now = Date.now } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("fetchJson must be a function");
  let wbiKeys = null;
  let cookie = "";

  async function call(path, { query = "", signed = false, params = {}, signal } = {}) {
    const headers = { ...BROWSER_HEADERS, ...(cookie ? { cookie } : {}) };
    let search = query;
    if (signed) {
      const keys = await loadWbiKeys(signal);
      search = signBilibiliWbiParams(params, { ...keys, now: now() });
    }
    const body = await fetchJson(`${API}${path}${search ? `?${search}` : ""}`, { headers, signal });
    if (!body || typeof body !== "object") throw bilibiliError("BILIBILI_BAD_RESPONSE", "Bilibili 返回了无法解析的数据");
    if (Number(body.code) !== 0) {
      throw bilibiliError("BILIBILI_API_ERROR", `Bilibili 接口返回 ${body.code}${body.message ? `：${String(body.message).slice(0, 80)}` : ""}`);
    }
    return body.data;
  }

  async function loadWbiKeys(signal) {
    if (wbiKeys && now() - wbiKeys.at < WBI_KEY_TTL_MS) return wbiKeys;
    await ensureBuvid(signal);
    // nav answers -101 for anonymous visitors but still carries wbi_img.
    const body = await fetchJson(`${API}/x/web-interface/nav`, { headers: { ...BROWSER_HEADERS, ...(cookie ? { cookie } : {}) }, signal });
    const image = body?.data?.wbi_img || {};
    const key = (url) => String(url || "").split("/").pop()?.split(".")[0] || "";
    const imgKey = key(image.img_url);
    const subKey = key(image.sub_url);
    if (!imgKey || !subKey) throw bilibiliError("BILIBILI_WBI_UNAVAILABLE", "无法取得 Bilibili 请求签名参数");
    wbiKeys = { imgKey, subKey, at: now() };
    return wbiKeys;
  }

  async function ensureBuvid(signal) {
    if (cookie) return;
    try {
      const body = await fetchJson(`${API}/x/frontend/finger/spi`, { headers: BROWSER_HEADERS, signal });
      const b3 = String(body?.data?.b_3 || "").replace(/[^0-9A-Za-z-]/g, "");
      const b4 = String(body?.data?.b_4 || "").replace(/[^0-9A-Za-z%=-]/g, "");
      if (b3) cookie = [`buvid3=${b3}`, b4 ? `buvid4=${b4}` : ""].filter(Boolean).join("; ");
    } catch {
      cookie = "";
    }
  }

  async function resolve(url, { signal } = {}) {
    let target = String(url || "");
    if (isBilibiliShortLink(target) && typeof resolveRedirect === "function") {
      target = String(await resolveRedirect(target, { headers: BROWSER_HEADERS, signal }) || target);
    }
    const id = parseBilibiliVideoId(target);
    if (!id) throw bilibiliError("BILIBILI_NOT_VIDEO", "这个 B站 链接不是视频页面");
    return id;
  }

  async function view(id, { signal } = {}) {
    const query = id.bvid ? `bvid=${encodeURIComponent(id.bvid)}` : `aid=${encodeURIComponent(id.aid)}`;
    const data = await call("/x/web-interface/view", { query, signal });
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    const page = pages[Math.min(pages.length, Math.max(1, id.page || 1)) - 1] || pages[0] || {};
    return {
      bvid: String(data?.bvid || id.bvid || ""),
      aid: String(data?.aid || id.aid || ""),
      cid: String(page.cid || data?.cid || ""),
      title: compact(data?.title, 120),
      description: compact(data?.desc, 400),
      owner: compact(data?.owner?.name, 40),
      category: compact(data?.tname, 20),
      cover: coverUrl(data?.pic),
      durationSeconds: Number(page.duration || data?.duration || 0) || 0,
      pageCount: pages.length || 1,
      pageTitle: pages.length > 1 ? compact(page.part, 60) : "",
      publishedAt: Number(data?.pubdate || 0) ? new Date(Number(data.pubdate) * 1000).toISOString() : null,
      stats: pickStats(data?.stat),
      url: `https://www.bilibili.com/video/${data?.bvid || id.bvid || `av${id.aid}`}${pages.length > 1 && id.page > 1 ? `?p=${id.page}` : ""}`
    };
  }

  async function hotComments(aid, { limit = 5, signal } = {}) {
    if (!aid) return [];
    const size = Math.max(1, Math.min(10, Number(limit) || 5));
    let data;
    try {
      data = await call("/x/v2/reply/wbi/main", { signed: true, params: { oid: aid, type: 1, mode: 3, ps: size }, signal });
    } catch {
      data = await call("/x/v2/reply", { query: `type=1&oid=${encodeURIComponent(aid)}&sort=1&ps=${size}&pn=1`, signal });
    }
    return (Array.isArray(data?.replies) ? data.replies : []).slice(0, size).map((reply) => ({
      user: compact(reply?.member?.uname, 24),
      text: compact(reply?.content?.message, 160),
      likes: Number(reply?.like || 0) || 0
    })).filter((entry) => entry.text);
  }

  // Uploader or AI subtitles in Bilibili's own JSON format, which the
  // storyboard reads directly. Many videos have none for anonymous visitors.
  async function subtitle(info, { signal, fetchSubtitle } = {}) {
    if (!info?.cid || (!info.bvid && !info.aid) || typeof fetchSubtitle !== "function") return null;
    const data = await call("/x/player/wbi/v2", {
      signed: true,
      params: info.bvid ? { bvid: info.bvid, cid: info.cid } : { aid: info.aid, cid: info.cid },
      signal
    });
    const tracks = Array.isArray(data?.subtitle?.subtitles) ? data.subtitle.subtitles : [];
    const track = tracks.find((item) => /zh|中文/i.test(`${item?.lan || ""}${item?.lan_doc || ""}`)) || tracks[0];
    const url = String(track?.subtitle_url || "");
    if (!url) return null;
    const absolute = url.startsWith("//") ? `https:${url}` : url;
    if (!/^https:\/\/[a-z0-9.-]*(?:hdslb\.com|bilivideo\.com|bilibili\.com)\//i.test(absolute)) return null;
    const body = await fetchSubtitle(absolute, { headers: BROWSER_HEADERS, signal });
    const lines = Array.isArray(body?.body) ? body.body : [];
    if (!lines.length) return null;
    return {
      language: compact(track?.lan_doc || track?.lan, 20),
      body: lines.slice(0, 4000).map((line) => ({
        from: Number(line?.from) || 0,
        to: Number(line?.to) || 0,
        content: compact(line?.content, 200)
      })).filter((line) => line.content)
    };
  }

  async function popular({ limit = 10, page = 1, signal } = {}) {
    const size = Math.max(1, Math.min(20, Number(limit) || 10));
    const data = await call("/x/web-interface/popular", { query: `ps=${size}&pn=${Math.max(1, Number(page) || 1)}`, signal });
    return (Array.isArray(data?.list) ? data.list : []).slice(0, size).map(listEntry);
  }

  async function search(keyword, { limit = 10, signal } = {}) {
    const query = compact(keyword, 60);
    if (!query) return [];
    const data = await call("/x/web-interface/wbi/search/type", {
      signed: true,
      params: { search_type: "video", keyword: query, page: 1 },
      signal
    });
    return (Array.isArray(data?.result) ? data.result : []).slice(0, Math.max(1, Math.min(20, Number(limit) || 10))).map((item) => ({
      bvid: String(item?.bvid || ""),
      title: compact(String(item?.title || "").replace(/<[^>]+>/g, ""), 120),
      owner: compact(item?.author, 40),
      category: compact(item?.typename, 20),
      durationText: compact(item?.duration, 12),
      views: Number(item?.play || 0) || 0,
      description: compact(item?.description, 160),
      url: item?.bvid ? `https://www.bilibili.com/video/${item.bvid}` : ""
    })).filter((item) => item.bvid && item.url);
  }

  return { resolve, view, hotComments, subtitle, popular, search };
}

function listEntry(item) {
  return {
    bvid: String(item?.bvid || ""),
    title: compact(item?.title, 120),
    owner: compact(item?.owner?.name, 40),
    category: compact(item?.tname, 20),
    durationSeconds: Number(item?.duration || 0) || 0,
    views: Number(item?.stat?.view || 0) || 0,
    description: compact(item?.desc, 160),
    reason: compact(item?.rcmd_reason?.content, 40),
    url: item?.bvid ? `https://www.bilibili.com/video/${item.bvid}` : ""
  };
}

function pickStats(stat = {}) {
  const read = (key) => Number(stat?.[key] || 0) || 0;
  return { views: read("view"), likes: read("like"), coins: read("coin"), favorites: read("favorite"), danmaku: read("danmaku"), replies: read("reply") };
}

export function formatBilibiliCount(value) {
  const number = Number(value) || 0;
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(1)}万`;
  return String(number);
}

export function formatBilibiliDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

// Video covers live on Bilibili's own image CDN; anything else is dropped.
function coverUrl(value) {
  const text = String(value || "").trim().replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://");
  try {
    const url = new URL(text);
    return url.protocol === "https:" && /(?:^|\.)hdslb\.com$/i.test(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

function compact(value, max) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}

function bilibiliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
