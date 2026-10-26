const obsoleteControlPattern = /\[\[(?:qq_command|qq_menu|qq_done|qq_progress|qq_task_budget|qq_task_continue)(?::[^\]\n]*)?\]\]/gi;
const legacyReplyTargetPattern = /\[\[qq_reply:[^\]\n]+\]\]/gi;

// Property order is generation order: innerThought comes first so the model
// forms its first-person reaction before writing anything visible (the
// structured-output form of DeepSeek's in-character "内心OS" thinking), and
// mood comes last as the state this exchange leaves behind.
export const qqAgentOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["innerThought", "status", "text", "bubbles", "reply", "attachments", "sticker", "mood"],
  properties: {
    innerThought: {
      type: "string",
      description: "Never sent. Your private first-person inner monologue (内心OS) about this moment, within 80 Chinese characters: how you really read the message and the person, how you feel, whether and how you want to respond. No analysis report, rules or tool talk."
    },
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
    },
    sticker: {
      type: "string",
      description: "Optional sticker to send after the text as its own bubble: a #ref from qq_sticker search results (or an exact sticker name). Empty for none. At most one per turn; with empty text and bubbles it is sent alone."
    },
    mood: {
      type: "string",
      description: "Your mood after this exchange in 2-8 Chinese characters (e.g. 有点困, 被逗乐了, 烦躁, 好奇), or empty to keep the previous mood. Never put private details here."
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
  const sticker = normalizeStickerSelector(parsed.sticker);
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
  // The sticker becomes its own final bubble, the way people send one after typing.
  const separator = String(bubbleSeparator || "|||").trim() || "|||";
  const visible = sticker
    ? [text, `[[qq_sticker:${sticker}]]`].filter(Boolean).join(`\n${separator}\n`)
    : text;
  return {
    structured: true,
    output: [visible, ...directives].filter(Boolean).join("\n").trim(),
    value: parsed
  };
}

// The Bot's private reflection on a structured turn; never delivered.
export function extractQqAgentInnerState(value) {
  if (!value || typeof value !== "object") return { innerThought: "", mood: "", silent: false };
  return {
    innerThought: String(value.innerThought || "").replace(/\s+/g, " ").trim().slice(0, 240),
    mood: String(value.mood || "").replace(/\s+/g, " ").trim().slice(0, 24),
    silent: value.status === "silent"
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

function normalizeStickerSelector(value) {
  return String(value || "").replace(/[\[\]\r\n|]+/g, " ").trim().slice(0, 60);
}

function normalizeAttachmentName(value) {
  return String(value || "").trim().replace(/[|\]\r\n]/g, "_").slice(0, 180);
}
