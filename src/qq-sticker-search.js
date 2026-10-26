import { createHash } from "node:crypto";
import { getQqStickerIdentity } from "./qq-sticker-label-store.js";

// On-demand sticker library search. The prompt no longer lists the library;
// the model searches it by mood, scene or meme and sends one result by its
// stable short reference (#3f2a9c). References derive from the label store's
// sticker identity (the same one enrich() stamps on catalog items), so they
// survive catalog reordering and new arrivals and match raw catalogs too.

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const REF_PATTERN = /^#?([0-9a-f]{6})$/i;
const separatorPattern = /[\s,，、;；|/]+/u;

export function getQqStickerRef(item = {}) {
  const identity = getQqStickerIdentity(item);
  if (!identity) return "";
  return `#${createHash("sha1").update(identity).digest("hex").slice(0, 6)}`;
}

export function parseQqStickerRef(value) {
  const match = String(value || "").trim().match(REF_PATTERN);
  return match ? `#${match[1].toLowerCase()}` : "";
}

// Resolves a model selector: a #ref, an exact name, or a unique partial name.
export function findQqStickerBySelector(catalog = [], selector = "") {
  const list = Array.isArray(catalog) ? catalog : [];
  const ref = parseQqStickerRef(selector);
  if (ref) return list.find((item) => getQqStickerRef(item) === ref) || null;
  const normalized = normalizeStickerText(selector);
  if (!normalized) return null;
  const exact = list.find((item) => normalizeStickerText(item.name) === normalized);
  if (exact) return exact;
  const partial = list.filter((item) => normalizeStickerText(item.name).includes(normalized));
  return partial.length === 1 ? partial[0] : null;
}

export function searchQqStickers(catalog = [], query = "", {
  limit = DEFAULT_LIMIT,
  recentRefs = [],
  random = Math.random
} = {}) {
  const list = (Array.isArray(catalog) ? catalog : []).filter((item) => item?.name);
  const max = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(Number(limit) || DEFAULT_LIMIT)));
  const recent = new Set((Array.isArray(recentRefs) ? recentRefs : []).map(parseQqStickerRef).filter(Boolean));
  const terms = String(query || "").split(separatorPattern).map(normalizeStickerText).filter(Boolean).slice(0, 8);
  if (!terms.length) return sampleQqStickers(list, max, { recent, random });

  const scored = [];
  for (const item of list) {
    const ref = getQqStickerRef(item);
    const tags = (Array.isArray(item.tags) ? item.tags : []).map(normalizeStickerText).filter(Boolean);
    const name = normalizeStickerText(item.name);
    const description = normalizeStickerText(item.description);
    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      let termScore = 0;
      if (tags.includes(term)) termScore = Math.max(termScore, 6);
      if (tags.some((tag) => tag.includes(term) || (tag.length >= 2 && term.includes(tag)))) termScore = Math.max(termScore, 4);
      if (name && (name.includes(term) || (name.length >= 2 && term.includes(name)))) termScore = Math.max(termScore, 3.5);
      if (description.includes(term)) termScore = Math.max(termScore, 2.5);
      if (!termScore) termScore = bigramOverlap(term, `${tags.join(" ")} ${name} ${description}`) * 2;
      if (termScore >= 1) matchedTerms += 1;
      score += termScore;
    }
    if (!score) continue;
    // Prefer stickers that match more of the requested meanings.
    score += matchedTerms > 1 ? matchedTerms : 0;
    if (!tags.length && !description) score -= 1;
    if (recent.has(ref)) score -= 3;
    if (score > 0.5) scored.push({ item, ref, score });
  }
  return scored
    .sort((left, right) => right.score - left.score || String(left.item.name).localeCompare(String(right.item.name), "zh-CN"))
    .slice(0, max);
}

export function formatQqStickerSearchResults(results = [], { query = "", total = 0 } = {}) {
  const list = Array.isArray(results) ? results : [];
  const header = query
    ? `表情包库共 ${total} 张；“${String(query).slice(0, 40)}”的匹配结果 ${list.length} 张：`
    : `表情包库共 ${total} 张；随机挑了 ${list.length} 张已标注的：`;
  if (!list.length) {
    return `${header}\n没有合适的。换个情绪/场合/梗的说法再搜，或者这轮不发表情包。`;
  }
  return [
    header,
    ...list.map(({ item, ref }) => {
      const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.slice(0, 6).join("、") : "";
      const meta = [
        item.animated ? "动图" : null,
        item.source === "account" ? "收藏" : item.source === "downloaded" ? "已下载" : item.source === "local" ? "本地" : null
      ].filter(Boolean).join("/");
      const detail = [tags, item.description ? String(item.description).slice(0, 60) : ""].filter(Boolean).join("；");
      return `- ${ref} ${item.name}${meta ? `【${meta}】` : ""}${detail ? `：${detail}` : "（未标注，可先 inspect 看图再 label）"}`;
    }),
    "选中后把 #编号 填进结构化输出的 sticker 字段即可发送；拿不准画面时先 inspect。每轮最多 1 张，不合适就不发。"
  ].join("\n");
}

// A few ready-to-send candidates for a turn the behavior plan marks as
// sticker-friendly: matches for the current message first, then a random
// labeled handful, like the favorites a person has at hand. Searching stays
// available when none fit.
export function suggestQqStickers(catalog = [], text = "", { limit = 5, recentRefs = [], random = Math.random } = {}) {
  const max = Math.max(1, Math.min(8, Math.trunc(Number(limit) || 5)));
  const matched = searchQqStickers(catalog, String(text || "").slice(0, 60), { limit: 3, recentRefs });
  const seen = new Set(matched.map((entry) => entry.ref));
  const sampled = searchQqStickers(catalog, "", { limit: max, recentRefs, random })
    .filter((entry) => !seen.has(entry.ref));
  return [...matched, ...sampled].slice(0, max);
}

export function formatQqStickerSuggestions(results = []) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return "";
  return [
    "手边可直接发的表情包：",
    ...list.map(({ item, ref }) => {
      const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.slice(0, 4).join("、") : "";
      return `  ${ref} ${item.name}${item.animated ? "【动图】" : ""}${tags ? `：${tags}` : ""}`;
    })
  ].join("\n");
}

export function formatQqStickerLibraryHint(catalog = []) {
  const list = Array.isArray(catalog) ? catalog : [];
  if (!list.length) return "";
  const labeled = list.filter((item) => (Array.isArray(item.tags) && item.tags.length) || item.description).length;
  return `表情包库：共 ${list.length} 张（已标注 ${labeled} 张），不在提示里展开。想发表情包时用 qq_sticker 按情绪/场合/梗搜索，把结果的 #编号 填进 sticker 字段。`;
}

function sampleQqStickers(list, max, { recent, random }) {
  const pool = list
    .filter((item) => (Array.isArray(item.tags) && item.tags.length) || item.description)
    .map((item) => ({ item, ref: getQqStickerRef(item), score: 0 }))
    .filter((entry) => !recent.has(entry.ref));
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, max);
}

function bigramOverlap(term, text) {
  const chars = [...term];
  if (chars.length < 2) return 0;
  const haystack = String(text || "");
  let hits = 0;
  for (let index = 0; index < chars.length - 1; index += 1) {
    if (haystack.includes(chars[index] + chars[index + 1])) hits += 1;
  }
  return hits / (chars.length - 1);
}

function normalizeStickerText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}
