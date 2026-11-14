// How the Bot's feelings and vocabulary show up in what it types this turn.
//
// The Bot already keeps a mood between turns (qq-bot-life-state.js) and
// learns how people here type (qq-language-style.js), but a mood that only
// sits in the prompt as a word ("被逗乐了") rarely changes the reply. This
// module turns the mood into concrete typing for one turn (a burst of
// “！！！”, a bubble that is only “？”, a short bracketed action, fewer words
// when tired) and keeps the Bot's vocabulary moving: it finds words and
// openers the Bot has worn out in this conversation and offers a rotating
// handful of other expressions people here use. Everything here is a
// suggestion for the main model; nothing is sent or rewritten by the Hub.
// Pure: callers pass state, texts and a per-message seed.

// Emotion families, checked by where their first keyword appears in the mood
// text (the earliest wins, ties by this order).
const MOOD_FAMILIES = Object.freeze([
  { id: "shy", label: "害羞", pattern: /害羞|不好意思|脸红|羞|被夸|扭捏|难为情/u },
  { id: "warm", label: "亲近", pattern: /暖|感动|想贴贴|贴贴|黏人|撒娇|心软|温柔|亲近|被宠|甜/u },
  { id: "sad", label: "低落", pattern: /难过|伤心|低落|失落|委屈|emo|丧|想哭|心酸|沮丧|孤单|寂寞|难受/iu },
  { id: "annoyed", label: "烦躁", pattern: /烦|躁|不爽|生气|气死|恼|火大|郁闷|嫌弃|不耐烦|膈应|憋屈/u },
  { id: "anxious", label: "紧张", pattern: /紧张|慌|焦虑|担心|不安|忐忑|心虚/u },
  { id: "tired", label: "困倦", pattern: /困|累|乏|没精神|没劲|犯困|想睡|疲|蔫|懒/u },
  { id: "speechless", label: "无语", pattern: /无语|无言|服了|麻了|一言难尽|汗|心累/u },
  { id: "surprised", label: "惊讶", pattern: /惊|震撼|吓|懵|愣|意外|没想到|离谱/u },
  { id: "excited", label: "兴奋", pattern: /兴奋|激动|好耶|上头|燃|狂喜|期待|迫不及待|嗨|亢奋/u },
  { id: "amused", label: "被逗乐", pattern: /笑|乐|逗|好玩|有趣|绷不住/u },
  { id: "happy", label: "开心", pattern: /开心|高兴|愉快|满足|美滋滋|舒服|幸福|得意|心情好|不错|爽/u },
  { id: "curious", label: "好奇", pattern: /好奇|想知道|感兴趣|疑惑|纳闷|琢磨/u },
  { id: "calm", label: "平静", pattern: /平静|还行|一般|淡定|放松|悠闲|安静|平和|无聊|普通/u }
]);
const STRONG_MOOD_PATTERN = /超|好[^奇]|很|太|巨|特别|非常|爆|炸|死|极|狂|贼|[!！]/u;
const WEAK_MOOD_PATTERN = /有点|有些|一点|稍|略|些许|微微|淡淡/u;
const MOOD_FRESH_MS = 30 * 60_000;
const MOOD_STALE_MS = 90 * 60_000;
const MOOD_GONE_MS = 4 * 60 * 60_000;

// What each feeling looks like when typed in QQ.
const FAMILY_TYPING = Object.freeze({
  excited: "连发几条短的、叠字和感叹号连打，语气往上走",
  amused: "笑声叠起来（照这里的写法），可以只回一串笑",
  happy: "语气轻快一点，可以带波浪号或一个颜文字",
  shy: "括号里一个小动作（如（捂脸））或颜文字，说话可以有点打结",
  warm: "软一点，可以用括号动作（如（蹭蹭））或波浪号",
  surprised: "先单独冒一个“？”“啊？”或“！？”再说",
  speechless: "一个“…”“。”或“？”就够，话很少",
  annoyed: "短、冲、句号收尾，不加表情和波浪号，懒得解释",
  sad: "字少、慢，用省略号，不用感叹号和 emoji，不开玩笑",
  tired: "很短很懒，语气词拖长，能一个字说完就一个字",
  anxious: "省略号、问号多一点，可以用括号小动作（如（慌））",
  curious: "追问一句、“诶？”“真的假的”这类",
  calm: "正常说，不用刻意加戏"
});

const PUNCTUATION_ONLY_FAMILIES = new Set(["surprised", "speechless", "excited", "annoyed", "amused"]);
const BURST_FAMILIES = new Set(["excited", "surprised", "amused", "annoyed", "happy"]);
const BRACKET_FAMILIES = new Set(["shy", "warm", "anxious", "tired", "happy", "sad", "amused", "excited"]);
const LOUD_FAMILIES = new Set(["excited", "amused", "surprised"]);
const QUIET_FAMILIES = new Set(["sad", "tired", "annoyed", "speechless"]);
const CHAT_MODES = new Set(["casual", "social_emotion", "social_request", "opinion", "visual_reaction", "casual_answer", "ping", "shared_content", "quoted_continuation", "private_proactive"]);

// One mood text (2-8 characters the model wrote) → family and strength 0-3.
export function classifyQqBotMood(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  let best = null;
  MOOD_FAMILIES.forEach((family, order) => {
    const match = family.pattern.exec(value);
    if (!match) return;
    if (!best || match.index < best.index || (match.index === best.index && order < best.order)) {
      best = { family, index: match.index, order };
    }
  });
  const family = best?.family || null;
  let level = family?.id === "calm" ? 1 : 2;
  if (STRONG_MOOD_PATTERN.test(value)) level += 1;
  if (WEAK_MOOD_PATTERN.test(value)) level -= 1;
  return {
    family: family?.id || "other",
    label: family?.label || value,
    level: clampInt(level, 0, 3)
  };
}

// The current mood as it affects typing now: it fades with age and the
// owner's emotionality slider makes feelings show more or less.
export function resolveQqBotMoodExpression(mood, { now = Date.now(), emotionality = 50 } = {}) {
  if (!mood?.text) return null;
  const at = Date.parse(mood.at || "");
  const age = Number.isFinite(at) ? Math.max(0, now - at) : Infinity;
  if (age > MOOD_GONE_MS) return null;
  const classified = classifyQqBotMood(mood.text);
  if (!classified) return null;
  let level = classified.level;
  if (age > MOOD_STALE_MS) level -= 2;
  else if (age > MOOD_FRESH_MS) level -= 1;
  const slider = Number(emotionality);
  if (Number.isFinite(slider)) {
    if (slider >= 70) level += 1;
    else if (slider <= 30) level -= 1;
  }
  return { text: mood.text, family: classified.family, label: classified.label, level: clampInt(level, 0, 3), ageMs: age };
}

// Expressive marks in the message being answered: a bracketed action aimed
// at the Bot (“（亲亲）”), “！！！”, a bare “？” or a burst of laughter invite
// an answer in kind.
export function detectQqMessageExpression(text) {
  const value = String(text || "").replace(/\[CQ:[^\]]*\]/g, " ").trim();
  const actions = [...value.matchAll(/[（(]([^()（）\n]{1,16})[）)]/gu)]
    .map((match) => match[1].trim())
    .filter((inner) => /^[\p{Script=Han}、，,~～…]{1,16}$/u.test(inner) && !/^(?:bushi|不是|误|雾|划掉|小声|确信|狗头)$/iu.test(inner));
  return {
    bracketAction: actions[0] ? `（${actions[0]}）` : "",
    punctuationOnly: Boolean(value) && /^[\s!！?？。.…~～、，,]+$/u.test(value),
    punctuationBurst: /[!！]{2,}|[?？]{2,}|[?？][!！]|[!！][?？]/u.test(value),
    laughter: /哈{3,}|h{3,}|笑死|xswl|233{2,}/iu.test(value)
  };
}

// The per-turn expression plan. `seed` makes the rolls stable per message.
export function buildQqBotExpressionPlan({
  mood = null,
  messageText = "",
  symbolHabits = {},
  mode = "casual",
  privateChat = false,
  seed = "",
  speechIntensity = 50
} = {}) {
  const chat = CHAT_MODES.has(String(mode || ""));
  const message = detectQqMessageExpression(messageText);
  const family = mood?.family || "";
  const level = Number(mood?.level || 0);
  const habits = symbolHabits && typeof symbolHabits === "object" ? symbolHabits : {};
  const minPeople = Math.max(1, Number(habits.minPeople) || (privateChat ? 1 : 2));
  const groupPunctuationOnly = Number(habits.punctuationOnlyPeople || 0) >= minPeople ? Number(habits.punctuationOnlyRatio || 0) : 0;
  const groupBracket = Number(habits.bracketActionPeople || 0) >= minPeople ? Number(habits.bracketActionRatio || 0) : 0;
  const groupBurst = Number(habits.punctuationBurstRatio || 0);
  const intensity = Number.isFinite(Number(speechIntensity)) ? Number(speechIntensity) : 50;
  const loudness = clamp(0.6 + intensity / 125, 0.6, 1.4);
  const devices = [];
  if (chat) {
    const byLevel = (values) => values[clampInt(level, 0, 3)] || 0;
    let punctuationOnlyChance = PUNCTUATION_ONLY_FAMILIES.has(family) ? byLevel([0, 0.12, 0.28, 0.45]) : 0;
    punctuationOnlyChance += Math.min(0.2, groupPunctuationOnly * 3);
    if (message.punctuationOnly) punctuationOnlyChance += 0.25;
    let burstChance = BURST_FAMILIES.has(family) ? byLevel([0, 0.15, 0.4, 0.65]) : 0;
    burstChance += Math.min(0.2, groupBurst * 3);
    if (message.punctuationBurst) burstChance += 0.25;
    let bracketChance = BRACKET_FAMILIES.has(family) ? byLevel([0, 0.12, 0.25, 0.4]) : 0;
    bracketChance += Math.min(0.25, groupBracket * 8);
    if (message.bracketAction) bracketChance += 0.45;
    if (!groupBracket && !message.bracketAction && Number(habits.sampleSize || 0) >= 40) bracketChance *= 0.5;
    if (QUIET_FAMILIES.has(family) && family !== "annoyed") burstChance = 0;
    if (stableFraction(`punct:${seed}`) < clamp(punctuationOnlyChance * loudness, 0, 0.75)) devices.push("punctuation_only");
    if (stableFraction(`burst:${seed}`) < clamp(burstChance * loudness, 0, 0.85)) devices.push("punctuation_burst");
    if (stableFraction(`bracket:${seed}`) < clamp(bracketChance, 0, 0.85)) devices.push("bracket_action");
    if (LOUD_FAMILIES.has(family) && level >= 2) devices.push("more_bubbles");
    if (QUIET_FAMILIES.has(family) && level >= 1) devices.push("fewer_words");
  }
  return {
    chat,
    mood: mood ? { text: mood.text, family, label: mood.label, level } : null,
    message,
    devices,
    extraBubbles: devices.includes("more_bubbles") ? (level >= 3 ? 2 : 1) : 0,
    lengthScale: devices.includes("fewer_words") ? (level >= 3 ? 0.5 : 0.7) : 1
  };
}

// A loud feeling splits the reply into more short bubbles and a quiet one
// shortens it; task turns (completionDriven) keep their own length.
export function applyQqBotExpressionToBehaviorPlan(plan = {}, expression = null) {
  if (!expression?.chat || plan.completionDriven) return plan;
  const next = { ...plan };
  if (expression.extraBubbles > 0) {
    next.preferMultiBubble = true;
    next.maxBubbles = Math.min(4, Math.max(2, Number(plan.maxBubbles || 1)) + expression.extraBubbles);
  }
  if (expression.lengthScale < 1 && Number.isFinite(Number(plan.maxChars)) && plan.maxChars != null) {
    next.maxChars = Math.max(4, Math.round(Number(plan.maxChars) * expression.lengthScale));
    if (!expression.extraBubbles) next.preferMultiBubble = false;
  }
  return next;
}

// Words, openers and endings the Bot has worn out in this conversation:
// counted once per reply over its recent replies. Ordinary function words
// are left out, and a shorter piece inside a longer worn-out phrase with the
// same count is folded into it.
const COMMON_WORDS = new Set([
  "这个", "那个", "什么", "一下", "不是", "没有", "可以", "现在", "就是", "还是", "怎么", "知道", "因为", "所以",
  "但是", "如果", "我们", "你们", "他们", "已经", "一个", "这样", "那样", "时候", "然后", "不会", "不能", "需要",
  "的话", "一点", "有点", "这么", "那么", "这里", "那里", "这边", "那边", "为什么", "是不是", "有没有", "可能",
  "看看", "觉得", "应该", "不过", "而且", "还有", "一起", "今天", "明天", "昨天", "东西", "问题", "出来", "起来",
  "下来", "过来", "回来", "一样", "这种", "那种", "其实", "只是", "还没", "自己", "别人", "大家", "直接", "我的", "你的"
]);

export function findQqBotOverusedExpressions(replies = [], { window = 24, assistantNames = [], humanTexts = [] } = {}) {
  const texts = (Array.isArray(replies) ? replies : [])
    .map((value) => cleanReplyText(value))
    .filter(Boolean)
    .slice(-Math.max(6, Number(window) || 24));
  if (texts.length < 4) return { words: [], openers: [], endings: [], sample: texts.length };
  const names = new Set((Array.isArray(assistantNames) ? assistantNames : []).map((name) => String(name || "").trim()).filter(Boolean));
  // Words people here also keep using are the topic, not the Bot's tic.
  const human = (Array.isArray(humanTexts) ? humanTexts : []).slice(-40).map(cleanReplyText).filter(Boolean);
  const isTopic = (term) => human.filter((text) => text.includes(term)).length >= 2;
  const documentCounts = new Map();
  for (const text of texts) {
    const seen = new Set();
    for (const run of text.match(/\p{Script=Han}+/gu) || []) {
      const chars = [...run];
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index + size <= chars.length; index += 1) seen.add(chars.slice(index, index + size).join(""));
      }
    }
    for (const term of seen) documentCounts.set(term, (documentCounts.get(term) || 0) + 1);
  }
  const minimum = Math.max(3, Math.ceil(texts.length * 0.15));
  const ranked = [...documentCounts.entries()]
    .filter(([term, count]) => count >= minimum && !COMMON_WORDS.has(term) && !names.has(term) && !/^[了的着过地得和与就都也]/u.test(term) && !isTopic(term))
    .sort((left, right) => right[1] - left[1] || [...right[0]].length - [...left[0]].length);
  // Pieces of one worn-out phrase (“麻烦再叫”“叫我一次”) grow back into the
  // phrase they all come from and count once.
  const words = [];
  for (const [term, count] of ranked) {
    const phrase = expandToSharedPhrase(term, texts.filter((text) => text.includes(term)));
    if (words.some(([kept]) => sharesPiece(kept, phrase))) continue;
    words.push([phrase, count]);
  }
  const edgeCounts = (pick) => {
    const counts = new Map();
    for (const text of texts.slice(-12)) {
      const edge = pick(text);
      if (edge) counts.set(edge, (counts.get(edge) || 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count >= 3).sort((left, right) => right[1] - left[1]).slice(0, 3)
      .map(([term, count]) => ({ term, count }));
  };
  return {
    sample: texts.length,
    words: words.slice(0, 8).map(([term, count]) => ({ term, count })),
    openers: edgeCounts((text) => {
      const chars = [...text.replace(/[\s\p{P}～~]+/gu, "")];
      return chars.length >= 3 ? chars.slice(0, 2).join("") : "";
    }),
    endings: edgeCounts((text) => {
      const chars = [...text.replace(/[\s\p{P}～~]+/gu, "")];
      return chars.length >= 3 ? chars.slice(-2).join("") : "";
    })
  };
}

// A rotating handful of expressions to reach for instead of the worn-out
// ones: the Bot's own habits it has not used lately, slang people here use
// and short reactions several people send. Different every message.
export function selectQqFreshExpressions({
  habits = [],
  slang = [],
  shortReactions = [],
  overused = [],
  recentReplies = [],
  seed = "",
  limit = 6
} = {}) {
  const worn = new Set((Array.isArray(overused) ? overused : []).map((item) => String(item?.term || item || "")).filter(Boolean));
  const recentText = (Array.isArray(recentReplies) ? recentReplies : []).slice(-6).map(cleanReplyText).join("\n");
  const pool = [];
  const add = (term, note, weight) => {
    const value = String(term || "").trim();
    if (!value || [...value].length > 16 || pool.some((item) => item.term === value)) return;
    if (worn.has(value) || [...worn].some((item) => value.includes(item)) || recentText.includes(value)) return;
    pool.push({ term: value, note: String(note || "").trim(), weight });
  };
  for (const item of Array.isArray(habits) ? habits : []) add(item?.term, item?.usage, 3);
  for (const item of Array.isArray(slang) ? slang : []) add(item?.term, item?.meaning, 2);
  for (const item of Array.isArray(shortReactions) ? shortReactions : []) add(item?.form ?? item?.term, "", 1);
  return pool
    .map((item) => ({ ...item, roll: stableFraction(`${seed}:${item.term}`) / item.weight }))
    .sort((left, right) => left.roll - right.roll)
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(({ term, note }) => ({ term, note }));
}

export function formatQqBotExpressionContext(plan = {}, { overused = null, fresh = [] } = {}) {
  const lines = [];
  const mood = plan.mood;
  if (mood && plan.chat) {
    const strength = ["很淡", "一点", "明显", "很强"][clampInt(mood.level, 0, 3)];
    const typing = FAMILY_TYPING[mood.family];
    const show = mood.level <= 0
      ? "已经很淡，正常说就好。"
      : `心情要落在打字上而不是说出来${typing ? `：${typing}` : "，让它带出语气、长短和标点"}。`;
    lines.push(`- 你现在的心情：${mood.text}（${strength}）。${show}这条消息让你情绪变了，就按变了之后的来。`);
  } else if (plan.chat) {
    lines.push("- 先想好这条消息让你此刻是什么情绪、有多强，再让它体现在打字上（不是写“我很开心”）。");
  }
  const devices = new Set(plan.devices || []);
  const ideas = [];
  if (devices.has("punctuation_only")) ideas.push("单独发一条只有标点的气泡（如“？”“！！！”“…”），再接一条或者就这样");
  if (devices.has("punctuation_burst")) ideas.push("感叹号/问号连打（！！！、？？）或叠字拉长语气");
  if (devices.has("bracket_action")) ideas.push(plan.message?.bracketAction
    ? `对方用括号写了动作${plan.message.bracketAction}，你也可以用括号回一个很短的动作（躲开、回应、愣住都行，看心情和关系）`
    : "在括号里带一个很短的动作或情景（像这里的人那样，一个动作就够）");
  if (devices.has("more_bubbles")) ideas.push(`拆成 ${2 + Number(plan.extraBubbles || 1)} 条左右的短气泡连发`);
  if (devices.has("fewer_words")) ideas.push("比平时少说，几个字也行");
  if (ideas.length) lines.push(`- 这轮可以试试：${ideas.join("；")}。挑合适的用，不合适就算了。`);
  const worn = [
    ...(overused?.words || []).map((item) => item.term),
    ...(overused?.openers || []).map((item) => `开头“${item.term}”`),
    ...(overused?.endings || []).map((item) => `结尾“${item.term}”`)
  ];
  if (worn.length) lines.push(`- 你最近在这里用多了，这轮别再用：${worn.join("、")}；换个说法，或者干脆不说那半句。`);
  const freshItems = (Array.isArray(fresh) ? fresh : []).filter((item) => item?.term);
  if (freshItems.length) {
    lines.push(`- 可以换着用的说法（语境对得上再用，别硬塞）：${freshItems.map((item) => item.note ? `${item.term}（${item.note}）` : item.term).join("、")}。`);
  }
  if (!lines.length) return "";
  return ["【这轮的情绪和表达】只给你自己参考，不要复述：", ...lines].join("\n");
}

// The longest Han text around `term` that every one of `texts` contains.
function expandToSharedPhrase(term, texts, maxLength = 10) {
  let phrase = term;
  const grow = (pick) => {
    while ([...phrase].length < maxLength) {
      const sample = texts[0] || "";
      const at = sample.indexOf(phrase);
      if (at < 0) return;
      const chars = [...sample];
      const start = [...sample.slice(0, at)].length;
      const end = start + [...phrase].length;
      const next = pick === "right" ? chars[end] : chars[start - 1];
      if (!next || !/\p{Script=Han}/u.test(next)) return;
      const candidate = pick === "right" ? phrase + next : next + phrase;
      if (!texts.every((text) => text.includes(candidate))) return;
      phrase = candidate;
    }
  };
  grow("right");
  grow("left");
  return phrase;
}

function sharesPiece(left, right) {
  if (left.includes(right) || right.includes(left)) return true;
  const chars = [...right];
  for (let index = 0; index + 2 <= chars.length; index += 1) {
    if (left.includes(chars.slice(index, index + 2).join(""))) return true;
  }
  return false;
}

function cleanReplyText(value) {
  return String(value?.reply ?? value?.text ?? value ?? "")
    .replace(/\[\[[^\]]*\]\]|\[CQ:[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}
