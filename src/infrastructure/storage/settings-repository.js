import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serializeFileOperation, writeJsonAtomically } from "../../file-store.js";

export function createSettingsRepository({ filePath } = {}) {
  const path = String(filePath || "").trim();
  if (!path) throw new TypeError("filePath is required");
  return Object.freeze({
    filePath: path,
    async load() {
      await mkdir(dirname(path), { recursive: true });
      try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError("settings root must be an object");
        }
        return value;
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
    async save(snapshot) {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new TypeError("settings snapshot must be an object");
      }
      await mkdir(dirname(path), { recursive: true });
      return serializeFileOperation(path, () => writeJsonAtomically(path, snapshot));
    }
  });
}
