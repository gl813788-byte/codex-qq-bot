import { snapshotQqContextImages } from "./context-images.js";

// The interest gate may see a few small pictures from the judged messages.
// Provider/model vision support is not advertised consistently, so "auto"
// tries once and remembers a model that rejects image input.
export const qqInterestVisionModes = Object.freeze(["auto", "on", "off"]);
export const qqInterestVisionMaxImages = 2;

export function normalizeQqInterestVisionMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(mode)) return "off";
  if (["1", "true", "yes", "on", "enabled", "always"].includes(mode)) return "on";
  return "auto";
}

export function createQqInterestVisionCapabilityCache() {
  const entries = new Map();
  const key = (provider, model) => `${String(provider || "")}\0${String(model || "")}`;
  return {
    get(provider, model) {
      return entries.has(key(provider, model)) ? entries.get(key(provider, model)).supported : null;
    },
    set(provider, model, supported, { at = new Date().toISOString() } = {}) {
      entries.set(key(provider, model), { provider: String(provider || ""), model: String(model || ""), supported: Boolean(supported), at });
    },
    snapshot() {
      return [...entries.values()].map((entry) => ({ ...entry }));
    }
  };
}

// Whether to send pictures for this provider/model right now.
export function shouldSendQqInterestImages({ mode, cache, provider, model, imageCount = 0 } = {}) {
  if (!imageCount || normalizeQqInterestVisionMode(mode) === "off") return false;
  if (normalizeQqInterestVisionMode(mode) === "on") return true;
  return cache?.get(provider, model) !== false;
}

// A request error that is about image input rather than auth, quota or format.
export function isQqInterestImageRejection(status, bodyText = "") {
  if (![400, 404, 415, 422].includes(Number(status))) return false;
  return /image|vision|multi-?modal|modalit|image_url|unknown variant|content.*(?:type|part)|unsupported.*content/i.test(String(bodyText || ""));
}

// Current message, quoted message, then the newest pictures in the judged
// window, deduplicated and labelled so the judge can tie them to the text.
export function selectQqInterestJudgeImages(event = {}, recentMessages = [], {
  limit = qqInterestVisionMaxImages,
  maxRecentMessages = 8
} = {}) {
  const currentId = event.raw?.message_id == null ? "" : String(event.raw.message_id);
  const recent = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((entry) => !currentId || String(entry?.messageId || "") !== currentId)
    .slice(-Math.max(1, Number(maxRecentMessages) || 8))
    .toReversed();
  const sources = [
    { images: event.images, origin: "当前消息", sender: event.senderLabel || event.senderName || "", at: null },
    { images: event.replyContext?.images, origin: "引用消息", sender: event.replyContext?.senderName || "", at: null },
    ...recent.map((entry) => ({
      images: entry?.images,
      origin: "最近上下文",
      sender: entry?.senderLabel || entry?.senderName || "",
      at: entry?.at || null
    }))
  ];
  const seen = new Set();
  const selected = [];
  for (const source of sources) {
    for (const image of snapshotQqContextImages(source.images, { limit: 4 })) {
      const key = `${image.file}\0${image.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ image, origin: source.origin, sender: String(source.sender || "").slice(0, 60), at: source.at });
      if (selected.length >= Math.max(1, Math.min(4, Number(limit) || qqInterestVisionMaxImages))) return selected;
    }
  }
  return selected;
}

// OpenAI-compatible multimodal user content: the original JSON text first,
// then each picture in the order listed by attachedImages.
export function buildQqInterestImageContent(text, images = []) {
  const valid = images.filter((image) => /^data:image\/(png|jpeg|gif|webp);base64,/.test(String(image?.dataUrl || "")));
  if (!valid.length) return text;
  return [
    { type: "text", text },
    ...valid.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))
  ];
}
