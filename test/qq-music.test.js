import assert from "node:assert/strict";
import test from "node:test";
import { classifyQqSharedContent, extractQqRichMessageContent } from "../src/qq-message-content.js";
import { collectQqMediaCandidates, formatQqMediaCandidates, isQqParsableMediaUrl, isQqWatchableVideoUrl } from "../src/qq-media/media-candidates.js";
import {
  isQqTrustedMusicAudioUrl,
  mergeQqTranslatedLyrics,
  parseQqLrc,
  parseQqMusicSongRef,
  pickQqSongMatch
} from "../src/qq-media/music-links.js";
import { createQqMusicResolver, normalizeQqMusicDetail } from "../src/qq-media/music-resolver.js";

test("song references are parsed from NetEase, QQ Music, Kugou and Kuwo share links", () => {
  assert.deepEqual(parseQqMusicSongRef("https://music.163.com/song?id=1901371647&userid=1"), { platform: "netease-music", site: "netease", id: "1901371647" });
  assert.equal(parseQqMusicSongRef("https://music.163.com/#/song?id=42").id, "42");
  assert.equal(parseQqMusicSongRef("https://y.music.163.com/m/song?id=77&uct2=x").id, "77");
  assert.equal(parseQqMusicSongRef("http://music.163.com/song/media/outer/url?id=88.mp3").id, "88");
  assert.equal(parseQqMusicSongRef("https://music.163.com/playlist?id=5"), null);
  assert.equal(parseQqMusicSongRef("https://163cn.tv/abc").short, true);
  assert.equal(parseQqMusicSongRef("https://i.y.qq.com/v8/playsong.html?songmid=0039MnYb0qxYhV&type=0").id, "0039MnYb0qxYhV");
  assert.equal(parseQqMusicSongRef("https://y.qq.com/n/ryqq/songDetail/004Z8Ihr0JIu5s").id, "004Z8Ihr0JIu5s");
  assert.deepEqual(parseQqMusicSongRef("https://i.y.qq.com/v8/playsong.html?songid=123"), { platform: "qq-music", site: "tencent", id: "", songId: "123" });
  assert.equal(parseQqMusicSongRef("https://c6.y.qq.com/base/fcgi-bin/u?__=abc").short, true);
  assert.equal(parseQqMusicSongRef("https://m.kugou.com/share/?u=1&hash=64a97cf5a13020e8b2475fd8c0b6be93&chl=qq").id, "64A97CF5A13020E8B2475FD8C0B6BE93");
  assert.equal(parseQqMusicSongRef("https://www.kugou.com/song/#hash=64a97cf5a13020e8b2475fd8c0b6be93").id, "64A97CF5A13020E8B2475FD8C0B6BE93");
  assert.equal(parseQqMusicSongRef("https://t1.kugou.com/song.html?id=abc").short, true);
  assert.equal(parseQqMusicSongRef("https://www.kuwo.cn/play_detail/228908").id, "228908");
  assert.equal(parseQqMusicSongRef("https://example.com/song?id=1"), null);
  assert.equal(parseQqMusicSongRef("not a url"), null);
});

test("song audio is only fetched from the music platforms' media hosts", () => {
  assert.equal(isQqTrustedMusicAudioUrl("https://m701.music.126.net/2026/a.mp3?x=1"), true);
  assert.equal(isQqTrustedMusicAudioUrl("https://sharefs.tx.kugou.com/v3/a.mp3"), true);
  assert.equal(isQqTrustedMusicAudioUrl("http://ws.stream.qqmusic.qq.com/C400x.m4a?vkey=1"), true);
  assert.equal(isQqTrustedMusicAudioUrl("http://music.163.com/404"), false);
  assert.equal(isQqTrustedMusicAudioUrl("http://127.0.0.1:3000/x.mp3"), false);
  assert.equal(isQqTrustedMusicAudioUrl("https://evil.example/a.mp3"), false);
  assert.equal(isQqTrustedMusicAudioUrl("https://music.126.net.evil.example/a.mp3"), false);
  assert.equal(isQqTrustedMusicAudioUrl("https://m7.music.126.net:8443/a.mp3"), false);
  assert.equal(isQqTrustedMusicAudioUrl("https://user:pass@m7.music.126.net/a.mp3"), false);
});

test("LRC lyrics keep timed lines, drop tags and separate credits", () => {
  const parsed = parseQqLrc([
    "[ti:孤勇者]",
    "[offset:500]",
    '{"t":0,"c":[{"tx":"作词: "},{"tx":"唐恬"}]}',
    "[00:01.00]作曲 : 钱雷",
    "[00:15.50][01:20.00]都，是勇敢的",
    "[00:20.30]你额头的伤口",
    "[00:22.00]"
  ].join("\n"));
  assert.deepEqual(parsed.credits, ["作词: 唐恬", "作曲 : 钱雷"]);
  assert.deepEqual(parsed.lines, [
    { time: 15, text: "都，是勇敢的" },
    { time: 19.8, text: "你额头的伤口" },
    { time: 79.5, text: "都，是勇敢的" }
  ]);
  const merged = mergeQqTranslatedLyrics([{ time: 1, text: "Hello" }, { time: 2, text: "World" }], [{ time: 1, text: "你好" }]);
  assert.deepEqual(merged, [{ time: 1, text: "Hello", translation: "你好" }, { time: 2, text: "World" }]);
});

test("title/artist matching refuses a different song rather than guessing", () => {
  const results = [
    { id: "1", name: "孤勇者 (Live)", artist: ["张杰"] },
    { id: "2", name: "孤勇者", artist: ["陈奕迅"] },
    { id: "3", name: "孤勇者", artist: ["某翻唱"] }
  ];
  assert.equal(pickQqSongMatch(results, { title: "孤勇者", artists: ["陈奕迅"] }).id, "2");
  assert.equal(pickQqSongMatch(results, { title: "孤勇者", artists: ["周杰伦"] }), null);
  assert.equal(pickQqSongMatch(results, { title: "晴天", artists: ["陈奕迅"] }), null);
  assert.equal(pickQqSongMatch([{ id: "9", name: "晴天", artist: ["周杰伦"] }], { title: "晴天" }).id, "9");
});

test("raw song details from each platform normalize to one shape", () => {
  const netease = normalizeQqMusicDetail("netease", JSON.stringify({
    songs: [{ id: 1901371647, name: "孤勇者", ar: [{ name: "陈奕迅" }], al: { name: "孤勇者", picUrl: "http://p1.music.126.net/a.jpg" }, dt: 256000, fee: 1, publishTime: 1636300800000, alia: ["双城之战主题曲"] }]
  }));
  assert.equal(netease.title, "孤勇者");
  assert.deepEqual(netease.artists, ["陈奕迅"]);
  assert.equal(netease.durationSeconds, 256);
  assert.equal(netease.vip, true);
  assert.equal(netease.cover, "https://p1.music.126.net/a.jpg");
  assert.equal(netease.publishDate, "2021-11-07");
  const tencent = normalizeQqMusicDetail("tencent", { code: 0, data: [{ mid: "0039MnYb0qxYhV", name: "晴天", singer: [{ name: "周杰伦" }], album: { name: "叶惠美", mid: "000MkMni19ClKG" }, interval: 269, pay: { pay_play: 1 } }] });
  assert.equal(tencent.id, "0039MnYb0qxYhV");
  assert.match(tencent.cover, /T002R300x300M000000MkMni19ClKG\.jpg$/);
  const kugou = normalizeQqMusicDetail("kugou", {
    hash: "64a97cf5a13020e8b2475fd8c0b6be93",
    songName: "不死鸟",
    fileName: "霍尊 - 不死鸟",
    authors: [{ author_name: "霍尊" }],
    timeLength: 265,
    url: "https://sharefs.kugou.com/v3/full.mp3",
    backup_url: ["https://evil.example/x.mp3"],
    album_img: "http://imge.kugou.com/stdmusic/{size}/a.jpg",
    climax_info: { start_time: "60000", end_time: "97300" }
  });
  assert.equal(kugou.id, "64A97CF5A13020E8B2475FD8C0B6BE93");
  assert.deepEqual(kugou.directUrls, ["https://sharefs.kugou.com/v3/full.mp3"]);
  assert.deepEqual(kugou.climax, { from: 60, to: 97 });
  assert.equal(kugou.cover, "https://imge.kugou.com/stdmusic/400/a.jpg");
  assert.equal(normalizeQqMusicDetail("netease", "{}"), null);
  assert.equal(normalizeQqMusicDetail("netease", "not json"), null);
});

// A stand-in for Meting: method calls are recorded, answers come from a table.
function fakeMeting(table, calls = []) {
  return class {
    constructor(site) {
      this.site = site;
      this.formatted = true;
    }

    format(value) {
      this.formatted = value;
      return this;
    }

    async call(method, args) {
      calls.push([this.site, method, ...args]);
      const answer = table[`${this.site}.${method}`];
      return typeof answer === "function" ? answer(...args) : answer ?? "[]";
    }

    song(id) { return this.call("song", [id]); }
    search(keyword, options) { return this.call("search", [keyword, options?.type || 1]); }
    lyric(id) { return this.call("lyric", [id]); }
    url(id) { return this.call("url", [id]); }
  };
}

const neteaseDetail = JSON.stringify({ songs: [{ id: 7, name: "晴天", ar: [{ name: "周杰伦" }], al: { name: "叶惠美" }, dt: 269000, fee: 8 }] });

test("the resolver reads a linked song, its lyrics and audio sources in order", async () => {
  const calls = [];
  const resolver = createQqMusicResolver({
    loadMeting: async () => fakeMeting({
      "netease.song": neteaseDetail,
      "netease.lyric": JSON.stringify({ lyric: "[00:01.00]故事的小黄花", tlyric: "" }),
      "netease.url": JSON.stringify({ url: "https://m7.music.126.net/a.mp3" }),
      "kugou.search": JSON.stringify([{ id: "H1", name: "晴天", artist: ["周杰伦"], album: "叶惠美" }]),
      "kugou.song": JSON.stringify({ hash: "H1", songName: "晴天", fileName: "周杰伦 - 晴天", timeLength: 269, url: "https://webfs.kugou.com/b.mp3" }),
      "tencent.search": "[]"
    }, calls)
  });
  const song = await resolver.resolve({ url: "https://music.163.com/song?id=7", audioUrl: "https://evil.example/x.mp3" });
  assert.equal(song.title, "晴天");
  assert.equal(song.matchedBy, "link");
  assert.deepEqual(song.lyrics.lines, [{ time: 1, text: "故事的小黄花" }]);
  const sources = [];
  for await (const source of resolver.audioSources(song, { candidate: { audioUrl: "https://evil.example/x.mp3" } })) sources.push([source.via, source.url]);
  assert.deepEqual(sources, [
    ["platform", "https://m7.music.126.net/a.mp3"],
    ["platform", "https://music.163.com/song/media/outer/url?id=7.mp3"],
    ["other_platform", "https://webfs.kugou.com/b.mp3"]
  ]);
});

test("a card without a song id is matched by title and artist and says so", async () => {
  const resolver = createQqMusicResolver({
    loadMeting: async () => fakeMeting({
      "kugou.search": JSON.stringify([{ id: "H2", name: "不死鸟", artist: ["霍尊"] }]),
      "kugou.song": JSON.stringify({ hash: "H2", songName: "不死鸟", fileName: "霍尊 - 不死鸟", timeLength: 265 }),
      "kugou.lyric": JSON.stringify({ lyric: "", tlyric: "" })
    })
  });
  const song = await resolver.resolve({ platform: "kugou", title: "不死鸟", artist: "霍尊 · 归一", url: "https://m.kugou.com/share/song.html?chain=x" });
  assert.equal(song.id, "H2");
  assert.equal(song.matchedBy, "search");
  assert.equal(song.lyrics, null);
  const unknown = await resolver.resolve({ platform: "kugou", title: "一首歌", url: "" });
  assert.equal(unknown, null);
});

test("a missing Meting component is reported instead of guessed", async () => {
  const resolver = createQqMusicResolver({ loadMeting: async () => null });
  assert.equal(await resolver.available(), false);
  await assert.rejects(resolver.resolve({ url: "https://music.163.com/song?id=7" }), (error) => error.code === "MEDIA_UNAVAILABLE");
});

test("music cards keep their stream URL out of the visible text and become music-N", () => {
  const card = JSON.stringify({
    app: "com.tencent.structmsg",
    view: "music",
    meta: { music: { title: "不死鸟", desc: "霍尊 · 归一", tag: "酷狗音乐", jumpUrl: "https://m.kugou.com/share/?hash=64a97cf5a13020e8b2475fd8c0b6be93", musicUrl: "https://sharefs.kugou.com/v3/signed.mp3?sig=secret", preview: "http://imge.kugou.com/a.jpg" } }
  });
  const content = extractQqRichMessageContent([
    { type: "json", data: { data: card } },
    { type: "music", data: { type: "163", id: "1901371647" } },
    { type: "text", data: { text: "还有这首 https://y.qq.com/n/ryqq/songDetail/004Z8Ihr0JIu5s 和 https://v.douyin.com/abc/" } }
  ]);
  assert.equal(content.cards[0].audioUrl, "https://sharefs.kugou.com/v3/signed.mp3?sig=secret");
  assert.doesNotMatch(content.displayText, /signed\.mp3|secret/);
  assert.ok(!content.links.some((url) => url.includes("signed.mp3")));
  assert.equal(content.cards[1].url, "https://music.163.com/song?id=1901371647");
  assert.equal(content.cards[1].platform, "netease-music");
  const candidates = collectQqMediaCandidates({ senderName: "甲", contentContext: content });
  assert.deepEqual(candidates.musics.map((item) => [item.selector, item.kind, item.platform, item.title, item.artist]), [
    ["music-1", "music_card", "kugou", "不死鸟", "霍尊"],
    ["music-2", "music_card", "netease-music", "一首歌", ""],
    ["music-3", "music_link", "qq-music", "", ""]
  ]);
  assert.equal(candidates.videos[0].platform, "douyin");
  const text = formatQqMediaCandidates(candidates, { available: { video: true, audio: true, music: true } });
  assert.match(text, /music-1：酷狗音乐音乐卡片《不死鸟》 - 霍尊（当前消息，甲）/);
  assert.match(text, /qq_media\.parse\(selector\)/);
  assert.match(text, /qq_media\.music\(action=listen, selector\)/);
  const offline = formatQqMediaCandidates(candidates, { available: { music: false } });
  assert.match(offline, /还没装音乐解析组件/);
});

test("more video platforms are watchable and song pages are parsable", () => {
  assert.equal(classifyQqSharedContent({ url: "https://www.acfun.cn/v/ac123" }).kind, "video");
  assert.equal(classifyQqSharedContent({ url: "https://weibo.com/tv/show/1034:123" }).kind, "video");
  assert.equal(classifyQqSharedContent({ url: "https://www.zhihu.com/zvideo/123" }).kind, "video");
  assert.equal(classifyQqSharedContent({ url: "https://www.zhihu.com/question/1" }).kind, "article");
  assert.equal(isQqWatchableVideoUrl("https://www.ixigua.com/123"), true);
  assert.equal(isQqWatchableVideoUrl("https://www.xiaohongshu.com/explore/abc"), true);
  assert.equal(isQqWatchableVideoUrl("https://www.zhihu.com/question/1"), false);
  assert.equal(isQqParsableMediaUrl("https://music.163.com/song?id=7"), true);
  assert.equal(isQqParsableMediaUrl("https://music.163.com/playlist?id=7"), false);
  assert.equal(isQqParsableMediaUrl("http://127.0.0.1/song?id=7"), false);
});

test("production credits and the opening title line stay out of the lyrics", () => {
  const parsed = parseQqLrc([
    "[00:00.00]不死鸟 - 霍尊",
    "[00:03.00]人声编辑 : 汝文博",
    "[00:04.00]母带 : 周天澈",
    "[00:05.00]词版权管理方：北京某公司",
    "[00:11.00]钢琴：霍尊",
    "[00:16.00]Talkbox录音：正雨",
    "[00:20.00]浴火 就像永远乐此不疲",
    "[00:30.00]Don't let me know: wo yeah"
  ].join("\n"));
  assert.deepEqual(parsed.lines.map((line) => line.text), ["浴火 就像永远乐此不疲", "Don't let me know: wo yeah"]);
  assert.equal(parsed.credits.length, 5);
});
