import { QQ_REACTION_FACES } from "./app/qq-message-tools.js";

// How often the people in a conversation do things other than typing:
// emoji reactions, pokes, recalls, quotes, shared cards, forwarded chat
// records, voice and video. Counters are anonymous per scope (never per
// person), decay with a 14-day half-life so habits stay current, and only
// feed the Bot's behavior plan; they never grant permissions.

export const QQ_HUMAN_ACTION_STATS_VERSION = 1;
const HALF_LIFE_DAYS = 14;
const MAX_SCOPES = 400;
const MAX_EMOJIS = 24;
const COUNTERS = Object.freeze(["messages", "reactions", "pokes", "recalls", "quotes", "mentions", "stickers", "images", "shares", "forwards", "voices", "videos"]);
const faceNameById = Object.freeze(Object.fromEntries(
  Object.entries(QQ_REACTION_FACES).reverse().map(([name, id]) => [id, name])
));

export function createEmptyQqHumanActionStats() {
  return { version: QQ_HUMAN_ACTION_STATS_VERSION, scopes: {} };
}

export function normalizeQqHumanActionStats(value) {
  const raw = value && typeof value === "object" ? value : {};
  const output = createEmptyQqHumanActionStats();
  const scopes = raw.scopes && typeof raw.scopes === "object" ? raw.scopes : {};
  for (const [scopeId, scope] of Object.entries(scopes).slice(-MAX_SCOPES)) {
    const id = String(scopeId || "").trim();
    if (!/^(?:\d{5,12}|private:\d{5,12})$/.test(id) || !scope || typeof scope !== "object") continue;
    const entry = { decayedAt: validTime(scope.decayedAt) || new Date(0).toISOString(), emojis: {} };
    for (const key of COUNTERS) entry[key] = nonNegative(scope[key]);
    for (const [emoji, count] of Object.entries(scope.emojis || {}).slice(0, MAX_EMOJIS)) {
      if (/^\d{1,7}$/.test(emoji) && nonNegative(count) > 0) entry.emojis[emoji] = nonNegative(count);
    }
    output.scopes[id] = entry;
  }
  return output;
}

function decayScope(scope, now) {
  const last = Date.parse(scope.decayedAt || "") || now;
  const days = Math.max(0, (now - last) / 86_400_000);
  if (days < 0.25) return scope;
  const factor = 0.5 ** (days / HALF_LIFE_DAYS);
  const next = { ...scope, decayedAt: new Date(now).toISOString(), emojis: {} };
  for (const key of COUNTERS) next[key] = round(nonNegative(scope[key]) * factor);
  for (const [emoji, count] of Object.entries(scope.emojis || {})) {
    const value = round(count * factor);
    if (value >= 0.05) next.emojis[emoji] = value;
  }
  return next;
}

// Records one observation. kind is a counter name; reactions may carry the
// emoji ids people used.
export function recordQqHumanAction(stats, { scopeId, kind, count = 1, emojiIds = [], now = Date.now() } = {}) {
  const id = String(scopeId || "").trim();
  if (!id || !COUNTERS.includes(kind)) return { stats, changed: false };
  const next = normalizeQqHumanActionStats(stats);
  const scope = decayScope(next.scopes[id] || { decayedAt: new Date(now).toISOString(), emojis: {} }, now);
  for (const key of COUNTERS) scope[key] = nonNegative(scope[key]);
  scope[kind] = round(scope[kind] + Math.max(0, Number(count) || 0));
  for (const emoji of emojiIds.map((value) => String(value || "").trim()).filter((value) => /^\d{1,7}$/.test(value))) {
    scope.emojis[emoji] = round((scope.emojis[emoji] || 0) + 1);
  }
  const sorted = Object.entries(scope.emojis).sort((left, right) => right[1] - left[1]).slice(0, MAX_EMOJIS);
  scope.emojis = Object.fromEntries(sorted);
  delete next.scopes[id];
  next.scopes[id] = scope;
  const ids = Object.keys(next.scopes);
  for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_SCOPES))) delete next.scopes[stale];
  return { stats: next, changed: true };
}

// Message-borne actions of one human message.
export function classifyQqHumanMessageActions(event = {}, { isSticker = () => false } = {}) {
  const kinds = ["messages"];
  const content = event.contentContext || {};
  if (event.replyContext || event.replyMessageId) kinds.push("quotes");
  if (Array.isArray(event.atTargets) && event.atTargets.some((id) => String(id) !== String(event.selfId || ""))) kinds.push("mentions");
  if (isSticker(event)) kinds.push("stickers");
  else if (Array.isArray(event.images) && event.images.length) kinds.push("images");
  if (Array.isArray(content.cards) && content.cards.length) kinds.push("shares");
  if (Array.isArray(content.forwardIds) && content.forwardIds.length) kinds.push("forwards");
  if (content.media?.audios?.length) kinds.push("voices");
  if (content.media?.videos?.length) kinds.push("videos");
  return kinds;
}

export function summarizeQqHumanActionRates(stats, scopeId, { now = Date.now() } = {}) {
  const raw = normalizeQqHumanActionStats(stats).scopes[String(scopeId || "")];
  if (!raw) return { sample: 0, confidence: "none", rates: {}, topEmojis: [] };
  const scope = decayScope(raw, now);
  const sample = scope.messages;
  const rates = {};
  for (const key of COUNTERS) if (key !== "messages") rates[key] = sample > 0 ? round(scope[key] / sample, 4) : 0;
  const topEmojis = Object.entries(scope.emojis)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([id]) => describeQqEmojiId(id))
    .filter(Boolean);
  return {
    sample: round(sample, 1),
    confidence: sample >= 120 ? "high" : sample >= 40 ? "medium" : sample >= 10 ? "low" : "none",
    rates,
    topEmojis
  };
}

export function describeQqEmojiId(id) {
  const value = String(id || "");
  if (faceNameById[value]) return faceNameById[value];
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0x2600 && number <= 0x10ffff) {
    try {
      return String.fromCodePoint(number);
    } catch {
      return "";
    }
  }
  return "";
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function validTime(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? text : "";
}
