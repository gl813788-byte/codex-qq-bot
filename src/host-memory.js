import { readFile } from "node:fs/promises";
import { freemem } from "node:os";

// Available physical memory right now. On phones (Termux/PRoot) Android kills
// the whole session on a sudden spike, so optional heavy work (local media
// jobs, extra agent processes) checks this before starting instead of
// assuming the startup resource plan still holds.

export async function readAvailableMemoryBytes({ read = readFile, fallback = freemem } = {}) {
  try {
    const text = await read("/proc/meminfo", "utf8");
    const match = String(text).match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (match) return Number(match[1]) * 1024;
  } catch {
    // not Linux, or /proc is hidden
  }
  return Number(fallback()) || 0;
}

export function createHostMemoryGate({ minAvailableBytes = 0, readAvailable = readAvailableMemoryBytes } = {}) {
  const minimum = Math.max(0, Number(minAvailableBytes) || 0);
  return async function checkHostMemory() {
    if (!minimum) return { ok: true, availableBytes: null, minimumBytes: 0 };
    const availableBytes = await readAvailable().catch(() => 0);
    return { ok: availableBytes >= minimum, availableBytes, minimumBytes: minimum };
  };
}

export function formatMegabytes(bytes) {
  return `${Math.round((Number(bytes) || 0) / 1024 / 1024)}MB`;
}

// How much free memory a shell command should find before it starts: any
// command needs a little headroom, builds/installs/media work need more, and
// parallel test runners need far more than a phone usually has.
const PARALLEL_TEST_PATTERN = /(?:^|[;&|\s])(?:npm\s+(?:run\s+)?(?:test|verify|check)|npm\s+t)(?=\s|$|[;&|])/;
const HEAVY_PATTERN = /(?:npm\s+(?:install|ci|i)(?:\s|$)|pip3?\s+install|tar\s[^;&|]*x|unzip\s|ffmpeg|yt-dlp|qq-media-worker|storyboard\.mjs|install-media-tools|sherpa|codex\s+exec|claude\s+-p|cargo\s|go\s+build|gcc\s|make(?:\s|$)|docker\s)/i;

export function classifyHostCommandMemoryNeed(command, {
  minMb = 500,
  heavyMb = 1500,
  parallelMb = 3500
} = {}) {
  const text = String(command || "");
  if (PARALLEL_TEST_PATTERN.test(text)
    || (/node[^;&|]*--test/.test(text) && !/--test-concurrency=1\b/.test(text))) {
    return { kind: "parallel-test", minimumBytes: parallelMb * 1024 * 1024 };
  }
  if (HEAVY_PATTERN.test(text)) return { kind: "heavy", minimumBytes: heavyMb * 1024 * 1024 };
  return { kind: "command", minimumBytes: minMb * 1024 * 1024 };
}
