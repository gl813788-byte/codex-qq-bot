import { classifyQqSharedContent, extractQqUrls } from "../qq-message-content.js";

// Videos and voice clips a turn can watch or hear. Candidates come only from
// the triggering message, its quote and expanded chat records, each with a
// turn-scoped selector (video-1, audio-1) so the model never passes raw paths
// or signed QQ URLs. Platform links are limited to known public video sites
// because the downloader must never be pointed at arbitrary hosts.

export const QQ_MEDIA_VIDEO_PLATFORMS = Object.freeze(["bilibili", "douyin", "kuaishou", "youtube"]);
const MAX_VIDEOS = 6;
const MAX_AUDIOS = 6;

export function isQqWatchableVideoUrl(url) {
  const classified = classifyQqSharedContent({ url });
  return classified.kind === "video" && QQ_MEDIA_VIDEO_PLATFORMS.includes(classified.platform);
}

export function collectQqMediaCandidates(event = {}) {
  const videos = [];
  const audios = [];
  const seenVideo = new Set();
  const seenAudio = new Set();
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
      if (!card?.url || !isQqWatchableVideoUrl(card.url)) continue;
      addVideo({ kind: "link", source, senderName, platform: classifyQqSharedContent({ url: card.url }).platform, title: card.title || "", url: card.url });
    }
    const linkSources = [content.plainText, content.text, ...(content.links || [])];
    for (const url of extractQqUrls(linkSources)) {
      if (!isQqWatchableVideoUrl(url)) continue;
      addVideo({ kind: "link", source, senderName, platform: classifyQqSharedContent({ url }).platform, title: "", url });
    }
  }
  return { videos, audios };
}

export function findQqMediaCandidate(candidates = {}, selector = "") {
  const value = String(selector || "").trim().toLowerCase();
  if (!value) return null;
  return [...(candidates.videos || []), ...(candidates.audios || [])].find((item) => item.selector === value) || null;
}

const sourceLabels = Object.freeze({ current: "当前消息", quoted: "被引用消息", forward: "聊天记录" });
const platformLabels = Object.freeze({ bilibili: "B站", douyin: "抖音", kuaishou: "快手", youtube: "YouTube", qq: "QQ" });

export function formatQqMediaCandidates(candidates = {}, { available = {} } = {}) {
  const videos = candidates.videos || [];
  const audios = candidates.audios || [];
  if (!videos.length && !audios.length) return "";
  const lines = ["【本轮可看/可听的媒体】"];
  for (const video of videos) {
    const label = video.kind === "qq_video" ? "QQ 视频" : `${platformLabels[video.platform] || ""}视频链接`;
    lines.push(`- ${video.selector}：${label}${video.title ? `《${video.title.slice(0, 60)}》` : ""}（${sourceLabels[video.source] || video.source}${video.senderName ? `，${video.senderName}` : ""}）`);
  }
  for (const audio of audios) {
    lines.push(`- ${audio.selector}：语音（${sourceLabels[audio.source] || audio.source}${audio.senderName ? `，${audio.senderName}` : ""}）`);
  }
  const tips = [];
  if (videos.length) {
    tips.push(available.video
      ? "想知道视频讲了什么、好不好笑，就像人一样先点开：qq_media.video(action=watch, selector) 会给你分镜图、时间轴台词和声音；没看过就别装看过"
      : "本机还没装视频分镜组件，看不了视频内容；只能根据标题聊，别假装看过");
  }
  if (audios.length) {
    tips.push(available.audio
      ? "语音可以用 qq_media.audio(action=listen, selector) 听（转写+语气+背景声）"
      : "本机还没装语音识别组件，听不了语音；可以如实说没听清");
  }
  if (tips.length) lines.push(`${tips.join("；")}。`);
  return lines.join("\n");
}
