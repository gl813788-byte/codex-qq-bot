import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  chooseQqMediaAutoModes,
  executeQqMediaAnalyzeTool,
  executeQqMediaMusicTool,
  getQqMediaTurnState,
  normalizeQqMediaAnalyzeModes
} from "../src/app/qq-media-tool.js";
import { collectQqMediaCandidates, countQqTurnMedia, formatQqMediaCandidates, snapshotQqRecentMedia } from "../src/qq-media/media-candidates.js";
import { createQqMediaRuntime } from "../src/qq-media/media-runtime.js";

const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "qq-media-analyze-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  return { root, inputDir, outputDir };
}

function soundRuntime(calls, { video = true } = {}) {
  return {
    status: async () => ({ video, audio: true, analysis: true, music: true, essentia: true, tagging: true, ffmpeg: "/bin/ffmpeg" }),
    probe: async () => ({ durationSeconds: 95, hasAudio: true, hasVideo: true }),
    downloadLink: async (url, { outputDir }) => {
      calls.push(["download", url]);
      await mkdir(outputDir, { recursive: true });
      const path = join(outputDir, "video.mp4");
      await writeFile(path, Buffer.alloc(32, 1));
      return { path };
    },
    transcribe: async (path, options) => {
      calls.push(["transcribe", options.from, options.to]);
      return { ok: true, durationSeconds: 95, segments: [{ start: 2, end: 5, text: "我养的鱼又胖了" }], events: ["BGM"], sounds: { overall: [{ label: "Singing", prob: 0.8 }] } };
    },
    analyze: async (path, options) => {
      calls.push(["analyze", options.mode]);
      return { ok: true, durationSeconds: 95, music: { from: 0, to: 95, rhythm: { bpm: 96 }, key: { key: "C", scale: "major" } }, sounds: { overall: [{ label: "Music", prob: 0.9 }] }, speech: { segments: [] } };
    },
    extractAudio: async (path, { outputPath, from, to }) => {
      calls.push(["extract", from, to]);
      await writeFile(outputPath, Buffer.alloc(2048, 1));
      return { path: outputPath, bytes: 2048, seconds: 95 };
    },
    writeTranscriptFile: async (dir) => join(dir, "transcript.json"),
    writeBilibiliSubtitleFile: async (dir) => join(dir, "subtitle.json"),
    storyboard: async (path, { outputDir }) => {
      calls.push(["storyboard"]);
      await mkdir(outputDir, { recursive: true });
      const sheet = join(outputDir, "storyboard.jpg");
      await writeFile(sheet, jpeg);
      return { sheets: [{ path: sheet }], manifest: "cell 1 = 00:00-00:04" };
    }
  };
}

test("using is the Bot's choice and empty means automatic by media kind", () => {
  assert.deepEqual(normalizeQqMediaAnalyzeModes(undefined), { ok: true, modes: [] });
  assert.deepEqual(normalizeQqMediaAnalyzeModes(["auto"]), { ok: true, modes: [] });
  assert.deepEqual(normalizeQqMediaAnalyzeModes("speech, music speech"), { ok: true, modes: ["speech", "music"] });
  assert.deepEqual(normalizeQqMediaAnalyzeModes(["audio-file"]), { ok: true, modes: ["audio_file"] });
  const unknown = normalizeQqMediaAnalyzeModes(["ocr"]);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /不认识的：ocr/);
  assert.deepEqual(chooseQqMediaAutoModes("video"), ["frames", "speech"]);
  assert.deepEqual(chooseQqMediaAutoModes("voice"), ["speech"]);
  assert.deepEqual(chooseQqMediaAutoModes("song"), ["music"]);
  assert.deepEqual(chooseQqMediaAutoModes("audio", { probe: { durationSeconds: 12 } }), ["speech"]);
  assert.deepEqual(chooseQqMediaAutoModes("audio", { probe: { durationSeconds: 12, tags: { title: "晴天" } } }), ["music"]);
  assert.deepEqual(chooseQqMediaAutoModes("audio", { probe: { durationSeconds: 240 } }), ["music"]);
});

test("a Bilibili link's sound is heard, analyzed and exported without watching its frames", async () => {
  // 2026-11-14: "那你提取一下声音吧" after a b23.tv share; the old audio and
  // music tools took no links, so the Bot fell back to a blocked shell ffmpeg.
  const taskWorkspace = await workspace();
  const calls = [];
  const state = getQqMediaTurnState({});
  try {
    const result = await executeQqMediaAnalyzeTool({
      action: "analyze",
      url: "https://b23.tv/fmHFGKR",
      using: ["speech", "music", "audio_file"]
    }, {
      runtime: soundRuntime(calls),
      candidates: { videos: [], audios: [], musics: [] },
      state,
      taskWorkspace,
      isUrlInConversation: (url) => url === "https://b23.tv/fmHFGKR"
    });
    assert.equal(result.ok, true);
    assert.equal(result.contentItems, undefined);
    assert.deepEqual(calls.map((call) => call[0]), ["download", "transcribe", "analyze", "extract"]);
    assert.equal(calls.filter((call) => call[0] === "download").length, 1, "the video is downloaded once for every mode");
    assert.match(result.reply, /\[0:02\] 我养的鱼又胖了/);
    assert.match(result.reply, /速度约 96 BPM/);
    const exported = result.reply.match(/：(\/\S+\.m4a)/)?.[1];
    assert.ok(exported?.startsWith(taskWorkspace.outputDir), "the sound file lands in the output directory");
    assert.equal((await readFile(exported)).length, 2048);
    assert.match(result.reply, /qq_chat\.send 的 attachments（kind=file）/);
    assert.equal(state.analyses, 1);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("without using a video is watched with speech, and the reply names the other choices", async () => {
  const taskWorkspace = await workspace();
  const calls = [];
  try {
    const result = await executeQqMediaAnalyzeTool({ action: "analyze", selector: "video-1" }, {
      runtime: soundRuntime(calls),
      fetchQqVideo: async (candidate, { outputDir }) => {
        calls.push(["qq-video", candidate.file]);
        await mkdir(outputDir, { recursive: true });
        const path = join(outputDir, "qq-video.mp4");
        await writeFile(path, Buffer.alloc(32, 1));
        return path;
      },
      candidates: { videos: [{ selector: "video-1", kind: "qq_video", source: "recent", platform: "qq", file: "abc.mp4", url: "" }], audios: [], musics: [] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.equal(result.ok, true);
    assert.match(result.reply, /没指定 using，按视频自动用了 frames、speech；还可以 using=info\/voice\/music\/subtitle\/audio_file/);
    assert.deepEqual(calls.map((call) => call[0]), ["qq-video", "transcribe", "storyboard"]);
    assert.equal(calls[0][1], "abc.mp4");
    assert.equal(result.contentItems.filter((item) => item.type === "inputImage").length, 1);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("modes a kind cannot use are skipped honestly, and songs refuse frames", async () => {
  const state = getQqMediaTurnState({});
  state.songs.push({ selector: "song-1", site: "netease", id: "1", platform: "netease-music", title: "晴天", artist: "周杰伦", url: "" });
  const refused = await executeQqMediaAnalyzeTool({ action: "analyze", selector: "song-1", using: ["frames"] }, {
    runtime: soundRuntime([]), candidates: { videos: [], audios: [], musics: [] }, state
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /是歌曲，用不了 frames；可以用 info、music/);
  const listen = await executeQqMediaMusicTool({ action: "listen", selector: "song-1" }, { runtime: soundRuntime([]), state });
  assert.match(listen.error, /只用来搜歌.*qq_media\.analyze/);
});

test("earlier QQ videos and voices of the conversation stay openable for follow-ups", () => {
  const now = Date.parse("2026-11-15T04:24:42Z");
  const entry = (at, extra) => ({ at, messageId: String(at), senderId: "1", senderLabel: "初月", text: "[视频]", ...extra });
  const recentEntries = [
    entry("2026-11-15T04:00:00Z", { media: { videos: [{ file: "old.mp4", url: "", name: "", sizeBytes: null }], audios: [] } }),
    ...Array.from({ length: 25 }, (_, index) => entry(`2026-11-15T04:1${Math.floor(index / 10)}:${String(index % 10).padStart(2, "0")}Z`, {})),
    entry("2026-11-15T04:23:14Z", { media: { videos: [{ file: "game.mp4", url: "https://multimedia.nt.qq.com.cn/x", name: "", sizeBytes: 3_000_000 }], audios: [] } }),
    entry("2026-11-15T04:23:20Z", { media: { videos: [], audios: [{ file: "v.amr", url: "", name: "", sizeBytes: null }] } }),
    { at: "2026-11-15T04:24:00Z", isAssistant: true, text: "我点开看看", media: { videos: [{ file: "bot.mp4" }], audios: [] } }
  ];
  const event = { text: "什么游戏", raw: { message_id: 99 }, contentContext: { plainText: "什么游戏", links: [] } };
  const candidates = collectQqMediaCandidates(event, { recentEntries, now });
  assert.deepEqual(candidates.videos.map((video) => [video.selector, video.file, video.source]), [["video-1", "game.mp4", "recent"]]);
  assert.deepEqual(candidates.audios.map((audio) => [audio.selector, audio.file]), [["audio-1", "v.amr"]]);
  assert.match(formatQqMediaCandidates(candidates, { available: { video: true, audio: true } }), /video-1：QQ 视频（前文消息，初月）/);
  assert.deepEqual(countQqTurnMedia(candidates), { videos: [], audios: [], musics: [] });
  // The current message's own video wins the first selector and is not repeated.
  const own = collectQqMediaCandidates({ ...event, contentContext: { media: { videos: [{ file: "game.mp4", url: "https://multimedia.nt.qq.com.cn/x" }] } } }, { recentEntries, now });
  assert.deepEqual(own.videos.map((video) => [video.selector, video.source]), [["video-1", "current"]]);
  assert.equal(countQqTurnMedia(own).videos.length, 1);
});

test("recent media snapshots keep fetchable ids only, never local paths", () => {
  assert.equal(snapshotQqRecentMedia(null), null);
  assert.equal(snapshotQqRecentMedia({ media: { videos: [], audios: [] } }), null);
  assert.deepEqual(snapshotQqRecentMedia({
    media: {
      videos: [{ file: "a.mp4", url: "https://multimedia.nt.qq.com.cn/a", path: "/data/user/0/qq/a.mp4", name: "clip", sizeBytes: 10 }],
      audios: [{ file: "", url: "", path: "/only/a/path.amr" }]
    }
  }), { videos: [{ file: "a.mp4", url: "https://multimedia.nt.qq.com.cn/a", name: "clip", sizeBytes: 10 }], audios: [] });
});

test("audio export is one bounded ffmpeg job writing AAC into the requested file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qq-media-extract-"));
  const seen = [];
  try {
    const runtime = createQqMediaRuntime({
      toolsDir: "/tools",
      workerScript: "/worker.mjs",
      inspect: async () => ({ analysis: true, ffmpeg: "/usr/bin/ffmpeg", paths: {} }),
      checkMemory: async () => ({ ok: true }),
      runProcess: async (command, args) => {
        seen.push({ command, args });
        await writeFile(args.at(-1), Buffer.alloc(100, 1));
        return { stdout: "" };
      }
    });
    const outputPath = join(dir, "out", "鱼-声音-1.m4a");
    const result = await runtime.extractAudio("/in/video.mp4", { outputPath, from: 30, to: 90 });
    assert.deepEqual(result, { path: outputPath, bytes: 100, seconds: 60 });
    const { command, args } = seen[0];
    assert.equal(command, "/usr/bin/ffmpeg");
    assert.equal(args[args.indexOf("-ss") + 1], "30");
    assert.equal(args[args.indexOf("-t") + 1], "60");
    assert.equal(args[args.indexOf("-c:a") + 1], "aac");
    assert.ok(args.includes("-vn") && args.includes("-nostdin"));
    assert.equal(args.at(-1), outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
