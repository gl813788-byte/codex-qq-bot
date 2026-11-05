import assert from "node:assert/strict";
import test from "node:test";
import { classifyQqSharedContent, extractQqRichMessageContent } from "../src/qq-message-content.js";
import { collectQqMediaCandidates, findQqMediaCandidate, formatQqMediaCandidates, isQqWatchableVideoUrl } from "../src/qq-media/media-candidates.js";
import { createBilibiliClient, isBilibiliShortLink, parseBilibiliVideoId, signBilibiliWbiParams } from "../src/qq-media/bilibili.js";

const bilibiliMiniApp = JSON.stringify({
  app: "com.tencent.miniapp_01",
  prompt: "[QQ小程序]30万人聚众排泄",
  meta: {
    detail_1: {
      appid: "1109937557",
      title: "哔哩哔哩",
      desc: "30万人聚众排泄，三天拉满整座小岛",
      preview: "pubminishare-30161.picsz.qpic.cn/abc.png",
      qqdocurl: "https://b23.tv/lovcdga?share_medium=android"
    }
  }
});

test("Bilibili mini-program cards become labeled video shares with the video title", () => {
  const content = extractQqRichMessageContent([{ type: "json", data: { data: bilibiliMiniApp } }]);
  const [card] = content.cards;
  assert.equal(card.kind, "video");
  assert.equal(card.platform, "bilibili");
  assert.equal(card.appName, "哔哩哔哩");
  assert.equal(card.title, "30万人聚众排泄，三天拉满整座小岛");
  assert.match(card.url, /^https:\/\/b23\.tv\/lovcdga/);
  assert.match(card.preview, /^https:\/\/pubminishare/);
  assert.match(content.displayText, /^\[B站视频分享\] 30万人聚众排泄/);
});

test("music, contact, group and location cards keep their kind", () => {
  const music = extractQqRichMessageContent([{ type: "json", data: { data: JSON.stringify({ app: "com.tencent.structmsg", view: "music", meta: { music: { title: "晴天", desc: "周杰伦", tag: "QQ音乐", jumpUrl: "https://i.y.qq.com/v8/playsong.html?songid=1" } } }) } }]);
  assert.equal(music.cards[0].kind, "music");
  assert.match(music.displayText, /^\[音乐分享\] 晴天｜周杰伦/);
  const contact = extractQqRichMessageContent([{ type: "json", data: { data: JSON.stringify({ app: "com.tencent.contact.lua", meta: { contact: { nickname: "小明", contact: "QQ号：123456", tag: "推荐联系人", jumpUrl: "mqqapi://card/show_pslcard?uin=123456" } } }) } }]);
  assert.equal(contact.cards[0].kind, "contact");
  assert.equal(contact.cards[0].qqId, "123456");
  const group = extractQqRichMessageContent([{ type: "json", data: { data: JSON.stringify({ app: "com.tencent.troopsharecard", meta: { contact: { nickname: "摸鱼群", contact: "群号：987654", tag: "推荐群聊" } } }) } }]);
  assert.equal(group.cards[0].kind, "group_contact");
  const place = extractQqRichMessageContent([{ type: "json", data: { data: JSON.stringify({ app: "com.tencent.map", meta: { "Location.Search": { name: "十洋地铁站", address: "某某路" } } }) } }]);
  assert.match(place.displayText, /^\[位置\] 十洋地铁站｜某某路/);
});

test("voice, video, dice and markdown segments become readable markers and fetchable media", () => {
  const content = extractQqRichMessageContent([
    { type: "record", data: { file: "a.amr", path: "/tmp/a.amr", url: "https://multimedia.nt.qq.com.cn/download?x=1" } },
    { type: "video", data: { file: "v.mp4", url: "https://multimedia.nt.qq.com.cn/download?v=1", file_size: "1234" } },
    { type: "dice", data: { result: "5" } },
    { type: "markdown", data: { content: "**hi**" } }
  ], "[CQ:record,file=a.amr,url=https://signed]");
  assert.equal(content.displayText, "[语音]\n[视频]\n[骰子：5 点]\n[Markdown] **hi**");
  assert.doesNotMatch(content.displayText, /CQ:record|signed/);
  assert.equal(content.media.audios[0].file, "a.amr");
  assert.equal(content.media.videos[0].sizeBytes, 1234);
});

test("shared-link classification only marks real video pages as videos", () => {
  assert.equal(classifyQqSharedContent({ url: "https://www.bilibili.com/video/BV1YCxq6fE6b" }).kind, "video");
  assert.equal(classifyQqSharedContent({ url: "https://space.bilibili.com/123" }).kind, "link");
  assert.equal(classifyQqSharedContent({ url: "https://live.bilibili.com/1" }).kind, "live");
  assert.equal(classifyQqSharedContent({ url: "https://v.douyin.com/abc/" }).platform, "douyin");
  assert.equal(isQqWatchableVideoUrl("http://127.0.0.1:3000/get_msg"), false);
  assert.equal(isQqWatchableVideoUrl("https://b23.tv/xyz"), true);
});

test("media candidates come from the message, its quote and chat records with turn selectors", () => {
  const event = {
    senderName: "甲",
    contentContext: {
      ...extractQqRichMessageContent([{ type: "json", data: { data: bilibiliMiniApp } }, { type: "record", data: { file: "v1.amr" } }]),
      forward: { text: "1. 乙：https://v.douyin.com/abc/", media: { videos: [{ file: "f.mp4", url: "https://multimedia.nt.qq.com.cn/f" }], audios: [] } }
    },
    replyContext: { senderName: "丙", contentContext: { plainText: "看这个 https://www.bilibili.com/video/BV1w5xh6sEEz", links: ["https://www.bilibili.com/video/BV1w5xh6sEEz"], media: { videos: [], audios: [{ file: "q.amr" }] } } }
  };
  const candidates = collectQqMediaCandidates(event);
  assert.deepEqual(candidates.videos.map((item) => [item.selector, item.source, item.platform]), [
    ["video-1", "current", "bilibili"],
    ["video-2", "quoted", "bilibili"],
    ["video-3", "forward", "qq"],
    ["video-4", "forward", "douyin"]
  ]);
  assert.deepEqual(candidates.audios.map((item) => [item.selector, item.source]), [["audio-1", "current"], ["audio-2", "quoted"]]);
  assert.equal(findQqMediaCandidate(candidates, "VIDEO-2").url, "https://www.bilibili.com/video/BV1w5xh6sEEz");
  const text = formatQqMediaCandidates(candidates, { available: { video: true, audio: false } });
  assert.match(text, /video-1：B站视频链接《30万人/);
  assert.match(text, /qq_media\.video\(action=watch/);
  assert.match(text, /还没装语音识别组件/);
});

test("Bilibili ids, short links and WBI signing are parsed deterministically", () => {
  assert.deepEqual(parseBilibiliVideoId("https://www.bilibili.com/video/BV1YCxq6fE6b?p=2"), { bvid: "BV1YCxq6fE6b", aid: "", page: 2 });
  assert.deepEqual(parseBilibiliVideoId("https://www.bilibili.com/video/av170001"), { bvid: "", aid: "170001", page: 1 });
  assert.equal(parseBilibiliVideoId("https://space.bilibili.com/1"), null);
  assert.equal(isBilibiliShortLink("https://b23.tv/abc"), true);
  const signed = signBilibiliWbiParams({ keyword: "原神!", page: 1 }, {
    imgKey: "7cd084941338484aae1ad9425b84077c",
    subKey: "4932caff0ff746eab6f01bf08b70ac45",
    now: 1_700_000_000_000
  });
  assert.match(signed, /^keyword=%E5%8E%9F%E7%A5%9E&page=1&wts=1700000000&w_rid=[0-9a-f]{32}$/);
});

test("the Bilibili client resolves short links and normalizes video facts and comments", async () => {
  const calls = [];
  const client = createBilibiliClient({
    resolveRedirect: async () => "https://www.bilibili.com/video/BV1YCxq6fE6b?share=1",
    fetchJson: async (url) => {
      calls.push(url);
      if (url.includes("/x/web-interface/view")) {
        return { code: 0, data: { bvid: "BV1YCxq6fE6b", aid: 42, title: "标题", desc: "简介", owner: { name: "UP" }, tname: "生活", duration: 90, pages: [{ cid: 7, duration: 90 }], stat: { view: 12345, like: 10 } } };
      }
      if (url.includes("/x/frontend/finger/spi")) return { code: 0, data: { b_3: "B3", b_4: "B4" } };
      if (url.includes("/x/web-interface/nav")) return { code: -101, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png", sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png" } } };
      if (url.includes("/x/v2/reply/wbi/main")) return { code: 0, data: { replies: [{ member: { uname: "路人" }, content: { message: "笑死" }, like: 9 }] } };
      throw new Error(`unexpected ${url}`);
    }
  });
  const id = await client.resolve("https://b23.tv/lovcdga");
  const info = await client.view(id);
  assert.equal(info.title, "标题");
  assert.equal(info.cid, "7");
  assert.equal(info.stats.views, 12345);
  const comments = await client.hotComments(info.aid);
  assert.deepEqual(comments, [{ user: "路人", text: "笑死", likes: 9 }]);
  assert.ok(calls.every((url) => url.startsWith("https://api.bilibili.com/")));
});
