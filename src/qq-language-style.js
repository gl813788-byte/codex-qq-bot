import { createQqCqCodePattern } from "./qq-message-content.js";

const cqCodePattern = createQqCqCodePattern("[A-Za-z_]+", "giu");
const urlPattern = /https?:\/\/\S+/giu;

// Kaomoji: a bracketed face containing typical face glyphs, or well-known
// ASCII faces. Bracketed asides are short bracketed remarks that are not a
// face, such as “（bushi）” or “（小声）”.
const kaomojiGlyphs = "ωω▽∀´｀°≧≦ﾟ゜＾^ᴗ˘･・∇εσ⊙◕‿｡•̀́ㅂ╯□︵┻━づ⌒Дд≖ಠ;；＞＜><≡⁄∠ゝ灬";
const kaomojiSource = `[(（][^()（）\\n]{0,8}[${kaomojiGlyphs}][^()（）\\n]{0,8}[)）]|QAQ|QwQ|qwq|OvO|TAT|T_T|orz|Orz|OTZ|=\\s?w\\s?=|>_<|＞_＜|\\^_\\^|\\^\\^|[ヽ٩][^\\n]{1,8}[ノو]`;
const kaomojiPattern = new RegExp(kaomojiSource, "gu");
const bracketAsidePattern = /[（(]([^()（）\n]{1,12})[）)]/gu;
const laughterPattern = /哈{3,}|h{3,}|w{3,}|2333+|草+(?=$|[\s，,。！？!?])|笑死|xswl/giu;

const punctuationDefinitions = Object.freeze([
  {
    key: "bracket_aside",
    symbol: "（补充语）",
    pattern: /[（(](?=[^()（）\n]{1,12}[）)])(?![^()（）\n]*[ωω▽∀´｀°≧≦ﾟ゜＾ᴗ˘･・∇εσ⊙◕‿｡•ㅂ╯□︵┻━づ⌒Д≖ಠ])(?!\s*\d+\s*[）)])[^()（）\n]{1,12}[）)]/gu,
    minimumRatio: 0.04
  },
  {
    key: "kaomoji",
    symbol: "颜文字",
    pattern: kaomojiPattern,
    minimumRatio: 0.03
  },
  {
    key: "space_separator",
    symbol: "空格断句",
    pattern: /\p{Script=Han}[ \u3000]+(?=\p{Script=Han})/gu,
    minimumRatio: 0.12
  },
  {
    key: "empty_parentheses",
    symbol: "（）/()",
    pattern: /(?:（\s*）|\(\s*\))/gu,
    minimumRatio: 0.05
  },
  {
    key: "repeated_question",
    symbol: "？？/??",
    pattern: /(?:？{2,}|\?{2,})/gu,
    minimumRatio: 0.05
  },
  {
    key: "repeated_exclamation",
    symbol: "！！/!!",
    pattern: /(?:！{2,}|!{2,})/gu,
    minimumRatio: 0.05
  },
  {
    key: "mixed_emphasis",
    symbol: "？！/!?",
    pattern: /(?:[？！?!]{2,})/gu,
    minimumRatio: 0.04
  },
  {
    key: "ellipsis",
    symbol: "…/...",
    pattern: /(?:…{1,}|\.{3,})/gu,
    minimumRatio: 0.06
  },
  {
    key: "tilde",
    symbol: "～/~",
    pattern: /[～~]+/gu,
    minimumRatio: 0.05
  },
  {
    key: "question",
    symbol: "？/?",
    pattern: /[？?]+/gu,
    minimumRatio: 0.08
  },
  {
    key: "exclamation",
    symbol: "！/!",
    pattern: /[！!]+/gu,
    minimumRatio: 0.08
  },
  {
    key: "full_stop",
    symbol: "。/.",
    pattern: /(?:。|(?<!\.)\.(?!\.))/gu,
    minimumRatio: 0.1
  },
  {
    key: "comma",
    symbol: "，/,",
    pattern: /[，,]+/gu,
    minimumRatio: 0.15
  },
  {
    key: "parentheses",
    symbol: "（）/()",
    pattern: /[（）()]/gu,
    minimumRatio: 0.1
  },
  {
    key: "colon",
    symbol: "：/:",
    pattern: /[：:]+/gu,
    minimumRatio: 0.1
  },
  {
    key: "semicolon",
    symbol: "；/;",
    pattern: /[；;]+/gu,
    minimumRatio: 0.08
  },
  {
    key: "enumeration_comma",
    symbol: "、",
    pattern: /、+/gu,
    minimumRatio: 0.08
  }
]);

const phraseDefinitions = Object.freeze([
  {
    key: "reaction_opening",
    label: "先用短反应词接住情绪",
    pattern: /(?:^|[\s，,。！？!?])(?:我去|好家伙|笑死|绷不住|离谱|救命)(?=$|[\s，,。！？!?])/giu
  },
  {
    key: "agreement_marker",
    label: "用短确认词直接表态",
    pattern: /(?:^|[\s，,。！？!?])(?:确实|真的|可以|行吧|也是|对的?)(?=$|[\s，,。！？!?])/giu
  },
  {
    key: "hesitation_marker",
    label: "用犹豫词保留思考停顿",
    pattern: /(?:em+m+|呃+|额+|嗯+|怎么说)/giu
  },
  {
    key: "continuation_marker",
    label: "用连接词连续补充",
    pattern: /(?:^|[\s，,。！？!?])(?:然后|所以|但是|不过|而且|感觉)(?=$|[\s，,。！？!?])/giu
  },
  {
    key: "self_correction_marker",
    label: "用短语即时改口或补正",
    pattern: /(?:^|[\s，,。！？!?])(?:不是|不对|等等|等下|准确说)(?=$|[\s，,。！？!?])/giu
  },
  {
    key: "soft_sentence_ending",
    label: "用句末语气词软化表达",
    pattern: /(?:吧|呢|呀|嘛|啦|捏|哦|喵)(?:[～~。！？!?…]*)$/giu
  },
  {
    key: "laughter_marker",
    label: "用笑声或字母表达轻松反应",
    pattern: /(?:哈{2,}|嘿{2,}|h{3,}|2333+|(?:^|\s)w{2,}(?:$|\s))/giu
  },
  {
    key: "net_reaction",
    label: "用网络流行反应词表态",
    pattern: /(?:草(?=$|[\s，,。！？!?])|绷不住|蚌埠住|难绷|破防|典中典|典(?=$|[\s，,。！？!?])|急了|麻了|寄了|润了|摆烂|逆天|抽象|绝了|赢麻了|啊对对对|6{2,}|nb|yyds|awsl|xswl|u1s1|dddd)/giu
  },
  {
    key: "repeated_character",
    label: "用叠字或拖长音加强语气",
    pattern: /([\p{Script=Han}a-zA-Z])\1{2,}/gu
  }
]);

export function createEmptyQqLanguageCounts() {
  return {
    punctuationOccurrences: Object.create(null),
    punctuationMessages: Object.create(null),
    phraseOccurrences: Object.create(null),
    phraseMessages: Object.create(null)
  };
}

export function extractQqLanguageFeatures(value) {
  const text = cleanVisibleText(value);
  const output = createEmptyQqLanguageCounts();
  if (!text) return output;
  collectDefinitions(text, punctuationDefinitions, output.punctuationOccurrences, output.punctuationMessages);
  collectDefinitions(text, phraseDefinitions, output.phraseOccurrences, output.phraseMessages);
  return output;
}

export function addQqLanguageFeatures(target, features) {
  const output = target && typeof target === "object" ? target : createEmptyQqLanguageCounts();
  for (const key of ["punctuationOccurrences", "punctuationMessages", "phraseOccurrences", "phraseMessages"]) {
    output[key] = normalizeQqLanguageCountRecord(output[key]);
    for (const [name, count] of Object.entries(features?.[key] || {})) {
      if (!isKnownLanguageKey(key, name)) continue;
      output[key][name] = boundedCount(Number(output[key][name] || 0) + Number(count || 0));
    }
  }
  return output;
}

export function normalizeQqLanguageCountRecord(value, { type = "any" } = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = Object.create(null);
  for (const [key, count] of Object.entries(input)) {
    if (type !== "any" && !isKnownLanguageKey(type, key)) continue;
    const normalized = boundedCount(count);
    if (normalized > 0) output[key] = normalized;
  }
  return output;
}

export function buildQqLanguageStyleProfile({
  sampleCount = 0,
  punctuationOccurrences = {},
  punctuationMessages = {},
  phraseOccurrences = {},
  phraseMessages = {}
} = {}) {
  const samples = Math.max(0, Number(sampleCount) || 0);
  const punctuation = punctuationDefinitions
    .map((definition) => buildProfileEntry(
      definition,
      punctuationOccurrences[definition.key],
      punctuationMessages[definition.key],
      samples
    ))
    .filter((entry) => entry.occurrenceCount > 0)
    .sort(compareProfileEntries);
  const phrases = phraseDefinitions
    .map((definition) => buildProfileEntry(
      definition,
      phraseOccurrences[definition.key],
      phraseMessages[definition.key],
      samples
    ))
    .filter((entry) => entry.occurrenceCount > 0)
    .sort(compareProfileEntries);
  return {
    sampleSize: samples,
    punctuation,
    frequentPunctuation: punctuation.filter((entry) => entry.frequent).slice(0, 8),
    phrases,
    frequentPhrases: phrases.filter((entry) => entry.frequent).slice(0, 6)
  };
}

export function analyzeQqLanguageStyle(entries = [], { senderId = "", windowSize = 240 } = {}) {
  const wantedSenderId = String(senderId || "");
  const messages = (Array.isArray(entries) ? entries : [])
    .slice(-Math.max(20, Number(windowSize) || 240))
    .filter((entry) => !(entry?.isAssistant || entry?.senderId === "assistant"))
    .filter((entry) => !wantedSenderId || String(entry?.senderId || "") === wantedSenderId)
    .map((entry) => cleanVisibleText(entry?.text || entry?.reply || ""))
    .filter(Boolean);
  const counts = createEmptyQqLanguageCounts();
  for (const text of messages) addQqLanguageFeatures(counts, extractQqLanguageFeatures(text));
  return buildQqLanguageStyleProfile({ sampleCount: messages.length, ...counts });
}

export function formatQqLanguageStyleProfile(profile = {}, { label = "当前范围" } = {}) {
  const punctuation = (profile.frequentPunctuation || []).slice(0, 6);
  const phrases = (profile.frequentPhrases || []).slice(0, 4);
  if (!punctuation.length && !phrases.length) return "";
  return [
    `${label}语言习惯（这里只是统计候选；具体含义必须由模型结合当前范围上下文审定）：`,
    ...punctuation.map((entry) => (
      `- ${entry.symbol}：${entry.messageCount}/${profile.sampleSize || 0} 条消息出现（${percentage(entry.messageRatio)}）；通用及范围含义尚未标注`
    )),
    ...phrases.map((entry) => (
      `- 短语结构“${entry.label}”：${entry.messageCount}/${profile.sampleSize || 0} 条；语用含义尚未标注`
    ))
  ].join("\n");
}

// Group-level typing habits with ratios over human text messages, plus the
// concrete bracketed asides, kaomoji and laughter forms that at least two
// different people used (so one person's private quirk never counts).
export function analyzeQqSymbolHabits(entries = [], { windowSize = 240 } = {}) {
  const messages = (Array.isArray(entries) ? entries : [])
    .slice(-Math.max(20, Number(windowSize) || 240))
    .filter((entry) => !(entry?.isAssistant || entry?.senderId === "assistant"))
    .map((entry) => ({
      senderId: String(entry?.senderId || ""),
      text: cleanSymbolText(entry?.text || entry?.reply || "")
    }))
    .filter((entry) => entry.text && !entry.text.startsWith("/"));
  const total = messages.length;
  const count = (predicate) => messages.filter((entry) => predicate(entry.text)).length;
  const forms = { bracketAsides: new Map(), kaomoji: new Map(), laughter: new Map() };
  const note = (map, form, senderId) => {
    const item = map.get(form) || { count: 0, senders: new Set() };
    item.count += 1;
    if (senderId) item.senders.add(senderId);
    map.set(form, item);
  };
  let bracketMessages = 0;
  let kaomojiMessages = 0;
  for (const { text, senderId } of messages) {
    const faces = [...text.matchAll(kaomojiPattern)].map((match) => match[0]);
    if (faces.length) kaomojiMessages += 1;
    for (const face of new Set(faces)) note(forms.kaomoji, face, senderId);
    const withoutFaces = faces.reduce((value, face) => value.split(face).join(" "), text);
    const asides = [...withoutFaces.matchAll(bracketAsidePattern)]
      .map((match) => match[1].trim())
      .filter((inner) => inner && !/^\d+$/.test(inner));
    if (asides.length) bracketMessages += 1;
    for (const inner of new Set(asides)) note(forms.bracketAsides, `（${inner}）`, senderId);
    for (const match of new Set([...text.matchAll(laughterPattern)].map((item) => normalizeLaughter(item[0])))) {
      note(forms.laughter, match, senderId);
    }
  }
  const shared = (map, limit) => [...map.entries()]
    .filter(([, item]) => item.count >= 2 && item.senders.size >= 2)
    .sort((left, right) => right[1].senders.size - left[1].senders.size || right[1].count - left[1].count)
    .slice(0, limit)
    .map(([form, item]) => ({ form, count: item.count, people: item.senders.size }));
  return {
    sampleSize: total,
    spaceSeparatorRatio: ratio(count((text) => /\p{Script=Han}[ \u3000]+\p{Script=Han}/u.test(text)), total),
    commaRatio: ratio(count((text) => /[，,]/.test(text)), total),
    noEndPunctuationRatio: ratio(count((text) => !/[。！？!?…~～）)」』.]$/u.test(text)), total),
    fullStopEndRatio: ratio(count((text) => /。$/.test(text)), total),
    bracketAsideRatio: ratio(bracketMessages, total),
    kaomojiRatio: ratio(kaomojiMessages, total),
    emojiRatio: ratio(count((text) => /\p{Extended_Pictographic}/u.test(text)), total),
    tildeRatio: ratio(count((text) => /[～~]/.test(text)), total),
    ellipsisRatio: ratio(count((text) => /…|\.{3,}|。{2,}/.test(text)), total),
    repeatedCharacterRatio: ratio(count((text) => /([\p{Script=Han}a-zA-Z])\1{2,}/u.test(text)), total),
    laughterRatio: ratio(count((text) => new RegExp(laughterPattern.source, "iu").test(text)), total),
    bracketAsides: shared(forms.bracketAsides, 6),
    kaomoji: shared(forms.kaomoji, 6),
    laughter: shared(forms.laughter, 4)
  };
}

// One prompt line per notable habit; quiet habits are left out.
export function describeQqSymbolHabits(habits = {}) {
  if (!habits || Number(habits.sampleSize || 0) < 12) return [];
  const lines = [];
  const pct = (value) => percentage(value);
  if (habits.spaceSeparatorRatio >= 0.15 && habits.spaceSeparatorRatio >= habits.commaRatio) {
    lines.push(`常用空格代替逗号断句（${pct(habits.spaceSeparatorRatio)}，逗号 ${pct(habits.commaRatio)}）`);
  }
  if (habits.noEndPunctuationRatio >= 0.6) lines.push(`句末大多不加标点（${pct(habits.noEndPunctuationRatio)}），句号收尾只占 ${pct(habits.fullStopEndRatio)}`);
  if (habits.bracketAsideRatio >= 0.03) {
    const forms = (habits.bracketAsides || []).map((item) => item.form).slice(0, 4);
    lines.push(`常加括号补充语（${pct(habits.bracketAsideRatio)}）${forms.length ? `，大家常写 ${forms.join(" ")}` : ""}`);
  }
  if (habits.kaomojiRatio >= 0.02) {
    const forms = (habits.kaomoji || []).map((item) => item.form).slice(0, 4);
    lines.push(`会用颜文字（${pct(habits.kaomojiRatio)}）${forms.length ? `，常见 ${forms.join(" ")}` : ""}`);
  }
  if (habits.tildeRatio >= 0.05) lines.push(`爱用波浪号～拖长语气（${pct(habits.tildeRatio)}）`);
  if (habits.ellipsisRatio >= 0.06) lines.push(`常用省略号表示无语或停顿（${pct(habits.ellipsisRatio)}）`);
  if (habits.laughterRatio >= 0.06) {
    const forms = (habits.laughter || []).map((item) => item.form).slice(0, 3);
    lines.push(`笑的时候${forms.length ? `常写 ${forms.join(" / ")}` : "常打一串笑声"}（${pct(habits.laughterRatio)}）`);
  }
  if (habits.repeatedCharacterRatio >= 0.06) lines.push(`常用叠字或拖长音加强语气（${pct(habits.repeatedCharacterRatio)}）`);
  if (habits.emojiRatio >= 0.08) lines.push(`常带 emoji（${pct(habits.emojiRatio)}）`);
  return lines;
}

function normalizeLaughter(value) {
  const text = String(value || "").toLowerCase();
  if (/^哈+$/.test(text)) return text.length >= 5 ? "哈哈哈哈哈" : "哈哈哈";
  if (/^h+$/.test(text)) return "hhh";
  if (/^w+$/.test(text)) return "www";
  if (/^2333+$/.test(text)) return "233";
  if (/^草+$/.test(text)) return "草";
  return text;
}

function cleanSymbolText(value) {
  return String(value || "")
    .replace(cqCodePattern, "\u0000")
    .replace(urlPattern, "\u0000")
    .replace(/@\S+\s?/g, "")
    .replace(/\[(?:图片|表情|语音|文件|视频)[^\]]*\]/g, "\u0000")
    .split("\u0000")
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function collectDefinitions(text, definitions, occurrences, messages) {
  for (const definition of definitions) {
    const count = [...text.matchAll(definition.pattern)].length;
    if (count <= 0) continue;
    occurrences[definition.key] = count;
    messages[definition.key] = 1;
  }
}

function buildProfileEntry(definition, occurrenceCount, messageCount, sampleCount) {
  const occurrences = boundedCount(occurrenceCount);
  const messages = Math.min(boundedCount(messageCount), sampleCount);
  const messageRatio = ratio(messages, sampleCount);
  const minimumMessages = sampleCount >= 48 ? 4 : 3;
  return {
    key: definition.key,
    symbol: definition.symbol,
    label: definition.label,
    occurrenceCount: occurrences,
    messageCount: messages,
    messageRatio,
    frequent: sampleCount >= 12
      && messages >= minimumMessages
      && messageRatio >= Number(definition.minimumRatio || 0.08)
  };
}

function compareProfileEntries(left, right) {
  return Number(right.frequent) - Number(left.frequent)
    || right.messageRatio - left.messageRatio
    || right.messageCount - left.messageCount
    || right.occurrenceCount - left.occurrenceCount;
}

function isKnownLanguageKey(type, key) {
  const definitions = String(type).startsWith("phrase") ? phraseDefinitions : punctuationDefinitions;
  return definitions.some((definition) => definition.key === key);
}

function cleanVisibleText(value) {
  return String(value || "")
    .replace(cqCodePattern, " ")
    .replace(urlPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedCount(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(1_000_000_000, number));
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 1000) / 1000;
}

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}
