import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createQqMediaRuntime, inspectQqMediaTools, parseQqStoryboardOutput } from "../src/qq-media/media-runtime.js";
import {
  executeQqMediaAudioTool,
  executeQqMediaBilibiliTool,
  executeQqMediaMusicTool,
  executeQqMediaParseTool,
  executeQqMediaVideoTool,
  getQqMediaTurnState
} from "../src/app/qq-media-tool.js";
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

const parsedSong = {
  site: "kugou",
  platform: "kugou",
  platformName: "酷狗音乐",
  id: "H1",
  title: "不死鸟",
  artists: ["霍尊"],
  album: "归一",
  durationSeconds: 265,
  vip: null,
  aliases: [],
  matchedBy: "link",
  climax: { from: 60, to: 97 },
  lyrics: { lines: [{ time: 12, text: "火焰中重生" }, { time: 70, text: "我是不死鸟" }], credits: ["作词：某人"] }
};

function fakeMusic(calls, { sources = ["https://sharefs.kugou.com/a.mp3"], song = parsedSong } = {}) {
  return {
    resolve: async (target) => {
      calls.push(["resolve", target.selector || target.url]);
      return song;
    },
    search: async (query) => {
      calls.push(["search", query]);
      return [{ site: "netease", platform: "netease-music", id: "7", name: "晴天", artist: ["周杰伦"], album: "叶惠美" }];
    },
    searchByLyrics: async (text) => {
      calls.push(["lyrics", text]);
      return [{ site: "netease", platform: "netease-music", id: "8", name: "孤勇者", artist: ["陈奕迅"] }];
    },
    audioSources: async function* () {
      for (const url of sources) yield { url, via: "platform", site: "kugou" };
    }
  };
}

function musicRuntime(calls, { durationSeconds = 265, analysis = {} } = {}) {
  return {
    status: async () => ({ video: true, audio: true, music: true, analysis: true, essentia: true, ytDlp: "/bin/yt-dlp", tagging: true }),
    probe: async () => ({ durationSeconds, hasAudio: true, hasVideo: false }),
    analyze: async (path, options) => {
      calls.push(["analyze", options.mode, options.from, options.to, options.focus, options.asr]);
      return {
        ok: true,
        durationSeconds,
        essentia: true,
        loudness: { meanDb: -18, rangeDb: 14, quietRatio: 0.05, loudestAt: 75, curve: [{ at: 0, db: -30 }, { at: 70, db: -12 }] },
        music: { from: 60, to: 97, rhythm: { bpm: 72.4, regularity: 0.9 }, key: { key: "Eb", scale: "minor", strength: 0.71 }, danceability: 1.1, dynamics: { complexity: 4 } },
        sounds: { overall: [{ label: "Music", prob: 0.9 }, { label: "Male singing", prob: 0.6 }], timeline: [] },
        ...analysis
      };
    },
    inspectLink: async (url) => {
      calls.push(["inspect", url]);
      return { title: "猫猫跳舞", uploader: "某UP", durationSeconds: 15, description: "简介", views: 120000, likes: 3000, comments: 12, reposts: null, uploadDate: "2026-11-01", tags: ["猫"], track: "原声", artists: ["某人"], width: 720 };
    }
  };
}

test("parse names a shared song with its facts and first lyric lines without listening", async () => {
  const calls = [];
  const state = getQqMediaTurnState({});
  const result = await executeQqMediaParseTool({ selector: "music-1" }, {
    runtime: musicRuntime(calls),
    music: fakeMusic(calls),
    candidates: { videos: [], audios: [], musics: [{ selector: "music-1", kind: "music_card", platform: "kugou", title: "不死鸟", artist: "霍尊", url: "https://m.kugou.com/share/?hash=x" }] },
    state
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /《不死鸟》- 霍尊｜专辑《归一》｜酷狗音乐｜4:25/);
  assert.match(result.reply, /\[0:12\] 火焰中重生/);
  assert.match(result.reply, /还没听过/);
  // A second parse of the same card reuses the resolution.
  await executeQqMediaParseTool({ selector: "music-1" }, { runtime: musicRuntime(calls), music: fakeMusic(calls), candidates: { musics: [{ selector: "music-1", title: "不死鸟" }] }, state });
  assert.equal(calls.filter((call) => call[0] === "resolve").length, 1);
});

test("parse reads a video link's facts and background music through yt-dlp", async () => {
  const calls = [];
  const result = await executeQqMediaParseTool({ selector: "video-1" }, {
    runtime: musicRuntime(calls),
    candidates: { videos: [{ selector: "video-1", kind: "link", platform: "douyin", url: "https://v.douyin.com/abc/" }], audios: [], musics: [] },
    state: getQqMediaTurnState({})
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /《猫猫跳舞》｜作者 某UP｜时长 0:15｜2026-11-01 发布/);
  assert.match(result.reply, /12\.0万播放 · 3000赞 · 12评论/);
  assert.match(result.reply, /背景音乐（平台标注）：原声 - 某人/);
  assert.deepEqual(calls, [["inspect", "https://v.douyin.com/abc/"]]);
  const foreign = await executeQqMediaParseTool({ url: "https://music.163.com/song?id=7" }, {
    runtime: musicRuntime([]), candidates: { musics: [] }, state: getQqMediaTurnState({}), isUrlInConversation: () => false
  });
  assert.match(foreign.error, /没有出现在本会话里/);
});

test("listening to a song downloads it, analyzes the chorus and returns lyrics with the feel", async () => {
  const taskWorkspace = await workspace();
  const calls = [];
  try {
    const result = await executeQqMediaMusicTool({ action: "listen", selector: "music-1" }, {
      runtime: musicRuntime(calls),
      music: fakeMusic(calls, { sources: ["https://evil.example/a.mp3", "https://sharefs.kugou.com/a.mp3"] }),
      downloadSong: async (url, { outputDir }) => {
        calls.push(["download", url]);
        if (url.includes("evil")) throw Object.assign(new Error("untrusted"), { code: "MEDIA_UNTRUSTED" });
        await mkdir(outputDir, { recursive: true });
        return join(outputDir, "song.mp3");
      },
      candidates: { videos: [], audios: [], musics: [{ selector: "music-1", title: "不死鸟", artist: "霍尊" }] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.equal(result.ok, true);
    assert.match(result.reply, /你真的把 《不死鸟》- 霍尊 放来听了/);
    assert.match(result.reply, /速度约 72 BPM（慢，节拍很稳）/);
    assert.match(result.reply, /调性约 降E 小调/);
    assert.match(result.reply, /平台标注的副歌段/);
    assert.match(result.reply, /\[1:10\] 我是不死鸟/);
    assert.match(result.reply, /Male singing/);
    assert.doesNotMatch(result.reply, /song\.mp3|qq-media-test-/);
    const analyze = calls.find((call) => call[0] === "analyze");
    assert.deepEqual(analyze, ["analyze", "music", 0, 265, { from: 60, to: 97 }, false]);
    assert.deepEqual(calls.filter((call) => call[0] === "download").map((call) => call[1]), ["https://evil.example/a.mp3", "https://sharefs.kugou.com/a.mp3"]);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("a song without playable audio is admitted, and a short download is called a preview", async () => {
  const taskWorkspace = await workspace();
  try {
    const none = await executeQqMediaMusicTool({ action: "listen", selector: "music-1" }, {
      runtime: musicRuntime([]),
      music: fakeMusic([], { sources: [], song: { ...parsedSong, vip: true } }),
      downloadSong: async () => { throw new Error("unused"); },
      candidates: { musics: [{ selector: "music-1", title: "不死鸟" }] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.equal(none.ok, true);
    assert.match(none.reply, /没能下载到 《不死鸟》- 霍尊 的音频（会员\/版权限制），所以你其实没听到/);
    assert.match(none.reply, /\[0:12\] 火焰中重生/);
    const preview = await executeQqMediaMusicTool({ action: "listen", selector: "music-1" }, {
      runtime: musicRuntime([], { durationSeconds: 30 }),
      music: fakeMusic([]),
      downloadSong: async (url, { outputDir }) => join(outputDir, "song.mp3"),
      candidates: { musics: [{ selector: "music-1", title: "不死鸟" }] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.match(preview.reply, /只拿到了 30 秒的试听片段/);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("song search hands out song-N and the music inside a video is guessed from its lyrics", async () => {
  const taskWorkspace = await workspace();
  const calls = [];
  const state = getQqMediaTurnState({});
  try {
    const found = await executeQqMediaMusicTool({ action: "search", query: "晴天 周杰伦" }, { runtime: musicRuntime(calls), music: fakeMusic(calls), state });
    assert.match(found.reply, /song-1：《晴天》- 周杰伦｜叶惠美｜网易云音乐/);
    const runtime = musicRuntime(calls, {
      durationSeconds: 40,
      analysis: { speech: { segments: [{ start: 3, end: 6, text: "爱你孤身走暗巷，爱你不跪的模样" }] } }
    });
    runtime.downloadLink = async (url, { outputDir }) => {
      await mkdir(outputDir, { recursive: true });
      return { path: join(outputDir, "video.mp4") };
    };
    const heard = await executeQqMediaMusicTool({ action: "listen", selector: "video-1" }, {
      runtime,
      music: fakeMusic(calls),
      candidates: { videos: [{ selector: "video-1", kind: "link", platform: "bilibili", url: "https://b23.tv/x" }], audios: [], musics: [] },
      state,
      taskWorkspace
    });
    assert.equal(heard.ok, true);
    assert.match(heard.reply, /\[0:03\] 爱你孤身走暗巷/);
    assert.match(heard.reply, /song-2：《孤勇者》- 陈奕迅/);
    assert.match(heard.reply, /只是猜测/);
    assert.ok(calls.some((call) => call[0] === "lyrics" && call[1] === "爱你孤身走暗巷 爱你不跪的模样"));
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("voice analysis adds pitch, speaking rate and loudness to the transcript", async () => {
  const taskWorkspace = await workspace();
  try {
    const result = await executeQqMediaAudioTool({ action: "analyze", selector: "audio-1" }, {
      runtime: {
        ...musicRuntime([]),
        analyze: async (path, options) => {
          assert.equal(options.mode, "voice");
          assert.equal(options.asr, true);
          return {
            ok: true,
            durationSeconds: 4,
            essentia: true,
            loudness: { meanDb: -20, rangeDb: 6 },
            pitch: { medianHz: 220, lowHz: 150, highHz: 330 },
            speech: { segments: [{ start: 0, end: 2, text: "今天好开心啊" }], text: "今天好开心啊", emotions: ["HAPPY"], events: [] },
            sounds: { overall: [{ label: "Speech", prob: 0.9 }] }
          };
        }
      },
      fetchVoice: async (candidate, { outputDir }) => join(outputDir, "voice.wav"),
      candidates: { videos: [], audios: [{ selector: "audio-1", file: "a.amr" }], musics: [] },
      state: getQqMediaTurnState({}),
      taskWorkspace
    });
    assert.equal(result.ok, true);
    assert.match(result.reply, /\[0:00\] 今天好开心啊/);
    assert.match(result.reply, /音高中位约 220Hz（中等），起伏 150-330Hz（抑扬顿挫明显）/);
    assert.match(result.reply, /语速约 3\.0 字\/秒/);
    assert.match(result.reply, /别据此判断对方的身份、年龄或性别/);
  } finally {
    await rm(taskWorkspace.root, { recursive: true, force: true });
  }
});

test("analysis and link parsing run bounded worker and yt-dlp commands", async () => {
  const seen = [];
  const runtime = createQqMediaRuntime({
    toolsDir: "/tools",
    workerScript: "/worker.mjs",
    cookiesFile: "",
    inspect: async () => ({ analysis: true, audio: true, tagging: true, ytDlp: "/tools/bin/yt-dlp", ffmpeg: "/usr/bin/ffmpeg", paths: {} }),
    runProcess: async (command, args) => {
      seen.push({ command, args });
      if (command === "/tools/bin/yt-dlp") {
        return { stdout: `${JSON.stringify({ title: "标题", uploader: "UP", duration: 61.4, view_count: 10, upload_date: "20261101", tags: ["a"], track: "歌", artists: ["人"] })}\n` };
      }
      return { stdout: '{"ok":true,"mode":"music","durationSeconds":10}\n' };
    }
  });
  const analysis = await runtime.analyze("/a.mp3", { mode: "music", from: 5, to: 50, focus: { from: 10, to: 40 }, asr: true });
  assert.equal(analysis.ok, true);
  const worker = seen[0].args;
  assert.equal(worker[1], "/worker.mjs");
  assert.equal(worker[2], "analyze");
  assert.equal(worker[worker.indexOf("--asr") + 1], "1");
  assert.equal(worker[worker.indexOf("--focus-from") + 1], "10");
  assert.equal(worker[worker.indexOf("--to") + 1], "50");
  const info = await runtime.inspectLink("https://v.douyin.com/abc/");
  assert.equal(info.durationSeconds, 61);
  assert.equal(info.uploadDate, "2026-11-01");
  assert.equal(info.track, "歌");
  const ytdlp = seen[1].args;
  assert.ok(ytdlp.includes("--skip-download"));
  assert.match(ytdlp[ytdlp.indexOf("-O") + 1], /^%\(\.\{id,title,/);
  assert.deepEqual(ytdlp.slice(-2), ["--", "https://v.douyin.com/abc/"]);
});
