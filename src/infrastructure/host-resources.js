import { readFile } from "node:fs/promises";
import { availableParallelism, freemem, totalmem } from "node:os";
import { posix } from "node:path";

// Startup snapshot only. Missing Linux/cgroup files fall back to OS facts.
export async function detectHostResources({
  read = (path) => readFile(path, "utf8"),
  totalMemoryBytes = totalmem(), freeMemoryBytes = freemem(), cpuCount = availableParallelism()
} = {}) {
  const text = async (path) => { try { return String(await read(path)); } catch { return ""; } };
  const [meminfo, membership, mounts] = await Promise.all([
    text("/proc/meminfo"), text("/proc/self/cgroup"), text("/proc/self/mountinfo")
  ]);
  const availableKb = /^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1];
  let availableMemoryBytes = Math.min(totalMemoryBytes, availableKb ? Number(availableKb) * 1024 : freeMemoryBytes);
  let memoryLimitBytes = totalMemoryBytes;
  let effectiveCpuCount = Math.max(0.01, cpuCount);
  const memberships = membership.trim().split("\n").map((line) => {
    const [, , controllers, path] = /^(\d+):([^:]*):(.*)$/.exec(line) || [];
    return { controllers: (controllers || "").split(","), path };
  });
  for (const line of mounts.split("\n")) {
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const [type, , options = ""] = right.split(" ");
    if (!["cgroup", "cgroup2"].includes(type)) continue;
    const fields = left.split(" ");
    const decode = (value) => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    const root = decode(fields[3]);
    const mount = decode(fields[4]);
    const member = memberships.find((item) => item.path && (type === "cgroup2"
      ? item.controllers[0] === ""
      : item.controllers.some((controller) => options.split(",").includes(controller))));
    if (!member) continue;
    // A cgroup namespace can report membership relative to its own root even
    // when mountinfo exposes a different host-side mount root.
    const relative = root === "/" || member.path === root || member.path.startsWith(`${root}/`)
      ? posix.relative(root, member.path) : member.path.replace(/^\/+/, "");
    if (relative.startsWith("..") || posix.isAbsolute(relative)) continue;
    let directory = posix.join(mount, relative);
    while (true) {
      const v2 = type === "cgroup2";
      const [limitText, currentText, quotaText, periodText] = await Promise.all([
        text(posix.join(directory, v2 ? "memory.max" : "memory.limit_in_bytes")),
        text(posix.join(directory, v2 ? "memory.current" : "memory.usage_in_bytes")),
        text(posix.join(directory, v2 ? "cpu.max" : "cpu.cfs_quota_us")),
        v2 ? "" : text(posix.join(directory, "cpu.cfs_period_us"))
      ]);
      const limit = positive(limitText);
      if (limit) {
        memoryLimitBytes = Math.min(memoryLimitBytes, limit);
        const used = Number(currentText.trim());
        availableMemoryBytes = Math.min(availableMemoryBytes,
          currentText.trim() && Number.isFinite(used) && used >= 0 ? Math.max(0, limit - used) : limit / 2);
      }
      const [quota, period] = v2 ? quotaText.trim().split(/\s+/) : [quotaText, periodText];
      if (positive(quota) && positive(period)) effectiveCpuCount = Math.min(effectiveCpuCount, Number(quota) / Number(period));
      if (directory === mount) break;
      directory = posix.dirname(directory);
    }
  }
  return {
    totalMemoryBytes, availableMemoryBytes: Math.min(availableMemoryBytes, memoryLimitBytes),
    memoryLimitBytes, cpuCount, effectiveCpuCount
  };
}

function positive(value) {
  const number = Number(String(value || "").trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
