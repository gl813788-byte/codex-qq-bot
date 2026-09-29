import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { baseAgentRuntimeEnvKeys, pickAgentChildEnv, readEnvFile } from "../agent/agent-child-env.js";

const profileAuthKeys = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "API_TIMEOUT_MS"
];
const claudeRuntimeEnvKeys = new Set([
  ...baseAgentRuntimeEnvKeys,
  "CLAUDE_CONFIG_DIR",
  ...profileAuthKeys
]);
// The Bot's Claude children must not phone home for optional features,
// self-update mid-turn, or write auto-memory into QQ task workspaces.
const claudeFixedEnv = Object.freeze({
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1"
});

export function defaultClaudeProfileEnvPath(baseEnv = process.env) {
  if (baseEnv.CLAUDE_ENV_FILE) return baseEnv.CLAUDE_ENV_FILE;
  const configDir = baseEnv.CLAUDE_CONFIG_DIR || join(baseEnv.HOME || "/root", ".claude");
  return join(configDir, "ncc-profiles", "active.env");
}

// A profile file mirrors the Codex ncc-profiles/active.env contract: when it
// exists its connection keys replace the inherited ones, so switching between
// the official login and a relay needs no Hub restart. Without a profile the
// child keeps the machine's own `claude` login.
export function buildIsolatedClaudeChildEnv({
  baseEnv = process.env,
  profileEnvPath = defaultClaudeProfileEnvPath(baseEnv),
  overrides = {}
} = {}) {
  const source = { ...baseEnv, ...(overrides && typeof overrides === "object" ? overrides : {}) };
  const profileEnv = readEnvFile(profileEnvPath);
  if (profileEnv) {
    for (const key of profileAuthKeys) delete source[key];
    for (const key of profileAuthKeys) {
      if (profileEnv[key]) source[key] = profileEnv[key];
    }
  }
  // Call sites pass the whole Hub environment as overrides for Codex; only the
  // Bot's own markers may pass through so Hub secrets and a parent Claude
  // session's markers never reach the child.
  return { ...pickAgentChildEnv(source, claudeRuntimeEnvKeys, isBotMarker), ...claudeFixedEnv };
}

// How turns authenticate: an ncc connection profile when one exists,
// otherwise the machine's own `claude` login. Never reads the keys.
export async function detectClaudeConnection(baseEnv = process.env) {
  const profileExists = await access(defaultClaudeProfileEnvPath(baseEnv), constants.R_OK).then(() => true, () => false);
  return profileExists ? "profile" : "login";
}

// The Claude CLI is usually a bare command name, so resolve it on PATH the
// way spawn would before reporting it in maintenance status.
export async function isExecutableOnPath(command, env = process.env) {
  const value = String(command || "").trim();
  if (!value) return false;
  const candidates = isAbsolute(value) || value.includes("/")
    ? [value]
    : String(env.PATH || "").split(delimiter).filter(Boolean).map((dir) => join(dir, value));
  for (const candidate of candidates) {
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return true;
  }
  return false;
}

function isBotMarker(key) {
  return key.startsWith("CODEX_REMOTE_CONTACT_") && !/KEY|TOKEN|SECRET|PASSWORD|COOKIE/.test(key);
}
