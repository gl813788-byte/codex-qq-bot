export const qqContextSummaryOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "knowledge"],
  properties: {
    summary: {
      type: "string",
      description: "A concise Chinese QQ conversation summary with 3 to 6 short points and no hidden markers."
    },
    knowledge: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "content", "scope", "userId", "userName", "replacesTitle"],
        properties: {
          kind: { type: "string", enum: ["slang", "note"] },
          title: { type: "string" },
          content: { type: "string" },
          scope: { type: "string", enum: ["group", "group-member", "member"] },
          userId: { type: "string" },
          userName: { type: "string" },
          replacesTitle: { type: "string" }
        }
      }
    }
  }
});

export function parseQqContextSummaryOutput(value) {
  const source = parseJsonObject(value);
  if (!source) return null;
  const summary = String(source.summary || "").trim().slice(0, 8_000);
  if (!summary) return null;
  const knowledge = (Array.isArray(source.knowledge) ? source.knowledge : [])
    .slice(0, 16)
    .map(normalizeKnowledgePatch)
    .filter(Boolean);
  return { summary, knowledge };
}

function normalizeKnowledgePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = value.kind === "slang" ? "slang" : value.kind === "note" ? "note" : "";
  const title = compact(value.title, 160);
  const content = compactMultiline(value.content, 4_000);
  const scope = ["group", "group-member", "member"].includes(value.scope) ? value.scope : "";
  if (!kind || !title || !content || !scope) return null;
  return {
    kind,
    title,
    content,
    scope,
    userId: compact(value.userId, 32),
    userName: compact(value.userName, 100),
    replacesTitle: compact(value.replacesTitle, 160)
  };
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactMultiline(value, limit) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, limit);
}
