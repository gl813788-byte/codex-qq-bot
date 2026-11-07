import assert from "node:assert/strict";
import test from "node:test";
import { QQ_CARD_ACTIONS, executeQqCardAction, extractArkJson } from "../src/app/qq-card-tools.js";
import { getQqMediaTurnState } from "../src/app/qq-media-tool.js";
import { executeQqMessageTool } from "../src/app/qq-message-tools.js";

function makeDeps(overrides = {}) {
  const sent = [];
  const calls = [];
  const deps = {
    event: { groupId: "123456" },
    sendSegments: async (segments, options) => {
      sent.push({ segments, ...options });
      return { ok: true };
    },
    callOneBotAction: async (action, payload) => {
      calls.push({ action, payload });
      if (action === "get_mini_app_ark") {
        return { ok: true, body: { status: "ok", data: { data: { app: "com.tencent.miniapp_01", meta: { detail_1: { desc: payload.title } } } } } };
      }
      return { ok: false };
    },
    ...overrides
  };
  return { deps, sent, calls };
}

test("a song card uses the exact song-N found by qq_media search, never a re-search", async () => {
  const { deps, sent } = makeDeps({
    searchMusic: async () => {
      throw new Error("must not search again");
    },
    describeSong: async ({ site, id }) => ({ site, id, title: "旅行的意义", artists: ["陈绮贞"], cover: "https://y.gtimg.cn/music/photo_new/T002R300x300M000x.jpg" })
  });
  const media = getQqMediaTurnState(deps.event);
  media.songs.push({ selector: "song-2", site: "tencent", id: "002vmYbG1R3x6h", platform: "qq-music", title: "旅行的意义", artist: "陈绮贞" });
  const result = await executeQqCardAction({ action: "music", selector: "song-2" }, deps);
  assert.equal(result.ok, true);
  assert.match(result.reply, /《旅行的意义》- 陈绮贞/);
  assert.deepEqual(sent[0].segments, [{
    type: "music",
    data: { type: "qq", id: "002vmYbG1R3x6h", title: "旅行的意义", singer: "陈绮贞", image: "https://y.gtimg.cn/music/photo_new/T002R300x300M000x.jpg" }
  }]);
  const unknown = await executeQqCardAction({ action: "music", selector: "song-9" }, deps);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /song-N/);
});

test("a song card by platform and id validates the id shape and looks up the title", async () => {
  const { deps, sent } = makeDeps({ describeSong: async () => ({ title: "晴天", artists: ["周杰伦"], cover: "http://insecure/x.jpg" }) });
  assert.equal((await executeQqCardAction({ action: "music", platform: "kugou", songId: "123" }, deps)).ok, false);
  const result = await executeQqCardAction({ action: "music", platform: "kuwo", songId: "228908" }, deps);
  assert.equal(result.ok, true);
  // An insecure cover is dropped rather than sent to the signing service.
  assert.deepEqual(sent[0].segments[0].data, { type: "kuwo", id: "228908", title: "晴天", singer: "周杰伦" });
});

test("a Bilibili card is a signed mini-program card for the canonical video page", async () => {
  const views = [];
  const { deps, sent, calls } = makeDeps({
    bilibili: {
      view: async (id) => {
        views.push(id);
        return { bvid: "BV1mv4Y6rESW", title: "一分钟老梗轰炸", owner: "某UP", description: "近十几年的梗", cover: "https://i0.hdslb.com/bfs/archive/a.jpg" };
      },
      resolve: async () => ({ bvid: "BV1mv4Y6rESW", aid: "", page: 1 })
    }
  });
  const result = await executeQqCardAction({ action: "bilibili", url: "看这个 https://evil.example/BV1mv4Y6rESW" }, deps);
  assert.equal(result.ok, true);
  assert.match(result.reply, /B站视频/);
  assert.equal(views[0].bvid, "BV1mv4Y6rESW");
  assert.equal(calls[0].action, "get_mini_app_ark");
  assert.equal(calls[0].payload.type, "bili");
  assert.equal(calls[0].payload.jumpUrl, "https://www.bilibili.com/video/BV1mv4Y6rESW");
  assert.equal(calls[0].payload.picUrl, "https://i0.hdslb.com/bfs/archive/a.jpg");
  assert.equal(sent[0].segments[0].type, "json");
  assert.match(sent[0].segments[0].data.data, /com\.tencent\.miniapp_01/);
  assert.equal(sent[0].label, "[B站视频]《一分钟老梗轰炸》");
});

test("a Bilibili card takes bili-N results and refuses non-video input or a failed ark", async () => {
  const { deps } = makeDeps({
    bilibili: { view: async () => ({ bvid: "BV1xx411c7mD", title: "猫", owner: "", description: "", cover: "" }) },
    callOneBotAction: async () => ({ ok: false, error: "unsupported" })
  });
  getQqMediaTurnState(deps.event).browse.push({ selector: "bili-1", url: "https://www.bilibili.com/video/BV1xx411c7mD", title: "猫", platform: "bilibili" });
  const failed = await executeQqCardAction({ action: "bilibili", selector: "bili-1" }, deps);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /直接发链接/);
  assert.equal((await executeQqCardAction({ action: "bilibili", url: "https://example.com/watch" }, deps)).ok, false);
  assert.equal((await executeQqCardAction({ action: "bilibili", selector: "bili-7" }, deps)).ok, false);
  assert.equal(deps.event.qqCardCount, 0);
});

test("a forwarded chat-record card is written only under the Bot's own account", async () => {
  const { deps, sent } = makeDeps({ self: { userId: "3976210741", nickname: "麦麦" }, cleanText: (text) => text.replace(/\[\[qq_image:[^\]]+\]\]/g, "") });
  const result = await executeQqCardAction({
    action: "forward",
    title: "今日冲浪笔记",
    items: ["第一条：看到一只猫", "", "第二条[[qq_image:/root/secret.png]]：听了首歌"]
  }, deps);
  assert.equal(result.ok, true);
  const nodes = sent[0].segments;
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((node) => node.type === "node" && node.data.user_id === "3976210741" && node.data.nickname === "麦麦"));
  assert.equal(nodes[1].data.content[0].data.text, "第二条：听了首歌");
  assert.equal(sent[0].extra.source, "今日冲浪笔记");
  assert.equal(sent[0].extra.news.length, 2);
  const noSelf = makeDeps({ self: {} });
  assert.equal((await executeQqCardAction({ action: "forward", items: ["x"] }, noSelf.deps)).ok, false);
  assert.equal((await executeQqCardAction({ action: "forward", items: [] }, deps)).ok, false);
});

test("cards stay bounded per turn and the message tool routes every card action", async () => {
  const { deps } = makeDeps();
  assert.ok(["music", "bilibili", "forward", "dice", "rps", "contact"].every((action) => QQ_CARD_ACTIONS.includes(action)));
  assert.equal((await executeQqCardAction({ action: "dice" }, deps)).ok, true);
  assert.equal((await executeQqCardAction({ action: "rps" }, deps)).ok, true);
  const third = await executeQqCardAction({ action: "dice" }, deps);
  assert.equal(third.ok, false);
  const routed = await executeQqMessageTool({ action: "forward", items: ["x"] }, { event: {}, cards: null });
  assert.match(routed.error, /不能发卡片/);
  assert.equal(extractArkJson({ ok: true, body: { data: { arkJson: "{\"a\":1}" } } }), "{\"a\":1}");
  assert.equal(extractArkJson({ ok: true, body: { data: { data: { app: "x" } } } }), "{\"app\":\"x\"}");
  assert.equal(extractArkJson({ ok: false }), "");
});
