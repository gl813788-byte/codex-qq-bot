const DEFAULT_MAX_MESSAGES = 4;
const DEFAULT_MAX_CHARS = 160;

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
  if (!raw || looksLikeStructuredFinalOutput(raw) || /\[\[qq_/i.test(raw)) return "";
  return raw
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, clampInteger(maxChars, 40, 500, DEFAULT_MAX_CHARS));
}

function looksLikeStructuredFinalOutput(value) {
  const candidate = String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
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
