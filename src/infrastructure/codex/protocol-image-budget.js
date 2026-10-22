// App Server can echo a tool image in native item notifications, legacy
// events and turn/thread snapshots. Only data URLs actually supplied by the
// Hub get a separate, finite allowance; all other output keeps its byte cap.
const MAX_IMAGE_ECHOES = 4;

export function createProtocolImageBudget() {
  const images = new Map();
  let remainingBytes = 0;
  return {
    register(result) {
      for (const item of result.contentItems || []) {
        const url = item?.type === "inputImage" ? item.imageUrl : null;
        if (typeof url !== "string" || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) continue;
        const entry = images.get(url) || { bytes: Buffer.byteLength(url), remaining: 0 };
        entry.remaining += MAX_IMAGE_ECHOES;
        images.set(url, entry);
        remainingBytes += entry.bytes * MAX_IMAGE_ECHOES;
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
          // Check length/prefix before hashing potentially large ordinary text.
          if (!value.startsWith("data:image/")) continue;
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
