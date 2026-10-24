const MiB = 1024 * 1024;
// Log reads go through fixed-size chunks, so retained log files cost disk,
// not heap; the counts keep a few days of history on a busy group.
const presets = {
  standard: { hubHeapMb: 384, qqHeapMb: 512, rendererLimit: 2, agentConcurrency: 2, agentPending: 24, oneBotConcurrency: 8, oneBotPending: 32, logBytes: 5 * MiB, logFiles: 8, threads: 4, arenas: 2, screen: "1280x720x24" },
  balanced: { hubHeapMb: 256, qqHeapMb: 384, rendererLimit: 1, agentConcurrency: 1, agentPending: 12, oneBotConcurrency: 4, oneBotPending: 16, logBytes: 3 * MiB, logFiles: 8, threads: 2, arenas: 2, screen: "960x540x24" },
  low: { hubHeapMb: 192, qqHeapMb: 256, rendererLimit: 1, agentConcurrency: 1, agentPending: 6, oneBotConcurrency: 2, oneBotPending: 8, logBytes: 2 * MiB, logFiles: 6, threads: 2, arenas: 1, screen: "800x600x24" }
};

export function planResourceProfile(facts, {
  profile = "auto", standardMb = 3600, balancedMb = 1800, minimumMb = 1024
} = {}) {
  if (![standardMb, balancedMb, minimumMb].every((value) => Number.isInteger(value) && value > 0)
    || standardMb <= balancedMb || balancedMb <= minimumMb) throw new Error("内存阈值必须满足：标准档 > 均衡档 > 最低启动值 > 0。");
  const availableMb = Math.max(0, Math.floor(facts.availableMemoryBytes / MiB));
  const totalMb = Math.floor(Math.min(facts.totalMemoryBytes, facts.memoryLimitBytes) / MiB);
  const cpu = Math.max(0.01, facts.effectiveCpuCount);
  const aliases = { normal: "standard", medium: "balanced", minimal: "low" };
  const requested = aliases[profile] || profile;
  if (!["auto", ...Object.keys(presets)].includes(requested)) throw new Error("资源档位只能是 auto、standard、balanced 或 low。");
  if (requested === "auto" && availableMb < minimumMb) throw new Error(`当前可用内存 ${availableMb} MiB，低于安全启动值 ${minimumMb} MiB。`);
  const selected = requested === "auto" ? availableMb >= standardMb ? "standard" : availableMb >= balancedMb ? "balanced" : "low" : requested;
  const plan = { ...presets[selected] };
  // Keep physical headroom; swap does not count as fast application memory.
  const reserveMb = Math.max(256, Math.min(2048, Math.ceil(totalMb * 0.15), Math.floor(availableMb / 4)));
  const budgetMb = Math.max(0, availableMb - reserveMb);
  if (requested === "auto") {
    plan.hubHeapMb = clamp(Math.floor(budgetMb / 8 / 32) * 32, 192, 1024);
    const sharedMb = plan.qqHeapMb + 192 + plan.hubHeapMb;
    const memoryConcurrency = Math.floor((budgetMb - sharedMb) / 512);
    if (memoryConcurrency < 1) throw new Error(`当前可用内存 ${availableMb} MiB，预留系统和 QQ/Hub 后不足以启动一个模型进程。`);
    plan.agentConcurrency = clamp(Math.min(Math.floor(cpu / 2), memoryConcurrency), 1, 8);
    plan.agentPending = Math.max(6, plan.agentConcurrency * 8);
    plan.oneBotConcurrency = clamp(Math.min(Math.floor(cpu * 2), Math.floor(budgetMb / 384)), 2, 32);
    plan.oneBotPending = plan.oneBotConcurrency * 4;
    plan.rendererLimit = cpu < 2 ? 1 : plan.rendererLimit;
    plan.threads = clamp(Math.ceil(cpu / 2), 2, 8);
  }
  plan.imageMaxBytes = clamp(Math.floor(plan.hubHeapMb / 24), 4, 20) * MiB;
  plan.compressedImageMaxEdge = plan.hubHeapMb < 256 ? 1280 : plan.hubHeapMb < 512 ? 1600 : 2048;
  return { profile: selected, requested, availableMb, totalMb, cpu, reserveMb, budgetMb, ...plan };
}

export function resourceProfileShellValues(plan) {
  return {
    NCC_ACTIVE_RESOURCE_PROFILE: plan.profile, NCC_MEM_AVAILABLE_MB: plan.availableMb,
    NCC_MEM_TOTAL_MB: plan.totalMb, NCC_EFFECTIVE_CPUS: plan.cpu, NCC_MEMORY_RESERVE_MB: plan.reserveMb,
    NCC_HUB_HEAP_MB: plan.hubHeapMb, NCC_CODEX_MAX_CONCURRENCY: plan.agentConcurrency,
    NCC_CODEX_MAX_PENDING: plan.agentPending, NCC_ONEBOT_MAX_CONCURRENCY: plan.oneBotConcurrency,
    NCC_ONEBOT_MAX_PENDING: plan.oneBotPending, NCC_LOG_MAX_BYTES: plan.logBytes,
    NCC_LOG_MAX_FILES: plan.logFiles, NCC_UV_THREADPOOL_SIZE: plan.threads, NCC_MALLOC_ARENA_MAX: plan.arenas,
    NCC_QQ_HEAP_MB: plan.qqHeapMb, NCC_QQ_RENDERER_LIMIT: plan.rendererLimit, NCC_XVFB_SCREEN_SPEC: plan.screen,
    NCC_IMAGE_MAX_BYTES: plan.imageMaxBytes, NCC_COMPRESSED_IMAGE_MAX_EDGE: plan.compressedImageMaxEdge
  };
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
