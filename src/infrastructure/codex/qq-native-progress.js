const DEFAULT_MAX_MESSAGES = 4;
const DEFAULT_MAX_CHARS = 160;
const QQ_AGENT_OUTPUT_KEYS = Object.freeze(["status", "text", "bubbles", "reply", "attachments"]);
const QQ_REPLY_KEYS = Object.freeze(["mode", "targetUserId"]);
const QQ_REPLY_MODES = new Set(["automatic", "plain", "quote", "mention"]);

export function createQqNativeProgressReporter({
  send,
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxChars = DEFAULT_MAX_CHARS,
  onError = null
} = {}) {
  if (typeof send !== "function") throw new TypeError("send must be a function");
  const seen = new Set();
  const limit = clampInteger(maxMessages, 1, 8, DEFAULT_MAX_MESSAGES);
  const charLimit = clampInteger(maxChars, 40, 500, DEFAULT_MAX_CHARS);
  let accepting = true;
  let acceptedCount = 0;
  let pending = Promise.resolve();

  return {
    observe(progress) {
      if (!accepting || acceptedCount >= limit) return false;
      const text = normalizeQqNativeProgress(progress, { maxChars: charLimit });
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) return false;
      seen.add(key);
      acceptedCount += 1;
      pending = pending.then(async () => {
        try {
          await send(text);
        } catch (error) {
          try {
            onError?.(error, text);
          } catch {
            // Progress diagnostics must not affect the QQ task.
          }
        }
      });
      return true;
    },
    async finish() {
      accepting = false;
      await pending;
    },
    snapshot() {
      return { acceptedCount, maxMessages: limit };
    }
  };
}

export function normalizeQqNativeProgress(progress, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (progress?.type !== "commentary") return "";
  const raw = String(progress?.text || "").trim();
  if (!raw) return "";
  const structuredText = unwrapStructuredCommentary(raw);
  const visible = structuredText === null ? raw : structuredText;
  if (!visible || looksLikeStructuredFinalOutput(visible) || /\[\[qq_/i.test(visible)) return "";
  return visible
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, clampInteger(maxChars, 40, 500, DEFAULT_MAX_CHARS));
}

function unwrapStructuredCommentary(value) {
  const candidate = stripJsonFence(value);
  if (!candidate.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return /^\{\s*"(?:status|text|bubbles|reply|attachments)"\s*:/i.test(candidate) ? "" : null;
  }
  if (!isExactQqAgentOutputEnvelope(parsed)) return "";
  if (parsed.status !== "reply" || parsed.attachments.length > 0) return "";
  const bubbles = parsed.bubbles.map((bubble) => bubble.trim()).filter(Boolean);
  return bubbles.length > 0 ? bubbles.join(" ") : parsed.text.trim();
}

function isExactQqAgentOutputEnvelope(value) {
  if (!hasExactKeys(value, QQ_AGENT_OUTPUT_KEYS)) return false;
  if (value.status !== "reply" && value.status !== "silent") return false;
  if (typeof value.text !== "string") return false;
  if (!Array.isArray(value.bubbles) || value.bubbles.length > 24 || !value.bubbles.every((item) => typeof item === "string")) {
    return false;
  }
  if (!hasExactKeys(value.reply, QQ_REPLY_KEYS) || !QQ_REPLY_MODES.has(value.reply.mode)) return false;
  if (typeof value.reply.targetUserId !== "string") return false;
  return Array.isArray(value.attachments);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => keys.includes(key));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stripJsonFence(value) {
  return String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksLikeStructuredFinalOutput(value) {
  const candidate = stripJsonFence(value);
  if (!candidate.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(candidate);
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return /^\{\s*"(?:status|text|bubbles|reply|attachments)"\s*:/i.test(candidate);
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}
