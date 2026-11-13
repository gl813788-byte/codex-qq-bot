import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// How the reply engine makes pictures:
// - "native": the engine draws itself (Codex image generation);
// - "codex": the engine cannot draw (Claude Code), so QQ turns get the
//   qq_draw.image tool, which runs one Codex image-generation turn;
// - null: no drawing on this machine.
// Decided once at startup from the engine's capability flag, the
// CODEX_REMOTE_CONTACT_CODEX_DRAWING setting and whether a codex CLI exists.
export function resolveAgentDrawing({ nativeImageGeneration = false, codexDrawing = "auto", codexAvailable = false } = {}) {
  if (nativeImageGeneration) return "native";
  if (codexDrawing !== "off" && codexAvailable) return "codex";
  return null;
}

// Resolves a bare command name on PATH the way spawn would.
export function isExecutableOnPathSync(command, env = process.env) {
  const value = String(command || "").trim();
  if (!value) return false;
  const candidates = isAbsolute(value) || value.includes("/")
    ? [value]
    : String(env.PATH || "").split(delimiter).filter(Boolean).map((dir) => join(dir, value));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // try the next PATH entry
    }
  }
  return false;
}
