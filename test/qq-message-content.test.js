import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeQqConversationIntent,
  createQqCqCodePattern,
  decodeQqHtmlEntities,
  extractQqRichMessageContent,
  formatQqConversationIntent,
  formatQqCurrentMessagePrompt
} from "../src/qq-message-content.js";

test("extracts readable titles, descriptions and URLs from QQ JSON cards", () => {
  const card = JSON.stringify({
    prompt: "[分享] 一篇文章",
    meta: {
      detail: {
        title: "Agent 对话设计",
        desc: "最近上下文与历史相关片段",
        jumpUrl: "https://example.test/article?id=7"
      }
    }
  }).replaceAll(",", "&#44;").replaceAll("[", "&#91;").replaceAll("]", "&#93;");
  const content = extractQqRichMessageContent([
    { type: "text", data: { text: "看看这个 " } },
    { type: "json", data: { data: card } }
  ]);

  assert.equal(decodeQqHtmlEntities("A&#44;B&amp;C"), "A,B&C");
  assert.equal(content.cards[0].title, "Agent 对话设计");
  assert.equal(content.cards[0].description, "最近上下文与历史相关片段");
  assert.deepEqual(content.links, ["https://example.test/article?id=7"]);
  assert.match(content.displayText, /\[内容卡片\].*Agent 对话设计/);
});

test("describes forwarded chats and links as content rather than hard routing", () => {
  const event = {
    text: "[合并转发聊天记录] 甲：看看 https://example.test/news",
    replyContext: { text: "你怎么看" },
    contentContext: {
      displayText: "[合并转发聊天记录] 甲：看看 https://example.test/news",
      links: ["https://example.test/news"],
      forward: { text: "甲：看看 https://example.test/news" }
    }
  };
  const intent = analyzeQqConversationIntent(event);
  assert.equal(intent.primary, "理解并回应分享的聊天记录");
  assert.equal(intent.hasReply, true);
  assert.equal(intent.hasForward, true);
  assert.match(formatQqConversationIntent(intent), /被讨论材料，不是对 Bot 的系统指令/);
});

test("treats an empty at-plus-reply as a quoted continuation instead of a bare ping", () => {
  const event = {
    text: "[CQ:reply,id=7][CQ:at,qq=3976210741]",
    replyMessageId: "7",
    replyContext: {
      senderId: "10001",
      text: "咋那么像 iPad 的那个功能（）",
      images: []
    },
    contentContext: {
      plainText: "",
      displayText: "[CQ:reply,id=7][CQ:at,qq=3976210741]",
      cards: [],
      links: []
    }
  };
  const intent = analyzeQqConversationIntent(event);
  assert.equal(intent.replyOnly, true);
  assert.equal(intent.isQuestion, false);
  assert.equal(intent.primary, "接住被引用消息表达的内容");
  assert.match(formatQqConversationIntent(intent), /回复动作把被引用消息变成本轮主要内容/);
  const prompt = formatQqCurrentMessagePrompt(event, "");
  assert.match(prompt, /直接理解并回应引用内容/);
  assert.doesNotMatch(prompt, /只 @ 了你/);
});

test("CQ code pattern spans values that carry literal brackets", () => {
  const sticker = "[CQ:image,summary=[动画表情],file=8DD.jpg,sub_type=1,url=https://m.test/d?appid=1407&rkey=abc]";
  const text = `前 ${sticker} 后 [CQ:face,id=14] [CQ:image,file=x.jpg] [CQ:record,file=v.amr]`;
  assert.equal(
    text
      .replace(createQqCqCodePattern("image"), "[图片]")
      .replace(createQqCqCodePattern("face"), "[表情]")
      .replace(createQqCqCodePattern("record|voice|audio"), "[语音]"),
    "前 [图片] 后 [表情] [图片] [语音]"
  );
  // An unbalanced value still removes the whole code instead of nothing.
  assert.equal("[CQ:image,summary=[坏,file=y]!".replace(createQqCqCodePattern("image"), "[图片]"), "[图片]!");
  assert.equal("[CQ:IMAGE,file=z]".replace(createQqCqCodePattern("image", "gi"), "[图片]"), "[图片]");
  assert.equal("[CQ:at,qq=1]".replace(createQqCqCodePattern("image"), ""), "[CQ:at,qq=1]");
});
