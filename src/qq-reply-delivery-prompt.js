import { formatQqColdProactiveCompletionInstruction } from "./qq-cold-proactive-prompt.js";

// Every reply-turn sentence that depends on how the main model speaks lives
// here, so the two delivery modes stay in one place:
// - "tool": the model talks through qq_chat.send during the turn; each call is
//   delivered at once and the final structured output is private state.
// - "final": the model returns one structured reply that the Hub sends after
//   the turn (tool-less turns, non-OneBot turns, owner file/image tasks, or
//   CODEX_REMOTE_CONTACT_QQ_REPLY_DELIVERY=final).

export const QQ_REPLY_DELIVERY_MODES = Object.freeze(["tool", "final"]);

export function normalizeQqReplyDelivery(value) {
  return value === "tool" ? "tool" : "final";
}

// Sent once, as a plain message, when a turn that already spoke fails before
// it finished, so people are not left with only a "let me check".
export const QQ_CHAT_SEND_FAILURE_NOTICE = "刚才卡住了，后面的没弄完，麻烦再叫我一次";

// Follow-ups that arrive while a turn runs are steered into it.
export function formatQqSteeredBatchInstruction({ replyDelivery = "final" } = {}) {
  return normalizeQqReplyDelivery(replyDelivery) === "tool"
    ? "5 秒静默窗口已经结束。Hub 把本批新消息引导进当前任务（必要时中断旧 turn 开启替代轮次）。你已经用 qq_chat.send 发出的消息对方都看到了：把新消息和正在做的事一起考虑，需要回应就接着用 qq_chat.send 说，别重复已经发过的内容，也不要逐条机械回复“消息一/消息二”。"
    : "5 秒静默窗口已经结束。Hub 会优先把本批新消息引导进当前活跃任务；若活跃 turn 已不接受引导，才会中断旧 turn 并开启替代轮次。无论采用哪种方式，都要把追加消息与正在进行的多轮任务融合成一份统一回复，不要先发过时答案，也不要逐条机械回复“消息一/消息二”。";
}

// A persistent thread resumes with the same fusion rules as a fresh turn.
export function formatQqPersistentFusionNote({ replyDelivery = "final" } = {}) {
  return normalizeQqReplyDelivery(replyDelivery) === "tool"
    ? "本轮仍使用与临时会话完全相同的融合式追问规则：所有触发 Bot 回复的新消息作为一个批次处理，用 qq_chat.send 自然地回应。"
    : "本轮仍使用与临时会话完全相同的融合式追问规则：所有触发 Bot 回复的新消息作为一个批次处理，最终只输出一份统一回复。";
}

// The last line of a reply prompt: what to do now.
export function formatQqReplyCompletionInstruction({
  replyDelivery = "final",
  privateChat = false,
  coldProactive = false,
  privateProactive = false
} = {}) {
  const tool = normalizeQqReplyDelivery(replyDelivery) === "tool";
  if (coldProactive) return formatQqColdProactiveCompletionInstruction({ replyDelivery: tool ? "tool" : "final" });
  if (privateProactive) {
    return tool
      ? "现在想说就用 qq_chat.send 给对方发一句自然的消息；读完上下文后没有真想说的内容、这类联系已经显得多余，或安全与关键事实无法可靠确认时，一条都不发，把 status 设为 silent。"
      : "现在只输出一句要发给对方的自然消息；读完上下文后没有真想说的内容、这类联系已经显得多余，或安全与关键事实无法可靠确认时，把 status 设为 silent。";
  }
  if (tool) {
    return `现在用 qq_chat.send 在${privateChat ? "私聊" : "群"}里回应：可以马上说，也可以先说一声再去做、做完再发，分几次发都行；不想说就一条都不发。说完、做完后提交输出 Schema 结束本轮（它不会发送）。不要追加服务式追问或“我还能继续帮你”的结尾。`;
  }
  return `请按输出 Schema 提交要发送到 QQ ${privateChat ? "私聊" : "群"}里的最终回复。不要追加服务式追问或“我还能继续帮你”的结尾。`;
}

// What the model already said in this turn, for a follow-up round.
export function formatQqAlreadySentContext(sentText = "", { maxChars = 2000 } = {}) {
  const text = String(sentText || "").trim();
  return text
    ? `你这一轮已经用 qq_chat.send 发出、对方都看到了的消息：\n${text.slice(0, maxChars)}`
    : "你这一轮还没有发出任何消息。";
}

// Follow-ups that arrive after a turn finished but before its lifecycle
// ended start one more round. With the send tool the earlier messages were
// already delivered, so the round continues the conversation; with a final
// reply the earlier answer is an unsent draft the round must replace.
export function buildQqFollowUpFusionPrompts({
  replyDelivery = "final",
  fullBase = "",
  fusionText = "",
  alreadySent = ""
} = {}) {
  if (normalizeQqReplyDelivery(replyDelivery) === "tool") {
    return {
      fullPrompt: [
        fullBase,
        "",
        formatQqAlreadySentContext(alreadySent),
        "",
        "你刚结束上一段回应，又有新消息到达：",
        fusionText,
        "",
        "接着自然回应这些新消息：需要回应就用 qq_chat.send 发，别重复已经发过的内容，也不要解释内部过程；没什么要补充的就一条都不发，把 status 设为 silent。"
      ].join("\n"),
      resumePrompt: [
        "你正在继续同一个 QQ 长期线程。你上一轮用 qq_chat.send 发出的消息对方都已经看到。之后又有新消息到达：",
        fusionText,
        "",
        "需要回应就用 qq_chat.send 接着说，别重复已经发过的话，不要逐条作答或解释内部过程；不需要就一条都不发，把 status 设为 silent。"
      ].join("\n")
    };
  }
  return {
    fullPrompt: [
      fullBase,
      "",
      "上一版回答已经生成，但尚未发送。现在有新的追问到达：",
      fusionText,
      "",
      "不要发送或复述上一版回答。立即进入下一轮，把上一版草稿与这批追问融合，只输出一份替代旧草稿的最终 QQ 回复；不要解释融合过程。"
    ].join("\n"),
    resumePrompt: [
      "你正在继续同一个 QQ 长期线程。上一轮助手输出尚未真正发送到 QQ，只是一份必须丢弃或改写的草稿。",
      fusionText,
      "",
      "立即进入下一轮，把本批触发消息及筛选后的中间语境融合进草稿，只输出一份替代草稿的最终 QQ 回复。不要逐条作答，不要解释内部过程。"
    ].join("\n")
  };
}
