import assert from "node:assert/strict";
import test from "node:test";
import {
  collectQqReplyTargetCandidates,
  extractQqReplyTargetDirective,
  formatQqReplyTargetInstruction,
  resolveQqReplyTarget
} from "../src/qq-reply-targeting.js";

test("lets a fused multi-sender reply quote a model-selected participant", () => {
  const event = {
    senderId: "10001",
    senderName: "甲",
    raw: { message_id: "501" },
    qqReplyTargetCandidates: [
      { senderId: "10002", senderName: "乙", messageId: "502" }
    ]
  };
  const candidates = collectQqReplyTargetCandidates(event, [
    { event: { senderId: "10003", senderName: "丙", raw: { message_id: "503" } } },
    { event: { senderId: "10002", senderName: "乙的新消息", raw: { message_id: "504" } } }
  ]);
  assert.deepEqual(candidates, [
    { senderId: "10001", senderName: "甲", messageId: "501" },
    { senderId: "10003", senderName: "丙", messageId: "503" },
    { senderId: "10002", senderName: "乙的新消息", messageId: "504" }
  ]);

  const instruction = formatQqReplyTargetInstruction(candidates);
  assert.match(instruction, /QQ 10001/);
  assert.match(instruction, /\[\[qq_reply:quote:QQ号\]\]/);
  assert.match(instruction, /\[\[qq_reply:mention:QQ号\]\]/);
  assert.match(instruction, /省略标记.*普通回复/);

  const parsed = extractQqReplyTargetDirective("回答乙\n[[qq_reply:quote:10002]]");
  assert.equal(parsed.visibleText, "回答乙");
  assert.deepEqual(resolveQqReplyTarget(parsed.directive, candidates), {
    explicit: true,
    mode: "quote",
    senderId: "10002",
    messageId: "504"
  });
});

test("lets a fused reply mention any selected participant", () => {
  const candidates = collectQqReplyTargetCandidates({
    senderId: "10001",
    senderName: "甲",
    raw: { message_id: "501" },
    qqReplyTargetCandidates: [
      { senderId: "10004", senderName: "丁", messageId: "504" }
    ]
  });
  assert.deepEqual(candidates, [
    { senderId: "10004", senderName: "丁", messageId: "504" },
    { senderId: "10001", senderName: "甲", messageId: "501" }
  ]);
  assert.match(formatQqReplyTargetInstruction(candidates), /每位候选人都可以.*引用或艾特/);

  const parsed = extractQqReplyTargetDirective("叫一下丁\n[[qq_reply:mention:10004]]");
  assert.equal(parsed.visibleText, "叫一下丁");
  assert.deepEqual(resolveQqReplyTarget(parsed.directive, candidates), {
    explicit: true,
    mode: "mention",
    senderId: "10004",
    messageId: null
  });
});

test("defaults fused multi-sender output to plain and honors an explicit plain marker", () => {
  const candidates = [
    { senderId: "10001", senderName: "甲", messageId: "501" },
    { senderId: "10002", senderName: "乙", messageId: "502" }
  ];
  assert.deepEqual(resolveQqReplyTarget(null, candidates), {
    explicit: false,
    mode: "plain",
    senderId: null,
    messageId: null
  });

  const parsed = extractQqReplyTargetDirective("[[qq_reply:plain]]\n都不引用也不艾特，直接回答");
  assert.equal(parsed.visibleText, "都不引用也不艾特，直接回答");
  assert.deepEqual(resolveQqReplyTarget(parsed.directive, candidates), {
    explicit: true,
    mode: "plain",
    senderId: null,
    messageId: null
  });

  const legacyParsed = extractQqReplyTargetDirective("[[qq_reply:none]]\n兼容旧格式");
  assert.equal(legacyParsed.visibleText, "兼容旧格式");
  assert.deepEqual(resolveQqReplyTarget(legacyParsed.directive, candidates), {
    explicit: true,
    mode: "plain",
    senderId: null,
    messageId: null
  });
});

test("keeps the legacy numeric marker as a quote target", () => {
  const candidates = [
    { senderId: "10001", senderName: "甲", messageId: "501" },
    { senderId: "10002", senderName: "乙", messageId: "502" }
  ];
  const parsed = extractQqReplyTargetDirective("[[qq_reply:10002]]\n回答乙");
  assert.equal(parsed.visibleText, "回答乙");
  assert.deepEqual(resolveQqReplyTarget(parsed.directive, candidates), {
    explicit: true,
    mode: "quote",
    senderId: "10002",
    messageId: "502"
  });
});

test("rejects a quote target that was not in the fused participant list", () => {
  const parsed = extractQqReplyTargetDirective("正文 [[qq_reply:quote:99999]]");
  const resolved = resolveQqReplyTarget(parsed.directive, [
    { senderId: "10001", messageId: "501" }
  ]);
  assert.equal(parsed.visibleText, "正文");
  assert.equal(resolved.mode, "plain");
  assert.equal(resolved.invalidTarget, "99999");
});
