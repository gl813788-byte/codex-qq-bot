import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqActiveJoinGroupPayload,
  formatQqActiveJoinGroupFailure,
  parseQqActiveJoinGroupCommand,
  parseQqZonePublishCommand
} from "../src/qq-social-command.js";

test("does not parse proactive friend-add commands", () => {
  assert.equal(parseQqActiveJoinGroupCommand("主动加好友 123456 群里认识的"), null);
  assert.equal(parseQqActiveJoinGroupCommand("加好友 123456"), null);
  assert.equal(parseQqActiveJoinGroupCommand("添加好友 123456"), null);
  assert.equal(parseQqActiveJoinGroupCommand("加群 987654"), null);
  assert.equal(parseQqActiveJoinGroupCommand("加入群 987654"), null);
});

test("parses group answers with spaces and keeps legacy syntax", () => {
  assert.deepEqual(buildQqActiveJoinGroupPayload(parseQqActiveJoinGroupCommand("主动加群 987654 正确 答案 2026")), {
    target_id: "987654",
    message: "正确 答案 2026",
    answer: "正确 答案 2026"
  });
  assert.deepEqual(buildQqActiveJoinGroupPayload(parseQqActiveJoinGroupCommand("主动加群 987654 答案=Open AI 2026")), {
    target_id: "987654",
    message: "Open AI 2026",
    answer: "Open AI 2026"
  });
});

test("formats actionable verification failures", () => {
  assert.match(formatQqActiveJoinGroupFailure("987654", {
    error: "answer_required",
    question: "项目口令"
  }, 409), /主动加群 987654 答案=正确答案/);
  assert.match(formatQqActiveJoinGroupFailure("987654", {
    error: "native_timeout",
    native_api: "GroupService.reqToJoinGroup"
  }, 504), /没有在限定时间内返回/);
  assert.match(formatQqActiveJoinGroupFailure("987654", {
    error: "group_join_unconfirmed"
  }, 502), /群列表没有确认/);
});

test("parses text, image-only and mixed QQ Zone publish commands", () => {
  assert.deepEqual(parseQqZonePublishCommand("/发动态 今天天气很好"), {
    content: "今天天气很好",
    useCurrentImages: false,
    invalidImageSelector: ""
  });
  assert.deepEqual(parseQqZonePublishCommand("发动态 图片=当前"), {
    content: "",
    useCurrentImages: true,
    invalidImageSelector: ""
  });
  assert.deepEqual(parseQqZonePublishCommand("发动态 今天天气很好 | 图片=引用"), {
    content: "今天天气很好",
    useCurrentImages: true,
    invalidImageSelector: ""
  });
  assert.equal(parseQqZonePublishCommand("发动态 图片=/etc/passwd").invalidImageSelector, "/etc/passwd");
});
