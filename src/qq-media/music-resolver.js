import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  QQ_MUSIC_PLATFORM_NAMES,
  QQ_MUSIC_SITES,
  isQqTrustedMusicAudioUrl,
  mergeQqTranslatedLyrics,
  parseQqLrc,
  parseQqMusicSongRef,
  pickQqSongMatch,
  qqMusicPlatformForSite
} from "./music-links.js";

// Song resolution on top of Meting (@meting/core, MIT): one interface to the
// NetEase, QQ Music, Kugou and Kuwo song, lyric, search and stream APIs.
// Meting is an optional media component in the tools directory. It only
// talks to those platforms' fixed API hosts; share links are expanded by the
// caller's safe redirect resolver and audio is downloaded by the caller
// through the safe-fetch policy, never by Meting.

const SEARCH_SITES = Object.freeze(["netease", "kugou", "tencent"]);

export function resolveQqMetingEntry(toolsDir) {
  return join(String(toolsDir || ""), "node_modules", "@meting", "core", "lib", "meting.esm.js");
}

export function createQqMetingLoader(toolsDir, { read = readFile } = {}) {
  let cached = null;
  let cachedVersion = "";
  // Re-imported when the installed version changes (an update), so a new
  // release is used without restarting the Hub. A missing package is looked
  // up again next time.
  return async function loadMeting() {
    const manifest = join(String(toolsDir || ""), "node_modules", "@meting", "core", "package.json");
    const version = await read(manifest, "utf8").then((text) => String(JSON.parse(text).version || "")).catch(() => "");
    if (!version) return null;
    if (cached && cachedVersion === version) return cached;
    try {
      // The package is "type": "module"; its ESM build is the reliable entry.
      const module = await import(`${pathToFileURL(resolveQqMetingEntry(toolsDir)).href}?v=${encodeURIComponent(version)}`);
      cached = typeof module?.default === "function" ? module.default : null;
      cachedVersion = cached ? version : "";
    } catch {
      cached = null;
      cachedVersion = "";
    }
    return cached;
  };
}

function musicError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withDeadline(promise, ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || musicError("ABORT_ERR", "aborted"));
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || musicError("ABORT_ERR", "aborted"));
    const timer = setTimeout(() => finish(reject, musicError("MUSIC_TIMEOUT", "音乐平台接口超时")), ms);
    timer.unref?.();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function parseJson(text) {
  if (text && typeof text === "object") return text;
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function clean(value, max = 120) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}

function dateFromMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number).toISOString().slice(0, 10);
}

function secureUrl(value) {
  const text = clean(value, 2000);
  return /^https?:\/\//i.test(text) ? text.replace(/^http:\/\//i, "https://") : "";
}

// Raw song-detail responses → one shape. Unknown or empty answers are null.
export function normalizeQqMusicDetail(site, raw) {
  const data = parseJson(raw);
  if (!data) return null;
  if (site === "netease") {
    const song = Array.isArray(data.songs) ? data.songs[0] : null;
    if (!song?.name) return null;
    const privilege = Array.isArray(data.privileges) ? data.privileges[0] : null;
    const fee = Number(song.fee ?? privilege?.fee);
    return {
      id: String(song.id),
      title: clean(song.name),
      artists: (song.ar || song.artists || []).map((artist) => clean(artist?.name, 40)).filter(Boolean).slice(0, 6),
      album: clean(song.al?.name || song.album?.name),
      durationSeconds: Math.round((Number(song.dt || song.duration) || 0) / 1000),
      cover: secureUrl(song.al?.picUrl || song.album?.picUrl),
      vip: fee === 1 || fee === 4 ? true : Number.isFinite(fee) ? false : null,
      publishDate: dateFromMs(song.publishTime),
      aliases: [...(song.alia || song.alias || []), ...(song.tns || [])].map((value) => clean(value, 60)).filter(Boolean).slice(0, 3),
      urlId: String(song.id),
      lyricId: String(song.id),
      directUrls: []
    };
  }
  if (site === "tencent") {
    const song = Array.isArray(data.data) ? data.data[0] : null;
    if (!song?.mid && !song?.name) return null;
    const albumMid = clean(song.album?.mid, 40);
    return {
      id: String(song.mid || ""),
      title: clean(song.name || song.title),
      artists: (song.singer || []).map((artist) => clean(artist?.name, 40)).filter(Boolean).slice(0, 6),
      album: clean(song.album?.name || song.album?.title),
      durationSeconds: Math.round(Number(song.interval) || 0),
      cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "",
      vip: song.pay ? Number(song.pay.pay_play) === 1 : null,
      publishDate: clean(song.time_public, 10),
      aliases: song.subtitle ? [clean(song.subtitle, 60)] : [],
      urlId: String(song.mid || ""),
      lyricId: String(song.mid || ""),
      directUrls: []
    };
  }
  if (site === "kugou") {
    if (!data.songName && !data.fileName) return null;
    const fileName = clean(data.fileName, 160);
    const [fileArtist, fileTitle] = fileName.includes(" - ") ? fileName.split(" - ") : ["", fileName];
    const authors = Array.isArray(data.authors) ? data.authors.map((author) => clean(author?.author_name, 40)) : [];
    const climax = data.climax_info || {};
    const climaxFrom = Number(climax.start_time) / 1000;
    const climaxTo = Number(climax.end_time) / 1000;
    return {
      id: String(data.hash || "").toUpperCase(),
      title: clean(data.songName || fileTitle),
      artists: (authors.filter(Boolean).length ? authors : String(data.singerName || data.author_name || fileArtist).split(/、|,|，/)).map((value) => clean(value, 40)).filter(Boolean).slice(0, 6),
      album: clean(data.album_name || data.albumname),
      durationSeconds: Math.round(Number(data.timeLength) || 0),
      cover: secureUrl(String(data.album_img || data.imgUrl || "").replace("{size}", "400")),
      vip: null,
      publishDate: "",
      aliases: [],
      urlId: String(data.hash || "").toUpperCase(),
      lyricId: String(data.hash || "").toUpperCase(),
      directUrls: [data.url, ...(Array.isArray(data.backup_url) ? data.backup_url : [])].map((value) => clean(value, 2000)).filter((value) => isQqTrustedMusicAudioUrl(value)),
      climax: climaxTo > climaxFrom && climaxFrom >= 0 ? { from: Math.round(climaxFrom), to: Math.round(climaxTo) } : null
    };
  }
  if (site === "kuwo") {
    const song = data.data && typeof data.data === "object" ? data.data : null;
    if (!song?.name) return null;
    return {
      id: String(song.rid || song.musicrid || "").replace(/^MUSIC_/, ""),
      title: clean(song.name),
      artists: String(song.artist || "").split("&").map((value) => clean(value, 40)).filter(Boolean).slice(0, 6),
      album: clean(song.album),
      durationSeconds: Math.round(Number(song.duration) || 0),
      cover: secureUrl(song.pic || song.albumpic),
      vip: song.isListenFee === true ? true : null,
      publishDate: clean(song.releaseDate, 10),
      aliases: [],
      urlId: String(song.rid || "").replace(/^MUSIC_/, ""),
      lyricId: String(song.rid || "").replace(/^MUSIC_/, ""),
      directUrls: []
    };
  }
  return null;
}

function normalizeSearchItem(site, item) {
  if (!item || !item.id) return null;
  return {
    site,
    platform: qqMusicPlatformForSite(site),
    id: String(item.id),
    name: clean(item.name),
    artist: (Array.isArray(item.artist) ? item.artist : [item.artist]).map((value) => clean(value, 40)).filter(Boolean),
    album: clean(item.album),
    urlId: String(item.url_id || item.id),
    lyricId: String(item.lyric_id || item.id)
  };
}

function splitArtists(value) {
  return String(value || "").split(/[、,，/&·]|\s+-\s+/).map((part) => part.trim()).filter(Boolean).slice(0, 4);
}

export function createQqMusicResolver({
  loadMeting,
  resolveRedirect = null,
  callTimeoutMs = 12_000
} = {}) {
  if (typeof loadMeting !== "function") throw new TypeError("loadMeting must be a function");

  async function client(site, { format = true } = {}) {
    const Meting = await loadMeting();
    if (!Meting) throw musicError("MEDIA_UNAVAILABLE", "本机还没装音乐解析组件（@meting/core）");
    return new Meting(site).format(format);
  }

  async function call(site, method, args, { format = true, signal } = {}) {
    const meting = await client(site, { format });
    return withDeadline(meting[method](...args), callTimeoutMs, signal);
  }

  async function detail(site, id, { signal } = {}) {
    const raw = await call(site, "song", [id], { format: false, signal });
    const song = normalizeQqMusicDetail(site, raw);
    if (!song) return null;
    return { ...song, site, platform: qqMusicPlatformForSite(site), platformName: QQ_MUSIC_PLATFORM_NAMES[qqMusicPlatformForSite(site)] || site };
  }

  async function search(query, { site = "netease", limit = 8, signal, type } = {}) {
    const keyword = clean(query, 80);
    if (!keyword) return [];
    const parsed = parseJson(await call(site, "search", [keyword, { page: 1, limit: Math.max(1, Math.min(20, limit)), ...(type ? { type } : {}) }], { signal }));
    return (Array.isArray(parsed) ? parsed : []).map((item) => normalizeSearchItem(site, item)).filter(Boolean).slice(0, limit);
  }

  async function lyrics(song, { signal } = {}) {
    if (!song?.lyricId) return null;
    const parsed = parseJson(await call(song.site, "lyric", [song.lyricId], { signal }));
    if (!parsed?.lyric) return null;
    const original = parseQqLrc(parsed.lyric);
    const translated = parsed.tlyric ? parseQqLrc(parsed.tlyric).lines : [];
    return { lines: mergeQqTranslatedLyrics(original.lines, translated), credits: original.credits, translated: translated.length > 0 };
  }

  async function matchOn(site, { title, artists }, { signal } = {}) {
    const results = await search(`${title} ${artists[0] || ""}`.trim(), { site, limit: 8, signal }).catch(() => []);
    const match = pickQqSongMatch(results, { title, artists });
    if (!match) return null;
    const song = await detail(site, match.id, { signal }).catch(() => null);
    if (song) return song;
    return {
      site,
      platform: match.platform,
      platformName: QQ_MUSIC_PLATFORM_NAMES[match.platform] || site,
      id: match.id,
      title: match.name,
      artists: match.artist,
      album: match.album,
      durationSeconds: 0,
      cover: "",
      vip: null,
      publishDate: "",
      aliases: [],
      urlId: match.urlId,
      lyricId: match.lyricId,
      directUrls: []
    };
  }

  // A music-N candidate (card or link) or a song-N search result → song
  // facts plus lyrics. A card without a usable song id is matched by its
  // title and artist; the result says so.
  async function resolve(candidate = {}, { signal, withLyrics = true } = {}) {
    let ref = candidate.site && candidate.id
      ? { site: candidate.site, id: candidate.id }
      : parseQqMusicSongRef(candidate.url) || parseQqMusicSongRef(candidate.audioUrl);
    if (ref?.short && typeof resolveRedirect === "function") {
      const finalUrl = await resolveRedirect(candidate.url, { signal }).catch(() => "");
      ref = parseQqMusicSongRef(finalUrl);
    }
    let song = null;
    let matchedBy = "link";
    if (ref?.id) song = await detail(ref.site, ref.id, { signal }).catch((error) => {
      if (error?.code === "MEDIA_UNAVAILABLE") throw error;
      return null;
    });
    if (!song) {
      const title = clean(candidate.title, 80);
      const artists = Array.isArray(candidate.artists) ? candidate.artists : splitArtists(candidate.artist || candidate.description);
      if (!title || title === "一首歌") return null;
      const preferred = ref?.site || QQ_MUSIC_SITES[candidate.platform] || "";
      for (const site of [...new Set([preferred, ...SEARCH_SITES].filter(Boolean))]) {
        song = await matchOn(site, { title, artists }, { signal });
        if (song) break;
      }
      matchedBy = "search";
    }
    if (!song) return null;
    song.matchedBy = matchedBy;
    if (withLyrics) song.lyrics = await lyrics(song, { signal }).catch(() => null);
    return song;
  }

  // Where this song's audio may be fetched, best first, lazily: the card's
  // own stream (platform media hosts only), the platform's direct or stream
  // URL, then the same title and artist on another platform. Every URL is
  // still downloaded and validated by the caller.
  async function* audioSources(song, { candidate = {}, signal, crossPlatform = true } = {}) {
    const seen = new Set();
    const offer = (url, via, site = song?.site) => {
      const value = clean(url, 2000);
      if (!value || seen.has(value) || !isQqTrustedMusicAudioUrl(value)) return null;
      seen.add(value);
      return { url: value, via, site };
    };
    const card = offer(candidate.audioUrl, "card");
    if (card) yield card;
    if (!song) return;
    for (const url of song.directUrls || []) {
      const direct = offer(url, "platform");
      if (direct) yield direct;
    }
    if (song.urlId) {
      const parsed = parseJson(await call(song.site, "url", [song.urlId, 320], { signal }).catch(() => null));
      const stream = offer(parsed?.url, "platform");
      if (stream) yield stream;
    }
    if (song.site === "netease" && /^\d+$/.test(String(song.id))) {
      const outer = offer(`https://music.163.com/song/media/outer/url?id=${song.id}.mp3`, "platform");
      if (outer) yield outer;
    }
    if (!crossPlatform || !song.title) return;
    for (const site of SEARCH_SITES.filter((value) => value !== song.site)) {
      const other = await matchOn(site, { title: song.title, artists: song.artists || [] }, { signal }).catch(() => null);
      if (!other) continue;
      for (const url of other.directUrls || []) {
        const direct = offer(url, "other_platform", site);
        if (direct) yield { ...direct, platformName: other.platformName };
      }
      if (other.urlId) {
        const parsed = parseJson(await call(site, "url", [other.urlId, 320], { signal }).catch(() => null));
        const stream = offer(parsed?.url, "other_platform", site);
        if (stream) yield { ...stream, platformName: other.platformName };
      }
    }
  }

  // Lyric search (NetEase type 1006): songs whose lyrics contain the heard
  // words. A guess for recognizing a song from sung lines.
  async function searchByLyrics(text, { signal, limit = 5 } = {}) {
    const phrase = clean(String(text || "").replace(/[，。！？、,.!?~～]+/g, " "), 40);
    if ([...phrase.replace(/\s+/g, "")].length < 6) return [];
    return search(phrase, { site: "netease", type: 1006, limit, signal }).catch(() => []);
  }

  return {
    available: async () => Boolean(await loadMeting()),
    resolve,
    detail,
    search,
    lyrics,
    audioSources,
    searchByLyrics
  };
}
