import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqLanguageStatisticsLogDetails,
  planQqLanguageStatisticsCheckpoint
} from "../src/qq-language-log.js";

test("language statistics logs only emit when candidates or bounded checkpoints change", () => {
  const quiet = planQqLanguageStatisticsCheckpoint({ sampleSize: 12 });
  assert.equal(quiet.due, false);

  const candidate = planQqLanguageStatisticsCheckpoint({
    sampleSize: 12,
    frequentPunctuation: [{
      key: "repeated_question",
      symbol: "？？/??",
      occurrenceCount: 6,
      messageCount: 4,
      messageRatio: 0.333,
      meaning: "不应进入统计日志"
    }]
  });
  assert.equal(candidate.due, true);
  assert.equal(candidate.snapshot.frequentCandidateCount, 1);
  assert.equal(JSON.stringify(candidate.snapshot).includes("不应进入统计日志"), false);

  const unchanged = planQqLanguageStatisticsCheckpoint({
    sampleSize: 13,
    frequentPunctuation: [{ key: "repeated_question", symbol: "？？/??" }]
  }, candidate.signature);
  assert.equal(unchanged.due, false);

  const checkpoint = planQqLanguageStatisticsCheckpoint({ sampleSize: 25 });
  assert.equal(checkpoint.due, true);
  assert.equal(checkpoint.snapshot.checkpoint, 1);
});

test("language statistics log details expose scoped aggregates without message text", () => {
  const scopePlan = planQqLanguageStatisticsCheckpoint({
    sampleSize: 30,
    frequentPhrases: [{
      key: "reaction_opening",
      label: "先用短反应词接住情绪",
      occurrenceCount: 8,
      messageCount: 7,
      messageRatio: 0.233
    }]
  });
  const details = buildQqLanguageStatisticsLogDetails({
    scopeId: "10001",
    scopeType: "group",
    groupId: "10001",
    senderId: "20002",
    scopePlan
  });

  assert.equal(details.operation, "learning.language_statistics");
  assert.equal(details.outcome, "recorded");
  assert.deepEqual(details.checkpointKinds, ["scope"]);
  assert.equal(details.scopeLanguage.phraseCandidates[0].key, "reaction_opening");
  assert.equal(Object.hasOwn(details, "text"), false);
  assert.equal(Object.hasOwn(details, "memberLanguage"), false);
});
