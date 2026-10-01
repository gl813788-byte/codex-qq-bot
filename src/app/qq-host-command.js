import { isAbsolute } from "node:path";
import { runProcess } from "../process-runner.js";
import { baseAgentRuntimeEnvKeys, pickAgentChildEnv } from "../infrastructure/agent/agent-child-env.js";

// An explicit tool invocation requests host access for exactly one command.
// Authority comes from the authenticated triggering event, never tool arguments,
// a selected QQ conversation, or the model's description of the speaker.
export async function executeQqHostCommand(args, {
  event,
  projectDir,
  signal,
  baseEnv = process.env,
  execute = runProcess
} = {}) {
  if (event?.isOwner !== true || !event.senderId) {
    return { ok: false, error: event?.isBotAdmin
      ? "本机提权仅向已验证主人开放。Bot 管理员请使用项目范围内的原生文件能力；不能通过确认或自称主人获取本机权限。"
      : "当前发送者不是已验证主人，不能申请本机执行权限。" };
  }
  if (event.qqPrivateProactive || event.qqColdProactive || event.proactiveDecision?.proactive) {
    return { ok: false, error: "主动聊天不能申请本机执行权限；需要主人直接提出任务。" };
  }
  const command = typeof args?.command === "string" ? args.command.trim() : "";
  const reason = typeof args?.reason === "string" ? args.reason.trim() : "";
  const cwd = args?.cwd || projectDir;
  if (!command || command.length > 16_000 || command.includes("\0") || !reason || reason.length > 1_000) {
    return { ok: false, error: "申请必须包含有界的 command 和具体提权理由 reason。" };
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0")) {
    return { ok: false, error: "cwd 必须是本机绝对目录。" };
  }
  const requestedTimeout = Number(args?.timeoutMs ?? 30_000);
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    return { ok: false, error: "timeoutMs 必须是正数。" };
  }
  // Do not inherit Hub/provider credentials or execute interactive shell profiles.
  const allowedKeys = new Set(baseAgentRuntimeEnvKeys.filter((key) => key !== "NODE_OPTIONS"));
  const env = pickAgentChildEnv(baseEnv, allowedKeys);
  try {
    const result = await execute("/bin/bash", ["--noprofile", "--norc", "-c", command], {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(120_000, Math.floor(requestedTimeout)),
      maxOutputBytes: 64 * 1024,
      killProcessGroup: true,
      allowFailure: true
    });
    return {
      ok: result.code === 0,
      reply: JSON.stringify({
        permission: "owner-host-command",
        exitCode: result.code,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr
      })
    };
  } catch (error) {
    return { ok: false, error: `本机命令未完成（${error?.code || "PROCESS_FAILED"}）。可能已有部分操作生效；先检查实际状态，不要盲目重试。` };
  }
}
