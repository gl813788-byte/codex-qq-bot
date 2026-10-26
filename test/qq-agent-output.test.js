import assert from "node:assert/strict";
import test from "node:test";
import {
  extractQqAgentInnerState,
  parseQqAgentOutput,
  qqAgentOutputSchema,
  stripObsoleteQqControlMarkers
} from "../src/infrastructure/codex/qq-agent-output.js";

test("QQ agent output schema is strict and covers reply addressing and attachments", () => {
  assert.equal(qqAgentOutputSchema.additionalProperties, false);
  assert.deepEqual(qqAgentOutputSchema.required, ["innerThought", "status", "text", "bubbles", "reply", "attachments", "sticker", "mood"]);
  // The private inner monologue is generated before anything visible.
  assert.equal(Object.keys(qqAgentOutputSchema.properties)[0], "innerThought");
  assert.deepEqual(qqAgentOutputSchema.properties.reply.properties.mode.enum, ["automatic", "plain", "quote", "mention"]);
});

test("structured QQ output is translated at the delivery compatibility boundary", () => {
  const parsed = parseQqAgentOutput(JSON.stringify({
    status: "reply",
    text: "",
    bubbles: ["第一条", "第二条"],
    reply: { mode: "quote", targetUserId: "123456" },
    attachments: [
      { kind: "image", path: "/tmp/task/output/a.png", name: "" },
      { kind: "file", path: "/tmp/task/output/a.txt", name: "结果.txt" }
    ]
  }), { bubbleSeparator: "|||" });
  assert.equal(parsed.structured, true);
  assert.match(parsed.output, /第一条\n\|\|\|\n第二条/);
  assert.match(parsed.output, /\[\[qq_reply:quote:123456\]\]/);
  assert.match(parsed.output, /\[\[qq_image:\/tmp\/task\/output\/a\.png\]\]/);
  assert.match(parsed.output, /\[\[qq_file:\/tmp\/task\/output\/a\.txt\|结果\.txt\]\]/);
});

test("structured QQ output removes legacy reply markers from visible text", () => {
  const parsed = parseQqAgentOutput(JSON.stringify({
    status: "reply",
    text: "[[qq_reply:quote:123456]]\n正文还在",
    bubbles: [],
    reply: { mode: "mention", targetUserId: "654321" },
    attachments: []
  }));
  assert.equal(parsed.output, "正文还在\n[[qq_reply:mention:654321]]");
});

test("structured silence and legacy-control stripping fail closed", () => {
  const silent = parseQqAgentOutput(JSON.stringify({
    status: "silent",
    text: "ignored",
    bubbles: [],
    reply: { mode: "automatic", targetUserId: "" },
    attachments: []
  }));
  assert.equal(silent.output, "[[qq_silent]]");
  assert.equal(stripObsoleteQqControlMarkers("正文\n[[qq_progress:处理中]]\n[[qq_done]]"), "正文");

  const unsafe = parseQqAgentOutput(JSON.stringify({
    status: "reply",
    text: "完成",
    bubbles: [],
    reply: { mode: "quote", targetUserId: "not-a-qq" },
    attachments: [{ kind: "file", path: "relative.txt", name: "x" }]
  }));
  assert.equal(unsafe.output, "完成");
});

test("a structured sticker becomes its own final bubble and inner state is never visible", () => {
  const parsed = parseQqAgentOutput(JSON.stringify({
    innerThought: "他又在装傻，我才不上当",
    status: "reply",
    text: "你猜",
    bubbles: [],
    reply: { mode: "automatic", targetUserId: "" },
    attachments: [],
    sticker: "#3f2a9c",
    mood: "有点想笑"
  }), { bubbleSeparator: "|||" });
  assert.equal(parsed.output, "你猜\n|||\n[[qq_sticker:#3f2a9c]]");
  assert.doesNotMatch(parsed.output, /上当|想笑/);
  const stickerOnly = parseQqAgentOutput(JSON.stringify({
    innerThought: "", status: "reply", text: "", bubbles: [], reply: { mode: "automatic", targetUserId: "" },
    attachments: [], sticker: "[[狗头]]|", mood: ""
  }));
  assert.equal(stickerOnly.output, "[[qq_sticker:狗头]]");
  assert.deepEqual(extractQqAgentInnerState({ innerThought: " 懒得理 ", mood: "困", status: "silent" }), {
    innerThought: "懒得理", mood: "困", silent: true
  });
  assert.deepEqual(extractQqAgentInnerState(null), { innerThought: "", mood: "", silent: false });
});
