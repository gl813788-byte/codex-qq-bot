import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqNativeProgressReporter,
  normalizeQqNativeProgress
} from "../src/infrastructure/codex/qq-native-progress.js";

test("native commentary becomes bounded visible progress while schema envelopes stay hidden", () => {
  assert.equal(normalizeQqNativeProgress({ type: "commentary", text: "  正在核对\n依赖  " }), "正在核对 依赖");
  assert.equal(normalizeQqNativeProgress({ type: "plan", explanation: "内部计划" }), "");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"reply","text":"完成","bubbles":[],"reply":{"mode":"plain"},"attachments":[]}'
  }), "");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"reply","text":"多余字段不应放行","bubbles":[],"reply":{"mode":"plain","targetUserId":"","extra":true},"attachments":[]}'
  }), "");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"reply","text":"没死，在认真看你前面那个萤火虫问题（）","bubbles":[],"reply":{"mode":"mention","targetUserId":"3784642920"},"attachments":[]}'
  }), "没死，在认真看你前面那个萤火虫问题（）");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '```json\n{"status":"reply","text":"","bubbles":["第一步完成","继续核对"],"reply":{"mode":"automatic","targetUserId":""},"attachments":[]}\n```'
  }), "第一步完成 继续核对");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"silent","text":"不应出现","bubbles":[],"reply":{"mode":"plain","targetUserId":""},"attachments":[]}'
  }), "");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"reply","text":"图片完成","bubbles":[],"reply":{"mode":"plain","targetUserId":""},"attachments":[{"kind":"image","path":"/tmp/a.png","name":""}]}'
  }), "");
  assert.equal(normalizeQqNativeProgress({
    type: "commentary",
    text: '{"status":"reply","text":"[[qq_progress:旧协议]]","bubbles":[],"reply":{"mode":"plain","targetUserId":""},"attachments":[]}'
  }), "");
  assert.equal(normalizeQqNativeProgress({ type: "commentary", text: "[[qq_progress:旧协议]]" }), "");
  assert.equal(normalizeQqNativeProgress({ type: "commentary", text: '{"tool":"raw output"}' }), "");
});

test("native progress reporter serializes, deduplicates and caps QQ sends", async () => {
  const sent = [];
  const reporter = createQqNativeProgressReporter({
    maxMessages: 2,
    send: async (text) => {
      await Promise.resolve();
      sent.push(text);
    }
  });
  const structuredProgress = {
    type: "commentary",
    text: '{"status":"reply","text":"第一步完成","bubbles":[],"reply":{"mode":"automatic","targetUserId":""},"attachments":[]}'
  };
  assert.equal(reporter.observe(structuredProgress), true);
  assert.equal(reporter.observe({ type: "commentary", text: "第一步完成" }), false);
  assert.equal(reporter.observe({ type: "commentary", text: "第二步完成" }), true);
  assert.equal(reporter.observe({ type: "commentary", text: "第三步完成" }), false);
  await reporter.finish();
  assert.deepEqual(sent, ["第一步完成", "第二步完成"]);
  assert.equal(reporter.observe({ type: "commentary", text: "结束后不再发送" }), false);
});

test("native progress send failures do not fail or stop later updates", async () => {
  const sent = [];
  const errors = [];
  const reporter = createQqNativeProgressReporter({
    send: async (text) => {
      if (!sent.length) {
        sent.push(text);
        throw new Error("temporary OneBot failure");
      }
      sent.push(text);
    },
    onError: (error) => errors.push(error.message)
  });
  reporter.observe({ type: "commentary", text: "先试一次" });
  reporter.observe({ type: "commentary", text: "继续处理" });
  await reporter.finish();
  assert.deepEqual(sent, ["先试一次", "继续处理"]);
  assert.deepEqual(errors, ["temporary OneBot failure"]);
});
