import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

// Optional local media understanding: the dsh-video-storyboard CLI for
// videos, a SenseVoice/CED worker for audio, and yt-dlp for public video
// links. Everything lives under one tools directory installed by
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
  const [ffmpeg, ffprobe, storyboard, sherpa, senseVoice, tokens, vad, tagging, labels] = await Promise.all([
    findExecutable(ffmpegPath),
    findExecutable(ffprobePath),
    fileExists(paths.storyboardCli),
    fileExists(paths.sherpaPackage),
    fileExists(paths.senseVoiceModel),
    fileExists(paths.senseVoiceTokens),
    fileExists(paths.vadModel),
    fileExists(paths.taggingModel),
    fileExists(paths.taggingLabels)
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
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", inputPath
    ], { timeoutMs: 20_000, maxOutputBytes: 256 * 1024, signal, env: childEnv() });
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      parsed = {};
    }
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    return {
      durationSeconds: Number(parsed.format?.duration) || 0,
      hasVideo: Boolean(video),
      hasAudio: streams.some((stream) => stream.codec_type === "audio"),
      width: Number(video?.width) || 0,
      height: Number(video?.height) || 0
    };
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
    probe,
    downloadLink,
    transcribe,
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
