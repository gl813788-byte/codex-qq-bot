// Turns one agent tool call into a short Chinese line that says what the Bot
// actually did, for the terminal log viewer and the dashboard:
//   发消息「突然mua 吓我一跳」「刚问完又来这套」  →  已送达 2 条
//   读文件 src/server.js 第 120 行起 40 行  →  完成
// Both engines' native tools (Codex items, Claude Code tool calls) and the
// Hub's QQ tools are described here, so the two engines read the same.
//
// Privacy rules kept from the per-tool logs (never weaken them here):
// - qq_runtime.host_command: no command body, reason or output;
// - chat history/archive/memory searches: no search terms, no message text;
// - language habits and persona edits: kind/field/op only, never the term;
// - results that carry chat material are summarized as counts.
// Only the Bot's own visible words (qq_chat.send, its posts) are quoted.

const MAX_QUOTE = 40;
const MAX_TARGET = 120;

function clip(value, max = MAX_QUOTE) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

function quote(value, max = MAX_QUOTE) {
  const text = clip(value, max);
  return text ? `「${text}」` : "";
}

function textLength(value) {
  return [...String(value ?? "").trim()].length;
}

function join(parts, separator = " ") {
  return parts.filter((part) => part != null && part !== "").join(separator);
}

function firstLine(value, max = 80) {
  return clip(String(value ?? "").split(/\r?\n/).find((line) => line.trim()) || "", max);
}

function countLines(value) {
  return String(value ?? "").split(/\r?\n/).filter((line) => line.trim()).length;
}

function idOrSelector(args = {}) {
  return join([args.selector, args.userId ? `QQ ${args.userId}` : "", args.id, args.target, args.scopeId], " ");
}

function urlHost(value) {
  try {
    return new URL(String(value)).host;
  } catch {
    return "";
  }
}

function fileName(value) {
  const text = String(value || "").trim();
  return text ? text.split("/").filter(Boolean).pop() || text : "";
}

// A search that might carry private chat terms is shown as "按关键词"
// without the words; ranges such as 最近 50 or 20-40 are not private.
function historyQuery(query) {
  const text = String(query || "").trim();
  if (!text) return "";
  if (/^(?:最近\s*\d{1,4}|\d{1,5}\s*-\s*\d{1,5}|\d{1,4})$/.test(text)) return text;
  return "按关键词搜索（关键词不记录）";
}

function resultSize(resultText) {
  const lines = countLines(resultText);
  const chars = textLength(resultText);
  if (!chars) return "";
  return lines > 1 ? `返回 ${lines} 行` : `返回 ${chars} 字`;
}

const MEMORY_FIELD_LABELS = Object.freeze({
  scopeImpressionSummary: "群/会话印象",
  scopeImpressionDetail: "群/会话印象",
  personImpressionSummary: "人物印象",
  personImpressionDetail: "人物印象",
  botThoughtSummary: "自己的想法",
  botThoughtDetail: "自己的想法"
});

const ACTION_LABELS = Object.freeze({
  list: "列出", search: "搜索", detail: "详情", add: "添加", force_add: "强制添加", overwrite: "覆盖", stale: "标记过时",
  delete: "删除", read: "读取", write: "写入", titles: "列标题", slang: "黑话", inspect: "查看", record: "记录", use: "取出",
  select: "展开", upsert: "记录", replace: "替换", mark_human: "标记为真人", remove: "移除", rename: "改名",
  attach: "加配图", caption: "改说明", download: "下载", files: "群文件", image: "看图", use_image: "取出图片",
  watch: "看", listen: "听", analyze: "分析语气", popular: "热门", info: "信息", spawn: "开子代理", status: "状态",
  message: "补充说明", cancel: "取消", adopt: "采用", drop: "放弃", view: "查看", adjust: "调整", label: "标注",
  favorite: "收藏", current: "当前会话", clear: "清除", send: "发送", member: "群成员资料", group: "群资料",
  notices: "群公告", essence: "精华消息", react: "贴表情", recallable: "可撤回列表", recall: "撤回", music: "音乐卡片",
  bilibili: "B站卡片", forward: "聊天记录卡片", dice: "骰子", rps: "猜拳", contact: "名片", poke: "拍一拍", like: "点赞",
  requests: "申请列表", join_group: "加群", add_friend: "加好友", qzone_recent: "看空间动态", qzone_publish: "发说说",
  qzone_comment: "评论说说", ban: "禁言", unban: "解除禁言", group_admin: "群管理"
});

function actionLabel(action) {
  const value = String(action || "").trim();
  return ACTION_LABELS[value] || value;
}

// Each entry: (args, result) => { verb, target, outcome? }. result is
// { ok, text, error }. A missing outcome falls back to 完成/失败 plus size.
const QQ_TOOL_DESCRIBERS = Object.freeze({
  "qq_chat.send": (args, result) => {
    const bubbles = (Array.isArray(args.bubbles) ? args.bubbles : typeof args.bubbles === "string" ? [args.bubbles] : [])
      .map((bubble) => String(bubble ?? "").trim())
      .filter(Boolean);
    if (!bubbles.length && typeof args.text === "string" && args.text.trim()) bubbles.push(args.text.trim());
    const attachments = Array.isArray(args.attachments) ? args.attachments.filter((item) => item?.path) : [];
    const mode = args.reply?.mode && args.reply.mode !== "automatic"
      ? `${{ plain: "不引用", quote: "引用", mention: "@" }[args.reply.mode] || args.reply.mode}${args.reply.targetUserId ? ` ${args.reply.targetUserId}` : ""}`
      : "";
    const target = join([
      bubbles.slice(0, 4).map((bubble) => quote(bubble)).join(""),
      bubbles.length > 4 ? `等 ${bubbles.length} 条` : "",
      args.sticker ? `表情包 ${clip(args.sticker, 20)}` : "",
      attachments.length ? `附件 ${attachments.map((item) => fileName(item.path)).slice(0, 3).join("、")}` : "",
      mode ? `（${mode}）` : ""
    ]);
    const delivered = String(result.text || "").match(/(?:已送达|送达) (\d+) 条/);
    const failed = String(result.text || "").match(/失败 (\d+) 条/);
    return {
      verb: "发消息",
      target,
      outcome: result.ok
        ? delivered ? `已送达 ${delivered[1]} 条${failed ? `，失败 ${failed[1]} 条` : ""}` : "已送达"
        : `没发出：${firstLine(result.error || result.text, 60)}`
    };
  },
  "qq_context.history": (args, result) => ({
    verb: "读聊天记录",
    target: join([
      historyQuery(args.query),
      args.userId ? `找 QQ ${args.userId} 的消息` : "",
      args.sessions ? `指定会话 ${String(args.sessions).split(",").filter(Boolean).length} 个` : ""
    ]),
    outcome: result.ok ? resultSize(result.text) : null
  }),
  "qq_context.archive": (args, result) => ({
    verb: { read: "翻服务器历史", files: "看群文件", download: "下载历史文件", image: "看历史图片", use_image: "取出历史图片" }[args.action] || "翻服务器历史",
    target: join([
      args.action === "read" ? join([args.before ? "继续往前" : "从最新开始", args.count ? `${args.count} 条` : ""]) : "",
      args.query ? "按关键词搜索（关键词不记录）" : "",
      args.userId ? `QQ ${args.userId}` : "",
      args.folder ? `文件夹 ${args.folder}` : "",
      args.selector || "",
      args.mode === "compressed" ? "压缩预览" : ""
    ]),
    outcome: result.ok && ["read", "files"].includes(args.action || "read") ? resultSize(result.text) : null
  }),
  "qq_context.download_file": (args) => ({ verb: "下载本轮文件", target: args.selector || "" }),
  "qq_context.images": (args) => ({
    verb: { list: "列图片目录", inspect: "看图", use: "取出图片" }[args.action] || "看图",
    target: join([args.selector, args.mode === "compressed" ? "压缩预览" : "", args.offset ? `从第 ${args.offset} 张` : ""])
  }),
  "qq_context.lookup": (args, result) => ({
    verb: `查${actionLabel(args.action) || "资料"}`,
    target: args.userId ? `QQ ${args.userId}` : "",
    outcome: result.ok ? resultSize(result.text) : null
  }),
  "qq_memory.short_term": (args, result) => ({
    verb: `短期记忆·${actionLabel(args.action) || "查看"}`,
    target: args.value ? `（内容 ${textLength(args.value)} 字，不记录）` : "",
    outcome: result.ok && ["list", "search", "detail"].includes(args.action) ? resultSize(result.text) : null
  }),
  "qq_memory.impression": (args) => ({
    verb: "记下印象",
    target: [...new Set(Object.keys(args || {}).filter((key) => String(args[key] ?? "").trim()).map((key) => MEMORY_FIELD_LABELS[key]).filter(Boolean))].join("、")
  }),
  "qq_memory.avatar": (args) => ({ verb: `头像·${actionLabel(args.action) || "查看"}`, target: args.userId ? `QQ ${args.userId}` : args.query ? "按描述搜索" : "" }),
  "qq_memory.robot_profile": (args) => ({
    verb: `机器人资料·${actionLabel(args.action) || "查看"}`,
    target: join([args.userId ? `QQ ${args.userId}` : "", Array.isArray(args.commands) && args.commands.length ? `${args.commands.length} 条指令` : ""])
  }),
  "qq_memory.person_detail": (args) => ({ verb: "看人物档案", target: args.userId ? `QQ ${args.userId}` : "" }),
  "qq_memory.person_alias": (args) => ({
    verb: `别称·${actionLabel(args.action) || "查看"}`,
    target: join([args.userId ? `QQ ${args.userId}` : "", args.alias ? quote(args.alias, 16) : "", args.replacement ? `→ ${quote(args.replacement, 16)}` : ""])
  }),
  "qq_knowledge.manage": (args, result) => ({
    verb: `知识库·${actionLabel(args.action) || "查看"}`,
    target: join([args.title ? `《${clip(args.title, 30)}》` : "", args.scope ? `范围 ${args.scope}` : "", args.content ? `正文 ${textLength(args.content)} 字` : ""]),
    outcome: result.ok && ["titles", "search", "read"].includes(args.action) ? resultSize(result.text) : null
  }),
  "qq_knowledge.image": (args) => ({
    verb: `知识配图·${actionLabel(args.action) || "查看"}`,
    target: join([args.title ? `《${clip(args.title, 30)}》` : "", args.selector, args.imageId])
  }),
  "qq_search.chinese_web": (args, result) => ({
    verb: "中文网页搜索",
    target: quote(args.query, 60),
    outcome: result.ok ? resultSize(result.text) : null
  }),
  "qq_search.images": (args) => ({
    verb: args.action === "download" ? "下载网络图片" : "搜网络图片",
    target: args.action === "download" ? args.selector || "" : quote(args.query, 40)
  }),
  "qq_media.parse": (args) => ({ verb: "解析分享内容", target: mediaSource(args) }),
  "qq_media.video": (args) => ({
    verb: args.action === "list" ? "列可看的视频" : "看视频",
    target: join([mediaSource(args), timeRange(args)])
  }),
  "qq_media.audio": (args) => ({
    verb: { list: "列可听的语音", listen: "听语音", analyze: "分析语气" }[args.action] || "听语音",
    target: mediaSource(args)
  }),
  "qq_media.music": (args) => ({
    verb: { list: "列可听的歌", search: "搜歌", listen: "听歌" }[args.action] || "听歌",
    target: join([args.action === "search" ? quote(args.query, 30) : mediaSource(args), args.byLyrics ? "按歌词" : "", args.platform, timeRange(args)])
  }),
  "qq_media.bilibili": (args) => ({
    verb: `逛 B站·${actionLabel(args.action) || "热门"}`,
    target: join([args.query ? quote(args.query, 30) : "", args.selector, args.url ? urlHost(args.url) : ""])
  }),
  "qq_social.act": (args, result) => ({
    verb: actionLabel(args.action) || "社交动作",
    target: join([
      args.target ? clip(args.target, 30) : "",
      ["qzone_publish", "qzone_comment"].includes(args.action) ? quote(args.value, 40) : args.value && textLength(args.value) <= 20 ? clip(args.value, 20) : ""
    ]),
    outcome: result.ok && !["requests", "qzone_recent"].includes(args.action) ? firstLine(result.text, 60) : null
  }),
  "qq_message.act": (args, result) => ({
    verb: actionLabel(args.action) || "消息动作",
    target: join([
      args.target ? (args.target === "quoted" ? "被引用的消息" : args.target === "current" ? "这条消息" : clip(args.target, 20)) : "",
      args.emoji ? clip(args.emoji, 12) : "",
      args.index ? `第 ${args.index} 条` : "",
      args.title ? quote(args.title, 30) : args.query ? quote(args.query, 30) : "",
      args.selector || "",
      args.url ? urlHost(args.url) : "",
      Array.isArray(args.items) && args.items.length ? `${args.items.length} 段` : ""
    ]),
    outcome: result.ok && args.action !== "recallable" ? firstLine(result.text, 60) : null
  }),
  "qq_agent.manage": (args, result) => ({
    verb: `子代理·${actionLabel(args.action) || "查看"}`,
    target: join([args.title ? quote(args.title, 30) : "", args.id || "", args.task ? `任务 ${textLength(args.task)} 字` : ""]),
    outcome: result.ok && ["spawn", "cancel", "message"].includes(args.action) ? firstLine(result.text, 60) : null
  }),
  "qq_self.state": () => ({ verb: "看自己的状态", target: "" }),
  "qq_self.language_habit": (args) => ({
    verb: `语言习惯·${actionLabel(args.action) || "查看"}`,
    target: join([args.kind, args.scope === "global" ? "全局" : args.scope ? "本会话" : "", args.onBehalfOfOwner ? "替主人改" : ""])
  }),
  "qq_self.persona": (args) => ({
    verb: `人设·${actionLabel(args.action) || "查看"}`,
    target: join([args.field, args.key, args.op, args.onBehalfOfOwner ? "替主人改" : ""])
  }),
  "qq_sticker.manage": (args, result) => ({
    verb: `表情包·${actionLabel(args.action) || "搜索"}`,
    target: args.action === "search" || !args.action ? quote(args.query, 30) : args.selector || "",
    outcome: result.ok && (args.action === "search" || !args.action)
      ? (() => {
        const refs = String(result.text || "").match(/#\d+/g) || [];
        return refs.length ? `找到 ${new Set(refs).size} 张` : resultSize(result.text);
      })()
      : null
  }),
  "qq_session.manage": (args, result) => ({
    verb: `跨会话·${actionLabel(args.action) || "查看"}`,
    target: join([args.scopeId, args.action === "send" ? quote(args.value, 40) : ""]),
    outcome: result.ok && ["select", "clear", "send"].includes(args.action) ? firstLine(result.text, 60) : result.ok ? resultSize(result.text) : null
  }),
  "qq_runtime.configure": (args, result) => ({
    verb: "改 Hub 设置",
    // Only the command word; its arguments can carry keys.
    target: String(args.command || "").trim().split(/\s+/)[0] || "",
    outcome: result.ok ? firstLine(result.text, 60) : null
  }),
  "qq_runtime.summarize": (args) => ({ verb: "加载历史做总结", target: args.range ? clip(args.range, 20) : "" }),
  "qq_runtime.host_command": (args, result) => {
    const exit = String(result.text || result.error || "").match(/(?:退出码|exit(?: code)?)[：:\s]*(-?\d+)/i);
    return {
      verb: "执行本机命令",
      target: "（命令内容按安全规则不记录）",
      outcome: exit ? `退出码 ${exit[1]}` : null
    };
  },
  "qq_draw.image": (args, result) => {
    const refs = Array.isArray(args.references) ? args.references.filter(Boolean).length : 0;
    const saved = String(result.text || "").match(/\/[^\s，。；]+\.(?:png|jpe?g|webp)/i);
    return {
      verb: "画图（Codex 代画）",
      target: join([quote(args.prompt, 60), refs ? `参考图 ${refs} 张` : ""]),
      outcome: result.ok ? saved ? `已画好 ${fileName(saved[0])}` : "已画好" : null
    };
  }
});

function mediaSource(args = {}) {
  if (args.selector) return String(args.selector);
  if (args.url) return urlHost(args.url) || "链接";
  if (args.path) return fileName(args.path);
  return "";
}

function timeRange(args = {}) {
  return args.from || args.to ? `${args.from || "开头"}~${args.to || "结尾"}` : "";
}

function fallbackOutcome(result) {
  if (!result.ok) return `失败：${firstLine(result.error || result.text, 80) || "未知错误"}`;
  return "完成";
}

// call: { namespace, tool, arguments }; result: { ok, text, error }.
// Returns { label, verb, target, outcome, line }.
export function describeQqToolActivity(call = {}, result = {}) {
  const namespace = String(call.namespace || "").trim();
  const tool = String(call.tool || "").trim();
  const label = namespace ? `${namespace}.${tool}` : tool;
  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const normalized = { ok: result.ok !== false, text: String(result.text ?? ""), error: String(result.error ?? "") };
  const describer = QQ_TOOL_DESCRIBERS[label];
  let described;
  try {
    described = describer
      ? describer(args, normalized)
      : { verb: label || "QQ 工具", target: join([args.action ? actionLabel(args.action) : "", idOrSelector(args)]) };
  } catch {
    described = { verb: label || "QQ 工具", target: "" };
  }
  const outcome = !normalized.ok
    ? described.outcome && /没发出|失败/.test(described.outcome) ? described.outcome : fallbackOutcome(normalized)
    : described.outcome || fallbackOutcome(normalized);
  return finish({ label, verb: described.verb, target: clip(described.target, MAX_TARGET * 2), outcome });
}

function finish({ label, verb, target, outcome }) {
  return {
    label,
    verb: verb || label,
    target: target || "",
    outcome: outcome || "",
    line: join([verb || label, target], " ")
  };
}

// Native engine tools. Returns null for items that are not tool calls
// (messages, reasoning) and for QQ tools, which the Hub's dispatcher logs
// with their results.
export function describeNativeAgentItem(item = {}, { cwd = "" } = {}) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "claudeToolCall") return describeClaudeTool(item, { cwd });
  switch (item.type) {
    case "commandExecution": {
      const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
      return finish({
        label: "shell",
        verb: "运行命令",
        target: quoteCommand(unwrapShellCommand(item.command)),
        outcome: item.status === "declined" ? "被拒绝"
          : exitCode == null ? statusText(item.status)
            : exitCode === 0 ? "退出码 0" : `失败，退出码 ${exitCode}`
      });
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const kinds = { add: "新建", delete: "删除", update: "修改" };
      return finish({
        label: "apply_patch",
        verb: "改文件",
        target: changes.slice(0, 4).map((change) => {
          const kind = kinds[change?.kind?.type || change?.kind] || "修改";
          return `${kind} ${relativePath(change?.path, cwd)}`;
        }).join("、") + (changes.length > 4 ? ` 等 ${changes.length} 个` : ""),
        outcome: statusText(item.status)
      });
    }
    case "webSearch":
      return finish({ label: "web_search", verb: "联网搜索", target: quote(item.query || item.action?.query, 60), outcome: "完成" });
    case "imageGeneration":
      return finish({
        label: "image_generation",
        verb: "画图",
        target: quote(item.revisedPrompt, 60),
        outcome: item.savedPath ? `已保存 ${fileName(item.savedPath)}` : statusText(item.status)
      });
    case "imageView":
      return finish({ label: "view_image", verb: "看图", target: relativePath(item.path, cwd), outcome: "完成" });
    case "mcpToolCall": {
      if (item.server === "qq") return null;
      return finish({
        label: `${item.server || "mcp"}.${item.tool || ""}`,
        verb: "MCP 工具",
        target: `${item.server || "mcp"}.${item.tool || ""}`,
        outcome: item.error ? `失败：${firstLine(item.error?.message || item.error, 60)}` : statusText(item.status)
      });
    }
    case "contextCompaction":
      return finish({ label: "compaction", verb: "压缩上下文", target: "", outcome: "完成" });
    default:
      return null;
  }
}

function describeClaudeTool(item, { cwd }) {
  const tool = String(item.tool || "");
  // QQ tools arrive through the Hub dispatcher, which logs them itself.
  if (tool.startsWith("mcp__qq__")) return null;
  const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
  const outcome = item.ok === false
    ? `失败${tool === "Bash" || !item.errorText ? "" : `：${firstLine(item.errorText, 60)}`}`
    : item.ok === true ? "完成" : "";
  switch (tool) {
    case "Read":
      return finish({
        label: tool,
        verb: "读文件",
        target: join([relativePath(args.file_path, cwd), args.offset ? `第 ${args.offset} 行起` : "", args.limit ? `${args.limit} 行` : ""]),
        outcome
      });
    case "Write":
      return finish({ label: tool, verb: "写文件", target: join([relativePath(args.file_path, cwd), args.content ? `${countLines(args.content)} 行` : ""]), outcome });
    case "Edit":
    case "MultiEdit":
      return finish({ label: tool, verb: "改文件", target: relativePath(args.file_path, cwd), outcome });
    case "Glob":
      return finish({ label: tool, verb: "找文件", target: join([quote(args.pattern, 50), args.path ? `在 ${relativePath(args.path, cwd)}` : ""]), outcome });
    case "Grep":
      return finish({
        label: tool,
        verb: "搜文件内容",
        target: join([quote(args.pattern, 50), args.path ? `在 ${relativePath(args.path, cwd)}` : "", args.glob ? `(${args.glob})` : ""]),
        outcome
      });
    case "Bash":
      return finish({ label: tool, verb: "运行命令", target: join([quoteCommand(args.command), args.description ? `（${clip(args.description, 30)}）` : ""]), outcome });
    case "WebSearch":
      return finish({ label: tool, verb: "联网搜索", target: quote(args.query, 60), outcome });
    case "WebFetch":
      return finish({ label: tool, verb: "打开网页", target: urlHost(args.url) || clip(args.url, 60), outcome });
    case "ToolSearch":
      return finish({ label: tool, verb: "加载工具定义", target: describeToolSearchQuery(args.query), outcome });
    case "TodoWrite":
      return finish({ label: tool, verb: "更新计划", target: Array.isArray(args.todos) ? `${args.todos.length} 项` : "", outcome });
    case "Task":
    case "Agent":
      return finish({ label: tool, verb: "派子任务", target: quote(args.description, 40), outcome });
    default:
      return finish({ label: tool, verb: tool.startsWith("mcp__") ? "MCP 工具" : tool, target: tool.startsWith("mcp__") ? tool.slice(5).replace(/__/g, ".") : "", outcome });
  }
}

// "select:mcp__qq__qq_sticker__manage,mcp__qq__qq_media__music" → qq_sticker.manage、qq_media.music
function describeToolSearchQuery(query) {
  const text = String(query || "").trim();
  if (/^select:/i.test(text)) {
    return text.slice(7).split(",").map((name) => toQqToolLabel(name.trim())).filter(Boolean).join("、");
  }
  return quote(text, 40);
}

// mcp__qq__qq_sticker__manage → qq_sticker.manage; other names unchanged.
export function toQqToolLabel(name) {
  const text = String(name || "").trim();
  const match = text.match(/^(?:mcp__qq__)?(qq_[a-z]+)__([a-z_]+)$/i);
  return match ? `${match[1]}.${match[2]}` : text;
}

function unwrapShellCommand(command) {
  const parts = Array.isArray(command) ? command.map(String) : null;
  if (parts && parts.length >= 3 && /(?:^|\/)(?:ba|z)?sh$/.test(parts[0]) && /^-l?c$/.test(parts[1])) return parts.slice(2).join(" ");
  const text = parts ? parts.join(" ") : String(command || "");
  const wrapped = text.match(/^(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return wrapped ? wrapped[2] : text;
}

function quoteCommand(command) {
  const text = clip(command, 160);
  return text ? `\`${text}\`` : "";
}

function relativePath(path, cwd) {
  const text = String(path || "").trim();
  if (!text) return "";
  const root = String(cwd || "").replace(/\/+$/, "");
  if (root && text.startsWith(`${root}/`)) return text.slice(root.length + 1);
  return text;
}

function statusText(status) {
  return {
    completed: "完成",
    failed: "失败",
    declined: "被拒绝",
    inProgress: "进行中",
    in_progress: "进行中"
  }[String(status || "")] || (status ? String(status) : "");
}

// The tool steps of one finished turn, in order, folding repeats:
// "ToolSearch → qq_sticker.manage → qq_chat.send ×2". QQ tools are named by
// their QQ label; Codex/Claude native tools by their own name.
export function summarizeAgentTurnTools(items = [], { maxSteps = 16 } = {}) {
  const labels = [];
  for (const item of Array.isArray(items) ? items : []) {
    const label = turnItemLabel(item);
    if (label) labels.push(label);
  }
  const steps = [];
  for (const label of labels) {
    const last = steps.at(-1);
    if (last?.label === label) last.count += 1;
    else steps.push({ label, count: 1 });
  }
  const shown = steps.slice(0, maxSteps).map((step) => (step.count > 1 ? `${step.label} ×${step.count}` : step.label));
  if (steps.length > maxSteps) shown.push(`…还有 ${steps.length - maxSteps} 步`);
  return { toolCallCount: labels.length, toolSteps: shown.join(" → ") };
}

function turnItemLabel(item) {
  if (!item || typeof item !== "object") return "";
  switch (item.type) {
    case "claudeToolCall":
      return toQqToolLabel(item.tool);
    case "dynamicToolCall":
      return item.namespace ? `${item.namespace}.${item.tool}` : String(item.tool || "dynamic_tool");
    case "mcpToolCall":
      return item.server === "qq" ? toQqToolLabel(item.tool) : `${item.server || "mcp"}.${item.tool || ""}`;
    case "commandExecution":
      return "shell";
    case "fileChange":
      return "apply_patch";
    case "webSearch":
      return "web_search";
    case "imageGeneration":
      return "image_generation";
    case "imageView":
      return "view_image";
    default:
      return "";
  }
}
