import assert from "node:assert/strict";
import test from "node:test";
import {
  addQqLanguageFeatures,
  analyzeQqLanguageStyle,
  buildQqLanguageStyleProfile,
  createEmptyQqLanguageCounts,
  extractQqLanguageFeatures,
  formatQqLanguageStyleProfile
} from "../src/qq-language-style.js";

test("counts punctuation by occurrence and by containing message without counting CQ URLs", () => {
  const features = extractQqLanguageFeatures("真的？？（） [CQ:image,url=https://example.test/a.jpg] https://example.test/x?a=1...");
  assert.equal(features.punctuationOccurrences.question, 1);
  assert.equal(features.punctuationOccurrences.repeated_question, 1);
  assert.equal(features.punctuationOccurrences.empty_parentheses, 1);
  assert.equal(features.punctuationMessages.question, 1);
  assert.equal(features.punctuationOccurrences.ellipsis || 0, 0);
});

test("builds bounded punctuation candidates while leaving scoped meaning to the model", () => {
  const counts = createEmptyQqLanguageCounts();
  for (let index = 0; index < 20; index += 1) {
    const text = index < 8 ? "行吧。" : index < 13 ? "真的？？" : "继续";
    addQqLanguageFeatures(counts, extractQqLanguageFeatures(text));
  }
  const profile = buildQqLanguageStyleProfile({ sampleCount: 20, ...counts });
  const period = profile.frequentPunctuation.find((entry) => entry.key === "full_stop");
  const repeatedQuestion = profile.frequentPunctuation.find((entry) => entry.key === "repeated_question");
  assert.equal(period.messageCount, 8);
  assert.equal(period.messageRatio, 0.4);
  assert.equal(period.meaning, undefined);
  assert.equal(repeatedQuestion.messageCount, 5);
  const formatted = formatQqLanguageStyleProfile(profile, { label: "本群" });
  assert.match(formatted, /本群语言习惯/);
  assert.match(formatted, /？？\/\?\?/);
  assert.match(formatted, /通用及范围含义尚未标注/);
});

test("analyzes human language by scope and optional stable sender id", () => {
  const entries = [];
  for (let index = 0; index < 16; index += 1) {
    entries.push({ senderId: "10001", text: index < 6 ? "怎么说…" : "行" });
    entries.push({ senderId: "20002", text: "收到！" });
  }
  entries.push({ senderId: "assistant", isAssistant: true, text: "我也会用……" });
  const group = analyzeQqLanguageStyle(entries);
  const member = analyzeQqLanguageStyle(entries, { senderId: "10001" });
  assert.equal(group.sampleSize, 32);
  assert.equal(member.sampleSize, 16);
  assert.equal(member.frequentPunctuation.some((entry) => entry.key === "ellipsis"), true);
  assert.equal(member.frequentPhrases.some((entry) => entry.key === "hesitation_marker"), true);
  assert.equal(group.punctuation.find((entry) => entry.key === "exclamation").messageCount, 16);
});
