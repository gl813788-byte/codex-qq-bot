import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createBilibiliClient } from "../qq-media/bilibili.js";
import { mediaError } from "../qq-media/media-runtime.js";

// Network and OneBot side effects behind qq_media: Bilibili API reads through
// the safe-fetch policy, QQ video downloads into the turn's input directory,
// and voice clips converted by NapCat (QQ voice is SILK, which ffmpeg cannot
// decode). Every returned path is a regular file inside outputDir.

const MAX_VOICE_BYTES = 20 * 1024 * 1024;

export function createQqMediaServices({
  fetchWithUrlPolicy,
  safeFetchMode = "strict",
  readResponseJson,
  writeResponseBodyToFile,
  callOneBotAction,
  maxVideoBytes = 200 * 1024 * 1024,
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

  const fetchSubtitle = (url, options) => fetchJson(url, { ...options, maxBytes: 4 * 1024 * 1024 });

  return { bilibili, fetchQqVideo, fetchVoice, fetchSubtitle, fetchJson };
}
