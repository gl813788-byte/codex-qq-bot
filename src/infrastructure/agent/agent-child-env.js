import { readFileSync } from "node:fs";

// Process-level variables every agent CLI child needs, whichever engine runs
// it. Engine modules add their own connection keys and markers on top.
export const baseAgentRuntimeEnvKeys = Object.freeze([
  "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP", "TZ", "TERM",
  "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS", "UV_THREADPOOL_SIZE", "MALLOC_ARENA_MAX",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy"
]);

// Copies only allowlisted keys (plus locale LC_* and anything the engine
// explicitly admits) so Hub secrets never leak into an agent child.
export function pickAgentChildEnv(source, allowedKeys, admitKey = () => false) {
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value == null) continue;
    if (allowedKeys.has(key) || key.startsWith("LC_") || admitKey(key)) env[key] = String(value);
  }
  return env;
}

export function readTextFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export function readEnvFile(path) {
  const body = readTextFile(path);
  return body == null ? null : parseEnvFile(body);
}

// Parses the ncc profile env syntax without executing shell code.
export function parseEnvFile(body) {
  const values = {};
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = parseEnvValue(match[2].trim());
  }
  return values;
}

function parseEnvValue(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\([\\"$`])/g, "$1");
  }
  return value.replace(/\s+#.*$/, "").trim();
}
