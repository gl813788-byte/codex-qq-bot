import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQqAdaptiveModelStyleReview,
  buildQqAdaptiveLearningSignals
} from "../src/qq-adaptive-learning.js";
import {
  buildQqModelStyleReviewPrompt,
  parseQqModelStyleReview
} from "../src/qq-style-review.js";

test("main-model style review stays flexible and overwrites the previous diagnosis", () => {
  const prompt = buildQqModelStyleReviewPrompt([
    { senderId: "10001", senderName: "群友", text: "直接接话", at: "2026-07-01T00:00:00.000Z" },
    { senderId: "assistant", isAssistant: true, text: "好的，我来详细说明。", at: "2026-07-01T00:00:01.000Z" }
  ], { botName: "测试 Bot", snapshotId: "snapshot-1" });
  assert.match(prompt, /没有明显差异就明确保持/);
  assert.match(prompt, /punctuationUsageRules/);
  assert.match(prompt, /统一属于现有黑话知识/);
  assert.doesNotMatch(prompt, /必须压到约/);

  const parsed = parseQqModelStyleReview(
    'FINAL_JSON: {"summary":"Bot 常先确认再解释，真人直接承接","detail":"差异主要出现在轻量接话；正式答疑不必盲目缩短。","guidance":["闲聊直接承接","复杂答疑保留必要解释"],"languageProfile":{"phrasePatterns":["先用短反应承接"],"sentencePatterns":["短句自然停住"],"punctuationUsageRules":[{"symbol":"……","knowledgeTitle":"……","confidence":0.82,"evidence":"多次出现在反应句末尾","usageBoundary":"不能一律理解为没说完"}]},"knowledge":[{"kind":"slang","title":"……","content":"通用可表示停顿；本群常表示无语，不能一律视为未说完","scope":"group","replacesTitle":""}]}'
  );
  const group = { adaptive: { styleReviewSummary: "旧复盘", styleGuidance: ["旧规则"] } };
  assert.equal(applyQqAdaptiveModelStyleReview(group, parsed, {
    now: "2026-07-02T00:00:00.000Z",
    humanSamples: 20,
    botSamples: 8
  }), true);
  const signals = buildQqAdaptiveLearningSignals(group, null, {
    now: "2026-07-02T01:00:00.000Z"
  });
  assert.equal(signals.group.styleReviewSummary, "Bot 常先确认再解释，真人直接承接");
  assert.doesNotMatch(signals.group.styleReviewDetail, /旧复盘/);
  assert.deepEqual(signals.group.styleGuidance, ["闲聊直接承接", "复杂答疑保留必要解释"]);
  assert.deepEqual(signals.group.styleLanguageProfile.phrasePatterns, ["先用短反应承接"]);
  assert.match(signals.group.styleLanguageProfile.punctuationUsageRules[0].usageBoundary, /不能一律理解/);
  assert.equal(parsed.knowledge[0].title, "……");
});

test("persistent learning references punctuation meanings stored in slang knowledge", () => {
  const group = {};
  const parsed = parseQqModelStyleReview(
    'FINAL_JSON: {"summary":"标点承载群内语气","detail":"重复问号多是惊讶式反问。","guidance":[],"languageProfile":{"phrasePatterns":[],"sentencePatterns":[],"punctuationUsageRules":[{"symbol":"？？","knowledgeTitle":"？？","confidence":0.76,"evidence":"常见于接梗后的短反应","usageBoundary":"不一定索要解释"}]},"knowledge":[{"kind":"slang","title":"？？","content":"通用表示加强疑问；本群常作惊讶式反问，不一定索要解释","scope":"group","replacesTitle":""}]}'
  );
  assert.equal(applyQqAdaptiveModelStyleReview(group, parsed), true);
  const context = buildQqAdaptiveLearningSignals(group).group.styleLanguageProfile;
  assert.match(context.punctuationUsageRules[0].usageBoundary, /不一定索要解释/);
  assert.equal(parsed.knowledge[0].content.includes("本群"), true);
});
