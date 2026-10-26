import { QQ_RECALL_WINDOW_MS } from "../qq-sent-message-ledger.js";

// Lightweight message actions a person uses instead of typing a reply:
// an emoji reaction on a group message, and recalling one's own message.
// Both are real QQ writes bound to the original conversation; success is
// reported only after OneBot confirms it.

const MAX_REACTIONS_PER_TURN = 2;

// QQ system face ids accepted by set_msg_emoji_like (NapCat infers the face
// type from the id length; longer ids are Unicode code points).
export const QQ_REACTION_FACES = Object.freeze({
  赞: "76", 点赞: "76", 爱心: "66", ok: "124", OK: "124", 笑哭: "182", doge: "179", 狗头: "179",
  斜眼笑: "178", 捂脸: "264", 吃瓜: "271", 问号脸: "268", 暗中观察: "269", 汪汪: "277", 喵喵: "307",
  鼓掌: "99", 庆祝: "320", 比心: "319", 拜谢: "297", 牛啊: "299", 摸鱼: "285", 托腮: "212",
  无奈: "174", 泪奔: "173", 委屈: "106", 疑问: "32", 微笑: "14", 呲牙: "13", 尴尬: "10", 流泪: "5",
  大哭: "9", 困: "25", 晕: "34", 打call: "311", 崇拜: "318", 嫌弃: "323", 生气: "326", 拳头: "120",
  玫瑰: "63", 拥抱: "49", 抱抱: "222", 敬礼: "282", 期待: "294", 加油: "315", 辣眼睛: "265", 头秃: "267"
});

export function resolveQqReactionEmojiId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{1,7}$/.test(text)) return text;
  const named = QQ_REACTION_FACES[text] || QQ_REACTION_FACES[text.replace(/^\[|\]$/g, "")];
  if (named) return named;
  const chars = [...text.replace(/️/g, "")];
  if (chars.length === 1) {
    const codePoint = chars[0].codePointAt(0);
    if (codePoint >= 0x2600) return String(codePoint);
  }
  return "";
}

export async function executeQqMessageTool(args = {}, {
  event = {},
  scopeId = "",
  ledger,
  callOneBotAction,
  assertActive = () => {}
} = {}) {
  assertActive();
  const action = String(args.action || "");
  if (action === "react") return reactToQqMessage(args, { event, callOneBotAction, assertActive });
  if (action === "recall") return recallOwnQqMessage(args, { scopeId, ledger, callOneBotAction, assertActive });
  if (action === "recallable") {
    const entries = ledger?.recallable(scopeId) || [];
    if (!entries.length) return { ok: true, reply: "最近两分钟内你在这里没有可撤回的消息。" };
    return {
      ok: true,
      reply: [
        "最近两分钟内你在这里发出、还能撤回的消息（1 是最新）：",
        ...entries.map((entry, index) => `${index + 1}. ${entry.text || "（无文字）"}`)
      ].join("\n")
    };
  }
  return { ok: false, error: "未知消息操作；只能 react、recall 或 recallable。" };
}

async function reactToQqMessage(args, { event, callOneBotAction, assertActive }) {
  if (!event.groupId) return { ok: false, error: "表情回应只能用在群聊消息上。" };
  event.qqReactionCount = Number(event.qqReactionCount || 0);
  if (event.qqReactionCount >= MAX_REACTIONS_PER_TURN) return { ok: false, error: `本轮最多回应 ${MAX_REACTIONS_PER_TURN} 次。` };
  const target = String(args.target || "current");
  const messageId = target === "quoted"
    ? event.replyContext?.messageId ?? event.replyMessageId
    : event.raw?.message_id;
  if (messageId == null || messageId === "") {
    return { ok: false, error: target === "quoted" ? "当前消息没有引用别的消息。" : "当前没有可回应的触发消息。" };
  }
  const emojiId = resolveQqReactionEmojiId(args.emoji);
  if (!emojiId) {
    return { ok: false, error: `不认识这个表情；可用 QQ 表情名（${Object.keys(QQ_REACTION_FACES).slice(0, 18).join("、")}…）、单个 emoji 或表情 id。` };
  }
  const result = await callOneBotAction("set_msg_emoji_like", { message_id: messageId, emoji_id: emojiId, set: true });
  assertActive();
  if (!result?.ok) return { ok: false, error: `表情回应失败：${result?.error || `HTTP ${result?.status || "未知"}`}。不要声称已经回应。` };
  event.qqReactionCount += 1;
  return { ok: true, reply: `已给${target === "quoted" ? "被引用的" : "这条"}消息贴上表情回应（${String(args.emoji).slice(0, 12)}）。只回应不说话时可以把 status 设为 silent。` };
}

async function recallOwnQqMessage(args, { scopeId, ledger, callOneBotAction, assertActive }) {
  const entries = ledger?.recallable(scopeId) || [];
  if (!entries.length) return { ok: false, error: `最近 ${Math.round(QQ_RECALL_WINDOW_MS / 60_000)} 分钟内你在这里没有还能撤回的消息；只能撤回自己刚发出的消息。` };
  const index = Math.max(1, Math.trunc(Number(args.index) || 1));
  const entry = entries[index - 1];
  if (!entry) return { ok: false, error: `只有 ${entries.length} 条可撤回；index 取 1-${entries.length}。` };
  const result = await callOneBotAction("delete_msg", { message_id: Number(entry.messageId) });
  assertActive();
  if (!result?.ok) return { ok: false, error: `撤回失败：${result?.error || `HTTP ${result?.status || "未知"}`}。可能已超过撤回时限，不要声称已经撤回。` };
  ledger.forget(scopeId, entry.messageId);
  return { ok: true, reply: `已撤回你刚才发的：${entry.text || "（无文字消息）"}` };
}
