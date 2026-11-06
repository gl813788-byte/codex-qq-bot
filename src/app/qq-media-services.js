import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createBilibiliClient } from "../qq-media/bilibili.js";
import { mediaError } from "../qq-media/media-runtime.js";
import { isQqTrustedMusicAudioUrl } from "../qq-media/music-links.js";
import { createQqMusicResolver } from "../qq-media/music-resolver.js";

// Network and OneBot side effects behind qq_media: Bilibili API reads through
// the safe-fetch policy, QQ video downloads into the turn's input directory,
// voice clips converted by NapCat (QQ voice is SILK, which ffmpeg cannot
// decode), and songs: Meting resolves facts, lyrics and stream URLs while
// the audio itself is downloaded here through the safe-fetch policy from the
// platforms' media hosts only. Every returned path is a regular file inside
// outputDir.

const MAX_VOICE_BYTES = 20 * 1024 * 1024;
const MAX_SONG_BYTES = 60 * 1024 * 1024;
const audioExtensions = Object.freeze({ "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/flac": "flac", "audio/x-flac": "flac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav" });

export function createQqMediaServices({
  fetchWithUrlPolicy,
  safeFetchMode = "strict",
  readResponseJson,
  writeResponseBodyToFile,
  callOneBotAction,
  maxVideoBytes = 200 * 1024 * 1024,
  maxSongBytes = MAX_SONG_BYTES,
  loadMeting = async () => null,
  userAgent = "codex-qq-bot",
  mergeSignals = (...signals) => AbortSignal.any(signals.filter(Boolean))
} = {}) {
  for (const [name, value] of Object.entries({ fetchWithUrlPolicy, readResponseJson, writeResponseBodyToFile, callOneBotAction })) {
    if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  }

  async function fetchJson(url, { headers = {}, signal, maxBytes = 2 * 1024 * 1024 } = {}) {
    const response = await fetchWithUrlPolicy(url, {
      headers,
      signal: mergeSignals(signal, AbortSignal.timeout(15_000))
    }, { mode: safeFetchMode });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => undefined);
      throw mediaError("MEDIA_HTTP", `HTTP ${response.status}`);
    }
    return readResponseJson(response, { maxBytes });
  }

  async function resolveRedirect(url, { headers = {}, signal } = {}) {
    let finalUrl = String(url);
    const response = await fetchWithUrlPolicy(url, {
      headers,
      signal: mergeSignals(signal, AbortSignal.timeout(10_000))
    }, { mode: safeFetchMode, onRedirect: (next) => { finalUrl = next; } });
    await response.body?.cancel?.().catch?.(() => undefined);
    return finalUrl;
  }

  const bilibili = createBilibiliClient({ fetchJson, resolveRedirect });
  const music = createQqMusicResolver({ loadMeting, resolveRedirect });

  async function downloadTo(url, outputPath, { signal, maxBytes }) {
    const response = await fetchWithUrlPolicy(url, {
      headers: { "user-agent": userAgent },
      signal: mergeSignals(signal, AbortSignal.timeout(180_000))
    }, { mode: safeFetchMode });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => undefined);
      throw mediaError("MEDIA_DOWNLOAD_FAILED", `视频下载返回 HTTP ${response.status}`);
    }
    await writeResponseBodyToFile(response, outputPath, { maxBytes });
    return outputPath;
  }

  function refererFor(url) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    if (/qq\.com$/i.test(host)) return "https://y.qq.com/";
    if (/kugou\.com$/i.test(host)) return "https://www.kugou.com/";
    if (/kuwo\.cn$/i.test(host)) return "https://www.kuwo.cn/";
    return "https://music.163.com/";
  }

  async function copyRegularFile(source, target, maxBytes) {
    const info = await stat(source);
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw mediaError("MEDIA_TOO_LARGE", "文件为空或超出大小限制");
    await copyFile(source, target);
    return target;
  }

  // A QQ video segment: its signed URL first, then NapCat's get_file.
  async function fetchQqVideo(candidate = {}, { outputDir, signal } = {}) {
    await mkdir(outputDir, { recursive: true });
    const target = join(outputDir, "qq-video.mp4");
    if (/^https?:\/\//i.test(String(candidate.url || ""))) {
      try {
        return await downloadTo(candidate.url, target, { signal, maxBytes: maxVideoBytes });
      } catch (error) {
        if (!candidate.file) throw error;
      }
    }
    if (!candidate.file) throw mediaError("MEDIA_DOWNLOAD_FAILED", "QQ 没有给出视频地址");
    const result = await callOneBotAction("get_file", { file: candidate.file, file_id: candidate.file });
    const data = result?.body?.data || {};
    if (result?.ok && data.file && !/^https?:/i.test(String(data.file))) {
      return copyRegularFile(String(data.file), target, maxVideoBytes);
    }
    const url = String(data.url || "");
    if (result?.ok && /^https?:\/\//i.test(url)) return downloadTo(url, target, { signal, maxBytes: maxVideoBytes });
    throw mediaError("MEDIA_DOWNLOAD_FAILED", "QQ 视频已过期或无法下载");
  }

  // NapCat converts the SILK voice to a playable format on request.
  async function fetchVoice(candidate = {}, { outputDir } = {}) {
    await mkdir(outputDir, { recursive: true });
    if (!candidate.file) throw mediaError("MEDIA_DOWNLOAD_FAILED", "这条语音没有文件标识");
    for (const format of ["wav", "mp3"]) {
      const result = await callOneBotAction("get_record", { file: candidate.file, out_format: format });
      const file = String(result?.body?.data?.file || "");
      if (result?.ok && file && !/^https?:/i.test(file)) {
        return copyRegularFile(file, join(outputDir, `voice.${format}`), MAX_VOICE_BYTES);
      }
    }
    throw mediaError("MEDIA_DOWNLOAD_FAILED", "QQ 没能转换这条语音（可能已过期）");
  }

  // One song file from a music platform's media host. Redirects stay under
  // the safe-fetch policy; a redirect to an HTML page (NetEase sends VIP
  // songs to /404) is rejected by type before anything is decoded.
  async function downloadSong(url, { outputDir, signal } = {}) {
    if (!isQqTrustedMusicAudioUrl(url)) throw mediaError("MEDIA_UNTRUSTED", "这个音频地址不在音乐平台的媒体域名下");
    await mkdir(outputDir, { recursive: true });
    let finalUrl = String(url);
    const response = await fetchWithUrlPolicy(url, {
      headers: { "user-agent": userAgent, referer: refererFor(url) },
      signal: mergeSignals(signal, AbortSignal.timeout(120_000))
    }, { mode: safeFetchMode, onRedirect: (next) => { finalUrl = next; } });
    const type = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || /^text\/|json|html/.test(type) || !isQqTrustedMusicAudioUrl(finalUrl)) {
      await response.body?.cancel?.().catch?.(() => undefined);
      throw mediaError("MEDIA_DOWNLOAD_FAILED", response.ok ? "平台没有给出可播放的音频（可能是会员/版权限制）" : `音频下载返回 HTTP ${response.status}`);
    }
    const extension = audioExtensions[type] || (finalUrl.match(/\.(mp3|m4a|flac|aac|ogg|wav)(?:[?#]|$)/i)?.[1] || "mp3").toLowerCase();
    const target = join(outputDir, `song.${extension}`);
    await writeResponseBodyToFile(response, target, { maxBytes: maxSongBytes });
    return target;
  }

  const fetchSubtitle = (url, options) => fetchJson(url, { ...options, maxBytes: 4 * 1024 * 1024 });

  return { bilibili, music, fetchQqVideo, fetchVoice, fetchSubtitle, fetchJson, downloadSong, resolveRedirect };
}
