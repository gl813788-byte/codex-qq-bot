import assert from "node:assert/strict";
import test from "node:test";
import { agentTurnUsageLogFields, createAgentTurnUsageTracker, summarizeClaudeUsage } from "../src/infrastructure/agent/agent-token-usage.js";
import { normalizeEntry } from "../src/logger.js";

const usage = (threadId, total, last) => ({ method: "thread/tokenUsage/updated", params: { threadId, tokenUsage: { total, last } } });

test("a Codex turn's usage is the thread total's growth during the turn", () => {
  const tracker = createAgentTurnUsageTracker();
  // A resumed thread already holds 9000 input tokens of history.
  tracker.observe(usage("t1", { inputTokens: 12000, cachedInputTokens: 8000, outputTokens: 500 }, { inputTokens: 3000, cachedInputTokens: 2000, outputTokens: 100 }));
  tracker.observe(usage("t1", { inputTokens: 16000, cachedInputTokens: 11500, outputTokens: 700 }, { inputTokens: 4000, cachedInputTokens: 3500, outputTokens: 200 }));
  // A rate-limit update resends the same totals.
  tracker.observe(usage("t1", { inputTokens: 16000, cachedInputTokens: 11500, outputTokens: 700 }, { inputTokens: 4000, cachedInputTokens: 3500, outputTokens: 200 }));
  assert.deepEqual(tracker.summarize({}), { inputTokens: 7000, cachedInputTokens: 5500, outputTokens: 300, cacheHitPercent: 78.6 });
  tracker.observe(usage("t2", { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 50 }, { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 50 }));
  assert.equal(tracker.summarize({}).inputTokens, 9000, "a recovery thread adds its own usage");
  assert.equal(createAgentTurnUsageTracker().summarize({}), null);
  tracker.observe({ method: "item/completed" });
});

test("Claude's aggregated usage counts cache reads and writes as input", () => {
  const summary = summarizeClaudeUsage({ input_tokens: 200, cache_read_input_tokens: 7000, cache_creation_input_tokens: 800, output_tokens: 90 });
  assert.deepEqual(summary, { inputTokens: 8000, cachedInputTokens: 7000, outputTokens: 90, cacheHitPercent: 87.5 });
  assert.equal(createAgentTurnUsageTracker().summarize({ usage: { input_tokens: 10, output_tokens: 1 } }).cacheHitPercent, 0);
  assert.equal(summarizeClaudeUsage(null), null);
  assert.deepEqual(agentTurnUsageLogFields(null), {});
  assert.equal(agentTurnUsageLogFields(summary).cacheHitPercent, 87.5);
});

// Live check 2026-11-14: fields named inputTokens/cachedInputTokens came out
// as "[redacted]" because the logger hides credential-like keys.
test("usage log fields survive the logger's credential redaction", () => {
  const fields = agentTurnUsageLogFields({ inputTokens: 8000, cachedInputTokens: 7000, outputTokens: 90, cacheHitPercent: 87.5 });
  assert.deepEqual(normalizeEntry({ level: "success", category: "agent", message: "turn finished", details: fields }).details, fields);
});
