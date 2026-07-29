const DEFAULT_MAX_CHARS = 900;
const DEFAULT_MAX_BUBBLES = 24;
const MIN_NATURAL_CUT_RATIO = 0.55;

export function buildQqReplySendPlan(reply, {
  separator = "|||",
  maxChars = DEFAULT_MAX_CHARS,
  maxBubbles = DEFAULT_MAX_BUBBLES
} = {}) {
  const text = String(reply || "").trim();
  if (!text) {
    return {
      bubbles: [],
      flattened: "",
      autoSplit: false,
      truncated: false,
      omittedChars: 0
    };
  }
  const safeMaxChars = boundedInteger(maxChars, DEFAULT_MAX_CHARS, 200, 4_000);
  const safeMaxBubbles = boundedInteger(maxBubbles, DEFAULT_MAX_BUBBLES, 1, 64);
  const explicitBubbles = splitExplicitBubbles(text, separator);
  const splitBubbles = explicitBubbles.flatMap((bubble) => splitBubbleAtNaturalBoundaries(bubble, safeMaxChars));
  const truncated = splitBubbles.length > safeMaxBubbles;
  const bubbles = splitBubbles.slice(0, safeMaxBubbles);
  const omittedChars = truncated
    ? characterLength(splitBubbles.slice(safeMaxBubbles).join("\n"))
    : 0;
  if (truncated && bubbles.length > 0) {
    const notice = `\n（本次回复超过 ${safeMaxBubbles} 条 QQ 消息的安全上限，剩余 ${omittedChars} 字已截断）`;
    bubbles[bubbles.length - 1] = appendWithinLimit(bubbles[bubbles.length - 1], notice, safeMaxChars);
  }
  return {
    bubbles,
    flattened: bubbles.join("\n"),
    autoSplit: splitBubbles.length > explicitBubbles.length,
    truncated,
    omittedChars
  };
}

export function splitBubbleAtNaturalBoundaries(value, maxChars = DEFAULT_MAX_CHARS) {
  const limit = boundedInteger(maxChars, DEFAULT_MAX_CHARS, 200, 4_000);
  let remaining = String(value || "").trim();
  if (!remaining) return [];
  const chunks = [];
  while (characterLength(remaining) > limit) {
    const prefix = sliceCharacters(remaining, 0, limit);
    const cut = findNaturalCut(prefix, limit);
    const chunk = sliceCharacters(remaining, 0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = sliceCharacters(remaining, cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitExplicitBubbles(text, separator) {
  const marker = String(separator || "").trim() || "|||";
  const pattern = new RegExp(`(?:^|\\r?\\n)[ \\t]*${escapeRegExp(marker)}[ \\t]*(?=\\r?\\n|$)`, "g");
  return String(text || "")
    .split(pattern)
    .map((bubble) => bubble.trim())
    .filter(Boolean);
}

function findNaturalCut(prefix, limit) {
  const characters = [...prefix];
  const minimum = Math.floor(limit * MIN_NATURAL_CUT_RATIO);
  const strongBoundary = findLastBoundary(characters, minimum, /[\n。！？!?；;]/u, true);
  if (strongBoundary > 0) return strongBoundary;
  const weakBoundary = findLastBoundary(characters, minimum, /[，、,:：）)\]\s]/u, true);
  return weakBoundary > 0 ? weakBoundary : characters.length;
}

function findLastBoundary(characters, minimum, pattern, includeBoundary) {
  for (let index = characters.length - 1; index >= minimum; index -= 1) {
    if (pattern.test(characters[index])) return index + (includeBoundary ? 1 : 0);
  }
  return -1;
}

function appendWithinLimit(value, suffix, limit) {
  const suffixLength = characterLength(suffix);
  const available = Math.max(1, limit - suffixLength);
  return `${sliceCharacters(value, 0, available).trimEnd()}${suffix}`;
}

function characterLength(value) {
  return [...String(value || "")].length;
}

function sliceCharacters(value, start, end) {
  return [...String(value || "")].slice(start, end).join("");
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
