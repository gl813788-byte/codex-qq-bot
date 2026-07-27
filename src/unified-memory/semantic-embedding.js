export const localSemanticEmbeddingModel = "local-hybrid-zh-concepts-v3";
export const localSemanticEmbeddingDimensions = 1024;

const semanticConcepts = [
  ["memory", ["记忆", "上下文", "回忆", "记住", "memory", "context"]],
  ["knowledge", ["知识", "知识库", "资料", "事实", "文档", "knowledge", "document"]],
  ["impression", ["印象", "画像", "关系", "人设", "性格", "profile", "persona"]],
  ["short-term", ["短期", "临时", "当前会话", "暂存", "short term", "temporary"]],
  ["long-term", ["长期", "持久", "稳定信息", "long term", "persistent"]],
  ["deploy", ["部署", "安装", "发布", "上线", "发版", "deploy", "deployment", "release", "ship"]],
  ["repair", ["修复", "排障", "解决", "修好", "恢复", "fix", "repair", "resolve"]],
  ["update", ["更新", "升级", "覆盖", "替换", "改成", "update", "upgrade", "replace"]],
  ["remove", ["删除", "清理", "移除", "忘记", "作废", "delete", "remove", "forget"]],
  ["search", ["搜索", "查找", "检索", "找一下", "search", "find", "lookup"]],
  ["bot", ["机器人", "bot", "助手", "助理", "assistant"]],
  ["group-chat", ["群聊", "群里", "群组", "群", "group", "channel"]],
  ["private-chat", ["私聊", "私信", "单聊", "private", "direct message", "dm"]],
  ["schedule", ["时间", "几点", "什么时候", "日期", "安排", "日程", "窗口", "schedule", "when", "time"]],
  ["meeting", ["会议", "开会", "碰头", "例会", "meeting", "sync"]],
  ["preference", ["喜欢", "偏爱", "爱用", "习惯", "倾向", "prefer", "preference", "like"]],
  ["avoid", ["不喜欢", "讨厌", "避免", "不想", "别", "不要", "avoid", "dislike", "hate"]],
  ["voice", ["语音", "电话", "通话", "开麦", "voice", "call"]],
  ["message", ["消息", "通知", "提醒", "回复", "message", "notification", "reply"]],
  ["problem", ["问题", "故障", "报错", "异常", "崩溃", "闪退", "bug", "error", "issue", "crash"]],
  ["complete", ["完成", "好了", "已解决", "已修复", "结束", "done", "completed", "resolved", "fixed"]],
  ["pending", ["待办", "未完成", "还没", "进行中", "等待", "pending", "todo", "open"]],
  ["current", ["现在", "当前", "目前", "最新版", "新的", "现行", "current", "latest", "new"]],
  ["historical", ["以前", "之前", "原来", "旧版", "过时", "历史", "previous", "old", "stale"]],
  ["reason", ["原因", "为什么", "怎么回事", "缘由", "reason", "why", "cause"]],
  ["location", ["位置", "哪里", "地址", "地点", "路径", "location", "where", "path"]],
  ["person", ["谁", "成员", "群友", "用户", "人物", "person", "member", "user", "who"]]
];

const questionNoise = new Set([
  "一下", "一个", "这个", "那个", "什么", "怎么", "如何", "是否", "有没有",
  "请问", "帮我", "可以", "需要", "want", "please", "could", "would"
]);

const chineseSegmenter = typeof Intl?.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

export function embedLocalSemanticText(text, {
  dimensions = localSemanticEmbeddingDimensions
} = {}) {
  return embedWeightedTexts([{ text, weight: 1 }], dimensions);
}

export function embedLocalSemanticFields({
  title = "",
  summary = "",
  detail = ""
} = {}, {
  dimensions = localSemanticEmbeddingDimensions
} = {}) {
  return embedWeightedTexts([
    { text: title, weight: 2.2 },
    { text: summary, weight: 1.45 },
    { text: detail, weight: 0.72 }
  ], dimensions);
}

export function cosineSimilarity(left, right) {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += Number(left[index] || 0) * Number(right[index] || 0);
  }
  return Math.max(-1, Math.min(1, score));
}

export function lexicalSimilarity(left, right) {
  const leftFeatures = semanticLexicalWeights(left);
  const rightFeatures = semanticLexicalWeights(right);
  return lexicalFeatureSimilarity(leftFeatures, rightFeatures);
}

export function lexicalFeatureSimilarity(leftFeatures, rightFeatures) {
  if (!leftFeatures.size || !rightFeatures.size) return 0;
  let intersection = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const weight of leftFeatures.values()) leftTotal += weight;
  for (const weight of rightFeatures.values()) rightTotal += weight;
  for (const [feature, leftWeight] of leftFeatures) {
    intersection += Math.min(leftWeight, Number(rightFeatures.get(feature) || 0));
  }
  return (2 * intersection) / Math.max(1e-6, leftTotal + rightTotal);
}

export function semanticQueryCoverage(query, candidate) {
  const queryFeatures = semanticLexicalWeights(query);
  const candidateFeatures = semanticLexicalWeights(candidate);
  return semanticFeatureCoverage(queryFeatures, candidateFeatures);
}

export function semanticFeatureCoverage(queryFeatures, candidateFeatures) {
  if (!queryFeatures.size || !candidateFeatures.size) return 0;
  let matched = 0;
  let total = 0;
  for (const [feature, weight] of queryFeatures) {
    total += weight;
    if (candidateFeatures.has(feature)) matched += weight;
  }
  return matched / Math.max(1e-6, total);
}

export function semanticTokens(text) {
  return [...semanticLexicalWeights(text).keys()];
}

export function normalizeSemanticText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function serializeEmbedding(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function deserializeEmbedding(value, dimensions = localSemanticEmbeddingDimensions) {
  if (!value) return new Float32Array(dimensions);
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    return new Float32Array(dimensions);
  }
  return new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );
}

function embedWeightedTexts(parts, dimensions) {
  const vector = new Float32Array(dimensions);
  for (const part of parts) {
    const fieldWeight = Number(part?.weight || 0);
    if (!fieldWeight) continue;
    for (const [feature, weight] of semanticFeatureWeights(part?.text)) {
      addHashedFeature(vector, feature, weight * fieldWeight);
    }
  }
  normalizeVector(vector);
  return vector;
}

function semanticFeatureWeights(text) {
  const normalized = normalizeSemanticText(text);
  const weights = new Map();
  if (!normalized) return weights;

  for (const token of normalized.match(/[a-z0-9]+(?:[_.:/+-][a-z0-9]+)*/g) || []) {
    addWeight(weights, `term:${token}`, 1.65);
    for (const part of token.split(/[_.:/+-]+/).filter((value) => value.length >= 2)) {
      addWeight(weights, `latin:${normalizeEnglishStem(part)}`, 1.2);
    }
  }

  for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    addChineseFeatures(weights, sequence);
  }

  for (const [canonical, aliases] of semanticConcepts) {
    if (aliases.some((alias) => containsSemanticTerm(normalized, alias))) {
      addWeight(weights, `concept:${canonical}`, 4.6);
    }
  }
  addTimeFeatures(weights, normalized);
  addPolarityFeatures(weights, normalized);
  addEntityFeatures(weights, normalized);
  return applySublinearFrequency(weights);
}

export function semanticLexicalWeights(text) {
  const features = semanticFeatureWeights(text);
  const output = new Map();
  for (const [feature, weight] of features) {
    if (feature.startsWith("char1:") || feature.startsWith("polarity:")) continue;
    output.set(feature, weight);
  }
  return output;
}

function addChineseFeatures(weights, sequence) {
  if (chineseSegmenter) {
    for (const segment of chineseSegmenter.segment(sequence)) {
      const word = String(segment.segment || "").trim();
      if (!word || questionNoise.has(word)) continue;
      if (word.length === 1) addWeight(weights, `char1:${word}`, 0.18);
      else addWeight(weights, `word:${word}`, Math.min(2.2, 1.25 + word.length * 0.16));
    }
  }
  for (let size = 2; size <= 4; size += 1) {
    const baseWeight = size === 2 ? 0.62 : size === 3 ? 0.92 : 0.72;
    for (let index = 0; index <= sequence.length - size; index += 1) {
      const gram = sequence.slice(index, index + size);
      if (questionNoise.has(gram)) continue;
      addWeight(weights, `zh${size}:${gram}`, baseWeight);
    }
  }
}

function addTimeFeatures(weights, normalized) {
  const weekdays = [
    ["1", /(?:周|星期|礼拜)一/],
    ["2", /(?:周|星期|礼拜)二/],
    ["3", /(?:周|星期|礼拜)三/],
    ["4", /(?:周|星期|礼拜)四/],
    ["5", /(?:周|星期|礼拜)五/],
    ["6", /(?:周|星期|礼拜)六/],
    ["7", /(?:周日|周天|星期日|星期天|礼拜日|礼拜天)/]
  ];
  for (const [day, pattern] of weekdays) {
    if (pattern.test(normalized)) addWeight(weights, `time:weekday:${day}`, 3.2);
  }
  const periods = [
    ["morning", /早上|上午|清晨|morning/],
    ["noon", /中午|午间|noon/],
    ["afternoon", /下午|傍晚|afternoon|evening/],
    ["night", /晚上|夜里|凌晨|晚间|night/]
  ];
  for (const [period, pattern] of periods) {
    if (pattern.test(normalized)) addWeight(weights, `time:period:${period}`, 2.6);
  }
  for (const match of normalized.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])(?:[:：点时])([0-5]?\d)?/g)) {
    addWeight(weights, `time:hour:${Number(match[1])}`, 3);
  }
  for (const match of normalized.matchAll(/(?:^|[^\d])(\d{1,2})[月/-](\d{1,2})(?:日|号)?/g)) {
    addWeight(weights, `time:date:${Number(match[1])}-${Number(match[2])}`, 3.2);
  }
}

function addPolarityFeatures(weights, normalized) {
  if (/(?:不|没|无|未|别|不要|不再|拒绝|避免)/.test(normalized)) {
    addWeight(weights, "polarity:negative", 1.8);
  }
  if (/(?:已经|已|完成|可以|同意|允许|恢复)/.test(normalized)) {
    addWeight(weights, "polarity:positive", 1.1);
  }
}

function addEntityFeatures(weights, normalized) {
  for (const match of normalized.matchAll(/(?:qq|群|用户|成员|id)?\s*[:：#]?\s*(\d{5,12})/g)) {
    addWeight(weights, `entity:id:${match[1]}`, 5);
  }
  for (const match of normalized.matchAll(/(?:v|版本)\s*(\d+(?:\.\d+){0,3})/g)) {
    addWeight(weights, `entity:version:${match[1]}`, 4);
  }
  for (const match of normalized.matchAll(/(?:#|＃)([\p{L}\p{N}_-]{2,32})/gu)) {
    addWeight(weights, `entity:tag:${match[1]}`, 3.5);
  }
}

function containsSemanticTerm(text, term) {
  const normalizedTerm = normalizeSemanticText(term);
  if (!normalizedTerm) return false;
  if (/^[a-z0-9 ]+$/.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
  }
  return text.includes(normalizedTerm);
}

function normalizeEnglishStem(value) {
  if (value.length <= 4) return value;
  return value
    .replace(/(ments?|ations?|ingly|edly|ing|ed|es|s)$/i, "")
    .slice(0, 32) || value;
}

function applySublinearFrequency(weights) {
  const output = new Map();
  for (const [feature, value] of weights) {
    output.set(feature, value <= 1 ? value : 1 + Math.log(value));
  }
  return output;
}

function addWeight(weights, feature, weight) {
  weights.set(feature, Number(weights.get(feature) || 0) + weight);
}

function addHashedFeature(vector, feature, weight) {
  const first = hash32(feature, 0x811c9dc5);
  const second = hash32(feature, 0x9e3779b9);
  const scale = weight * Math.SQRT1_2;
  vector[first % vector.length] += (first & 0x80000000) === 0 ? scale : -scale;
  vector[second % vector.length] += (second & 0x40000000) === 0 ? scale : -scale;
}

function hash32(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function normalizeVector(vector) {
  let lengthSquared = 0;
  for (const value of vector) lengthSquared += value * value;
  if (lengthSquared <= 0) return vector;
  const divisor = Math.sqrt(lengthSquared);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= divisor;
  }
  return vector;
}
