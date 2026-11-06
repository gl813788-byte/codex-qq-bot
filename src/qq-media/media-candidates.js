import { collectQqInboundFileCandidates } from "../qq-inbound-files.js";
import { classifyQqSharedContent, extractQqUrls } from "../qq-message-content.js";
import { QQ_MUSIC_SITES, isQqMusicShareUrl } from "./music-links.js";

// Videos, songs and voice clips a turn can watch, parse or hear. Candidates
// come only from the triggering message, its quote and expanded chat records,
// each with a turn-scoped selector (video-1, music-1, audio-1) so the model
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

export function collectQqMediaCandidates(event = {}) {
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

const sourceLabels = Object.freeze({ current: "当前消息", quoted: "被引用消息", forward: "聊天记录" });
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
  if (videos.length || musics.length) {
    tips.push("不确定是什么时先用 qq_media.parse(selector) 解析（视频：标题/作者/时长/简介/数据/BGM；歌曲：歌名/歌手/专辑/歌词），很轻，不用下载");
  }
  if (videos.length) {
    tips.push(available.video
      ? "想知道视频讲了什么、好不好笑，就像人一样先点开：qq_media.video(action=watch, selector) 会给你分镜图、时间轴台词和声音；没看过就别装看过"
      : "本机还没装视频分镜组件，看不了视频内容；只能根据标题聊，别假装看过");
  }
  if (musics.length) {
    tips.push(available.music
      ? "想知道这首歌听起来怎样，就真的去听：qq_media.music(action=listen, selector) 会下载下来，给你歌词、节奏/调性/情绪起伏和乐器人声；没听过就别装听过"
      : "本机还没装音乐解析组件，只能根据卡片上的歌名歌手聊，别假装听过");
  }
  if (audios.length) {
    tips.push(available.audio
      ? "语音可以用 qq_media.audio(action=listen, selector) 听（转写+语气+背景声），analyze 再加音高、音量和是否在唱歌"
      : "本机还没装语音识别组件，听不了语音；可以如实说没听清");
  }
  if (files.length) {
    tips.push(available.analysis === false
      ? "本机没有 ffmpeg/ffprobe，打不开这些音频/视频文件；如实说没法听/看"
      : "这些文件不用先 qq_context.download_file，直接把 file-N 交给 qq_media：歌/音频用 music(action=listen) 听，说话的录音用 audio(action=listen/analyze)，视频文件用 video(action=watch) 看，只想知道格式、时长和内嵌的歌名歌手用 parse");
  }
  if (tips.length) lines.push(`${tips.join("；")}。`);
  return lines.join("\n");
}
