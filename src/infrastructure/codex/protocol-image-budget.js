// App Server can echo a tool image in native item notifications, legacy
// events and turn/thread snapshots. Only images actually supplied by the Hub
// get a separate, finite allowance; all other output keeps its byte cap.
// Dynamic tools echo the data URL; MCP tool results (mcpToolCall items) echo
// the bare base64 payload, so both spellings of one image are registered.
const MAX_IMAGE_ECHOES = 4;
const dataUrlPattern = /^data:image\/(png|jpeg|gif|webp);base64,/;
// Base64 signatures of PNG, JPEG, GIF and WebP payloads.
const base64ImagePrefixes = ["iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR"];

export function createProtocolImageBudget() {
  const images = new Map();
  let remainingBytes = 0;
  const allow = (value) => {
    const entry = images.get(value) || { bytes: Buffer.byteLength(value), remaining: 0 };
    entry.remaining += MAX_IMAGE_ECHOES;
    images.set(value, entry);
    remainingBytes += entry.bytes * MAX_IMAGE_ECHOES;
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
    remainingBytes: () => remainingBytes,
    discount(message) {
      if (!remainingBytes) return 0;
      let bytes = 0;
      const pending = [message];
      while (pending.length) {
        const value = pending.pop();
        if (typeof value === "string") {
          // Check the prefix before hashing potentially large ordinary text.
          if (!value.startsWith("data:image/") && !base64ImagePrefixes.some((prefix) => value.startsWith(prefix))) continue;
          const entry = images.get(value);
          if (!entry?.remaining) continue;
          entry.remaining -= 1;
          remainingBytes -= entry.bytes;
          bytes += entry.bytes;
        } else if (value && typeof value === "object") {
          for (const child of Object.values(value)) pending.push(child);
        }
      }
      return bytes;
    }
  };
}
