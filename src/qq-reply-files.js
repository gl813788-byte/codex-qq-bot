import { basename } from "node:path";
import { resolveAllowedQqMarkerPath } from "./qq-output-policy.js";

export function sanitizeQqUploadFileName(name) {
  const cleaned = String(name || "").trim().replace(/[\\/:*?"<>|\r\n]+/g, "_");
  return cleaned.slice(0, 180);
}

export function extractQqFileMarkers(text) {
  return [...String(text || "").matchAll(/\[\[qq_file:([^\]\n]+)\]\]/g)]
    .map((match) => {
      const [rawPath, ...nameParts] = match[1].split("|");
      return {
        path: String(rawPath || "").trim(),
        name: sanitizeQqUploadFileName(nameParts.join("|").trim())
      };
    })
    .filter((item) => item.path);
}

// Rejected files must remain failed delivery attempts. Silently dropping them
// would let a successful text send falsely confirm the whole reply.
export async function resolveQqReplyFileAttachments(reply, { event, projectDir } = {}) {
  const attachments = [];
  const failures = [];
  const seen = new Set();
  for (const marker of extractQqFileMarkers(reply)) {
    const filePath = await resolveAllowedQqMarkerPath(marker.path, { kind: "file", event, projectDir });
    if (!filePath) {
      failures.push({
        ok: false,
        errorCode: "QQ_FILE_ATTACHMENT_REJECTED",
        error: "附件不在本轮输出目录中或已经不可读，文件未发送。"
      });
      continue;
    }
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    attachments.push({ path: filePath, name: marker.name || basename(filePath) });
  }
  return { attachments, failures };
}
