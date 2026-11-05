import {
  copyQqBotDrawingTo,
  formatQqBotDrawingsList,
  listQqBotDrawingsForScope,
  readQqBotDrawingFile
} from "../qq-bot-drawings.js";

// Drawing half of qq_context.images: list, look at, or take out one of the
// Bot's own drawings.
// Only drawings visible in this conversation are reachable; use copies the
// validated file into this turn's output directory so the ordinary
// attachment and Qzone paths can send it.

export async function executeQqDrawingsTool(args = {}, {
  drawings = [],
  scopeId = "",
  directory,
  taskWorkspace,
  maxBytes = 20 * 1024 * 1024,
  assertActive = () => {}
} = {}) {
  assertActive();
  const action = String(args.action || "list");
  if (action === "list") return { ok: true, reply: formatQqBotDrawingsList(drawings, { scopeId }) };
  const id = String(args.id || "").trim().toLowerCase();
  const drawing = listQqBotDrawingsForScope(drawings, scopeId).find((item) => item.id === id);
  if (!drawing) return { ok: false, error: "这里没有这张画；先用 action=list 看看有哪些。" };
  try {
    if (action === "inspect") {
      const { data, mimeType } = await readQqBotDrawingFile(drawing, { directory, maxBytes });
      assertActive();
      const reply = `这是你画的《${drawing.title}》（${drawing.id}）。${drawing.description ? `当时的想法：${drawing.description}` : ""}`;
      return {
        ok: true,
        reply,
        contentItems: [
          { type: "inputText", text: reply },
          { type: "inputImage", imageUrl: `data:${mimeType};base64,${data.toString("base64")}` }
        ]
      };
    }
    if (action === "use") {
      if (!taskWorkspace?.outputDir) return { ok: false, error: "本轮没有输出目录，拿不出来。" };
      const path = await copyQqBotDrawingTo(drawing, { directory, outputDir: taskWorkspace.outputDir, maxBytes });
      assertActive();
      return {
        ok: true,
        reply: `已把《${drawing.title}》拿到本轮输出目录：${path}。发到聊天就把这个路径放进 attachments（kind=image）；配进说说就用 qq_social.act(action=qzone_publish, target=输出)。回复里不要写路径。`
      };
    }
  } catch {
    return { ok: false, error: "这张画的文件读不出来了（可能已被清理），如实说。" };
  }
  return { ok: false, error: "画作只支持 list、inspect、use。" };
}
