import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQqOfficialRobotMarker,
  applyQqRobotContextAssessment,
  createEmptyQqRobotProfile,
  normalizeQqOfficialRobotMarker,
  normalizeQqRobotCommands
} from "../src/qq-robot-profile.js";

test("normalizes official robot markers without treating a missing value as false", () => {
  assert.equal(normalizeQqOfficialRobotMarker(true), true);
  assert.equal(normalizeQqOfficialRobotMarker("0"), false);
  assert.equal(normalizeQqOfficialRobotMarker(undefined, null), undefined);
});

test("official robot markers take precedence while context can identify unofficial robots", () => {
  const official = applyQqOfficialRobotMarker(createEmptyQqRobotProfile(), true, {
    at: new Date("2026-08-30T08:00:00.000Z")
  }).profile;
  const downgradeResult = applyQqRobotContextAssessment(official, {
    isRobot: false,
    confidence: 0.99,
    evidence: "短期内没有看到自动回复",
    commands: []
  });
  const attemptedDowngrade = downgradeResult.profile;
  assert.equal(downgradeResult.changed, false);
  assert.equal(attemptedDowngrade.isRobot, true);
  assert.equal(attemptedDowngrade.source, "official");

  const unofficial = applyQqRobotContextAssessment(
    applyQqOfficialRobotMarker(createEmptyQqRobotProfile(), false).profile,
    {
      isRobot: true,
      confidence: 0.91,
      evidence: "长期固定响应帮助菜单和掷骰格式",
      commands: [{ command: "/roll 2d6", effect: "掷两枚六面骰", requiresMention: false }]
    }
  ).profile;
  assert.equal(unofficial.isRobot, true);
  assert.equal(unofficial.source, "context");
});

test("keeps only bounded low-risk public robot commands", () => {
  assert.deepEqual(normalizeQqRobotCommands([
    { command: "/今日运势", effect: "娱乐查询", requiresMention: false },
    { command: "/今日运势", effect: "重复" },
    { command: "/踢人 12345", effect: "管理" },
    { command: "https://example.test/action", effect: "外链" }
  ]), [{ command: "/今日运势", effect: "娱乐查询", requiresMention: false }]);
});

test("migrates the legacy command description field into effect", () => {
  assert.deepEqual(normalizeQqRobotCommands([
    { command: "/roll 1d6", description: "返回一次六面骰结果" }
  ]), [{ command: "/roll 1d6", effect: "返回一次六面骰结果", requiresMention: true }]);
});
