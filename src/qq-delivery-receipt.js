export function buildQqDeliveryReceipt(reply = "", send = {}, {
  at = new Date().toISOString()
} = {}) {
  const bubbles = Array.isArray(send?.bubbles) && send.bubbles.length > 0
    ? send.bubbles.map((bubble) => String(bubble || "").trim())
    : [String(reply || "").trim()].filter(Boolean);
  const results = Array.isArray(send?.results) ? send.results : [];
  const deliveredBubbles = [];
  const failedBubbles = [];

  for (const [index, bubble] of bubbles.entries()) {
    const result = results[index];
    const failed = result ? result.ok === false : send?.ok === false;
    (failed ? failedBubbles : deliveredBubbles).push(bubble);
  }

  if (send?.ok === false && failedBubbles.length === 0 && bubbles.length > 0) {
    failedBubbles.push(...deliveredBubbles.splice(0));
  }

  return {
    at,
    attemptedBubbleCount: bubbles.length,
    deliveredBubbleCount: deliveredBubbles.length,
    failedBubbleCount: failedBubbles.length,
    deliveredBubbles,
    failedBubbles,
    error: compactText(send?.error || findSendError(results), 300)
  };
}

export function createQqDeliveryFailureMemoryEntry(event = {}, receipt = {}) {
  if (Number(receipt.failedBubbleCount || 0) <= 0) return null;
  return {
    at: receipt.at || new Date().toISOString(),
    senderId: event.senderId || "",
    senderLabel: event.senderLabel || event.senderName || "群友",
    senderName: event.senderName || "",
    isOwner: Boolean(event.isOwner),
    deliveryFailure: true,
    attemptedBubbleCount: Math.max(0, Number(receipt.attemptedBubbleCount || 0)),
    deliveredBubbleCount: Math.max(0, Number(receipt.deliveredBubbleCount || 0)),
    failedBubbleCount: Math.max(0, Number(receipt.failedBubbleCount || 0)),
    failedBubbles: (receipt.failedBubbles || []).map((text) => compactText(text, 500)).filter(Boolean).slice(0, 6),
    deliveryError: compactText(receipt.error, 300)
  };
}

export function formatQqDeliveryFailureContext(entries = [], {
  assistantName = "assistant"
} = {}) {
  const failures = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.deliveryFailure)
    .slice(-3);
  if (failures.length === 0) return "";
  return [
    `${assistantName} 的 QQ 投递回执（事实状态）：`,
    "下列失败内容没有成功到达 QQ，不能当作已经对群友说过。结合当前语境决定是否自然补发；不要声称对方已经看到。",
    ...failures.map((entry) => {
      const failed = (entry.failedBubbles || []).filter(Boolean).join(" / ") || "（内容不可用）";
      const counts = `成功 ${Math.max(0, Number(entry.deliveredBubbleCount || 0))} 条，失败 ${Math.max(1, Number(entry.failedBubbleCount || 0))} 条`;
      return `- ${formatTime(entry.at)}：${counts}；未送达内容：${failed}`;
    })
  ].join("\n");
}

function findSendError(results) {
  for (const result of results || []) {
    if (result?.ok !== false) continue;
    return result.error
      || result.body?.message
      || result.body?.wording
      || result.body?.error
      || (result.status ? `HTTP ${result.status}` : "QQ 投递失败");
  }
  return "";
}

function compactText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
