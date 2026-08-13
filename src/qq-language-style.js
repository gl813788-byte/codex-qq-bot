const cqCodePattern = /\[CQ:[^\]]+\]/giu;
const urlPattern = /https?:\/\/\S+/giu;

const punctuationDefinitions = Object.freeze([
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
    pattern: /(?:哈{2,}|嘿{2,}|(?:^|\s)w{2,}(?:$|\s))/giu
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
