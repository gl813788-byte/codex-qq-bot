import assert from "node:assert/strict";
import test from "node:test";
import { detectHostResources } from "../src/infrastructure/host-resources.js";
import { planResourceProfile } from "../src/config/resource-profile.js";

const MiB = 1024 * 1024;
const facts = (availableMb, cpu = 8) => ({ totalMemoryBytes: 8192 * MiB, memoryLimitBytes: 8192 * MiB, availableMemoryBytes: availableMb * MiB, effectiveCpuCount: cpu });

test("automatic plans respect memory headroom and CPU capacity, and reject insufficient memory", () => {
  const low = planResourceProfile(facts(1600));
  const large = planResourceProfile(facts(7000));
  assert.equal(low.profile, "low");
  assert.equal(low.agentConcurrency, 1);
  assert.ok(large.hubHeapMb > low.hubHeapMb);
  assert.ok(large.agentConcurrency > low.agentConcurrency);
  assert.ok(large.imageMaxBytes > low.imageMaxBytes);
  assert.equal(planResourceProfile(facts(7000, 0.5)).agentConcurrency, 1);
  assert.equal(planResourceProfile(facts(7000, 1)).rendererLimit, 1);
  assert.throws(() => planResourceProfile(facts(900)), /安全启动/);
  assert.throws(() => planResourceProfile(facts(1100)), /不足以启动/);
  assert.equal(planResourceProfile(facts(7000), { profile: "balanced" }).hubHeapMb, 256);
  // Several days of rotated logs: 3 MiB x 8 on the balanced tier, 2 MiB x 6 on low.
  assert.equal(planResourceProfile(facts(7000), { profile: "balanced" }).logFiles * planResourceProfile(facts(7000), { profile: "balanced" }).logBytes, 24 * MiB);
  assert.equal(low.logFiles * low.logBytes, 12 * MiB);
  assert.throws(() => planResourceProfile(facts(7000), { minimumMb: 2000 }), /内存阈值/);
  assert.throws(() => planResourceProfile(facts(7000), { profile: "unknown" }), /资源档位/);
});

test("startup detection respects cgroup hierarchies and falls back to OS resources", async () => {
  const cases = [
    {
      name: "nested cgroup v2", files: {
        "/proc/meminfo": "MemAvailable: 7340032 kB\n",
        "/proc/self/cgroup": "0::/parent/child\n",
        "/proc/self/mountinfo": "1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
        "/sys/fs/cgroup/parent/child/memory.max": `${4096 * MiB}`,
        "/sys/fs/cgroup/parent/child/memory.current": `${512 * MiB}`,
        "/sys/fs/cgroup/parent/memory.max": `${3072 * MiB}`,
        "/sys/fs/cgroup/parent/memory.current": `${2048 * MiB}`,
        "/sys/fs/cgroup/parent/child/cpu.max": "max 100000",
        "/sys/fs/cgroup/parent/cpu.max": "150000 100000"
      }, expected: { memoryLimitBytes: 3072 * MiB, availableMemoryBytes: 1024 * MiB, effectiveCpuCount: 1.5 }
    },
    {
      name: "cgroup v1", files: {
        "/proc/self/cgroup": "1:memory:/job\n2:cpu,cpuacct:/job\n",
        "/proc/self/mountinfo": "1 0 0:1 / /cg/memory rw - cgroup memory rw,memory\n2 0 0:2 / /cg/cpu rw - cgroup cpu rw,cpu,cpuacct\n",
        "/cg/memory/job/memory.limit_in_bytes": `${2048 * MiB}`,
        "/cg/memory/job/memory.usage_in_bytes": `${256 * MiB}`,
        "/cg/cpu/job/cpu.cfs_quota_us": "50000",
        "/cg/cpu/job/cpu.cfs_period_us": "100000"
      }, expected: { memoryLimitBytes: 2048 * MiB, availableMemoryBytes: 1792 * MiB, effectiveCpuCount: 0.5 }
    },
    {
      name: "namespaced cgroup", files: {
        "/proc/self/cgroup": "0::/\n",
        "/proc/self/mountinfo": "1 0 0:1 /host/job /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
        "/sys/fs/cgroup/memory.max": `${2048 * MiB}`,
        "/sys/fs/cgroup/memory.current": `${256 * MiB}`,
        "/sys/fs/cgroup/cpu.max": "100000 100000"
      }, expected: { memoryLimitBytes: 2048 * MiB, availableMemoryBytes: 1792 * MiB, effectiveCpuCount: 1 }
    },
    { name: "OS fallback", expected: { memoryLimitBytes: 8192 * MiB, availableMemoryBytes: 7000 * MiB, effectiveCpuCount: 8 } }
  ];
  for (const { name, files, expected } of cases) {
    const detected = await detectHostResources({
      read: async (path) => { if (!files) throw new Error("no Linux resource files"); return files[path] || ""; },
      totalMemoryBytes: 8192 * MiB, freeMemoryBytes: 7000 * MiB, cpuCount: 8
    });
    for (const [key, value] of Object.entries(expected)) assert.equal(detected[key], value, `${name}: ${key}`);
  }
});
