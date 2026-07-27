import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqContextSemanticScorer,
  scoreQqContextSemanticRelevance
} from "../src/qq-context-relevance.js";

test("distant QQ context semantic scoring recognizes paraphrases without shared bigrams", () => {
  const scorer = createQqContextSemanticScorer("什么时候把新版本发布");
  const deployment = scorer("运维安排周五晚上十点部署上线");
  const unrelated = scorer("中午吃了番茄炒蛋");

  assert.ok(deployment.score > 0.16, `deployment score was ${deployment.score}`);
  assert.ok(deployment.score > unrelated.score + 0.1);
});

test("distant QQ context semantic scoring keeps preference polarity and channel concepts", () => {
  const related = scoreQqContextSemanticRelevance(
    "别给小林打电话",
    "小林不喜欢语音通话，优先发文字消息"
  );
  const unrelated = scoreQqContextSemanticRelevance(
    "别给小林打电话",
    "小林喜欢周五晚上玩游戏"
  );

  assert.ok(related.score > unrelated.score);
  assert.ok(related.coverageScore > unrelated.coverageScore);
});
