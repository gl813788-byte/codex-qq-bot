import assert from "node:assert/strict";
import test from "node:test";
import {
  findQqBracketActionClaims,
  findUnbackedQqActionClaims,
  formatQqUnbackedActionRefusal,
  isQqAutoPerformedActionClaim,
  qqActionEvidenceKey,
  stripQqBracketActionClaims
} from "../src/qq-action-claims.js";

const kinds = (text) => findQqBracketActionClaims(text).map((claim) => claim.kind);

// Live check 2026-11-14: the Bot answered “（戳戳）” with “（戳回去）正犯困呢”
// but never poked; the owner noted the same happens with other actions.
test("bracketed actions QQ can perform are recognized", () => {
  const cases = {
    "（戳回去）正犯困呢": "poke", "(戳戳你)": "poke", "（拍拍你的头）乖": "poke", "（反手拍回去）": "poke",
    "（甩出一张表情包）": "sticker", "（发了个表情包）": "sticker",
    "（发张图）": "image", "（贴了个表情）": "react",
    "（点赞）": "like", "（给你点了个赞）": "like",
    "（撤回）": "recall", "（偷了）": "favorite", "（已存）": "favorite", "（收藏了）": "favorite",
    "（扔了个骰子）": "dice", "（出剪刀）": "rps", "（放首歌给你）": "music",
    "（发了条说说）": "qzone", "（禁言你）": "moderation", "（踢了）": "moderation", "（加好友）": "add_friend"
  };
  for (const [text, kind] of Object.entries(cases)) assert.deepEqual(kinds(text), [kind], text);
});

test("imaginary actions, remarks and look-alikes stay text", () => {
  for (const text of ["（亲亲）", "（抱住）", "（摸摸头）", "（拍桌）", "（拍手）", "（拍照）", "（戳穿）", "（存疑）", "（偷笑）",
    "（发呆）", "（发抖）", "（点头）", "（踢踢脚）", "（截图）", "（bushi）", "（笑）", "戳一下试试", "发个表情包吧"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("a claim is backed by a successful matching tool or by what the message carries", () => {
  const claims = findQqBracketActionClaims("（甩出一张表情包）（撤回）（戳戳）（点赞）");
  const evidence = new Set([qqActionEvidenceKey({ namespace: "qq_message", tool: "act", toolAction: "recall" })]);
  assert.equal(qqActionEvidenceKey({ namespace: "qq_social", tool: "act", toolAction: "poke" }), "qq_social.act:poke");
  assert.deepEqual(findUnbackedQqActionClaims(claims, { evidence }).map((claim) => claim.kind), ["sticker", "poke", "like"]);
  assert.deepEqual(findUnbackedQqActionClaims(claims, { evidence, sticker: true }).map((claim) => claim.kind), ["poke", "like"]);
  evidence.add("qq_message.act:react");
  assert.deepEqual(findUnbackedQqActionClaims(claims, { evidence, sticker: true }).map((claim) => claim.kind), ["poke"], "a thumbs-up reaction backs （点赞）");
  assert.equal(isQqAutoPerformedActionClaim({ kind: "poke" }), true);
  assert.equal(isQqAutoPerformedActionClaim({ kind: "sticker" }), false);
});

test("the refusal names the tool and stripping leaves no empty bubble", () => {
  const claims = findQqBracketActionClaims("（撤回）（甩出一张表情包）");
  const reason = formatQqUnbackedActionRefusal(claims);
  assert.match(reason, /这条没有发出/);
  assert.match(reason, /（撤回）是 QQ 里真能做的撤回.*qq_message\.act recall/);
  assert.match(reason, /qq_sticker 搜到的 #编号 填进 qq_chat\.send 的 sticker/);
  assert.match(reason, /不打算真的做，就把这个括号删掉再发/);
  const text = "笑死（戳戳）\n|||\n（甩出一张表情包）\n|||\n（亲亲）晚安";
  const all = findQqBracketActionClaims(text);
  assert.equal(stripQqBracketActionClaims(text, all), "笑死\n|||\n（亲亲）晚安");
  assert.equal(stripQqBracketActionClaims("（戳回去）正犯困呢", all.filter((claim) => claim.kind === "sticker")), "（戳回去）正犯困呢", "only the given claims go");
  assert.equal(stripQqBracketActionClaims("a\n##\n（戳）\n##\nb", findQqBracketActionClaims("（戳）"), { bubbleSeparator: "##" }), "a\n##\nb");
});
