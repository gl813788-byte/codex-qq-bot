import assert from "node:assert/strict";
import test from "node:test";
import {
  parseQqContextSummaryOutput,
  qqContextSummaryOutputSchema
} from "../src/infrastructure/codex/qq-context-summary-output.js";

test("context summary schema separates visible text from structured knowledge", () => {
  assert.equal(qqContextSummaryOutputSchema.additionalProperties, false);
  assert.deepEqual(qqContextSummaryOutputSchema.required, ["summary", "knowledge"]);
  assert.equal(qqContextSummaryOutputSchema.properties.knowledge.items.additionalProperties, false);
});

test("parses bounded summary knowledge without marker protocols", () => {
  const result = parseQqContextSummaryOutput(JSON.stringify({
    summary: "1. 讨论了新的 Agent 架构。",
    knowledge: [{
      kind: "note",
      title: "Agent 架构",
      content: "群内共识：由 Codex App Server 负责原生工具循环。",
      scope: "group",
      userId: "",
      userName: "",
      replacesTitle: "旧 Agent 架构"
    }]
  }));

  assert.equal(result.summary, "1. 讨论了新的 Agent 架构。");
  assert.equal(result.knowledge[0].replacesTitle, "旧 Agent 架构");
});

test("fails closed for invalid summaries and drops malformed knowledge", () => {
  assert.equal(parseQqContextSummaryOutput("not json"), null);
  assert.deepEqual(parseQqContextSummaryOutput(JSON.stringify({
    summary: "有内容",
    knowledge: [{ kind: "note", title: "缺正文", content: "", scope: "group" }]
  })), { summary: "有内容", knowledge: [] });
});
