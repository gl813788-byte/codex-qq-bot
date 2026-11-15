import { qqContextImageMaxAgeMs, qqContextImageRecentMessages } from "../qq-enhancer/context-images.js";
import { collectQqInboundFileCandidates } from "../qq-inbound-files.js";
import { classifyQqSharedContent, extractQqUrls } from "../qq-message-content.js";
import { QQ_MUSIC_SITES, isQqMusicShareUrl } from "./music-links.js";

// Videos, songs and voice clips a turn can watch, parse or hear. Candidates
// come from the triggering message, its quote and expanded chat records, and
// QQ videos/voices of earlier messages in the same conversation that are
// still inside the image window (five minutes or the latest 20 messages), so
// a follow-up such as "什么游戏" can look at the video again. Each gets a
// turn-scoped selector (video-1, music-1, audio-1) so the model
// never passes raw paths or signed QQ URLs. Platform links are limited to
// known public video and music sites because the downloaders must never be
// pointed at arbitrary hosts. QQ files in the message or its quote keep the
// file-N selectors of qq_context.download_file; their names only decide what
// the directory lists, and ffprobe decides what a file really contains.

export const QQ_MEDIA_VIDEO_PLATFORMS = Object.freeze(["bilibili", "douyin", "kuaishou", "youtube", "acfun", "ixigua", "weibo", "zhihu"]);
// Posts that are often videos; yt-dlp decides when the link is opened.
export const QQ_MEDIA_MAYBE_VIDEO_PLATFORMS = Object.freeze(["xiaohongshu", "weibo"]);
const MAX_VIDEOS = 6;
const MAX_AUDIOS = 6;
const MAX_MUSICS = 6;

export function isQqWatchableVideoUrl(url) {
  const classified = classifyQqSharedContent({ url });
  if (classified.kind === "video") return QQ_MEDIA_VIDEO_PLATFORMS.includes(classified.platform);
  return classified.kind === "post" && QQ_MEDIA_MAYBE_VIDEO_PLATFORMS.includes(classified.platform);
}

// A song page on a known music platform (NetEase, QQ Music, Kugou, Kuwo).
export function isQqListenableMusicUrl(url) {
  const classified = classifyQqSharedContent({ url });
  return classified.kind === "music" && Boolean(QQ_MUSIC_SITES[classified.platform]) && isQqMusicShareUrl(url);
}

// Any link qq_media may open by URL once it appeared in the conversation.
export function isQqParsableMediaUrl(url) {
  return isQqWatchableVideoUrl(url) || isQqListenableMusicUrl(url);
}

const AUDIO_FILE_EXTENSIONS = new Set(["mp3", "flac", "wav", "m4a", "aac", "ogg", "oga", "opus", "wma", "ape", "aiff", "aif", "alac", "amr", "wv", "dsf", "dff", "mka"]);
const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "m4v", "mkv", "mov", "webm", "avi", "flv", "wmv", "ts", "m2ts", "mts", "3gp", "mpg", "mpeg", "rmvb", "rm", "vob", "ogv"]);

// "audio" / "video" from a file name's extension, otherwise "".
export function classifyQqMediaFileName(name) {
  const extension = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || "";
  if (AUDIO_FILE_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return "video";
  return "";
}

function splitMusicDescription(value) {
  // Cards put "歌手" or "歌手 · 专辑" / "歌手 - 专辑" in the description.
  const [artist, album = ""] = String(value || "").split(/\s+[·\-–]\s+|\s*·\s*/);
  return { artist: String(artist || "").trim().slice(0, 80), album: String(album || "").trim().slice(0, 80) };
}

// The fetchable part of a message's QQ videos and voices, kept with the
// conversation's recent messages. Local paths are left out.
export function snapshotQqRecentMedia(contentContext) {
  const media = contentContext?.media;
  if (!media || typeof media !== "object") return null;
  const pick = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      file: String(item?.file || "").slice(0, 300),
      url: /^https?:\/\//i.test(String(item?.url || "")) ? String(item.url).slice(0, 2000) : "",
      name: String(item?.name || "").slice(0, 120),
      sizeBytes: Number.isFinite(Number(item?.sizeBytes)) && item?.sizeBytes !== null ? Number(item.sizeBytes) : null
    }))
    .filter((item) => item.file || item.url)
    .slice(0, 4);
  const videos = pick(media.videos);
  const audios = pick(media.audios);
  return videos.length || audios.length ? { videos, audios } : null;
}

function isRecentEntryEligible(entry, index, length, now) {
  if (index >= length - qqContextImageRecentMessages) return true;
  const at = Date.parse(entry?.at || "");
  return Number.isFinite(at) && at >= now - qqContextImageMaxAgeMs;
}

export function collectQqMediaCandidates(event = {}, { recentEntries = [], now = Date.now() } = {}) {
  const videos = [];
  const audios = [];
  const musics = [];
  const seenVideo = new Set();
  const seenAudio = new Set();
  const seenMusic = new Set();
  const addMusic = (entry) => {
    const key = entry.url || `${entry.title}|${entry.artist}`;
    if (!key || seenMusic.has(key) || musics.length >= MAX_MUSICS) return;
    seenMusic.add(key);
    musics.push({ ...entry, selector: `music-${musics.length + 1}` });
  };
  const addVideo = (entry) => {
    const key = entry.url || entry.file || entry.path;
    if (!key || seenVideo.has(key) || videos.length >= MAX_VIDEOS) return;
    seenVideo.add(key);
    videos.push({ ...entry, selector: `video-${videos.length + 1}` });
  };
  const addAudio = (entry) => {
    const key = entry.file || entry.url || entry.path;
    if (!key || seenAudio.has(key) || audios.length >= MAX_AUDIOS) return;
    seenAudio.add(key);
    audios.push({ ...entry, selector: `audio-${audios.length + 1}` });
  };
  const sources = [
    { source: "current", senderName: event.senderName || "", content: event.contentContext },
    { source: "quoted", senderName: event.replyContext?.senderName || "", content: event.replyContext?.contentContext },
    { source: "forward", senderName: "", content: event.contentContext?.forward },
    { source: "forward", senderName: "", content: event.replyContext?.contentContext?.forward }
  ];
  for (const { source, senderName, content } of sources) {
    if (!content || typeof content !== "object") continue;
    for (const video of content.media?.videos || []) {
      addVideo({ kind: "qq_video", source, senderName, platform: "qq", title: video.name || "", url: video.url || "", file: video.file || "", path: video.path || "", sizeBytes: video.sizeBytes ?? null });
    }
    for (const audio of content.media?.audios || []) {
      addAudio({ kind: "qq_voice", source, senderName, url: audio.url || "", file: audio.file || "", path: audio.path || "", sizeBytes: audio.sizeBytes ?? null });
    }
    for (const card of content.cards || []) {
      if (card?.kind === "music") {
        const { artist, album } = splitMusicDescription(card.description);
        addMusic({
          kind: "music_card",
          source,
          senderName,
          platform: card.platform || "",
          platformName: card.platformName || card.appName || "",
          title: card.title || "",
          artist,
          album,
          url: card.url || "",
          audioUrl: card.audioUrl || ""
        });
        continue;
      }
      if (!card?.url || !isQqWatchableVideoUrl(card.url)) continue;
      addVideo({ kind: "link", source, senderName, platform: classifyQqSharedContent({ url: card.url }).platform, title: card.title || "", url: card.url });
    }
    const linkSources = [content.plainText, content.text, ...(content.links || [])];
    for (const url of extractQqUrls(linkSources)) {
      if (isQqListenableMusicUrl(url)) {
        const classified = classifyQqSharedContent({ url });
        addMusic({ kind: "music_link", source, senderName, platform: classified.platform, platformName: classified.platformName, title: "", artist: "", album: "", url, audioUrl: "" });
        continue;
      }
      if (!isQqWatchableVideoUrl(url)) continue;
      addVideo({ kind: "link", source, senderName, platform: classifyQqSharedContent({ url }).platform, title: "", url });
    }
  }
  // Earlier QQ videos and voices of this conversation, newest first.
  const recent = Array.isArray(recentEntries) ? recentEntries : [];
  const currentId = event.raw?.message_id == null ? "" : String(event.raw.message_id);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    if (!entry?.media || entry.isAssistant || !isRecentEntryEligible(entry, index, recent.length, now)) continue;
    if (currentId && String(entry.messageId || "") === currentId) continue;
    const senderName = String(entry.senderLabel || entry.senderName || "").slice(0, 60);
    for (const video of entry.media.videos || []) {
      addVideo({ kind: "qq_video", source: "recent", senderName, platform: "qq", title: video.name || "", url: video.url || "", file: video.file || "", path: "", sizeBytes: video.sizeBytes ?? null, at: entry.at || null });
    }
    for (const audio of entry.media.audios || []) {
      addAudio({ kind: "qq_voice", source: "recent", senderName, url: audio.url || "", file: audio.file || "", path: "", sizeBytes: audio.sizeBytes ?? null, at: entry.at || null });
    }
  }
  // Every detected QQ file stays addressable (a misnamed song still plays);
  // only media-looking names are listed in the directory.
  const files = collectQqInboundFileCandidates(event).map((file) => ({
    kind: "qq_file",
    selector: file.selector,
    name: file.name,
    sizeBytes: file.fileSize || null,
    origin: file.origin,
    mediaType: classifyQqMediaFileName(file.name)
  }));
  return { videos, audios, musics, files };
}

export function findQqMediaCandidate(candidates = {}, selector = "") {
  const value = String(selector || "").trim().toLowerCase();
  if (!value) return null;
  return [...(candidates.videos || []), ...(candidates.audios || []), ...(candidates.musics || []), ...(candidates.files || [])].find((item) => item.selector === value) || null;
}

// Media-looking QQ files of this turn (audio or video by name).
export function listQqMediaFiles(candidates = {}, mediaType = "") {
  return (candidates.files || []).filter((file) => (mediaType ? file.mediaType === mediaType : Boolean(file.mediaType)));
}

const sourceLabels = Object.freeze({ current: "当前消息", quoted: "被引用消息", forward: "聊天记录", recent: "前文消息" });

// Media this turn was triggered with (not the earlier messages kept for
// follow-ups), for counting what is new in the current message.
export function countQqTurnMedia(candidates = {}) {
  const own = (items) => (items || []).filter((item) => item.source !== "recent");
  return { videos: own(candidates.videos), audios: own(candidates.audios), musics: own(candidates.musics) };
}
export const QQ_MEDIA_PLATFORM_LABELS = Object.freeze({
  bilibili: "B站",
  douyin: "抖音",
  kuaishou: "快手",
  youtube: "YouTube",
  acfun: "AcFun",
  ixigua: "西瓜视频",
  weibo: "微博",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  qq: "QQ",
  "netease-music": "网易云音乐",
  "qq-music": "QQ音乐",
  kugou: "酷狗音乐",
  kuwo: "酷我音乐"
});
const platformLabels = QQ_MEDIA_PLATFORM_LABELS;

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return "";
  return value >= 1048576 ? `${(value / 1048576).toFixed(value >= 10 * 1048576 ? 0 : 1)}MB` : `${Math.max(1, Math.round(value / 1024))}KB`;
}

export function formatQqMediaCandidates(candidates = {}, { available = {} } = {}) {
  const videos = candidates.videos || [];
  const audios = candidates.audios || [];
  const musics = candidates.musics || [];
  const files = listQqMediaFiles(candidates);
  if (!videos.length && !audios.length && !musics.length && !files.length) return "";
  const lines = ["【本轮可看/可听的媒体】"];
  for (const video of videos) {
    const label = video.kind === "qq_video"
      ? "QQ 视频"
      : QQ_MEDIA_MAYBE_VIDEO_PLATFORMS.includes(video.platform) && classifyQqSharedContent({ url: video.url }).kind !== "video"
        ? `${platformLabels[video.platform] || ""}帖子（可能是视频）`
        : `${platformLabels[video.platform] || ""}视频链接`;
    lines.push(`- ${video.selector}：${label}${video.title ? `《${video.title.slice(0, 60)}》` : ""}（${sourceLabels[video.source] || video.source}${video.senderName ? `，${video.senderName}` : ""}）`);
  }
  for (const music of musics) {
    const label = `${music.platformName || platformLabels[music.platform] || ""}${music.kind === "music_card" ? "音乐卡片" : "歌曲链接"}`;
    const song = music.title ? `《${music.title.slice(0, 60)}》${music.artist ? ` - ${music.artist.slice(0, 40)}` : ""}` : "";
    lines.push(`- ${music.selector}：${label}${song}（${sourceLabels[music.source] || music.source}${music.senderName ? `，${music.senderName}` : ""}）`);
  }
  for (const audio of audios) {
    lines.push(`- ${audio.selector}：语音（${sourceLabels[audio.source] || audio.source}${audio.senderName ? `，${audio.senderName}` : ""}）`);
  }
  for (const file of files) {
    const size = formatFileSize(file.sizeBytes);
    lines.push(`- ${file.selector}：${file.mediaType === "video" ? "视频文件" : "音频文件"}「${String(file.name || "未命名").slice(0, 80)}」（${file.origin || "当前消息"}${size ? `，${size}` : ""}）`);
  }
  const tips = [];
  if (videos.length || musics.length || audios.length || files.length) {
    tips.push("都用 qq_media.analyze(selector) 打开：不填 using 就按类型自动（视频看画面+听台词，语音听内容，歌真的听一遍）；也可以自己挑 using——info 只看是什么（很轻，不下载）、frames 画面、speech 说的话、voice 声音特点、music 音乐、subtitle B站字幕、audio_file 把声音存成可发送的文件");
  }
  if (videos.length && !available.video) tips.push("本机还没装视频分镜组件，看不了视频画面；只能听声音或根据标题聊，别假装看过");
  if (musics.length && !available.music) tips.push("本机还没装音乐解析组件，只能根据卡片上的歌名歌手聊，别假装听过");
  if ((audios.length || videos.length) && !available.audio) tips.push("本机还没装语音识别组件，听不了说的话；可以如实说没听清");
  if (files.length && available.analysis === false) tips.push("本机没有 ffmpeg/ffprobe，打不开这些音频/视频文件；如实说没法听/看");
  if (files.length && available.analysis !== false) tips.push("这些文件不用先 qq_context.download_file，直接把 file-N 交给 qq_media.analyze");
  tips.push("没看没听就别装看过听过；info 只是解析，不算看过或听过");
  if (tips.length) lines.push(`${tips.join("；")}。`);
  return lines.join("\n");
}
