import { execFile } from "node:child_process";

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

// Reports the installed agent CLI version for the dashboard. `peek` never
// waits for a process: it returns the cached answer and refreshes stale
// entries in the background, so status polling stays cheap on slow hosts.
export function createAgentCliVersionProbe({
  readVersion = readCliVersion,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now
} = {}) {
  const cache = new Map();

  const refresh = (cliPath) => {
    const key = String(cliPath || "");
    const cached = cache.get(key);
    if (cached?.pending) return cached.pending;
    const pending = Promise.resolve()
      .then(() => readVersion(key))
      .then((version) => version, () => null)
      .then((version) => {
        cache.set(key, { version, checkedAt: now(), pending: null });
        return version;
      });
    cache.set(key, { version: cached?.version ?? null, checkedAt: cached?.checkedAt ?? 0, pending });
    return pending;
  };

  return {
    peek(cliPath) {
      if (!cliPath) return null;
      const cached = cache.get(String(cliPath));
      if (!cached || (!cached.pending && now() - cached.checkedAt >= ttlMs)) void refresh(cliPath);
      return cached?.version ?? null;
    },
    refresh
  };
}

export function parseAgentCliVersion(output) {
  return String(output || "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || null;
}

function readCliVersion(cliPath) {
  return new Promise((resolve, reject) => {
    execFile(cliPath, ["--version"], {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      // `--version` needs no credentials; keep Hub secrets out of the child.
      env: {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME || "/root",
        LANG: process.env.LANG || "C.UTF-8"
      }
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(parseAgentCliVersion(stdout));
    });
  });
}
