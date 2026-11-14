// Per-turn token usage, including how much of the input was served from the
// provider's prompt cache, for the turn's log line. Codex streams
// `thread/tokenUsage/updated` with a running thread total (and the last
// request's share); Claude Code reports one aggregated `usage` on its result.
// The per-turn figure for Codex is the final total minus the total before this
// turn's first request, so a resumed thread's history is not counted again
// and a repeated notification (rate-limit updates resend the same totals) is
// harmless.

const FIELDS = Object.freeze(["inputTokens", "cachedInputTokens", "outputTokens"]);

export function createAgentTurnUsageTracker() {
  // A recovery attempt runs on a fresh thread, so totals are kept per thread.
  const threads = new Map();
  return {
    observe(message) {
      if (message?.method !== "thread/tokenUsage/updated") return;
      const total = pickCodexUsage(message.params?.tokenUsage?.total);
      if (!total) return;
      const threadId = String(message.params?.threadId || "");
      const entry = threads.get(threadId);
      if (entry) {
        entry.latest = total;
        return;
      }
      const last = pickCodexUsage(message.params?.tokenUsage?.last);
      threads.set(threadId, { baseline: last ? subtract(total, last) : zeroUsage(), latest: total });
    },
    // The engine's own figure wins (Claude); otherwise the observed deltas.
    summarize(result = null) {
      const claude = summarizeClaudeUsage(result?.usage);
      if (claude) return claude;
      if (!threads.size) return null;
      const sum = zeroUsage();
      for (const { baseline, latest } of threads.values()) {
        const delta = subtract(latest, baseline);
        for (const field of FIELDS) sum[field] += delta[field];
      }
      return withCacheRatio(sum);
    }
  };
}

// Anthropic's input_tokens excludes cache reads and writes; the turn's input
// is all three.
export function summarizeClaudeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.input_tokens);
  const read = count(usage.cache_read_input_tokens);
  const written = count(usage.cache_creation_input_tokens);
  const output = count(usage.output_tokens);
  if (input == null && read == null && written == null) return null;
  return withCacheRatio({
    inputTokens: (input || 0) + (read || 0) + (written || 0),
    cachedInputTokens: read || 0,
    outputTokens: output || 0
  });
}

// Log fields for a turn line; empty when the engine reported nothing. The
// names avoid the word "token": the logger redacts any detail key that looks
// like a credential, and these counts are not one.
export function agentTurnUsageLogFields(summary) {
  if (!summary) return {};
  return {
    usageInput: summary.inputTokens,
    usageCachedInput: summary.cachedInputTokens,
    usageOutput: summary.outputTokens,
    cacheHitPercent: summary.cacheHitPercent
  };
}

function withCacheRatio(usage) {
  const input = Math.max(0, usage.inputTokens || 0);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens || 0));
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: Math.max(0, usage.outputTokens || 0),
    cacheHitPercent: input > 0 ? Math.round((cached / input) * 1000) / 10 : null
  };
}

function pickCodexUsage(value) {
  if (!value || typeof value !== "object") return null;
  const usage = {
    inputTokens: count(value.inputTokens),
    cachedInputTokens: count(value.cachedInputTokens),
    outputTokens: count(value.outputTokens)
  };
  return usage.inputTokens == null ? null : usage;
}

function subtract(left, right) {
  return Object.fromEntries(FIELDS.map((field) => [field, Math.max(0, (left[field] || 0) - (right[field] || 0))]));
}

function zeroUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}
