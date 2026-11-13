import { QQ_CHAT_SEND_MAX_BUBBLES } from "../infrastructure/codex/qq-native-tools.js";

// qq_chat.send: the main model speaks through a tool, the way chat agents on
// other platforms do, instead of packing its one reply into the final
// structured output. One session lives for one reply turn. It validates the
// arguments, serializes sends so bubbles never interleave, refuses spam
// (per-turn limit, exact repeats of delivered content, calls after the turn
// ended) and keeps the receipts the reply lifecycle later turns into memory.
// Delivery itself (reply guards, OneBot writes, interest reset) is injected.

export const QQ_CHAT_SEND_MAX_PER_TURN = 12;
const STOP_CODES = new Set(["QQ_REPLY_STOPPED", "HUB_SHUTTING_DOWN", "QQ_GENERATION_STOPPED"]);
const MAX_ATTACHMENTS = 8;
const REPLY_MODES = new Set(["automatic", "plain", "quote", "mention"]);
const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

export function normalizeQqChatSendArguments(args = {}) {
  const source = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const rawBubbles = Array.isArray(source.bubbles)
    ? source.bubbles
    : typeof source.bubbles === "string" ? [source.bubbles] : [];
  const bubbles = rawBubbles
    .map((bubble) => String(bubble ?? "").trim())
    .filter(Boolean);
  // Some models name the field text; one string is one bubble.
  if (bubbles.length === 0 && typeof source.text === "string" && source.text.trim()) {
    bubbles.push(source.text.trim());
  }
  const mode = REPLY_MODES.has(source.reply?.mode) ? source.reply.mode : "automatic";
  const targetUserId = /^[1-9][0-9]{4,12}$/.test(String(source.reply?.targetUserId || "").trim())
    ? String(source.reply.targetUserId).trim()
    : "";
  const attachments = (Array.isArray(source.attachments) ? source.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .map((attachment) => {
      const path = String(attachment?.path || "").trim();
      const kind = attachment?.kind === "image" || attachment?.kind === "file"
        ? attachment.kind
        : IMAGE_EXTENSION_PATTERN.test(path) ? "image" : "file";
      return { kind, path, name: String(attachment?.name || "").trim() };
    })
    .filter((attachment) => attachment.path);
  return {
    bubbles: bubbles.slice(0, QQ_CHAT_SEND_MAX_BUBBLES),
    droppedBubbleCount: Math.max(0, bubbles.length - QQ_CHAT_SEND_MAX_BUBBLES),
    reply: { mode, targetUserId: mode === "quote" || mode === "mention" ? targetUserId : "" },
    attachments,
    sticker: String(source.sticker || "").trim()
  };
}

// The same shape as the final structured output's visible fields, so the
// existing parser, attachment import and marker pipeline deliver it.
export function toQqAgentOutputValue(message) {
  return {
    status: "reply",
    text: "",
    bubbles: [...message.bubbles],
    reply: { ...message.reply },
    attachments: message.attachments.map((attachment) => ({ ...attachment })),
    sticker: message.sticker
  };
}

export function createQqChatSendSession({
  deliver,
  maxSends = QQ_CHAT_SEND_MAX_PER_TURN,
  onEvent = null
} = {}) {
  if (typeof deliver !== "function") throw new TypeError("deliver must be a function");
  const limit = Math.max(1, Math.min(30, Math.trunc(Number(maxSends)) || QQ_CHAT_SEND_MAX_PER_TURN));
  const deliveries = [];
  const deliveredKeys = new Set();
  let attempts = 0;
  let closed = false;
  let queue = Promise.resolve();

  const report = (payload) => {
    try {
      onEvent?.(payload);
    } catch {
      // Diagnostics never change what the model is told.
    }
  };

  const sendNow = async (args, context) => {
    if (closed) {
      return { ok: false, error: "这一轮已经结束，这条没有发出。" };
    }
    const message = normalizeQqChatSendArguments(args);
    if (message.bubbles.length === 0 && !message.sticker && message.attachments.length === 0) {
      return { ok: false, error: "没有要发送的内容：bubbles、sticker、attachments 至少要有一项。不想说话就不用调用。" };
    }
    if (attempts >= limit) {
      report({ outcome: "limited", sendIndex: attempts });
      return { ok: false, error: `这一轮已经发了 ${limit} 次消息，先停下；还有话等别人回应了再说。` };
    }
    const key = messageKey(message);
    if (deliveredKeys.has(key)) {
      report({ outcome: "duplicate", sendIndex: attempts });
      return { ok: false, error: "这条和你这一轮已经发出的内容一样，没有重复发送；对方已经看到了。" };
    }
    const sendIndex = attempts;
    attempts += 1;
    let delivery;
    try {
      delivery = await deliver(message, { ...context, sendIndex });
    } catch (error) {
      if (STOP_CODES.has(error?.code)) {
        // A stopped reply (/stop, shutdown) is not a failed delivery to retry.
        closed = true;
        report({ outcome: "stopped", sendIndex });
        return { ok: false, error: "这一轮回复已经被停止，不要再发了。" };
      }
      delivery = {
        reply: message.bubbles.join("\n"),
        send: { ok: false, error: String(error?.message || error || "QQ 投递失败") },
        receipt: {
          attemptedBubbleCount: Math.max(1, message.bubbles.length),
          deliveredBubbleCount: 0,
          failedBubbleCount: Math.max(1, message.bubbles.length),
          deliveredBubbles: [],
          failedBubbles: message.bubbles.length ? [...message.bubbles] : ["（表情包或附件）"],
          error: String(error?.message || error || "QQ 投递失败")
        }
      };
    }
    if (delivery?.refused) {
      // Nothing was attempted (for example a proactive turn that went stale).
      report({ outcome: "refused", sendIndex });
      return { ok: false, error: String(delivery.reason || "这条没有发出。") };
    }
    const receipt = delivery?.receipt || {};
    deliveries.push({
      sendIndex,
      reply: String(delivery?.reply || ""),
      send: delivery?.send || null,
      receipt,
      hasSticker: Boolean(message.sticker),
      attachmentCount: message.attachments.length
    });
    if (Number(receipt.deliveredBubbleCount || 0) > 0) deliveredKeys.add(key);
    report({
      outcome: Number(receipt.failedBubbleCount || 0) > 0
        ? Number(receipt.deliveredBubbleCount || 0) > 0 ? "partial" : "failed"
        : "delivered",
      sendIndex,
      deliveredBubbleCount: Number(receipt.deliveredBubbleCount || 0),
      failedBubbleCount: Number(receipt.failedBubbleCount || 0)
    });
    return formatQqChatSendResult(receipt, {
      droppedBubbleCount: message.droppedBubbleCount,
      remaining: limit - attempts
    });
  };

  return {
    send(args, context = {}) {
      const run = queue.then(() => sendNow(args, context));
      queue = run.catch(() => undefined);
      return run;
    },
    // Late calls from an engine that kept going are refused, never delivered.
    async close() {
      closed = true;
      await queue;
    },
    get deliveries() {
      return deliveries.map((delivery) => ({ ...delivery }));
    },
    get deliveredBubbleCount() {
      return deliveries.reduce((total, delivery) => total + Number(delivery.receipt?.deliveredBubbleCount || 0), 0);
    },
    snapshot() {
      return {
        attempts,
        sendCount: deliveries.length,
        deliveredBubbleCount: deliveries.reduce((total, delivery) => total + Number(delivery.receipt?.deliveredBubbleCount || 0), 0),
        failedBubbleCount: deliveries.reduce((total, delivery) => total + Number(delivery.receipt?.failedBubbleCount || 0), 0),
        limit,
        closed
      };
    }
  };
}

export function formatQqChatSendResult(receipt = {}, { droppedBubbleCount = 0, remaining = 0 } = {}) {
  const delivered = Math.max(0, Number(receipt.deliveredBubbleCount || 0));
  const failed = Math.max(0, Number(receipt.failedBubbleCount || 0));
  const dropped = Math.max(0, Number(droppedBubbleCount || 0));
  const droppedNote = dropped > 0 ? `超出单次 ${QQ_CHAT_SEND_MAX_BUBBLES} 条上限的 ${dropped} 条没有发，要说就再调用一次。` : "";
  if (failed === 0 && delivered > 0) {
    return {
      ok: true,
      reply: [
        `已送达 ${delivered} 条，对方已经看到；别重发。`,
        droppedNote,
        remaining > 0 ? "还有事就继续做，有新话再发；说完了就结束本轮。" : "本轮发言次数已用完。"
      ].filter(Boolean).join("")
    };
  }
  const failedText = (receipt.failedBubbles || [])
    .map((bubble) => String(bubble || "").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 4)
    .map((bubble) => `「${bubble}」`)
    .join("");
  const reason = String(receipt.error || "QQ 没有确认送达").replace(/\s+/g, " ").trim().slice(0, 200);
  if (delivered > 0) {
    return {
      ok: true,
      reply: `送达 ${delivered} 条，失败 ${failed} 条（${reason}）。没送达的${failedText}对方没看到，可以换个说法补发，但别重复已送达的。${droppedNote}`
    };
  }
  return {
    ok: false,
    error: `没有发出去（${reason}）。${failedText ? `对方没看到${failedText}。` : ""}不要说已经发了；可以换个说法再试一次。`
  };
}

// Folds one turn's sends into the reply/send pair the lifecycle already
// understands: every attempted bubble once, each paired with its own result,
// so the receipt, sent-message memory and failure memory stay exact.
export function summarizeQqChatSendDeliveries(deliveries = [], { bubbleSeparator = "|||" } = {}) {
  const separator = `\n${String(bubbleSeparator || "|||").trim() || "|||"}\n`;
  const bubbles = [];
  const results = [];
  const deliveredBubbles = [];
  let firstError = "";
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    const receipt = delivery?.receipt || {};
    for (const bubble of receipt.deliveredBubbles || []) {
      const text = String(bubble || "").trim();
      if (!text) continue;
      bubbles.push(text);
      deliveredBubbles.push(text);
      results.push({ ok: true });
    }
    for (const bubble of receipt.failedBubbles || []) {
      const text = String(bubble || "").trim();
      if (!text) continue;
      const error = String(receipt.error || "QQ 投递失败");
      firstError ||= error;
      bubbles.push(text);
      results.push({ ok: false, error });
    }
  }
  return {
    sendCount: Array.isArray(deliveries) ? deliveries.length : 0,
    reply: bubbles.join(separator),
    deliveredReply: deliveredBubbles.join(separator),
    deliveredBubbleCount: deliveredBubbles.length,
    send: bubbles.length
      ? {
        ok: results.every((result) => result.ok),
        toolDelivered: true,
        bubbles,
        flattened: bubbles.join("\n"),
        results,
        ...(firstError ? { error: firstError } : {})
      }
      : null
  };
}

function messageKey(message) {
  return JSON.stringify([
    message.bubbles.map((bubble) => bubble.replace(/\s+/g, " ").toLocaleLowerCase()),
    message.sticker.toLocaleLowerCase(),
    message.attachments.map((attachment) => attachment.path)
  ]);
}
