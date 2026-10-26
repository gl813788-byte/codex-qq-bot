// In-memory record of message ids the Bot itself sent and QQ confirmed, per
// conversation. It exists only so the Bot can recall its own recent message;
// QQ lets an ordinary member recall for about two minutes, so nothing older
// is offered and nothing is persisted.

const DEFAULT_MAX_PER_SCOPE = 24;
export const QQ_RECALL_WINDOW_MS = 115_000;

export function createQqSentMessageLedger({ maxPerScope = DEFAULT_MAX_PER_SCOPE, now = () => Date.now() } = {}) {
  const scopes = new Map();
  const prune = (scopeId, at = now()) => {
    const list = (scopes.get(scopeId) || []).filter((entry) => at - entry.at <= QQ_RECALL_WINDOW_MS * 2);
    if (list.length) scopes.set(scopeId, list.slice(-maxPerScope));
    else scopes.delete(scopeId);
    return scopes.get(scopeId) || [];
  };
  return {
    record(scopeId, { messageId, text = "" } = {}) {
      const scope = String(scopeId || "").trim();
      const id = normalizeMessageId(messageId);
      if (!scope || !id) return false;
      const list = prune(scope);
      if (list.some((entry) => entry.messageId === id)) return false;
      list.push({ messageId: id, text: compactPreview(text), at: now() });
      scopes.set(scope, list.slice(-maxPerScope));
      return true;
    },
    // Newest first, limited to messages QQ still allows the Bot to recall.
    recallable(scopeId) {
      const at = now();
      return prune(String(scopeId || "").trim(), at)
        .filter((entry) => at - entry.at <= QQ_RECALL_WINDOW_MS)
        .reverse();
    },
    forget(scopeId, messageId) {
      const scope = String(scopeId || "").trim();
      const id = normalizeMessageId(messageId);
      const list = scopes.get(scope) || [];
      const next = list.filter((entry) => entry.messageId !== id);
      if (next.length) scopes.set(scope, next);
      else scopes.delete(scope);
      return next.length !== list.length;
    }
  };
}

export function extractOneBotSentMessageId(result) {
  return normalizeMessageId(result?.body?.data?.message_id ?? result?.data?.message_id ?? result?.message_id);
}

function normalizeMessageId(value) {
  if (value == null) return "";
  const id = String(value).trim();
  return /^-?\d{1,20}$/.test(id) ? id : "";
}

function compactPreview(value) {
  return [...String(value || "").replace(/\[\[qq_[^\]]*\]\]/g, "[表情/附件]").replace(/\s+/g, " ").trim()].slice(0, 40).join("");
}
