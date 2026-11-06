import { analyzeQqSymbolHabits, describeQqSymbolHabits } from "./qq-language-style.js";

const mediaOnlyPattern = /^(?:\[(?:图片|表情|语音|文件)(?:[^\]]*)?\]|[\p{Extended_Pictographic}\uFE0F\s]+)$/u;
const casualEmotionPattern = /(累|困|晕|烦|气死|难受|开心|高兴|想睡|睡懵|绷不住|笑死|离谱|无语|我去|卧槽|草|好耶|寄了|麻了|焦虑|难过|伤心|emo|崩溃|郁闷|心累|不开心|想哭|委屈|慌|孤独|失眠)/i;
// “说不上为什么”“不知道怎么办” share how someone feels; they are not asking
// for an explanation.
const rhetoricalQuestionPattern = /(?:说不上|不知道|也不懂|搞不懂|想不通)(?:为什么|为啥|怎么回事|怎么办|咋办)/;
const imageQuestionPattern = /(看|看看|识别|评价|锐评|什么图|这是啥|这是什么|什么梗|什么意思|图里|截图|表情包)/i;
const socialRequestPattern = /(叫.{0,8}(?:爸爸|爹|妈)|揍|打|锤|夸我|骂我|亲一个|抱一下|给.{0,8}(?:点.{0,4}赞|点赞)|充.{0,8}(?:会员|svip)|借我|唱一个)/i;
const protectedMarkerPattern = /\[\[qq_(?:memory|image|file|sticker|reply|command|progress|task_budget):[^\n]*?\]\]|\[\[qq_(?:done|task_continue)\]\]/g;
const emojiCharacterPattern = /\p{Extended_Pictographic}/u;
const compactMediaTokenPattern = /\[(?:图片|表情|语音|文件)(?:[^\]]*)?\]/giu;

export function isQqStickerStyleMessage(entry = {}) {
  if (Number(entry?.stickerCount || 0) > 0) return true;
  const text = String(entry?.text || entry?.reply || "").trim();
  if (!text) return false;
  if (/\[\[qq_sticker:[^\]]+\]\]/i.test(text) || /^\[表情/.test(text)) return true;
  if (/\[CQ:face,/i.test(text)) return true;
  const cqImage = /\[CQ:image,/i.test(text) || /^,?file=[^,]+,/i.test(text);
  return cqImage && (
    /summary=\[(?:动画表情|动态表情|表情)[^\]]*\]/i.test(text)
    || /(?:emoji_id|emoji_package_id|package_id)=/i.test(text)
    || /(?:^|,)sub_type=1(?:,|\])/i.test(text)
  );
}

export function isQqImageStyleMessage(entry = {}) {
  const text = String(entry?.text || "").trim();
  if (isQqStickerStyleMessage(entry)) return false;
  return /^\[图片/.test(text)
    || /\[CQ:image,/i.test(text)
    || /^,?file=[^,]+,[\s\S]*url=/i.test(text)
    || (Array.isArray(entry?.images) && entry.images.length > 0);
}

export function getQqAdaptiveStickerChance(style = {}, { privateChat = false } = {}) {
  const learned = clamp(Number(style?.stickerMessageRatio || 0), 0, 1);
  return clamp(learned * 1.35 + 0.035, privateChat ? 0.08 : 0.10, privateChat ? 0.26 : 0.34);
}

export function analyzeQqHumanChatStyle(entries = [], { privateChat = false, windowSize = 160 } = {}) {
  const window = (Array.isArray(entries) ? entries : []).slice(-Math.max(20, windowSize));
  const humans = window.filter((entry) => !entry?.isAssistant && entry?.senderId !== "assistant");
  const textMessages = humans
    .map((entry) => getQqHumanVisibleText(entry))
    .filter((text) => text && !text.startsWith("/"));
  const lengths = textMessages.map(characterLength).sort((left, right) => left - right);
  const stickerMessages = humans.filter(isQqStickerStyleMessage).length;
  const imageMessages = humans.filter(isQqImageStyleMessage).length;
  const mediaMessages = humans.filter((entry) => isQqStickerStyleMessage(entry)
    || isQqImageStyleMessage(entry)
    || mediaOnlyPattern.test(String(entry?.text || "").trim())).length;
  const emojiMessages = humans.filter((entry) => emojiCharacterPattern.test(String(entry?.text || ""))).length;
  const emojiPalette = collectEmojiPalette(humans);
  const shortMessages = lengths.filter((length) => length <= 12).length;
  const multilineMessages = textMessages.filter((text) => /\n/.test(text)).length;
  const terminalPeriodMessages = textMessages.filter((text) => /。$/.test(text)).length;
  const questionMessages = textMessages.filter((text) => /[?？]/.test(text)).length;
  const runs = buildHumanMessageRuns(window);
  const multiRuns = runs.filter((run) => run.count >= 2);
  const messagesInMultiRuns = multiRuns.reduce((sum, run) => sum + run.count, 0);
  const runLengths = runs.map((run) => run.count).sort((left, right) => left - right);
  const timing = analyzeHumanTiming(window, humans);
  const median = quantile(lengths, 0.5, privateChat ? 16 : 8);
  const p90 = quantile(lengths, 0.9, privateChat ? 48 : 24);
  const reactionMax = clamp(Math.max(median, p90), 8, privateChat ? 30 : 18);
  const casualMax = clamp(Math.max(p90, median * 2), privateChat ? 18 : 10, privateChat ? 54 : 28);
  const answerMax = clamp(Math.max(p90 * 4, median * 6), privateChat ? 64 : 36, privateChat ? 180 : 96);
  return {
    sampleSize: humans.length,
    textSampleSize: textMessages.length,
    confidence: textMessages.length >= 40 ? "high" : textMessages.length >= 16 ? "medium" : "low",
    symbolHabits: analyzeQqSymbolHabits(humans, { windowSize }),
    medianTextChars: median,
    p90TextChars: p90,
    shortMessageRatio: ratio(shortMessages, lengths.length),
    mediaMessageRatio: ratio(mediaMessages, humans.length),
    imageMessageRatio: ratio(imageMessages, humans.length),
    stickerMessageRatio: ratio(stickerMessages, humans.length),
    emojiMessageRatio: ratio(emojiMessages, humans.length),
    emojiPalette,
    replyMessageRatio: ratio(humans.filter((entry) => Boolean(entry?.replyContext)).length, humans.length),
    mentionMessageRatio: ratio(humans.filter((entry) => Array.isArray(entry?.atTargets) && entry.atTargets.length > 0).length, humans.length),
    multilineRatio: ratio(multilineMessages, textMessages.length),
    terminalPeriodRatio: ratio(terminalPeriodMessages, textMessages.length),
    questionRatio: ratio(questionMessages, textMessages.length),
    noTerminalPunctuationRatio: ratio(textMessages.filter((text) => !/[。！？!?…~～）)]$/.test(text)).length, textMessages.length),
    sameSpeakerContinuationRatio: ratio(Math.max(0, humans.length - runs.length), humans.length),
    multiMessageRunRatio: ratio(multiRuns.length, runs.length),
    messagesInMultiRunsRatio: ratio(messagesInMultiRuns, humans.length),
    runP90: quantile(runLengths, 0.9, 2),
    maxRun: runLengths.at(-1) || 1,
    messagesPerHour: timing.messagesPerHour,
    activeMinuteMedianMessages: timing.activeMinuteMedianMessages,
    activeMinuteP90Messages: timing.activeMinuteP90Messages,
    sameSpeakerGapMedianSeconds: timing.sameSpeakerGapMedianSeconds,
    speakerSwitchGapMedianSeconds: timing.speakerSwitchGapMedianSeconds,
    reactionMax,
    casualMax,
    answerMax,
    privateChat
  };
}

export function analyzeQqBotChatStyle(entries = [], { windowSize = 160 } = {}) {
  const window = (Array.isArray(entries) ? entries : []).slice(-Math.max(20, windowSize));
  const bots = window.filter((entry) => entry?.isAssistant || entry?.senderId === "assistant");
  const textMessages = bots
    .map((entry) => getQqHumanVisibleText(entry))
    .filter(Boolean);
  const lengths = textMessages.map(characterLength).sort((left, right) => left - right);
  const stickerMessages = bots.filter(isQqStickerStyleMessage).length;
  const multiBubbleMessages = bots.filter((entry) => Number(entry?.bubbleCount || 0) > 1
    || /(?:^|\n)\s*\|\|\|\s*(?:\n|$)/.test(String(entry?.text || ""))).length;
  const genericOpeningMessages = textMessages.filter((text) => /^(?:好的|好嘞|收到|明白了?|当然|没问题)[，,：:\s]?/.test(text)).length;
  const serviceEndingMessages = textMessages.filter((text) => /(?:如果|要是|需要|想要).{0,12}(?:我可以|我能|再帮|继续帮)|(?:还有什么|希望能帮到|随时告诉我)[^。！？!?]{0,8}[。！？!?]?$/.test(text)).length;
  return {
    sampleSize: bots.length,
    textSampleSize: textMessages.length,
    averageTextChars: lengths.length > 0 ? Number((lengths.reduce((sum, length) => sum + length, 0) / lengths.length).toFixed(1)) : 0,
    medianTextChars: quantile(lengths, 0.5, 0),
    p90TextChars: quantile(lengths, 0.9, 0),
    shortMessageRatio: ratio(lengths.filter((length) => length <= 12).length, lengths.length),
    stickerMessages,
    stickerMessageRatio: ratio(stickerMessages, bots.length),
    emojiMessageRatio: ratio(textMessages.filter((text) => emojiCharacterPattern.test(text)).length, textMessages.length),
    terminalPeriodRatio: ratio(textMessages.filter((text) => /。$/.test(text)).length, textMessages.length),
    noTerminalPunctuationRatio: ratio(textMessages.filter((text) => !/[。！？!?…~～）)]$/.test(text)).length, textMessages.length),
    questionRatio: ratio(textMessages.filter((text) => /[?？]/.test(text)).length, textMessages.length),
    multiBubbleRatio: ratio(multiBubbleMessages, bots.length),
    genericOpeningRatio: ratio(genericOpeningMessages, textMessages.length),
    serviceEndingRatio: ratio(serviceEndingMessages, textMessages.length)
  };
}

// `expression` comes from the owner's speech sliders (see
// getQqPersonalityExpressionBias): it scales chat-length hints and the emoji,
// sticker and multi-bubble odds, never task turns.
export function buildQqHumanBehaviorPlan(event = {}, intent = {}, style = {}, { text = "", expression = null } = {}) {
  const source = String(text || event?.text || "").replace(/\s+/g, " ").trim();
  const privateChat = Boolean(style.privateChat || event.type === "private_message" || !event.groupId);
  const hasImages = Boolean(intent.hasImages);
  const explicitImageQuestion = hasImages && imageQuestionPattern.test(source);
  const barePing = !source || /^[?？!！~～。\s]+$/.test(source);
  const emotional = casualEmotionPattern.test(source);
  // A feeling shared without a real question is emotional chat, not a Q&A.
  const venting = emotional && !/[?？]/.test(source) && (rhetoricalQuestionPattern.test(source) || !intent.isQuestion);
  let mode = "casual";
  let goal = "像群友那样随口接一句，不扩写成说明文";
  let maxChars = Number(style.casualMax || (privateChat ? 48 : 24));
  let maxSentences = privateChat ? 2 : 1;
  let compact = true;
  let openEnded = false;
  let completionDriven = false;

  if (event.qqPrivateProactive) {
    mode = "private_proactive";
    goal = "结合这段私聊的频率、最近话题和自己的兴趣自然联系一次；没有具体内容就保持沉默";
    maxChars = Math.min(Number(style.casualMax || 28), 32);
    maxSentences = 1;
  } else if (event.qqColdProactive) {
    mode = "cold_proactive";
    goal = "知道当前是冷群场景后，根据自己的兴趣自由检索、探索并决定是否自然开启话题";
    maxChars = Number(style.answerMax || 88);
    maxSentences = 3;
    compact = false;
    openEnded = true;
  } else if (intent.replyOnly) {
    mode = "quoted_continuation";
    goal = intent.isQuestion
      ? "直接回答被引用消息里的问题，不退回无内容的在线确认或让对方重说"
      : "把被引用消息当作当前话头自然接上，不退回无内容的在线确认或索取重复说明";
    maxChars = Math.min(Number(style.answerMax || (privateChat ? 96 : 60)), privateChat ? 110 : 72);
    maxSentences = 2;
    compact = true;
  } else if (barePing) {
    mode = "ping";
    goal = "短促回应自己在场，必要时只问一句怎么了";
    maxChars = privateChat ? 12 : 8;
  } else if (event.queuedAggregate) {
    mode = "multi_turn";
    goal = "抓住连续消息里最后仍有效的主线，不逐条点名复述";
    maxChars = Number(style.answerMax || (privateChat ? 140 : 80));
    maxSentences = privateChat ? 3 : 2;
    compact = false;
  } else if (intent.hasForward || intent.links?.length) {
    mode = "shared_content";
    goal = intent.asksOpinion || intent.isQuestion
      ? "回应对方分享内容里真正问的点"
      : "先对分享内容作一个具体反应，不擅自写长篇摘要";
    maxChars = Math.min(Number(style.answerMax || 80), privateChat ? 130 : 72);
    maxSentences = privateChat ? 3 : 2;
    compact = !(intent.asksOpinion || intent.isQuestion);
  } else if (intent.asksRecent) {
    mode = "context_answer";
    goal = "直接承接前文回答，省略双方已经知道的背景";
    maxChars = Number(style.answerMax || (privateChat ? 140 : 88));
    maxSentences = privateChat ? 3 : 2;
    compact = false;
  } else if (intent.asksAction && source.length <= 40 && socialRequestPattern.test(source)) {
    mode = "social_request";
    goal = "把它当作群聊里的轻量请求或玩笑，能做就短报结果，不能做就短拒绝或接梗，不展开权限说明";
    maxChars = Math.min(Number(style.casualMax || 28) + 12, privateChat ? 62 : 38);
    maxSentences = 2;
  } else if (intent.asksAction) {
    mode = "task";
    goal = "直接完成并交付结果；篇幅按任务正确性和完整性自行决定";
    maxChars = null;
    maxSentences = null;
    compact = false;
    openEnded = true;
    completionDriven = true;
  } else if (hasImages && !explicitImageQuestion) {
    mode = "visual_reaction";
    goal = "像群友看见图后接一句，不主动做图片解析报告";
    maxChars = Number(style.reactionMax || (privateChat ? 24 : 16));
  } else if (intent.asksOpinion) {
    mode = "opinion";
    goal = "先给鲜明但有分寸的看法，只补一个关键理由";
    maxChars = Math.min(Number(style.answerMax || 80), privateChat ? 110 : 64);
    maxSentences = 2;
    compact = false;
  } else if (venting && !explicitImageQuestion) {
    mode = "social_emotion";
    goal = "像朋友那样反应：共鸣、吐槽或说说自己的类似情况都行，不分析、不说教、不给方案，也别像心理咨询";
    maxChars = Math.min(Number(style.casualMax || 28) + 8, privateChat ? 64 : 34);
    maxSentences = 2;
  } else if (intent.isQuestion || explicitImageQuestion) {
    mode = source.length <= 14 ? "casual_answer" : "answer";
    goal = source.length <= 14
      ? "直接回答短问题，不把它升级成百科说明"
      : "先给答案，再补最关键依据";
    maxChars = source.length <= 14
      ? Math.min(Number(style.answerMax || 72), privateChat ? 88 : 52)
      : Number(style.answerMax || (privateChat ? 150 : 88));
    maxSentences = source.length <= 14 ? 2 : (privateChat ? 3 : 2);
    compact = source.length <= 14;
  } else if (emotional) {
    mode = "social_emotion";
    goal = "像朋友那样反应：共鸣、吐槽或说说自己的类似情况都行，不分析、不说教、不给方案，也别像心理咨询";
    maxChars = Math.min(Number(style.casualMax || 28) + 8, privateChat ? 64 : 34);
    maxSentences = 2;
  }

  const bias = normalizeExpressionBias(expression);
  if (Number.isFinite(maxChars) && maxChars != null && !completionDriven) {
    maxChars = Math.max(4, Math.round(maxChars * bias.lengthScale));
  }
  const multiBubbleChance = clamp(getMultiBubbleChance(mode, privateChat, style) * bias.bubbleScale, 0, 0.85);
  const preferMultiBubble = multiBubbleChance > 0
    && stableFraction(`${event.groupId || "private"}:${event.senderId || ""}:${event.raw?.message_id || ""}:${source}`) < multiBubbleChance;
  const emojiChance = clamp(getEmojiChance(mode, source, style) * bias.emojiScale, 0, 0.6);
  const preferEmoji = emojiChance > 0
    && stableFraction(`emoji:${event.groupId || "private"}:${event.senderId || ""}:${event.raw?.message_id || ""}:${source}`) < emojiChance;
  const stickerChance = clamp(getStickerChance(mode, source, style, { privateChat, hasImages }) * bias.stickerScale, 0, 0.7);
  const preferSticker = stickerChance > 0
    && stableFraction(`sticker:${event.groupId || "private"}:${event.senderId || ""}:${event.raw?.message_id || ""}:${source}`) < stickerChance;
  return {
    mode,
    goal,
    maxChars,
    maxSentences,
    compact,
    openEnded,
    completionDriven,
    preferMultiBubble,
    multiBubbleChance,
    maxBubbles: preferMultiBubble ? clamp(Number(style.runP90 || 2), 2, 3) : 1,
    preferEmoji,
    emojiChance,
    emojiPalette: Array.isArray(style.emojiPalette) ? style.emojiPalette.slice(0, 5) : [],
    preferSticker,
    stickerChance,
    typingHabits: describeQqSymbolHabits(style.symbolHabits)
  };
}

// Defaults when a conversation has too few observations to measure: rough
// per-message rates of an ordinary Chinese QQ group.
const DEFAULT_HUMAN_ACTION_RATES = Object.freeze({ reactions: 0.03, pokes: 0.01, recalls: 0.01 });
const reactionModes = new Set(["casual", "social_emotion", "visual_reaction", "shared_content", "opinion", "ping", "casual_answer", "social_request", "quoted_continuation"]);
const reactionOnlyModes = new Set(["casual", "social_emotion", "visual_reaction", "ping", "shared_content"]);

// Non-typing actions for this turn, sized by how often people here actually
// do them (summarizeQqHumanActionRates) and rolled per message so the Bot
// reacts, pokes back or opens a shared video at a human-like rate instead of
// only ever replying. Suggestions only; tools still decide what happened.
export function buildQqHumanActionPlan(event = {}, plan = {}, {
  actionRates = null,
  media = { videos: 0, audios: 0, unheardAudios: 0, musics: 0 },
  mediaAvailable = { video: false, audio: false, music: false },
  stickerCandidates = 0,
  expression = null
} = {}) {
  const privateChat = !event.groupId;
  const mode = String(plan.mode || "casual");
  const measured = actionRates && actionRates.confidence && actionRates.confidence !== "none";
  const rate = (key) => {
    const value = Number(actionRates?.rates?.[key]);
    return measured && Number.isFinite(value) ? value : DEFAULT_HUMAN_ACTION_RATES[key] ?? 0;
  };
  const key = `${event.groupId || "private"}:${event.senderId || ""}:${event.raw?.message_id || ""}:${event.text || ""}`;
  const bias = normalizeExpressionBias(expression);
  const actions = [];
  const hasMessageId = event.raw?.message_id != null && !event.qqColdProactive && !event.qqPrivateProactive;
  const directed = Boolean(event.type === "group_at" || String(event.type || "").endsWith("_poke")
    || event.hasSelfAtSegment || event.isReplyToSelf || privateChat);

  let reactChance = 0;
  let reactionOnlyChance = 0;
  if (!privateChat && hasMessageId && reactionModes.has(mode) && !event.queuedAggregate) {
    reactChance = clamp(rate("reactions") * 5 * bias.emojiScale, 0.06, 0.4);
    if (["answer", "context_answer", "task"].includes(mode)) reactChance *= 0.5;
    reactionOnlyChance = reactionOnlyModes.has(mode) ? reactChance * 0.35 : 0;
  }
  const reactionRoll = stableFraction(`react:${key}`);
  if (reactionRoll < reactionOnlyChance) actions.push("reaction_only");
  else if (reactionRoll < reactChance) actions.push("react");

  let pokeBackChance = 0;
  if (String(event.type || "").endsWith("_poke")) {
    pokeBackChance = clamp(0.4 + rate("pokes") * 8, 0.35, 0.7);
    if (stableFraction(`poke:${key}`) < pokeBackChance) actions.push("poke_back");
  }

  let watchChance = 0;
  if (media.videos > 0 && mediaAvailable.video) {
    watchChance = directed || mode === "shared_content" ? 0.85 : 0.5;
    if (stableFraction(`watch:${key}`) < watchChance) actions.push("watch_video");
  }
  if (media.unheardAudios > 0 && mediaAvailable.audio) actions.push("listen_audio");
  // A shared song is played the way a person taps a music card: usually when
  // it was shared with the Bot, sometimes when it just went by.
  let musicChance = 0;
  if (Number(media.musics) > 0 && mediaAvailable.music) {
    musicChance = directed || mode === "shared_content" ? 0.8 : 0.45;
    if (stableFraction(`music:${key}`) < musicChance) actions.push("listen_music");
  }

  let favoriteChance = 0;
  if (stickerCandidates > 0) {
    favoriteChance = 0.15;
    if (stableFraction(`favorite:${key}`) < favoriteChance) actions.push("save_sticker");
  }
  return {
    actions,
    reactChance: round3(reactChance),
    reactionOnlyChance: round3(reactionOnlyChance),
    pokeBackChance: round3(pokeBackChance),
    watchChance: round3(watchChance),
    musicChance: round3(musicChance),
    favoriteChance: round3(favoriteChance),
    measured: Boolean(measured),
    sample: Number(actionRates?.sample || 0),
    humanReactionRate: rate("reactions"),
    topEmojis: Array.isArray(actionRates?.topEmojis) ? actionRates.topEmojis.slice(0, 4) : []
  };
}

export function formatQqHumanActionContext(actionPlan = {}) {
  const actions = Array.isArray(actionPlan.actions) ? actionPlan.actions : [];
  const per100 = Math.round(Number(actionPlan.humanReactionRate || 0) * 1000) / 10;
  const emojiHint = actionPlan.topEmojis?.length ? `（这里常贴的：${actionPlan.topEmojis.join(" ")}）` : "";
  const lines = [
    `行为规划（${actionPlan.measured ? `按这里的人实际的互动频率，样本约 ${Math.round(actionPlan.sample)} 条` : "这里样本还少，按普通群聊的习惯"}；你不只会打字，真人也会顺手做点别的）：`
  ];
  if (actions.includes("reaction_only")) {
    lines.push(`- 这轮像真人那样只给这条消息贴个表情回应就够了${emojiHint}：用 qq_message.act(action=react)，成功后 status 设为 silent、不再打字；真有话想说才改成文字。`);
  } else if (actions.includes("react")) {
    lines.push(`- 顺手给这条消息贴个表情回应（qq_message.act react）再回复${emojiHint}；这里的人大约每 100 条消息贴 ${per100} 次。`);
  }
  if (actions.includes("poke_back")) lines.push("- 别人拍了你：像人一样拍回去（qq_social.act poke），可以拍完不说话，也可以再接一句。");
  if (actions.includes("watch_video")) lines.push("- 有人发了视频：先像人一样点开看（qq_media.video watch），看完再聊你的真实观感；不看就别装看过。");
  if (actions.includes("listen_audio")) lines.push("- 有语音还没听：用 qq_media.audio listen 听一下再回。");
  if (actions.includes("listen_music")) lines.push("- 有人分享了歌：像人一样点开听（qq_media.music listen），听完再聊旋律、歌词和你的感受；只想知道是哪首就 qq_media.parse；没听就别装听过。");
  if (actions.includes("save_sticker")) lines.push("- 对方发的表情包如果你觉得好玩，可以 inspect 看看、label 标注，喜欢就收藏（favorite）。");
  if (lines.length === 1) lines.push("- 这轮没有特别要做的动作；照常回应，或者觉得没必要回就 status=silent。");
  lines.push("- 动作只在工具返回成功后才算做了；不用每轮都做动作，也别为了显得忙乱用工具。");
  return lines.join("\n");
}

function round3(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function normalizeExpressionBias(value) {
  const scale = (input, fallback = 1) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? Math.min(3, number) : fallback;
  };
  const source = value && typeof value === "object" ? value : {};
  return {
    lengthScale: Math.max(0.3, scale(source.lengthScale)),
    emojiScale: scale(source.emojiScale),
    stickerScale: scale(source.stickerScale),
    bubbleScale: scale(source.bubbleScale)
  };
}

export function formatQqHumanBehaviorContext(style = {}, plan = {}, {
  proactive = false,
  stickerSuggestions = ""
} = {}) {
  const bubbles = plan.preferMultiBubble
    ? `本轮像真人那样分开发（2 条，最多 ${plan.maxBubbles || 2} 条）：第一条先给反应或结论，下一条补一句后劲、细节或吐槽；实在只有一句话才发 1 条，别硬拆半句。`
    : "本轮默认 1 条气泡；确实有自然的补一句时才用 2 条，不把长文机械切碎。";
  const emojiInstruction = plan.preferEmoji
    ? `本轮可以自然带 1 个 emoji${plan.emojiPalette?.length ? `，近期群里常见的是 ${plan.emojiPalette.join(" ")}` : ""}；只在语气确实需要时用，不要每条固定挂同一个。`
    : "本轮不必为了像人而强塞文字 emoji。";
  const stickerInstruction = plan.preferSticker
    ? "本轮适合像真人那样在文字后补 1 张表情包（或者只发表情包）：优先从下面手边的几张里挑情绪最贴的，把 #编号 填进 sticker 字段，它会在文字后单独发出；只发表情包时 text 和 bubbles 留空。手边的都不贴才用 qq_sticker 按情绪/场合/梗搜，或者这轮不发。想发就发，不用在文字里解释。"
    : "本轮默认不发表情包；只有语境非常贴合时才例外用 sticker 字段发 1 张。";
  return [
    `真人化动态规划（匿名统计样本 ${style.sampleSize || 0} 条；不模仿具体个人）：`,
    `- 模式：${plan.mode || "casual"}；目标：${plan.goal || "自然承接"}。`,
    "- 先根据完整上下文自行判断是否正在执行或继续一个实质任务；若是，任务完整性优先，下面的闲聊长度与句数建议自动失效。",
    plan.openEnded
      ? "- 本轮不额外设置硬性字数或句数限制；按实际内容自然组织，任务要完整交付，非任务仍要像群聊而不是无故写报告。"
      : `- 可见正文建议控制在 ${plan.maxChars || 48} 字以内、最多 ${plan.maxSentences || 2} 句；任务正确性、必要解释和安全提示优先于字数。QQ 内部标记、链接和文件路径不计入字数。`,
    `- ${bubbles}`,
    `- ${emojiInstruction}`,
    `- 表情包规划：${stickerInstruction}`,
    plan.preferSticker && stickerSuggestions ? stickerSuggestions : null,
    "- 真人群聊通常只回应当前最值得接的一点，会省略双方已经知道的主语和背景；不要复述问题，不要把每句口语补成完整书面语。",
    "- 对方只是在分享、感叹或发图时，先给具体反应；没有求建议就不要自动分析、科普、安慰教程或列能力清单。",
    plan.typingHabits?.length
      ? `- 这里的打字习惯（群友整体统计，不是某一个人）：${plan.typingHabits.join("；")}。你打字也跟着这些习惯走，频率和大家差不多就行。`
      : null,
    "- 可以自然用短句、语气词、问号、括号补充或颜文字；这里通用的黑话可以照大家的用法用，但别硬塞、别用错意思，也别模仿某个人独有的口癖。被认真问到是不是 AI 时如实回答。",
    proactive
      ? "- 这是兴趣模型已经批准的执行轮；先理解内容并正常执行，但主模型仍可在上下文已经过时、互动重复无价值、自己已经厌烦或安全/事实边界不允许时把 status 设为 silent。"
      : null
  ].filter(Boolean).join("\n");
}

export function applyQqHumanReplyGuard(reply, plan = {}, style = {}, { bubbleSeparator = "|||" } = {}) {
  const raw = String(reply || "").trim();
  if (!raw || !plan.compact) return raw;
  const markers = [];
  let visible = raw.replace(protectedMarkerPattern, (marker) => {
    markers.push(marker);
    return "";
  }).trim();
  if (!visible) return raw;
  visible = visible.replace(/^(?:好的|好嘞|收到|明白了)[，,：:\s]+/, "");
  const maxChars = Math.max(6, Number(plan.maxChars || style.casualMax || 28));
  // Length is only a prompt hint; the guard never drops model-written content.
  if (plan.preferMultiBubble && !visible.includes(bubbleSeparator)) {
    let units = splitNaturalUnits(visible, bubbleSeparator);
    if (units.length === 1) {
      const clauses = splitNaturalClauses(visible);
      if (clauses.length > 1) units = clauses;
      // Space-separated chat (“困了 但还想赖一会儿”) has no commas to split on:
      // the first chunk goes out as the reaction and the rest follows.
      else units = splitSpacedChunks(visible);
    }
    const maxBubbles = Math.max(2, Number(plan.maxBubbles || 2));
    if (units.length >= 2
      && units.length <= maxBubbles
      && units.every((unit) => characterLength(unit) <= Math.ceil(maxChars * 1.3))) {
      visible = units.join(`\n${bubbleSeparator}\n`);
    }
  }
  visible = visible
    .split(`\n${bubbleSeparator}\n`)
    .map((bubble) => characterLength(bubble) <= 18 ? bubble.replace(/。$/u, "") : bubble)
    .join(`\n${bubbleSeparator}\n`)
    .trim();
  return [visible, ...markers].filter(Boolean).join("\n");
}

export function isQqSilentReply(reply) {
  const visible = String(reply || "").replace(protectedMarkerPattern, "").trim();
  return visible === "[[qq_silent]]";
}

export function getQqAdaptiveBubbleDelayMs(style = {}, { configuredMs = 650 } = {}) {
  const base = clamp(Number(configuredMs || 0), 0, 5000);
  const learnedSeconds = Number(style.sameSpeakerGapMedianSeconds || 0);
  if (!Number.isFinite(learnedSeconds) || learnedSeconds <= 0) return base;
  const compressedHumanDelay = Math.round(learnedSeconds * 150);
  return clamp(Math.max(base, compressedHumanDelay), base, 1800);
}

// Pause before a follow-up bubble, like a person typing it: half the learned
// gap plus ~14 characters per second for this bubble, with jitter, capped so
// a long bubble never stalls delivery. A sticker-only bubble goes out fast.
export function getQqTypingDelayMs(bubble, baseDelayMs = 650, { random = Math.random } = {}) {
  const base = clamp(Number(baseDelayMs || 0), 0, 5000);
  const visible = String(bubble || "").replace(/\[\[qq_[^\]]*\]\]/g, "").trim();
  if (!visible) return Math.round(base * (0.6 + random() * 0.4));
  const typingMs = Math.min([...visible].length, 40) * 70;
  return clamp(Math.round(base * 0.5 + typingMs + random() * 400), base, 4200);
}

function getMultiBubbleChance(mode, privateChat, style) {
  const learned = Number(style?.multiMessageRunRatio);
  const socialBase = Number.isFinite(learned) && learned > 0
    ? clamp(learned + 0.08, privateChat ? 0.28 : 0.36, privateChat ? 0.48 : 0.58)
    : (privateChat ? 0.34 : 0.44);
  if (["casual", "social_emotion", "social_request", "opinion", "shared_content", "casual_answer", "quoted_continuation"].includes(mode)) return socialBase;
  if (["answer", "context_answer", "task", "multi_turn"].includes(mode)) return socialBase * 0.68;
  if (mode === "visual_reaction") return socialBase * 0.5;
  return 0;
}

function getEmojiChance(mode, source, style) {
  if (!["casual", "social_emotion", "social_request", "opinion", "visual_reaction", "casual_answer"].includes(mode)) return 0;
  if (emojiCharacterPattern.test(source)) return 0.32;
  const learned = Number(style?.emojiMessageRatio || 0);
  return clamp(learned * 1.6, 0.04, 0.18);
}

function getStickerChance(mode, source, style, { privateChat = false, hasImages = false } = {}) {
  if (!["ping", "casual", "social_emotion", "social_request", "opinion", "visual_reaction", "casual_answer", "shared_content"].includes(mode)) return 0;
  let chance = getQqAdaptiveStickerChance(style, { privateChat });
  if (hasImages || isQqStickerStyleMessage({ text: source })) chance += 0.06;
  if (mode === "visual_reaction") chance += 0.04;
  if (mode === "ping") chance *= 0.65;
  return clamp(chance, 0, privateChat ? 0.30 : 0.40);
}

export function getQqHumanVisibleText(entry) {
  const text = String(entry?.text || "")
    .replace(protectedMarkerPattern, "")
    .replace(compactMediaTokenPattern, "")
    .replace(/\[CQ:(?:image|face|video|record|voice|audio|file),[\s\S]*$/i, "")
    .replace(/^,?file=[^,]+,[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text && (isQqStickerStyleMessage(entry) || isQqImageStyleMessage(entry))) return "";
  return text;
}

function splitNaturalUnits(text, bubbleSeparator) {
  const normalized = String(text || "")
    .replace(new RegExp(`\\s*${escapeRegExp(bubbleSeparator)}\\s*`, "g"), "\n")
    .replace(/\n+/g, "\n")
    .trim();
  const units = [];
  for (const line of normalized.split("\n")) {
    const matches = line.match(/[。！？!?~～]*[^。！？!?~～]+[。！？!?~～]*|[。！？!?~～]+/gu) || [];
    for (const match of matches) {
      const value = match.trim();
      if (value) units.push(value);
    }
  }
  return units.length ? units : [normalized];
}

function splitSpacedChunks(text) {
  const value = String(text || "").trim();
  if (/\n/.test(value)) return [value];
  const chunks = value.split(/(?<=\p{Script=Han}[）)～~！!？?]?) +(?=\p{Script=Han})/u).map((part) => part.trim()).filter(Boolean);
  if (chunks.length < 2 || characterLength(chunks[0]) < 2) return [value];
  return [chunks[0], chunks.slice(1).join(" ")];
}

function splitNaturalClauses(text) {
  return String(text || "")
    .split(/[，,；;]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildHumanMessageRuns(entries) {
  const runs = [];
  let current = null;
  for (const entry of entries) {
    if (entry?.isAssistant || entry?.senderId === "assistant") {
      if (current) runs.push(current);
      current = null;
      continue;
    }
    const senderId = String(entry?.senderId || "");
    if (!senderId) continue;
    const at = Date.parse(entry?.at || "");
    const closeInTime = current && Number.isFinite(at) && Number.isFinite(current.lastAt) && at - current.lastAt <= 120000;
    if (current && current.senderId === senderId && closeInTime) {
      current.count += 1;
      current.lastAt = at;
    } else {
      if (current) runs.push(current);
      current = { senderId, count: 1, lastAt: at };
    }
  }
  if (current) runs.push(current);
  return runs;
}

function analyzeHumanTiming(entries, humans) {
  const validTimes = humans.map((entry) => Date.parse(entry?.at || "")).filter(Number.isFinite).sort((left, right) => left - right);
  const durationHours = validTimes.length >= 2 ? Math.max(1 / 60, (validTimes.at(-1) - validTimes[0]) / 3600000) : 0;
  const activeMinutes = new Map();
  for (const at of validTimes) {
    const key = Math.floor(at / 60000);
    activeMinutes.set(key, (activeMinutes.get(key) || 0) + 1);
  }
  const perMinute = [...activeMinutes.values()].sort((left, right) => left - right);
  const sameSpeakerGaps = [];
  const switchGaps = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous?.isAssistant || current?.isAssistant || previous?.senderId === "assistant" || current?.senderId === "assistant") continue;
    const gap = (Date.parse(current?.at || "") - Date.parse(previous?.at || "")) / 1000;
    if (!Number.isFinite(gap) || gap < 0 || gap > 1800) continue;
    (String(previous?.senderId) === String(current?.senderId) ? sameSpeakerGaps : switchGaps).push(gap);
  }
  sameSpeakerGaps.sort((left, right) => left - right);
  switchGaps.sort((left, right) => left - right);
  return {
    messagesPerHour: durationHours ? Number((humans.length / durationHours).toFixed(1)) : 0,
    activeMinuteMedianMessages: quantile(perMinute, 0.5, 0),
    activeMinuteP90Messages: quantile(perMinute, 0.9, 0),
    sameSpeakerGapMedianSeconds: Number(quantile(sameSpeakerGaps, 0.5, 0).toFixed?.(1) || 0),
    speakerSwitchGapMedianSeconds: Number(quantile(switchGaps, 0.5, 0).toFixed?.(1) || 0)
  };
}

function collectEmojiPalette(entries) {
  const counts = new Map();
  for (const entry of entries) {
    for (const character of String(entry?.text || "")) {
      if (!emojiCharacterPattern.test(character)) continue;
      counts.set(character, (counts.get(character) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([emoji]) => emoji);
}

function quantile(sorted, fraction, fallback) {
  if (!sorted.length) return fallback;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

function characterLength(value) {
  return [...String(value || "")].length;
}

function stableFraction(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
