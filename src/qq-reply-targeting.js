const replyTargetMarkerPattern = /\[\[qq_reply:([^\]\n]+)\]\]/gi;
const maxReplyTargetCandidates = 12;

export function collectQqReplyTargetCandidates(event = {}, extraEvents = []) {
  const ordered = [];
  const append = (value = {}) => {
    const senderId = normalizeQqId(value.senderId ?? value.userId);
    const messageId = normalizeMessageId(value.messageId ?? value.raw?.message_id);
    if (!senderId || !messageId) return;
    const candidate = {
      senderId,
      senderName: String(value.senderName || value.senderLabel || value.name || "").trim().slice(0, 100),
      messageId
    };
    const existing = ordered.findIndex((item) => item.senderId === senderId);
    if (existing >= 0) ordered.splice(existing, 1);
    ordered.push(candidate);
  };

  for (const candidate of event.qqReplyTargetCandidates || []) append(candidate);
  append(event);
  for (const candidate of event.queuedEvents || []) append(candidate);
  for (const item of extraEvents || []) append(item?.event || item);
  return ordered.slice(-maxReplyTargetCandidates);
}

export function formatQqReplyTargetInstruction(candidates = []) {
  const options = uniqueQqReplyTargets(candidates);
  if (options.length < 2) return "";
  const formatTargets = (items) => items
    .map((item) => `${item.senderName || "群友"}(QQ ${item.senderId})`)
    .join("；");
  return [
    "这批消息来自多位群友，最终答案的内容对象和 QQ 寻址对象必须由你自己匹配，不能沿用最早触发者。",
    `以下每位候选人都可以由你选择引用或艾特：${formatTargets(options)}。`,
    "引用某人时，在最终正文中独占一行写 [[qq_reply:quote:QQ号]]；艾特某人时写 [[qq_reply:mention:QQ号]]；不需要引用或艾特任何人时写 [[qq_reply:plain]]。标记不会显示给群友。",
    "省略标记时 Hub 默认使用普通回复，不会引用或艾特最早触发者。只能选择上面列出的 QQ 号；需要同时艾特多人时，仍在可见正文中使用 @昵称 或 @QQ号。"
  ].filter(Boolean).join("\n");
}

function parseQqReplyTarget(rawTarget) {
  const raw = String(rawTarget || "").trim();
  const target = raw.toLowerCase();
  if (["none", "plain", "不引用", "不艾特", "无", "普通"].includes(target)) {
    return { mode: "plain", senderId: null };
  }
  const modeTarget = target.match(/^(quote|reply|引用|mention|at|艾特|@)\s*[:：\s]\s*(\d{4,20})$/i);
  if (modeTarget) {
    const requestedMode = modeTarget[1].toLowerCase();
    return {
      mode: ["mention", "at", "艾特", "@"].includes(requestedMode) ? "mention" : "quote",
      senderId: modeTarget[2]
    };
  }
  const legacyQuoteTarget = normalizeQqId(target);
  if (legacyQuoteTarget) {
    return { mode: "quote", senderId: legacyQuoteTarget };
  }
  return { mode: "invalid", senderId: null, rawTarget: raw.slice(0, 100) };
}

export function extractQqReplyTargetDirective(reply = "") {
  let directive = null;
  const visibleText = String(reply || "").replace(replyTargetMarkerPattern, (_match, rawTarget) => {
    directive = parseQqReplyTarget(rawTarget);
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { visibleText, directive };
}

export function resolveQqReplyTarget(directive, candidates = []) {
  const options = uniqueQqReplyTargets(candidates);
  if (directive?.mode === "plain") {
    return { explicit: true, mode: "plain", senderId: null, messageId: null };
  }
  if (directive?.mode === "quote" || directive?.mode === "mention") {
    const candidate = options.find((item) => item.senderId === directive.senderId);
    if (candidate && (directive.mode !== "quote" || candidate.messageId)) {
      return {
        explicit: true,
        mode: directive.mode,
        senderId: candidate.senderId,
        messageId: directive.mode === "quote" ? candidate.messageId : null
      };
    }
    return {
      explicit: true,
      mode: "plain",
      senderId: null,
      messageId: null,
      invalidTarget: directive.senderId
    };
  }
  if (directive?.mode === "invalid") {
    return { explicit: true, mode: "plain", senderId: null, messageId: null, invalidTarget: directive.rawTarget || null };
  }
  return {
    explicit: false,
    mode: options.length > 1 ? "plain" : "automatic",
    senderId: null,
    messageId: null
  };
}

function uniqueQqReplyTargets(candidates) {
  return collectQqReplyTargetCandidates({ qqReplyTargetCandidates: candidates });
}

function normalizeQqId(value) {
  const id = String(value ?? "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function normalizeMessageId(value) {
  const id = String(value ?? "").trim();
  return /^-?\d{1,30}$/.test(id) ? id : "";
}
