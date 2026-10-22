#!/usr/bin/env node
import { detectHostResources } from "../src/infrastructure/host-resources.js";
import { planResourceProfile, resourceProfileShellValues } from "../src/config/resource-profile.js";

try {
  const env = process.env;
  const facts = await detectHostResources();
  const plan = planResourceProfile(facts, {
    profile: String(env.CODEX_REMOTE_CONTACT_RESOURCE_PROFILE || env.NCC_RESOURCE_PROFILE || "auto").toLowerCase(),
    standardMb: Number(env.NCC_MEMORY_STANDARD_MB || 3600),
    balancedMb: Number(env.NCC_MEMORY_BALANCED_MB || 1800),
    minimumMb: Number(env.NCC_MEMORY_MINIMUM_MB || 1024)
  });
  if (process.argv.includes("--shell")) {
    for (const [key, value] of Object.entries(resourceProfileShellValues(plan))) console.log(`${key}=${value}`);
  } else if (process.argv.includes("--json")) console.log(JSON.stringify({ ...plan, facts }, null, 2));
  else {
    console.log(`启动资源检测：可用 ${plan.availableMb} / ${plan.totalMb} MiB，CPU 配额 ${plan.cpu}，保留 ${plan.reserveMb} MiB，采用 ${plan.profile} 档。`);
    console.log(`Hub 堆 ${plan.hubHeapMb} MiB，模型并发 ${plan.agentConcurrency} / 排队 ${plan.agentPending}，OneBot 并发 ${plan.oneBotConcurrency}，图片 ${plan.imageMaxBytes / 1024 / 1024} MiB，压缩最长边 ${plan.compressedImageMaxEdge}px。`);
  }
} catch (error) {
  console.error(`启动资源检测失败：${error.message}`);
  process.exitCode = 1;
}
