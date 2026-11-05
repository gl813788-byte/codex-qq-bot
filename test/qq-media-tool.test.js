import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createQqMediaRuntime, inspectQqMediaTools, parseQqStoryboardOutput } from "../src/qq-media/media-runtime.js";
import { executeQqMediaAudioTool, executeQqMediaBilibiliTool, executeQqMediaVideoTool, getQqMediaTurnState } from "../src/app/qq-media-tool.js";
import { applyQqVoiceTranscripts, hasQqHeardVoice, transcribeQqEventVoices } from "../src/app/qq-voice-transcription.js";

const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "qq-media-test-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  return { root, inputDir, outputDir };
}

test("storyboard output parsing keeps sheets in the output directory and hides local paths", () => {
  const parsed = parseQqStoryboardOutput([
    "[plan] 4 帧 → 1 张",
    "[sheet] /work/out/storyboard.jpg  798x502  4 帧  cell>=399x222",
    "[sheet] /elsewhere/x.jpg  798x502  4 帧",
    "[done] 4091ms",
    "",
    '<storyboard path="/root/video.mp4" duration="16.00">',
    "cell 1 = 00:00.00-00:04.00",
    "sheet already in context: cite cells by number; video_zoom only for a narrower window.",
    "per-cell times for verification: <name>.evidence.json",
    "</storyboard>"
  ].join("\n"), { outputDir: "/work/out" });
  assert.deepEqual(parsed.sheets, [{ path: "/work/out/storyboard.jpg", width: 798, height: 502, frames: 4 }]);
  assert.equal(parsed.summary, "4 帧 → 1 张");
  assert.match(parsed.manifest, /path="video"/);
  assert.doesNotMatch(parsed.manifest, /\/root\/video|evidence\.json|video_zoom/);
  assert.match(parsed.manifest, /qq_media\.video\(action=watch, from, to\)/);
});

test("media tool inspection reports missing components without failing", async () => {
  const status = await inspectQqMediaTools({
    toolsDir: "/tools",
    fileExists: async (path) => path.endsWith("storyboard.mjs"),
    findExecutable: async (name) => (["ffmpeg", "ffprobe"].includes(name) ? `/usr/bin/${name}` : "")
  });
  assert.equal(status.video, true);
  assert.equal(status.audio, false);
  assert.equal(status.links, false);
  assert.ok(status.missing.includes("SenseVoice 模型"));
  assert.ok(status.missing.includes("yt-dlp"));
});

test("the media runtime runs one job at a time and refuses a full queue", async () => {
  const releases = [];
  const runtime = createQqMediaRuntime({
    toolsDir: "/tools",
    workerScript: "/worker.mjs",
    maxQueued: 1,
    inspect: async () => ({ audio: true, tagging: false, ffmpeg: "/usr/bin/ffmpeg", paths: {} }),
    runProcess: () => new Promise((resolve) => releases.push(() => resolve({ stdout: '{"ok":true,"segments":[],"durationSeconds":1}\n' })))
  });
  const first = runtime.transcribe("/a.wav");
  const second = runtime.transcribe("/b.wav");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(runtime.transcribe("/c.wav"), (error) => error.code === "MEDIA_BUSY");
  assert.equal(releases.length, 1);
  releases[0]();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases[1]();
  assert.equal((await second).ok, true);
});

test("link downloads use bounded yt-dlp arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qq-media-dl-"));
  let seen = null;
  const runtime = createQqMediaRuntime({
    toolsDir: "/tools",
    workerScript: "/worker.mjs",
    maxVideoSeconds: 600,
    maxDownloadBytes: 50 * 1024 * 1024,
    inspect: async () => ({ links: true, ytDlp: "/tools/bin/yt-dlp", ffmpeg: "/usr/bin/ffmpeg", paths: {} }),
    runProcess: async (command, args) => {
      seen = { command, args };
      await writeFile(join(dir, "video.mp4"), Buffer.alloc(16));
      await writeFile(join(dir, "video.info.json"), JSON.stringify({ title: "标题", duration: 30, uploader: "UP" }));
      return { stdout: "" };
    }
  });
  try {
    const result = await runtime.downloadLink("https://www.bilibili.com/video/BV1w5xh6sEEz", { outputDir: dir });
    assert.equal(result.title, "标题");
    assert.equal(seen.command, "/tools/bin/yt-dlp");
    assert.ok(seen.args.includes("--no-playlist"));
    assert.equal(seen.args[seen.args.indexOf("--max-filesize") + 1], "50M");
    assert.match(seen.args[seen.args.indexOf("--match-filter") + 1], /!is_live & duration <=\? 1800/);
    assert.equal(seen.args.at(-1), "https://www.bilibili.com/video/BV1w5xh6sEEz");
    assert.equal(seen.args.at(-2), "--");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeRuntime(calls, { video = true, audio = true } = {}) {
  return {
    status: async () => ({ video, audio, tagging: true }),
    probe: async () => ({ durationSeconds: 600, hasAudio: true, hasVideo: true }),
    downloadLink: async (url, { outputDir }) => {
      calls.push(["download", url]);
      await mkdir(outputDir, { recursive: true });
      return { path: join(outputDir, "video.mp4") };
    },
    transcribe: async (path, options) => {
      calls.push(["transcribe", options.from, options.to]);
      return { ok: true, durationSeconds: 240, segments: [{ start: 1, end: 3, text: "大家好" }], emotions: ["HAPPY"], events: ["Laughter"], sounds: { overall: [{ label: "Music", prob: 0.9 }] } };
    },
    writeTranscriptFile: async (dir) => join(dir, "transcript.json"),
    writeBilibiliSubtitleFile: async (dir) => join(dir, "subtitle.json"),
    storyboard: async (path, { outputDir, from, to }) => {
      calls.push(["storyboard", from, to]);
      await mkdir(outputDir, { recursive: true });
      const sheet = join(outputDir, "storyboard.jpg");
      await writeFile(sheet, jpeg);
      return { sheets: [{ path: sheet }], manifest: "cell 1 = 00:00-00:04" };
    }
  };
}

test("watching a Bilibili card returns storyboard pictures, transcript, sound and video facts", async () => {
  const taskWorkspace = await workspace();
  const calls = [];
  const event = {};
  try {
    const result = await executeQqMediaVideoTool({ action: "watch", selector: "video-1" }, {
      runtime: fakeRuntime(calls),
      bilibili: {
        resolve: async () => ({ bvid: "BV1YCxq6fE6b" }),
        view: async () => ({ title: "标题", owner: "UP", aid: "1", cid: "2", url: "https://www.bilibili.com/video/BV1YCxq6fE6b", durationSeconds: 600, stats: { views: 20000 } }),
        hotComments: async () => [{ user: "路人", text: "笑死", likes: 3 }],
        subtitle: async () => null
      },
      fetchSubtitle: async () => null,
      candidates: { videos: [{ selector: "video-1", kind: "link", platform: "bilibili", url: "https://b23.tv/x", title: "标题" }], audios: [] },
      state: getQqMediaTurnState(event),
      taskWorkspace
    });
    assert.equal(result.ok, true);
    assert.equal(result.contentItems.filter((item) => item.type === "inputImage").length, 1);
    assert.match(result.contentItems[1].imageUrl, /^data:image\/jpeg;base64,/);
    assert.match(result.reply, /B站视频《标题》｜UP UP/);
    assert.match(result.reply, /热门评论/);
    assert.match(result.reply, /语气偏开心；听到笑声/);
    assert.match(result.reply, /后面还有，想接着看就用 from=240/);
    assert.deepEqual(calls, [["download", "https://www.bilibili.com/video/BV1YCxq6fE6b"], ["transcribe", 0, 240], ["storyboard", 0, 240]]);
    assert.equal(event.qqMediaState.watched[0].title, "标题");
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("video links must come from this conversation and the tool admits missing components", async () => {
  const state = getQqMediaTurnState({});
  const notInstalled = await executeQqMediaVideoTool({ action: "watch", selector: "video-1" }, {
    runtime: fakeRuntime([], { video: false }), candidates: { videos: [], audios: [] }, state
  });
  assert.equal(notInstalled.ok, false);
  assert.match(notInstalled.error, /没装视频分镜组件/);
  const foreign = await executeQqMediaVideoTool({ action: "watch", url: "https://www.bilibili.com/video/BV1w5xh6sEEz" }, {
    runtime: fakeRuntime([]), candidates: { videos: [], audios: [] }, state, isUrlInConversation: () => false
  });
  assert.match(foreign.error, /没有出现在本会话里/);
  const loopback = await executeQqMediaVideoTool({ action: "watch", url: "http://127.0.0.1:3000/x" }, {
    runtime: fakeRuntime([]), candidates: { videos: [], audios: [] }, state, isUrlInConversation: () => true
  });
  assert.match(loopback.error, /只能看 B站/);
});

test("listening to a voice clip returns a timestamped transcript", async () => {
  const taskWorkspace = await workspace();
  try {
    const result = await executeQqMediaAudioTool({ action: "listen", selector: "audio-1" }, {
      runtime: fakeRuntime([]),
      fetchVoice: async (candidate, { outputDir }) => join(outputDir, "voice.wav"),
      candidates: { videos: [], audios: [{ selector: "audio-1", file: "a.amr" }] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.equal(result.ok, true);
    assert.match(result.reply, /\[0:01\] 大家好/);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("Bilibili browsing hands out bili-N selectors that watch accepts", async () => {
  const state = getQqMediaTurnState({});
  const listed = await executeQqMediaBilibiliTool({ action: "popular", limit: 2 }, {
    bilibili: { popular: async () => [{ bvid: "BV1", title: "猫猫", owner: "UP", url: "https://www.bilibili.com/video/BV1w5xh6sEEz", views: 120000, durationSeconds: 65 }] },
    state
  });
  assert.match(listed.reply, /bili-1：《猫猫》｜UP UP｜1:05｜12\.0万播放/);
  assert.equal(state.browse[0].selector, "bili-1");
});

test("heard voice messages replace the [语音] marker and unblock routing", async () => {
  const event = {
    text: "[语音]",
    contentContext: { displayText: "[语音]", plainText: "", media: { audios: [{ file: "a.amr" }], videos: [] } },
    replyContext: { text: "[语音]", contentContext: { media: { audios: [{ file: "q.amr" }], videos: [] } } }
  };
  const { event: heard, transcripts } = await transcribeQqEventVoices(event, {
    runtime: {
      status: async () => ({ audio: true }),
      transcribe: async () => ({ text: "你在干嘛", durationSeconds: 3, emotions: ["HAPPY"], events: [] })
    },
    fetchVoice: async (audio, { outputDir }) => join(outputDir, `${audio.file}.wav`),
    workRoot: await mkdtemp(join(tmpdir(), "qq-voice-"))
  });
  assert.equal(transcripts.length, 2);
  assert.equal(heard.text, "[语音 3秒] 你在干嘛（语气开心）");
  assert.equal(heard.contentContext.plainText, "你在干嘛");
  assert.equal(heard.replyContext.text, "[语音 3秒] 你在干嘛（语气开心）");
  assert.equal(hasQqHeardVoice(heard), true);
  assert.equal(hasQqHeardVoice(applyQqVoiceTranscripts(event, [{ source: "current", ok: false }])), false);
});
