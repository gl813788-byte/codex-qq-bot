const obsoleteControlPattern = /\[\[(?:qq_command|qq_menu|qq_done|qq_progress|qq_task_budget|qq_task_continue)(?::[^\]\n]*)?\]\]/gi;
const legacyReplyTargetPattern = /\[\[qq_reply:[^\]\n]+\]\]/gi;

export const qqAgentOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "text", "bubbles", "reply", "attachments"],
  properties: {
    status: {
      type: "string",
      enum: ["reply", "silent"],
      description: "Send a QQ reply or intentionally remain silent."
    },
    text: {
      type: "string",
      description: "The visible QQ text. Keep empty when bubbles contains the complete reply."
    },
    bubbles: {
      type: "array",
      maxItems: 24,
      items: { type: "string" },
      description: "Optional ordered QQ text bubbles. Use either this or text, not both."
    },
    reply: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "targetUserId"],
      properties: {
        mode: { type: "string", enum: ["automatic", "plain", "quote", "mention"] },
        targetUserId: {
          type: "string",
          description: "QQ number from the provided reply candidates; empty for automatic/plain."
        }
      }
    },
    attachments: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "path", "name"],
        properties: {
          kind: { type: "string", enum: ["image", "file"] },
          path: { type: "string", description: "Absolute path inside the current task output workspace." },
          name: { type: "string", description: "Optional display filename; empty for images/default names." }
        }
      }
    }
  }
});

export function parseQqAgentOutput(value, { bubbleSeparator = "|||" } = {}) {
  const raw = String(value || "").trim();
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      structured: false,
      output: stripObsoleteQqControlMarkers(raw),
      value: null
    };
  }

  const status = parsed.status === "silent" ? "silent" : "reply";
  if (status === "silent") {
    return { structured: true, output: "[[qq_silent]]", value: parsed };
  }

  const bubbles = Array.isArray(parsed.bubbles)
    ? parsed.bubbles.map(cleanVisibleText).filter(Boolean).slice(0, 24)
    : [];
  const text = bubbles.length
    ? bubbles.join(`\n${String(bubbleSeparator || "|||").trim() || "|||"}\n`)
    : cleanVisibleText(parsed.text);
  const directives = [];
  const mode = String(parsed.reply?.mode || "automatic");
  const targetUserId = normalizeQqId(parsed.reply?.targetUserId);
  if (mode === "plain") directives.push("[[qq_reply:plain]]");
  if ((mode === "quote" || mode === "mention") && targetUserId) {
    directives.push(`[[qq_reply:${mode}:${targetUserId}]]`);
  }
  for (const attachment of Array.isArray(parsed.attachments) ? parsed.attachments.slice(0, 8) : []) {
    const path = normalizeAbsoluteMarkerPath(attachment?.path);
    if (!path) continue;
    if (attachment?.kind === "image") {
      directives.push(`[[qq_image:${path}]]`);
      continue;
    }
    if (attachment?.kind === "file") {
      const name = normalizeAttachmentName(attachment?.name);
      directives.push(`[[qq_file:${path}${name ? `|${name}` : ""}]]`);
    }
  }
  return {
    structured: true,
    output: [text, ...directives].filter(Boolean).join("\n").trim(),
    value: parsed
  };
}

export function stripObsoleteQqControlMarkers(value) {
  return String(value || "")
    .replace(obsoleteControlPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseJsonObject(value) {
  const withoutFence = String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!withoutFence.startsWith("{") || !withoutFence.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(withoutFence);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cleanVisibleText(value) {
  return stripObsoleteQqControlMarkers(String(value || "").trim())
    .replace(legacyReplyTargetPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeQqId(value) {
  const id = String(value || "").trim();
  return /^[1-9][0-9]{4,12}$/.test(id) ? id : "";
}

function normalizeAbsoluteMarkerPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || /[\r\n\]]/.test(path)) return "";
  return path;
}

function normalizeAttachmentName(value) {
  return String(value || "").trim().replace(/[|\]\r\n]/g, "_").slice(0, 180);
}
