import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

// Optional local media understanding: the dsh-video-storyboard CLI for
// videos, a SenseVoice/CED worker for audio (plus essentia.js tempo/key
// analysis), Meting for music-platform songs and lyrics, and yt-dlp for
// public video links. Everything lives under one tools directory installed by
// `ncc media install`; the Hub only inspects it and runs bounded child
// processes, one job at a time with a short queue, so a phone never runs two
// heavy media jobs at once or blocks QQ replies behind them.

export const QQ_MEDIA_INSTALL_HINT = "npm run ncc -- media install";

export function resolveQqMediaToolPaths(toolsDir) {
  const dir = String(toolsDir || "");
  return {
    toolsDir: dir,
    storyboardCli: join(dir, "node_modules", "dsh-video-storyboard", "bin", "storyboard.mjs"),
    sherpaPackage: join(dir, "node_modules", "sherpa-onnx-node", "package.json"),
    senseVoiceModel: join(dir, "models", "sense-voice", "model.int8.onnx"),
    senseVoiceTokens: join(dir, "models", "sense-voice", "tokens.txt"),
    vadModel: join(dir, "models", "silero_vad.onnx"),
    taggingModel: join(dir, "models", "audio-tagging", "model.int8.onnx"),
    taggingLabels: join(dir, "models", "audio-tagging", "class_labels_indices.csv"),
    bundledYtDlp: join(dir, "bin", "yt-dlp"),
    metingPackage: join(dir, "node_modules", "@meting", "core", "package.json"),
    essentiaPackage: join(dir, "node_modules", "essentia.js", "package.json"),
    cacheDir: join(dir, "cache"),
    dshHome: join(dir, "dsh-home")
  };
}

export async function findQqExecutable(name, { env = process.env, isExecutable = defaultIsExecutable } = {}) {
  const value = String(name || "");
  if (!value) return "";
  if (value.includes("/")) return (await isExecutable(value)) ? value : "";
  for (const dir of String(env.PATH || "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, value);
    if (await isExecutable(candidate)) return candidate;
  }
  return "";
}

async function defaultIsExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function defaultFileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function inspectQqMediaTools({
  toolsDir,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  ytDlpPath = "",
  env = process.env,
  fileExists = defaultFileExists,
  findExecutable = (name) => findQqExecutable(name, { env })
} = {}) {
  const paths = resolveQqMediaToolPaths(toolsDir);
  const [ffmpeg, ffprobe, storyboard, sherpa, senseVoice, tokens, vad, tagging, labels, meting, essentia] = await Promise.all([
    findExecutable(ffmpegPath),
    findExecutable(ffprobePath),
    fileExists(paths.storyboardCli),
    fileExists(paths.sherpaPackage),
    fileExists(paths.senseVoiceModel),
    fileExists(paths.senseVoiceTokens),
    fileExists(paths.vadModel),
    fileExists(paths.taggingModel),
    fileExists(paths.taggingLabels),
    fileExists(paths.metingPackage),
    fileExists(paths.essentiaPackage)
  ]);
  const ytDlp = (ytDlpPath && await findExecutable(ytDlpPath))
    || (await findExecutable(paths.bundledYtDlp))
    || (await findExecutable("yt-dlp"));
  const missing = [];
  if (!ffmpeg) missing.push("ffmpeg");
  if (!ffprobe) missing.push("ffprobe");
  if (!storyboard) missing.push("dsh-video-storyboard");
  if (!sherpa) missing.push("sherpa-onnx-node");
  if (!senseVoice || !tokens) missing.push("SenseVoice 模型");
  if (!ytDlp) missing.push("yt-dlp");
  if (!meting) missing.push("@meting/core（音乐解析）");
  if (!essentia) missing.push("essentia.js（节奏/调性分析）");
  return {
    paths,
    ffmpeg,
    ffprobe,
    ytDlp,
    video: Boolean(ffmpeg && ffprobe && storyboard),
    audio: Boolean(ffmpeg && sherpa && senseVoice && tokens),
    vad: Boolean(vad),
    tagging: Boolean(tagging && labels),
    links: Boolean(ytDlp && ffmpeg),
    // Song facts, lyrics and audio sources from music platforms.
    music: Boolean(meting),
    // Loudness curve and sound tags need only ffmpeg (+ sherpa for tags);
    // tempo, key and pitch need essentia.js.
    analysis: Boolean(ffmpeg && ffprobe),
    essentia: Boolean(essentia),
    missing
  };
}

export function createQqMediaRuntime({
  toolsDir,
  workerScript,
  nodePath = process.execPath,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  ytDlpPath = "",
  cookiesFile = "",
  maxVideoSeconds = 1200,
  maxDownloadBytes = 200 * 1024 * 1024,
  asrLanguage = "auto",
  asrThreads = 2,
  jobTimeoutMs = 300_000,
  maxQueued = 2,
  env = process.env,
  runProcess,
  inspect = inspectQqMediaTools,
  // Optional async () => { ok, availableBytes, minimumBytes }: refuses a job
  // when the host is too short of memory for another heavy child process.
  checkMemory = null,
  statusTtlMs = 60_000,
  now = Date.now
} = {}) {
  if (typeof runProcess !== "function") throw new TypeError("runProcess must be a function");
  let cachedStatus = null;
  let active = 0;
  const waiting = [];

  async function status({ refresh = false } = {}) {
    if (!refresh && cachedStatus && now() - cachedStatus.at < statusTtlMs) return cachedStatus.value;
    const value = await inspect({ toolsDir, ffmpegPath, ffprobePath, ytDlpPath, env });
    cachedStatus = { at: now(), value };
    return value;
  }

  // One media job at a time; a full queue refuses instead of piling up
  // processes on a memory-constrained host.
  async function runJob(task) {
    if (active >= 1) {
      if (waiting.length >= Math.max(0, maxQueued)) {
        const error = new Error("媒体处理正忙，稍后再试");
        error.code = "MEDIA_BUSY";
        throw error;
      }
      await new Promise((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      if (typeof checkMemory === "function") {
        const memory = await checkMemory();
        if (!memory?.ok) {
          const error = new Error(`本机可用内存不足（${Math.round((memory?.availableBytes || 0) / 1048576)}MB，需要至少 ${Math.round((memory?.minimumBytes || 0) / 1048576)}MB），这次先不处理媒体`);
          error.code = "MEDIA_LOW_MEMORY";
          throw error;
        }
      }
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active = Math.max(0, active - 1);
    }
  }

  function childEnv(extra = {}) {
    const paths = resolveQqMediaToolPaths(toolsDir);
    return {
      PATH: env.PATH || "/usr/bin:/bin",
      HOME: env.HOME || "/tmp",
      LANG: env.LANG || "C.UTF-8",
      ...(env.TMPDIR ? { TMPDIR: env.TMPDIR } : {}),
      ...(env.HTTPS_PROXY ? { HTTPS_PROXY: env.HTTPS_PROXY } : {}),
      ...(env.HTTP_PROXY ? { HTTP_PROXY: env.HTTP_PROXY } : {}),
      ...(env.https_proxy ? { https_proxy: env.https_proxy } : {}),
      ...(env.http_proxy ? { http_proxy: env.http_proxy } : {}),
      ...(env.NO_PROXY ? { NO_PROXY: env.NO_PROXY } : {}),
      XDG_CACHE_HOME: paths.cacheDir,
      ...extra
    };
  }

  async function probe(inputPath, { signal } = {}) {
    const tools = await status();
    if (!tools.ffprobe) throw mediaError("MEDIA_UNAVAILABLE", "本机没有 ffprobe");
    const result = await runProcess(tools.ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration,format_name,bit_rate:format_tags:stream=codec_type,codec_name,width,height,sample_rate,channels:stream_disposition=attached_pic",
      "-of", "json", "--", inputPath
    ], { timeoutMs: 20_000, maxOutputBytes: 1024 * 1024, signal, env: childEnv() });
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      parsed = {};
    }
    return normalizeQqProbe(parsed);
  }

  // Public platform links only (the caller validates the host). The format
  // selector keeps downloads small: a 480p scan copy is enough for 800px cells.
  async function downloadLink(url, { outputDir, signal } = {}) {
    const tools = await status();
    if (!tools.links) throw mediaError("MEDIA_UNAVAILABLE", `本机没有 yt-dlp，无法下载视频链接（安装：${QQ_MEDIA_INSTALL_HINT}）`);
    await mkdir(outputDir, { recursive: true });
    const maxMb = Math.max(1, Math.floor(maxDownloadBytes / 1024 / 1024));
    const args = [
      "--no-playlist", "--no-progress", "--no-warnings", "--no-mtime", "--no-part",
      "--ffmpeg-location", tools.ffmpeg,
      "-f", "bv*[height<=480]+ba/b[height<=480]/wv*+ba/w/b",
      "--merge-output-format", "mp4",
      "--max-filesize", `${maxMb}M`,
      "--match-filter", `!is_live & duration <=? ${Math.max(10, Math.floor(maxVideoSeconds * 3))}`,
      "--socket-timeout", "20",
      "--retries", "2",
      "--write-info-json", "--no-write-playlist-metafiles",
      "-o", join(outputDir, "video.%(ext)s"),
      ...(cookiesFile ? ["--cookies", cookiesFile] : []),
      "--", String(url)
    ];
    await runJob(() => runProcess(tools.ytDlp, args, {
      timeoutMs: jobTimeoutMs, maxOutputBytes: 512 * 1024, signal, env: childEnv(), killProcessGroup: true
    }));
    const entries = await readdir(outputDir);
    const file = entries.find((name) => /^video\.(?:mp4|mkv|webm|flv|mov)$/i.test(name));
    if (!file) throw mediaError("MEDIA_DOWNLOAD_FAILED", "视频没有下载成功（可能超出大小/时长限制，或需要登录）");
    const path = join(outputDir, file);
    const info = await readFile(join(outputDir, "video.info.json"), "utf8").then(JSON.parse).catch(() => ({}));
    const size = (await stat(path)).size;
    if (size > maxDownloadBytes) throw mediaError("MEDIA_TOO_LARGE", "下载的视频超出大小限制");
    return {
      path,
      bytes: size,
      title: compact(info.title, 120),
      uploader: compact(info.uploader || info.channel, 40),
      description: compact(info.description, 300),
      durationSeconds: Number(info.duration) || 0
    };
  }

  // Facts about a public video link without downloading it: one yt-dlp run
  // printing a fixed set of fields (the full JSON with formats can be huge).
  async function inspectLink(url, { signal } = {}) {
    const tools = await status();
    if (!tools.ytDlp) throw mediaError("MEDIA_UNAVAILABLE", `本机没有 yt-dlp，无法解析视频链接（安装：${QQ_MEDIA_INSTALL_HINT}）`);
    const fields = [
      "id", "title", "uploader", "channel", "creator", "duration", "description", "view_count", "like_count",
      "comment_count", "repost_count", "upload_date", "timestamp", "tags", "categories", "track", "artist", "artists",
      "album", "webpage_url", "extractor_key", "width", "height", "is_live", "age_limit"
    ];
    const args = [
      "--no-playlist", "--no-warnings", "--skip-download", "--no-write-comments",
      "--socket-timeout", "20", "--retries", "1",
      "-O", `%(.{${fields.join(",")}})j`,
      ...(cookiesFile ? ["--cookies", cookiesFile] : []),
      "--", String(url)
    ];
    const result = await runJob(() => runProcess(tools.ytDlp, args, {
      timeoutMs: Math.min(jobTimeoutMs, 90_000), maxOutputBytes: 1024 * 1024, signal, env: childEnv(), allowFailure: true, killProcessGroup: true
    }));
    const info = parseLastJsonLine(result.stdout);
    if (!info) {
      const reason = String(result.stderr || "").split(/\r?\n/).filter((line) => /ERROR/i.test(line)).pop() || "";
      throw mediaError("MEDIA_PARSE_FAILED", `没能解析这个链接${reason ? `（${compact(reason.replace(/^.*?ERROR:\s*/i, ""), 160)}）` : ""}`);
    }
    return normalizeQqLinkInfo(info);
  }

  // Local music/voice analysis (loudness curve, sound tags, optional sung
  // words, and with essentia.js tempo/key/danceability or voice pitch).
  async function analyze(inputPath, { mode = "music", from = 0, to = 0, focus = null, asr = false, tags = true, signal, maxSeconds = 600 } = {}) {
    const tools = await status();
    if (!tools.analysis) throw mediaError("MEDIA_UNAVAILABLE", `本机没有 ffmpeg/ffprobe，分析不了声音（安装：${QQ_MEDIA_INSTALL_HINT}）`);
    const args = [
      "--max-old-space-size=256", workerScript, "analyze",
      "--tools", toolsDir, "--input", inputPath,
      "--mode", mode === "voice" ? "voice" : "music",
      "--language", asrLanguage, "--threads", String(asrThreads),
      "--max-seconds", String(Math.max(5, Math.floor(maxSeconds))),
      "--ffmpeg", tools.ffmpeg,
      "--tags", tags && tools.tagging ? "1" : "0",
      "--asr", asr && tools.audio ? "1" : "0",
      ...(from > 0 ? ["--from", String(from)] : []),
      ...(to > from ? ["--to", String(to)] : []),
      ...(focus && focus.to > focus.from ? ["--focus-from", String(focus.from), "--focus-to", String(focus.to)] : [])
    ];
    const result = await runJob(() => runProcess(nodePath, args, {
      timeoutMs: jobTimeoutMs, maxOutputBytes: 2 * 1024 * 1024, signal, env: childEnv(), allowFailure: true, killProcessGroup: true
    }));
    const parsed = parseLastJsonLine(result.stdout);
    if (!parsed) throw mediaError("MEDIA_WORKER_FAILED", "声音分析进程没有返回结果");
    if (parsed.ok === false) throw mediaError(parsed.code || "MEDIA_WORKER_FAILED", parsed.error || "声音分析失败");
    return parsed;
  }

  async function transcribe(inputPath, { from = 0, to = 0, signal, tags = true, maxSeconds = maxVideoSeconds } = {}) {
    const tools = await status();
    if (!tools.audio) throw mediaError("MEDIA_UNAVAILABLE", `本机还没装语音识别组件（安装：${QQ_MEDIA_INSTALL_HINT}）`);
    const args = [
      "--max-old-space-size=192", workerScript, "transcribe",
      "--tools", toolsDir, "--input", inputPath,
      "--language", asrLanguage, "--threads", String(asrThreads),
      "--max-seconds", String(Math.max(5, Math.floor(maxSeconds))),
      "--ffmpeg", tools.ffmpeg,
      "--tags", tags && tools.tagging ? "1" : "0",
      ...(from > 0 ? ["--from", String(from)] : []),
      ...(to > from ? ["--to", String(to)] : [])
    ];
    const result = await runJob(() => runProcess(nodePath, args, {
      timeoutMs: jobTimeoutMs, maxOutputBytes: 2 * 1024 * 1024, signal, env: childEnv(), allowFailure: true, killProcessGroup: true
    }));
    const parsed = parseLastJsonLine(result.stdout);
    if (!parsed) throw mediaError("MEDIA_WORKER_FAILED", "语音识别进程没有返回结果");
    if (parsed.ok === false) throw mediaError(parsed.code || "MEDIA_WORKER_FAILED", parsed.error || "语音识别失败");
    return parsed;
  }

  // --text prints the citable manifest (the CLI's unknown-flag warning for
  // it is spurious). detail=high would start the optional Python OCR bridge,
  // so only low/med are used. maxSheets bounds the visual input per call.
  async function storyboard(inputPath, { outputDir, from = 0, to = 0, transcriptPath = "", detail = "med", maxSheets = 2, signal } = {}) {
    const tools = await status();
    if (!tools.video) throw mediaError("MEDIA_UNAVAILABLE", `本机还没装视频分镜组件（安装：${QQ_MEDIA_INSTALL_HINT}）`);
    await mkdir(outputDir, { recursive: true });
    const paths = resolveQqMediaToolPaths(toolsDir);
    const outPath = join(outputDir, "storyboard.jpg");
    const args = [
      "--max-old-space-size=384", paths.storyboardCli, inputPath,
      "--out", outPath, "--text",
      "--max-sheets", String(Math.max(1, Math.min(4, Math.floor(Number(maxSheets) || 2)))),
      "--detail", detail === "low" ? "low" : "med",
      "--transcript", transcriptPath ? "auto" : "off",
      ...(transcriptPath ? ["--transcript-file", transcriptPath] : []),
      ...(from > 0 ? ["--from", String(from)] : []),
      ...(to > from ? ["--to", String(to)] : [])
    ];
    const result = await runJob(() => runProcess(nodePath, args, {
      timeoutMs: jobTimeoutMs,
      maxOutputBytes: 2 * 1024 * 1024,
      signal,
      killProcessGroup: true,
      env: childEnv({
        DSH_HOME: paths.dshHome,
        DSH_VIDEO_CACHE_DIR: paths.cacheDir,
        DSH_FFMPEG_PATH: tools.ffmpeg,
        DSH_FFPROBE_PATH: tools.ffprobe,
        DSH_ASR_ENABLED: "0",
        DSH_STORYBOARD_AUTO: "1"
      })
    }));
    return parseQqStoryboardOutput(result.stdout, { outputDir });
  }

  async function writeTranscriptFile(outputDir, segments = []) {
    await mkdir(outputDir, { recursive: true });
    const path = join(outputDir, "transcript.json");
    await writeFile(path, `${JSON.stringify(segments.map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || "").slice(0, 400)
    })))}\n`, "utf8");
    return path;
  }

  async function writeBilibiliSubtitleFile(outputDir, subtitle) {
    await mkdir(outputDir, { recursive: true });
    const path = join(outputDir, "subtitle.json");
    await writeFile(path, `${JSON.stringify({ body: subtitle.body })}\n`, "utf8");
    return path;
  }

  return {
    status,
    // Work that must not overlap a media job (installing an update).
    runExclusive: (task) => runJob(task),
    probe,
    downloadLink,
    inspectLink,
    transcribe,
    analyze,
    storyboard,
    writeTranscriptFile,
    writeBilibiliSubtitleFile,
    get busy() {
      return active > 0;
    },
    get queued() {
      return waiting.length;
    }
  };
}

// The CLI prints `[sheet] <path>  WxH ...` per image, then `[done] <ms>`,
// then (with --text) the citable manifest.
export function parseQqStoryboardOutput(stdout = "", { outputDir = "" } = {}) {
  const lines = String(stdout || "").split(/\r?\n/);
  const sheets = [];
  let doneIndex = -1;
  let summary = "";
  for (const [index, line] of lines.entries()) {
    const sheet = line.match(/^\[sheet\]\s+(\S+)\s+(\d+)x(\d+)\s+(\d+)/);
    if (sheet && (!outputDir || sheet[1].startsWith(outputDir))) {
      sheets.push({ path: sheet[1], width: Number(sheet[2]), height: Number(sheet[3]), frames: Number(sheet[4]) });
    }
    if (/^\[plan\]/.test(line)) summary = line.replace(/^\[plan\]\s*/, "");
    if (/^\[done\]/.test(line)) doneIndex = index;
  }
  const manifest = doneIndex >= 0
    ? lines.slice(doneIndex + 1)
      .filter((line) => !/^\[manifest\]/.test(line) && !/evidence\.json/.test(line))
      .join("\n")
      // Local paths stay in the Hub; the model cites cells, not files.
      .replace(/\bpath="[^"]*"/g, 'path="video"')
      .replace(/video_zoom/g, "qq_media.video(action=watch, from, to)")
      .trim()
    : "";
  return { sheets, summary, manifest: manifest.slice(0, 12_000) };
}

// yt-dlp's selected fields → bounded facts the model can read.
export function normalizeQqLinkInfo(info = {}) {
  const count = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : null);
  const date = /^\d{8}$/.test(String(info.upload_date || ""))
    ? `${String(info.upload_date).slice(0, 4)}-${String(info.upload_date).slice(4, 6)}-${String(info.upload_date).slice(6, 8)}`
    : Number(info.timestamp) > 0 ? new Date(Number(info.timestamp) * 1000).toISOString().slice(0, 10) : "";
  const artists = Array.isArray(info.artists) && info.artists.length ? info.artists : info.artist ? [info.artist] : [];
  return {
    id: compact(info.id, 60),
    title: compact(info.title, 160),
    uploader: compact(info.uploader || info.channel || info.creator, 60),
    durationSeconds: Number(info.duration) > 0 ? Math.round(Number(info.duration)) : 0,
    description: compact(info.description, 600),
    views: count(info.view_count),
    likes: count(info.like_count),
    comments: count(info.comment_count),
    reposts: count(info.repost_count),
    uploadDate: date,
    tags: (Array.isArray(info.tags) ? info.tags : []).map((tag) => compact(tag, 30)).filter(Boolean).slice(0, 10),
    category: compact((Array.isArray(info.categories) ? info.categories : [])[0], 30),
    // Background music some platforms (Douyin, YouTube Music) name.
    track: compact(info.track, 80),
    artists: artists.map((artist) => compact(artist, 40)).filter(Boolean).slice(0, 4),
    album: compact(info.album, 80),
    url: /^https?:\/\//i.test(String(info.webpage_url || "")) ? String(info.webpage_url).slice(0, 500) : "",
    extractor: compact(info.extractor_key, 30),
    width: count(info.width),
    height: count(info.height),
    isLive: info.is_live === true,
    ageLimit: count(info.age_limit)
  };
}

// ffprobe JSON → stream facts plus the container's embedded tags. Cover art
// in an audio file is an attached-picture video stream, not a video track.
export function normalizeQqProbe(parsed = {}) {
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video" && Number(stream?.disposition?.attached_pic) !== 1);
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  const rawTags = parsed?.format?.tags && typeof parsed.format.tags === "object" ? parsed.format.tags : {};
  const tags = {};
  for (const [key, value] of Object.entries(rawTags)) tags[String(key).toLowerCase()] ||= String(value ?? "");
  const lyrics = String(tags.lyrics || tags.unsyncedlyrics || tags["lyrics-eng"] || "").replace(/\r\n?/g, "\n").trim();
  return {
    durationSeconds: Number(parsed?.format?.duration) || 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    format: compact(parsed?.format?.format_name, 40),
    bitRate: Number(parsed?.format?.bit_rate) || 0,
    videoCodec: compact(video?.codec_name, 20),
    audioCodec: compact(audio?.codec_name, 20),
    sampleRate: Number(audio?.sample_rate) || 0,
    channels: Number(audio?.channels) || 0,
    coverArt: streams.some((stream) => Number(stream?.disposition?.attached_pic) === 1),
    tags: {
      title: compact(tags.title, 120),
      artist: compact(tags.artist || tags.album_artist, 80),
      album: compact(tags.album, 80),
      date: compact(tags.date || tags.year, 20),
      genre: compact(tags.genre, 40),
      comment: compact(tags.comment || tags.description, 200)
    },
    lyrics: [...lyrics].slice(0, 3000).join("")
  };
}

function parseLastJsonLine(stdout = "") {
  const lines = String(stdout || "").trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // keep looking for the worker's JSON line
    }
  }
  return null;
}

function compact(value, max) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}

export function mediaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
