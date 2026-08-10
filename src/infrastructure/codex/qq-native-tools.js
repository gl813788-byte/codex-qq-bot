const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties
});

const string = (description = "") => ({ type: "string", description });

export function buildQqNativeToolSpecs({
  isOwner = false,
  toolsEnabled = true,
  hasStickerCandidates = false,
  hasMemoryPeople = false
} = {}) {
  if (!toolsEnabled) return [];
  const namespaces = [
    {
      type: "namespace",
      name: "qq_context",
      description: "Read the current QQ conversation context without asking the user to repeat it.",
      tools: [{
        type: "function",
        name: "history",
        description: "Read recent messages, a numeric range such as 20-40, or search by keyword.",
        inputSchema: objectSchema({ query: string("Examples: 最近 50, 20-40, or a keyword.") })
      }, {
        type: "function",
        name: "download_file",
        description: "Download one file explicitly detected in the current triggering QQ message or its quoted message into this turn's task input directory. Use only selectors listed in the turn context.",
        inputSchema: objectSchema({ selector: string("An exact current-turn selector such as file-1.") })
      }]
    },
    {
      type: "namespace",
      name: "qq_memory",
      description: "Read or maintain scoped short-term memory and recognized person memory.",
      tools: [
        {
          type: "function",
          name: "short_term",
          description: "Run one scoped short-term-memory operation. Prefer search before add or overwrite.",
          inputSchema: objectSchema({
            action: { type: "string", enum: ["list", "search", "detail", "add", "force_add", "overwrite", "stale", "delete"] },
            value: string("Search text, entry id, or content required by the selected action."),
            extra: string("Replacement content or stale reason when needed.")
          }, ["action"])
        },
        {
          type: "function",
          name: "impression",
          description: "Stage a meaningful update to the current scope/person social impression. It is persisted only after the final QQ reply is delivered. Do not call for routine chat or guesses.",
          inputSchema: objectSchema({
            scopeImpressionSummary: string("Short current group/private impression, or empty."),
            scopeImpressionDetail: string("Substantive scoped detail, or empty."),
            personImpressionSummary: string("Short impression of the current sender, or empty."),
            personImpressionDetail: string("Substantive current-sender detail, or empty."),
            personImpressionComplete: { type: "boolean" },
            personImpressionMemorable: { type: "boolean" },
            personImpressionPromotionReason: string("Why a stable non-sensitive profile merits unified-person promotion, or empty."),
            botThoughtSummary: string("Short Bot-side relationship thought, or empty."),
            botThoughtDetail: string("Substantive Bot-side thought, or empty.")
          }, [])
        },
        ...(hasMemoryPeople ? [{
          type: "function",
          name: "person_detail",
          description: "Read the complete AI-maintained impression for a person recognized in this turn.",
          inputSchema: objectSchema({ userId: string("A QQ number explicitly listed in this turn's person candidates.") })
        }, {
          type: "function",
          name: "person_alias",
          description: "List, add, remove, or rename an alias for a recognized QQ person.",
          inputSchema: objectSchema({
            action: { type: "string", enum: ["list", "add", "remove", "rename"] },
            userId: string("Recognized person's QQ number."),
            alias: string("Alias to add/remove, or old alias for rename."),
            replacement: string("New alias for rename; otherwise empty.")
          }, ["action", "userId"])
        }] : [])
      ]
    },
    {
      type: "namespace",
      name: "qq_knowledge",
      description: "Read and maintain reusable title-based QQ knowledge with scope isolation.",
      tools: [{
        type: "function",
        name: "manage",
        description: "List titles, search, read, add/overwrite a note, or save slang. Search before writing.",
        inputSchema: objectSchema({
          action: { type: "string", enum: ["titles", "search", "read", "write", "slang"] },
          title: string("Stable title, slang phrase, or search query."),
          content: string("Knowledge body/explanation for write/slang; otherwise empty."),
          scope: string("Allowed current scope such as group, group-member, member, or empty for inferred current scope.")
        }, ["action"])
      }]
    },
    {
      type: "namespace",
      name: "qq_search",
      description: "Chinese-web fallback for sources that native Codex Web Search cannot retrieve well.",
      tools: [{
        type: "function",
        name: "chinese_web",
        description: "Search the configured Chinese web providers. Use native Web Search first for general current facts.",
        inputSchema: objectSchema({ query: string("A specific search query.") })
      }]
    },
    {
      type: "namespace",
      name: "qq_social",
      description: "Perform real QQ actions. Never claim success unless this tool returns success.",
      tools: [{
        type: "function",
        name: "act",
        description: "Perform a bounded QQ action such as poke, like, incoming-request handling, group join, Qzone, moderation, or ban. Hub permissions remain authoritative.",
        inputSchema: objectSchema({
          action: { type: "string", enum: ["poke", "like", "requests", "join_group", "qzone_recent", "qzone_publish", "qzone_comment", "ban", "unban", "group_admin"] },
          target: string("QQ id, group id, sender, request id, or empty when the action does not need one."),
          value: string("Count, duration, verification answer, post text, comment, or subcommand details.")
        }, ["action"])
      }]
    },
    ...(hasStickerCandidates ? [{
      type: "namespace",
      name: "qq_sticker",
      description: "Inspect, label, and optionally favorite actual sticker candidates from this QQ turn.",
      tools: [{
        type: "function",
        name: "manage",
        description: "Inspect a sticker, save labels after inspection, or favorite at most one received candidate.",
        inputSchema: objectSchema({
          action: { type: "string", enum: ["inspect", "label", "favorite"] },
          selector: string("Sticker name or current candidate number."),
          tags: string("Comma-separated tags for label; otherwise empty."),
          description: string("Visual description/context for label, or frame selection for inspect.")
        }, ["action", "selector"])
      }]
    }] : []),
    ...(isOwner ? [{
      type: "namespace",
      name: "qq_session",
      description: "Privileged cross-session routing for the verified owner or a Bot administrator. List known QQ groups/private contacts, switch the active target for subsequent QQ tools, read another session, or send a real message there.",
      tools: [{
        type: "function",
        name: "manage",
        description: "Manage the cross-session focus. After select, every compatible QQ tool in this Agent turn uses that target until another select or clear. Sending is a real QQ write and requires an explicit privileged-user request.",
        inputSchema: objectSchema({
          action: { type: "string", enum: ["list", "current", "select", "clear", "read", "send"] },
          scopeId: string("Use group:GROUP_ID or private:QQ_ID; empty uses the active focus where supported."),
          value: string("List filter, history query, or message text; empty when not needed.")
        }, ["action"])
      }]
    }, {
      type: "namespace",
      name: "qq_runtime",
      description: "Privileged runtime controls for the verified owner or a Bot administrator. Changes are validated and persisted by the Hub.",
      tools: [{
        type: "function",
        name: "configure",
        description: "Inspect or change the next-turn model, reasoning effort, Codex session mode, web/interest settings, allowlist, or other existing Hub settings.",
        inputSchema: objectSchema({ command: string("An existing QQ management command without leading slash, for example 思考强度 high, 模型 2, 会话模式 长期, 详细配置.") })
      }, {
        type: "function",
        name: "summarize",
        description: "Load bounded QQ history so this same native Agent turn can summarize it. This does not start a nested model process.",
        inputSchema: objectSchema({ range: string("最近, 全部, a count, a range, or a keyword.") })
      }]
    }] : [])
  ];
  return namespaces.filter((namespace) => namespace.tools.length > 0);
}

export function createQqNativeToolDispatcher({
  executeCommand,
  executeStructured,
  event,
  maxCalls = 32,
  onToolEvent
} = {}) {
  if (typeof executeCommand !== "function") throw new TypeError("executeCommand must be a function");
  const resultsByCallId = new Map();
  let callCount = 0;
  let focusedEvent = null;
  return async function dispatch(call = {}) {
    const callId = String(call.callId || "").trim();
    if (callId && resultsByCallId.has(callId)) return resultsByCallId.get(callId);
    if (callCount >= maxCalls) {
      const result = { ok: false, error: "QQ native tool call limit reached for this turn." };
      notifyToolObserver(onToolEvent, {
        namespace: String(call.namespace || ""),
        tool: String(call.tool || ""),
        toolAction: String(call.arguments?.action || "") || null,
        callId: callId || null,
        toolRound: callCount,
        durationMs: 0,
        ok: false,
        outcome: "denied",
        errorCode: "tool_call_limit",
        sourceEvent: event,
        targetEvent: focusedEvent || event,
        result
      });
      return result;
    }
    callCount += 1;
    const toolRound = callCount;
    if (event && typeof event === "object") event.qqCurrentToolRound = toolRound;
    const boundEvent = focusedEvent || event;
    const sessionTool = call.namespace === "qq_session" && call.tool === "manage";
    const inboundFileTool = call.namespace === "qq_context" && call.tool === "download_file";
    const structured = sessionTool
      || inboundFileTool
      || (call.namespace === "qq_memory" && call.tool === "impression");
    const command = structured ? "" : mapQqNativeToolToCommand(call.namespace, call.tool, call.arguments, { event: boundEvent });
    const startedAt = Date.now();
    const promise = (async () => {
      let result;
      let errorCode = null;
      try {
        if (structured && typeof executeStructured === "function") {
          const structuredResult = await executeStructured(call, boundEvent, {
            rootEvent: event,
            focusedEvent
          });
          if (sessionTool && structuredResult?.clearFocus) focusedEvent = null;
          else if (sessionTool && structuredResult?.scopeEvent) focusedEvent = structuredResult.scopeEvent;
          result = {
            ok: structuredResult?.ok !== false,
            ...(structuredResult?.scopeId ? { scopeId: String(structuredResult.scopeId) } : {}),
            result: String(structuredResult?.reply || structuredResult?.error || "结构化工具已执行。")
          };
          if (!result.ok) errorCode = "structured_tool_failed";
        } else if (command) {
          const commandResult = await executeCommand(command, boundEvent);
          result = {
            ok: commandResult?.ok !== false,
            command,
            ...(focusedEvent?.qqCrossSessionScopeId ? { scopeId: focusedEvent.qqCrossSessionScopeId } : {}),
            result: String(commandResult?.reply || commandResult?.error || "工具已执行。")
          };
          if (!result.ok) errorCode = "command_tool_failed";
        } else {
          result = { ok: false, error: `Unknown or invalid QQ native tool: ${call.namespace || ""}.${call.tool || ""}` };
          errorCode = "unknown_tool";
        }
      } catch (error) {
        result = { ok: false, error: String(error?.message || error || "QQ native tool failed") };
        errorCode = String(error?.code || "tool_exception");
      }
      notifyToolObserver(onToolEvent, {
        namespace: String(call.namespace || ""),
        tool: String(call.tool || ""),
        toolAction: String(call.arguments?.action || "") || null,
        callId: callId || null,
        toolRound,
        durationMs: Math.max(0, Date.now() - startedAt),
        ok: result.ok !== false,
        outcome: result.ok !== false ? "success" : "failed",
        errorCode,
        sourceEvent: event,
        targetEvent: boundEvent,
        scopeId: result.scopeId || null,
        result
      });
      return result;
    })();
    if (callId) resultsByCallId.set(callId, promise);
    return promise;
  };
}

function notifyToolObserver(observer, payload) {
  if (typeof observer !== "function") return;
  try {
    Promise.resolve(observer(payload)).catch(() => null);
  } catch {
    // Tool lifecycle observers must never change the Agent result.
  }
}

export function mapQqNativeToolToCommand(namespace, tool, args = {}, { event = null } = {}) {
  const ns = String(namespace || "");
  const name = String(tool || "");
  if (ns === "qq_context" && name === "history") return `/聊天记录 ${clean(args.query || "最近 50")}`;
  if (ns === "qq_memory" && name === "person_detail") return `/人物记忆 详细 ${clean(args.userId)}`;
  if (ns === "qq_memory" && name === "person_alias") {
    const actions = { list: "列表", add: "添加", remove: "删除", rename: "修改" };
    return joinCommand("/人物别称", actions[args.action], args.userId, args.alias, args.action === "rename" ? args.replacement : "");
  }
  if (ns === "qq_memory" && name === "short_term") {
    const actions = {
      list: "列表", search: "搜索", detail: "详细", add: "添加", force_add: "强制添加",
      overwrite: "覆盖", stale: "过时", delete: "删除"
    };
    return joinCommand("/记忆", actions[args.action], args.value, args.extra);
  }
  if (ns === "qq_knowledge" && name === "manage") {
    const actions = { titles: "标题", search: "搜索", read: "查看", write: "添加", slang: "黑话" };
    const action = actions[args.action];
    if (!action) return "";
    if (args.action === "write" || args.action === "slang") {
      return `/知识库 ${action} ${clean(args.title)} | ${clean(args.content)}${args.scope ? ` | ${clean(args.scope)}` : ""}`;
    }
    return joinCommand("/知识库", action, args.title, args.scope ? `| ${args.scope}` : "");
  }
  if (ns === "qq_search" && name === "chinese_web") return `/联网 ${clean(args.query)}`;
  if (ns === "qq_sticker" && name === "manage") {
    if (args.action === "inspect") return `/看表情 ${clean(args.selector)}${args.description ? ` | ${clean(args.description)}` : ""}`;
    if (args.action === "label") return `/表情标签 ${clean(args.selector)} | ${clean(args.tags)} | ${clean(args.description)}`;
    if (args.action === "favorite") return `/收藏表情 ${clean(args.selector)}`;
  }
  if (ns === "qq_runtime" && name === "configure" && (event?.isOwner || event?.isBotAdmin)) return `/${clean(args.command).replace(/^\/+/, "")}`;
  if (ns === "qq_runtime" && name === "summarize" && (event?.isOwner || event?.isBotAdmin)) return `/聊天记录 ${clean(args.range || "最近 300")}`;
  if (ns === "qq_social" && name === "act") return mapSocialCommand(args);
  return "";
}

function mapSocialCommand(args) {
  const target = clean(args.target);
  const value = clean(args.value);
  switch (args.action) {
    case "poke": return joinCommand("/拍一拍", target || "发送者");
    case "like": return joinCommand("/点赞", target || "发送者", value || "1");
    case "requests": return mapRequestCommand(target, value);
    case "join_group": return joinCommand("/主动加群", target, value);
    case "qzone_recent": return joinCommand("/动态 最近", target, value || "10");
    case "qzone_publish": return `/发动态 ${value}`.trim();
    case "qzone_comment": return joinCommand("/评论动态", target, value);
    case "ban": return joinCommand("/ban", target, value);
    case "unban": return joinCommand("/unban", target);
    case "group_admin": return `/${value}`.trim();
    default: return "";
  }
}

function mapRequestCommand(target, value) {
  const action = value.match(/^(同意|通过|接受|拒绝|驳回)(?:\s+([\s\S]+))?$/i);
  if (action && target) return joinCommand("/申请", action[1], target, action[2]);
  return joinCommand("/申请", value || target || "列表");
}

function joinCommand(...parts) {
  return parts.map(clean).filter(Boolean).join(" ");
}

function clean(value) {
  return String(value || "").replace(/[\r\n\[\]]+/g, " ").trim().slice(0, 4000);
}
