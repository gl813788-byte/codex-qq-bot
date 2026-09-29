import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  baseAgentRuntimeEnvKeys,
  pickAgentChildEnv,
  readEnvFile,
  readTextFile
} from "./infrastructure/agent/agent-child-env.js";

const profileAuthKeys = ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"];
const codexRuntimeEnvKeys = new Set([
  ...baseAgentRuntimeEnvKeys,
  "CODEX_HOME", "CODEX_CONFIG_PATH", "CODEX_ENV_FILE",
  ...profileAuthKeys
]);

export function buildCodexChildEnv({
  baseEnv = process.env,
  profileEnvPath = process.env.CODEX_ENV_FILE || "/root/.codex/ncc-profiles/active.env",
  configPath = baseEnv.CODEX_CONFIG_PATH || join(baseEnv.CODEX_HOME || join(baseEnv.HOME || "/root", ".codex"), "config.toml"),
  overrides = {}
} = {}) {
  const env = { ...baseEnv, ...overrides };
  const activeEnv = readEnvFile(profileEnvPath);

  for (const key of profileAuthKeys) delete env[key];
  for (const [key, value] of Object.entries(activeEnv || {})) {
    if (!profileAuthKeys.includes(key)) env[key] = value;
  }

  const matchingProfileEnv = findMatchingProfileEnv(configPath, dirname(profileEnvPath));
  for (const key of profileAuthKeys) {
    if (matchingProfileEnv?.[key]) env[key] = matchingProfileEnv[key];
  }
  return env;
}

export function buildIsolatedCodexChildEnv(options = {}) {
  const overrides = options?.overrides && typeof options.overrides === "object"
    ? options.overrides
    : {};
  return pickAgentChildEnv(buildCodexChildEnv(options), codexRuntimeEnvKeys, (key) => Object.hasOwn(overrides, key));
}

function findMatchingProfileEnv(configPath, profileDir) {
  const activeAuth = parseCodexAuthConfig(readTextFile(configPath));
  if (!activeAuth) return null;

  let entries = [];
  try {
    entries = readdirSync(profileDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    const profileName = entry.name.slice(0, -5);
    const profileAuth = parseCodexAuthConfig(readTextFile(join(profileDir, entry.name)));
    if (!sameCodexAuthConfig(activeAuth, profileAuth)) continue;
    const profileEnv = readEnvFile(join(profileDir, `${profileName}.env`));
    if (profileEnv) return profileEnv;
  }
  return null;
}

function parseCodexAuthConfig(body) {
  if (!body) return null;
  let provider = "";
  let section = "";
  const providers = new Map();

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[model_providers\.([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].replace(/^"|"$/g, "");
      if (!providers.has(section)) providers.set(section, {});
      continue;
    }
    if (line.startsWith("[")) {
      section = "";
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']*)["']\s*$/);
    if (!valueMatch) continue;
    const [, key, value] = valueMatch;
    if (!section && key === "model_provider") provider = value;
    if (section && (key === "base_url" || key === "env_key")) providers.get(section)[key] = value;
  }

  const providerConfig = providers.get(provider);
  if (!provider || !providerConfig?.base_url) return null;
  return {
    provider: provider.toLowerCase(),
    baseUrl: providerConfig.base_url.replace(/\/+$/, "").toLowerCase(),
    envKey: String(providerConfig.env_key || "").toUpperCase()
  };
}

function sameCodexAuthConfig(left, right) {
  return Boolean(left && right
    && left.provider === right.provider
    && left.baseUrl === right.baseUrl
    && left.envKey === right.envKey);
}
