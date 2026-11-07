// App Server can echo a tool image in native item notifications, legacy
// events and turn/thread snapshots. Only images actually supplied by the Hub
// get a separate, finite allowance; all other output keeps its byte cap.
// Dynamic tools echo the data URL; MCP tool results (mcpToolCall items) echo
// the bare base64 payload, so both spellings of one image are registered.
//
// Native image generation echoes every picture it drew as base64 inside
// imageGeneration items, legacy image_generation_end events and raw
// image_generation_call items. Those pictures never pass through the Hub, so
// a picture first seen inside such an item claims one of a few generated-image
// slots and then gets the same finite echo allowance as a tool image. Before
// a line is parsed, one unclaimed slot's size is available as headroom; text
// and pictures outside image-generation items never claim a slot.
const MAX_IMAGE_ECHOES = 4;
export const MAX_GENERATED_IMAGES = 6;
export const MAX_GENERATED_IMAGE_BYTES = 24 * 1024 * 1024;
const MIN_GENERATED_IMAGE_BYTES = 1024;
const dataUrlPattern = /^data:image\/(png|jpeg|gif|webp);base64,/;
// Base64 signatures of PNG, JPEG, GIF and WebP payloads.
const base64ImagePrefixes = ["iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR"];
const generatedItemTypePattern = /^(imageGeneration|image_generation_call|image_generation_end)$/i;
const generatedMethodPattern = /image_generation/i;

export function createProtocolImageBudget({
  maxGeneratedImages = MAX_GENERATED_IMAGES,
  maxGeneratedImageBytes = MAX_GENERATED_IMAGE_BYTES
} = {}) {
  const images = new Map();
  let remainingBytes = 0;
  let generatedSlots = Math.max(0, Math.floor(Number(maxGeneratedImages) || 0));
  const generatedLimit = Math.max(MIN_GENERATED_IMAGE_BYTES, Math.floor(Number(maxGeneratedImageBytes) || 0));
  const allow = (value) => {
    const entry = images.get(value) || { bytes: Buffer.byteLength(value), remaining: 0 };
    entry.remaining += MAX_IMAGE_ECHOES;
    images.set(value, entry);
    remainingBytes += entry.bytes * MAX_IMAGE_ECHOES;
  };
  const looksLikeImage = (value) => value.startsWith("data:image/")
    || base64ImagePrefixes.some((prefix) => value.startsWith(prefix));
  const claimGenerated = (value) => {
    if (generatedSlots < 1 || images.has(value)) return false;
    const bytes = Buffer.byteLength(value);
    if (bytes < MIN_GENERATED_IMAGE_BYTES || bytes > generatedLimit) return false;
    if (value.startsWith("data:image/") && !dataUrlPattern.test(value)) return false;
    generatedSlots -= 1;
    allow(value);
    return true;
  };
  return {
    register(result) {
      for (const item of result.contentItems || []) {
        const url = item?.type === "inputImage" ? item.imageUrl : null;
        if (typeof url !== "string" || !dataUrlPattern.test(url)) continue;
        allow(url);
        const payload = url.slice(url.indexOf(",") + 1);
        if (payload) allow(payload);
      }
    },
    remainingBytes: () => remainingBytes + (generatedSlots > 0 ? generatedLimit : 0),
    discount(message) {
      if (!remainingBytes && generatedSlots < 1) return 0;
      let bytes = 0;
      const rootGenerated = generatedMethodPattern.test(String(message?.method || ""));
      const pending = [[message, rootGenerated]];
      while (pending.length) {
        const [value, generated] = pending.pop();
        if (typeof value === "string") {
          // Check the prefix before hashing potentially large ordinary text.
          if (!looksLikeImage(value)) continue;
          if (generated && !images.has(value)) claimGenerated(value);
          const entry = images.get(value);
          if (!entry?.remaining) continue;
          entry.remaining -= 1;
          remainingBytes -= entry.bytes;
          bytes += entry.bytes;
        } else if (value && typeof value === "object") {
          const inside = generated || generatedItemTypePattern.test(String(value.type || ""));
          for (const child of Object.values(value)) pending.push([child, inside]);
        }
      }
      return bytes;
    }
  };
}
