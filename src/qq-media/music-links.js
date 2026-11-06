// Pure helpers for shared songs: which platform song a card or link points
// at, which hosts may serve its audio, LRC lyric parsing and conservative
// title/artist matching. Nothing here touches the network.

// Meting site names for the music platforms the message classifier knows.
export const QQ_MUSIC_SITES = Object.freeze({
  "netease-music": "netease",
  "qq-music": "tencent",
  kugou: "kugou",
  kuwo: "kuwo"
});

export const QQ_MUSIC_PLATFORM_NAMES = Object.freeze({
  "netease-music": "网易云音乐",
  "qq-music": "QQ音乐",
  kugou: "酷狗音乐",
  kuwo: "酷我音乐"
});

const siteToPlatform = Object.freeze(Object.fromEntries(Object.entries(QQ_MUSIC_SITES).map(([platform, site]) => [site, platform])));

export function qqMusicPlatformForSite(site) {
  return siteToPlatform[String(site || "")] || "";
}

function parseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(host, pattern) {
  return pattern.test(String(host || "").toLowerCase());
}

// A song reference parsed from a share link. `short` means the link must be
// expanded (through the safe redirect resolver) before it names a song.
export function parseQqMusicSongRef(value) {
  const url = parseUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  let text = url.href;
  try {
    text = decodeURIComponent(url.href);
  } catch {
    // keep the encoded form
  }
  if (hostMatches(host, /(?:^|\.)163cn\.tv$/)) return { platform: "netease-music", site: "netease", id: "", short: true };
  if (hostMatches(host, /(?:^|\.)music\.163\.com$/)) {
    const outer = text.match(/\/song\/media\/outer\/url\?(?:.*&)?id=(\d{1,20})/i);
    const song = outer || text.match(/\/song(?:\/|\?(?:[^#]*&)?id=)(\d{1,20})/i);
    return song ? { platform: "netease-music", site: "netease", id: song[1] } : null;
  }
  if (hostMatches(host, /(?:^|\.)y\.qq\.com$/)) {
    const mid = text.match(/[?&#]songmid=([0-9A-Za-z]{8,24})/i)
      || text.match(/\/songDetail\/([0-9A-Za-z]{8,24})/i)
      || text.match(/\/song\/([0-9A-Za-z]{8,24})\.html/i);
    if (mid) return { platform: "qq-music", site: "tencent", id: mid[1] };
    const songId = text.match(/[?&#]songid=(\d{1,20})/i);
    if (songId) return { platform: "qq-music", site: "tencent", id: "", songId: songId[1] };
    if (/\/base\/fcgi-bin\/u\b/i.test(url.pathname) || /^c\d*\.y\.qq\.com$/.test(host)) return { platform: "qq-music", site: "tencent", id: "", short: true };
    return null;
  }
  if (hostMatches(host, /(?:^|\.)kugou\.com$/)) {
    const hash = text.match(/[?&#/]hash=([0-9a-f]{32})\b/i);
    if (hash) return { platform: "kugou", site: "kugou", id: hash[1].toUpperCase() };
    if (/^t\d*\.kugou\.com$/.test(host) || /\/share\//i.test(url.pathname)) return { platform: "kugou", site: "kugou", id: "", short: true };
    return null;
  }
  if (hostMatches(host, /(?:^|\.)kuwo\.cn$/)) {
    const rid = text.match(/\/(?:play_detail|yinyue)\/(\d{1,20})/i)
      || text.match(/[?&#](?:rid|musicId|mid)=(?:MUSIC_)?(\d{1,20})/i);
    return rid ? { platform: "kuwo", site: "kuwo", id: rid[1] } : null;
  }
  return null;
}

export function isQqMusicShareUrl(value) {
  return Boolean(parseQqMusicSongRef(value));
}

// Audio may only come from the platforms' own media hosts. The card's stream
// URL is untrusted message data, so anything else falls back to the
// platform API or a name search.
const audioHosts = /(?:^|\.)(?:126\.net|163\.com|qq\.com|kugou\.com|kuwo\.cn)$/i;

export function isQqTrustedMusicAudioUrl(value) {
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  if (url.port && !["80", "443"].includes(url.port)) return false;
  return audioHosts.test(url.hostname) && !/\/404\b/.test(url.pathname);
}

// LRC (and NetEase's JSON credit lines) → timed lines. Metadata tags such as
// [ti:] or [offset:] are dropped; credit lines (作词/作曲/…) are kept apart.
// A short "role: names" label (作词/编曲/钢琴/母带/版权/出品…) before a colon.
const creditPattern = /^(?:[^:：\s]{0,8}(?:词|曲|编|制作|监制|出品|混音|母带|录音|人声|和声|配唱|演唱|原唱|吉他|钢琴|贝斯|鼓|弦|键盘|合成|采样|统筹|企划|策划|发行|版权|宣传|设计|OP|SP|ISRC)[^:：]{0,8}|lyricist|lyrics|composer|arranger|producer|mixing|mastering|recording|vocals?|guitar|piano|bass|drums?)\s*[:：]\s*\S/i;

export function parseQqLrc(text, { maxLines = 400 } = {}) {
  const lines = [];
  const credits = [];
  let offset = 0;
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("{")) {
      try {
        const parsed = JSON.parse(line);
        const value = (Array.isArray(parsed.c) ? parsed.c : []).map((part) => String(part?.tx || "")).join("").trim();
        if (value) credits.push(value.slice(0, 80));
      } catch {
        // not a credit line
      }
      continue;
    }
    const offsetTag = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (offsetTag) {
      offset = Number(offsetTag[1]) / 1000;
      continue;
    }
    if (/^\[[a-z]+:[^\]]*\]$/i.test(line)) continue;
    const times = [];
    let rest = line;
    for (;;) {
      const match = rest.match(/^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/);
      if (!match) break;
      times.push(Number(match[1]) * 60 + Number(String(match[2]).replace(":", ".")));
      rest = rest.slice(match[0].length);
    }
    const value = rest.replace(/<\d+:\d+(?:\.\d+)?>/g, "").trim();
    if (!value) continue;
    if (creditPattern.test(value)) {
      credits.push(value.slice(0, 80));
      continue;
    }
    // The opening "歌名 - 歌手" line many platforms put at 0:00.
    if (!lines.length && times.length && times[0] < 2 && / - /.test(value) && value.length <= 80) continue;
    for (const time of times.length ? times : [null]) {
      lines.push({ time: time == null ? null : Math.max(0, Math.round((time - offset) * 100) / 100), text: value.slice(0, 200) });
    }
  }
  lines.sort((left, right) => (left.time ?? Number.MAX_SAFE_INTEGER) - (right.time ?? Number.MAX_SAFE_INTEGER));
  return { lines: lines.slice(0, maxLines), credits: [...new Set(credits)].slice(0, 12) };
}

// Attach a translated LRC to the original lines by timestamp.
export function mergeQqTranslatedLyrics(lines = [], translated = []) {
  if (!translated.length) return lines;
  const byTime = new Map(translated.filter((line) => line.time != null).map((line) => [line.time.toFixed(1), line.text]));
  return lines.map((line) => {
    const translation = line.time == null ? "" : byTime.get(line.time.toFixed(1));
    return translation && translation !== line.text ? { ...line, translation } : line;
  });
}

export function formatQqClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

export function formatQqLyricExcerpt(lines = [], { maxLines = 60, maxChars = 3000, from = 0, to = 0 } = {}) {
  const selected = lines.filter((line) => line.time == null || ((!from || line.time >= from - 1) && (!to || line.time <= to + 1)));
  const output = [];
  let chars = 0;
  for (const line of selected.slice(0, maxLines)) {
    const text = `${line.time == null ? "" : `[${formatQqClock(line.time)}] `}${line.text}${line.translation ? `（${line.translation}）` : ""}`;
    if (chars + text.length > maxChars) break;
    output.push(text);
    chars += text.length + 1;
  }
  const omitted = selected.length - output.length;
  return { text: output.join("\n"), omitted: Math.max(0, omitted) };
}

export function normalizeQqSongText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s'"`·・.,，。!！?？、;；:：\-_~～/\\|&＆+＋*]+/g, "")
    .trim();
}

function stripVersionNote(value) {
  return String(value || "").replace(/[(（[【].*?[)）\]】]/g, "").trim();
}

// The best search result for a known title/artist, or null when nothing
// shares the title: a wrong song is worse than none.
export function pickQqSongMatch(results = [], { title = "", artists = [] } = {}) {
  const wantedTitle = normalizeQqSongText(stripVersionNote(title));
  if (!wantedTitle) return null;
  const wantedArtists = (Array.isArray(artists) ? artists : String(artists || "").split(/[、,，/&]| - |\s+/))
    .map(normalizeQqSongText)
    .filter(Boolean);
  let best = null;
  for (const [index, item] of (Array.isArray(results) ? results : []).entries()) {
    const name = normalizeQqSongText(stripVersionNote(item?.name));
    if (!name) continue;
    let score = 0;
    if (name === wantedTitle) score += 10;
    else if (name.includes(wantedTitle) || wantedTitle.includes(name)) score += 4;
    else continue;
    const itemArtists = (Array.isArray(item.artist) ? item.artist : [item.artist]).map(normalizeQqSongText).filter(Boolean);
    if (wantedArtists.length && itemArtists.some((artist) => wantedArtists.some((wanted) => artist.includes(wanted) || wanted.includes(artist)))) score += 6;
    else if (wantedArtists.length) score -= 4;
    if (/live|伴奏|翻唱|cover|remix|dj/i.test(String(item.name)) && !/live|伴奏|翻唱|cover|remix|dj/i.test(String(title))) score -= 2;
    score -= index * 0.1;
    if (score >= 7 && (!best || score > best.score)) best = { score, item };
  }
  return best ? best.item : null;
}
