import { AsyncLocalStorage } from "node:async_hooks";

const toolContext = new AsyncLocalStorage();

export function runAgentToolCall(operation) {
  return toolContext.run(true, operation);
}

export function runOutsideAgentToolCall(operation) {
  return toolContext.exit(operation);
}

export function assertAgentTurnNotNested() {
  if (!toolContext.getStore()) return;
  const error = new Error("Agent 工具不能同步启动另一轮模型；请使用 /AI任务 后台，强制执行可另加“强制”。");
  error.code = "CODEX_NESTED_TURN_BLOCKED";
  throw error;
}
