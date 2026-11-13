import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqFollowUpFusionPrompts,
  formatQqAlreadySentContext,
  formatQqPersistentFusionNote,
  formatQqReplyCompletionInstruction,
  formatQqSteeredBatchInstruction,
  normalizeQqReplyDelivery
} from "../src/qq-reply-delivery-prompt.js";

test("unknown delivery modes read as a final reply", () => {
  assert.equal(normalizeQqReplyDelivery("tool"), "tool");
  assert.equal(normalizeQqReplyDelivery("final"), "final");
  assert.equal(normalizeQqReplyDelivery(undefined), "final");
});

test("final-reply turns keep the single structured reply wording", () => {
  assert.equal(
    formatQqReplyCompletionInstruction({ privateChat: true }),
    "请按输出 Schema 提交要发送到 QQ 私聊里的最终回复。不要追加服务式追问或“我还能继续帮你”的结尾。"
  );
  assert.equal(
    formatQqReplyCompletionInstruction({}),
    "请按输出 Schema 提交要发送到 QQ 群里的最终回复。不要追加服务式追问或“我还能继续帮你”的结尾。"
  );
  assert.match(formatQqReplyCompletionInstruction({ privateProactive: true }), /^现在只输出一句/);
  assert.match(formatQqReplyCompletionInstruction({ coldProactive: true }), /就输出；/);
  assert.match(formatQqSteeredBatchInstruction(), /统一回复/);
  assert.match(formatQqPersistentFusionNote(), /最终只输出一份统一回复/);
});

test("send-tool turns are told every visible word goes through qq_chat.send", () => {
  for (const text of [
    formatQqReplyCompletionInstruction({ replyDelivery: "tool", privateChat: true }),
    formatQqReplyCompletionInstruction({ replyDelivery: "tool", privateProactive: true }),
    formatQqReplyCompletionInstruction({ replyDelivery: "tool", coldProactive: true }),
    formatQqSteeredBatchInstruction({ replyDelivery: "tool" }),
    formatQqPersistentFusionNote({ replyDelivery: "tool" })
  ]) {
    assert.match(text, /qq_chat\.send/);
    assert.doesNotMatch(text, /最终回复|统一回复/);
  }
  assert.match(formatQqReplyCompletionInstruction({ replyDelivery: "tool", privateChat: true }), /在私聊里回应/);
  assert.match(formatQqReplyCompletionInstruction({ replyDelivery: "tool" }), /在群里回应/);
});

test("follow-ups continue a spoken turn but replace an unsent draft", () => {
  const tool = buildQqFollowUpFusionPrompts({ replyDelivery: "tool", fullBase: "BASE", fusionText: "NEW", alreadySent: "等我看看" });
  assert.match(tool.fullPrompt, /^BASE\n/);
  assert.match(tool.fullPrompt, /对方都看到了的消息：\n等我看看/);
  assert.match(tool.fullPrompt, /NEW/);
  assert.doesNotMatch(tool.fullPrompt, /草稿/);
  assert.match(tool.resumePrompt, /都已经看到/);
  const final = buildQqFollowUpFusionPrompts({ fullBase: "BASE", fusionText: "NEW", alreadySent: "ignored" });
  assert.match(final.fullPrompt, /尚未发送/);
  assert.doesNotMatch(final.fullPrompt, /ignored/);
  assert.match(final.resumePrompt, /草稿/);
  assert.equal(formatQqAlreadySentContext(""), "你这一轮还没有发出任何消息。");
});
