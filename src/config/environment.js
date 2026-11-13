import { normalizeQqMediaUpdateMode, parseQqMediaUpdateWindow } from "../qq-media/media-updates.js";
import { parseAllowedOrigins } from "../http-utils.js";
import { normalizeSafeFetchMode } from "../safe-fetch.js";
import { CODEX_TASK_TIMEOUT_DEFAULTS, CODEX_TASK_TYPES } from "../codex-task-timeout.js";
import {
  DEFAULT_INTEREST_AGENT_TIMEOUT_MS,
  getDefaultInterestModel,
  getDefaultInterestModelBaseUrl,
  normalizeInterestAgentTimeoutMs,
  normalizeInterestModelProvider,
  normalizeInterestModelReasoningEffort
} from "../interest-model-provider.js";
import { normalizeQqInterestVisionMode } from "../qq-enhancer/interest-vision.js";

export function createEnvironmentConfig(env = process.env) {
  const oneBotMaxConcurrency = boundedInteger(
    env.CODEX_REMOTE_CONTACT_ONEBOT_MAX_CONCURRENCY,
    { defaultValue: 8, min: 1, max: 32 }
  );
  const oneBotMaxPending = boundedInteger(env.CODEX_REMOTE_CONTACT_ONEBOT_MAX_PENDING, {
    defaultValue: 32,
    min: 0,
    max: 256
  });
  const codexMaxConcurrency = boundedInteger(env.CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY, {
    defaultValue: 2,
    min: 1,
    max: 8
  });
  const codexMaxPending = boundedInteger(env.CODEX_REMOTE_CONTACT_CODEX_MAX_PENDING, {
    defaultValue: 32,
    min: 0,
    max: 256
  });
  const sqliteTimeoutMs = boundedInteger(env.CODEX_REMOTE_CONTACT_SQLITE_TIMEOUT_MS, {
    defaultValue: 8_000,
    min: 1_000,
    max: 30_000
  });
  const sqliteMaxOutputBytes = boundedInteger(env.CODEX_REMOTE_CONTACT_SQLITE_MAX_OUTPUT_BYTES, {
    defaultValue: 2 * 1024 * 1024,
    min: 64 * 1024,
    max: 16 * 1024 * 1024
  });
  const codexQuotaCacheTtlMs = boundedInteger(env.CODEX_REMOTE_CONTACT_QUOTA_CACHE_TTL_MS, {
    defaultValue: 30_000,
    min: 5_000,
    max: 5 * 60_000
  });
  const codexTaskTimeouts = {
    [CODEX_TASK_TYPES.QQ_REPLY]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_REPLY_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_REPLY),
    [CODEX_TASK_TYPES.QQ_VISION_REPLY]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_VISION_REPLY_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_VISION_REPLY),
    [CODEX_TASK_TYPES.QQ_CONTEXT_SUMMARY]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_CONTEXT_SUMMARY_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_CONTEXT_SUMMARY),
    [CODEX_TASK_TYPES.QQ_SELF_PERSONA]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_SELF_PERSONA_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_SELF_PERSONA),
    [CODEX_TASK_TYPES.QQ_FILE_TASK]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_FILE_TASK_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_FILE_TASK),
    [CODEX_TASK_TYPES.QQ_IMAGE_GENERATION]: codexTaskTimeout(env.CODEX_REMOTE_CONTACT_CODEX_IMAGE_GENERATION_TIMEOUT_MS, CODEX_TASK_TYPES.QQ_IMAGE_GENERATION, {
      max: 60 * 60_000
    })
  };
  const qqImageMaxBytes = boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES, {
    defaultValue: 20 * 1024 * 1024,
    min: 256 * 1024,
    max: 100 * 1024 * 1024
  });
  const qqFileMaxBytes = boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_FILE_MAX_BYTES, {
    defaultValue: 50 * 1024 * 1024,
    min: 1024 * 1024,
    max: 1024 * 1024 * 1024
  });
  const hubPort = parsePort(env.CODEX_REMOTE_CONTACT_PORT, 3789);
  const qqWebLookupTimeoutMs = numberOrDefault(
    env.CODEX_REMOTE_CONTACT_QQ_WEB_TIMEOUT_MS
      || env.CODEX_REMOTE_CONTACT_QQ_WEB_LOOKUP_TIMEOUT_MS,
    12_000
  );
  const qqProactiveJudgeProvider = normalizeInterestModelProvider(
    env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_PROVIDER
  );
  const defaultQqProactiveJudgeModel = getDefaultInterestModel(qqProactiveJudgeProvider);
  return {
    logMaxBytes: numberOrDefault(env.CODEX_REMOTE_CONTACT_LOG_MAX_BYTES, 5 * 1024 * 1024),
    logMaxFiles: numberOrDefault(env.CODEX_REMOTE_CONTACT_LOG_MAX_FILES, 5),
    logLevel: env.CODEX_REMOTE_CONTACT_LOG_LEVEL || "debug",
    logConsoleOutput: env.CODEX_REMOTE_CONTACT_LOG_CONSOLE !== "0",
    logConsoleLevels: env.CODEX_REMOTE_CONTACT_LOG_CONSOLE_LEVELS || "success,warn,error",
    safeFetchMode: normalizeSafeFetchMode(env.CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE),

    oneBotApiBase: env.ONEBOT_API_BASE || "http://127.0.0.1:3000",
    oneBotAccessToken: String(env.ONEBOT_ACCESS_TOKEN || env.CODEX_REMOTE_CONTACT_ONEBOT_TOKEN || "").trim(),
    environmentManagementApiToken: String(env.CODEX_REMOTE_CONTACT_API_TOKEN || "").trim(),
    oneBotRequestTimeoutMs: boundedInteger(env.CODEX_REMOTE_CONTACT_ONEBOT_TIMEOUT_MS, {
      defaultValue: 10_000,
      min: 1_000,
      max: 30_000
    }),
    oneBotHealthTtlMs: boundedInteger(env.CODEX_REMOTE_CONTACT_ONEBOT_HEALTH_TTL_MS, {
      defaultValue: 15_000,
      min: 5_000,
      max: 60_000
    }),
    oneBotMaxConcurrency,
    oneBotMaxPending,

    agentEngine: enumValue(
      String(env.CODEX_REMOTE_CONTACT_AGENT_ENGINE || "").trim().toLowerCase(),
      ["codex", "claude"],
      "codex"
    ),
    // Codex serves QQ tools from a per-turn MCP server by default; "dynamic"
    // keeps App Server dynamic tools. Claude Code always uses MCP. Both defer
    // tool schemas until the model selects a tool.
    agentToolTransport: enumValue(
      String(env.CODEX_REMOTE_CONTACT_AGENT_TOOL_TRANSPORT || "").trim().toLowerCase(),
      ["mcp", "dynamic"],
      "mcp"
    ),
    // "tool" lets the main model speak through the always-loaded qq_chat.send
    // tool, as many times as it likes during a turn; its final structured
    // output is then private state only. "final" keeps the older contract in
    // which the final structured output carries the one reply.
    qqReplyDelivery: enumValue(
      String(env.CODEX_REMOTE_CONTACT_QQ_REPLY_DELIVERY || "").trim().toLowerCase(),
      ["tool", "final"],
      "tool"
    ),
    // Engines without native image generation (Claude Code) draw through a
    // qq_draw.image tool that runs one Codex image-generation turn on the
    // machine's Codex login. "auto" offers it when the codex CLI is present.
    codexDrawing: enumValue(
      String(env.CODEX_REMOTE_CONTACT_CODEX_DRAWING || "").trim().toLowerCase(),
      ["auto", "off"],
      "auto"
    ),
    codexDrawingTimeoutMs: boundedInteger(env.CODEX_REMOTE_CONTACT_CODEX_DRAWING_TIMEOUT_MS, {
      defaultValue: 240_000,
      min: 30_000,
      max: 600_000
    }),
    // The QQ bot is also a working Agent, so Codex keeps every native feature
    // and its own base instructions unless a deployment opts into trimming.
    agentLeanContext: env.CODEX_REMOTE_CONTACT_AGENT_LEAN_CONTEXT === "1",
    qqBaseInstructionsMode: enumValue(
      String(env.CODEX_REMOTE_CONTACT_QQ_BASE_INSTRUCTIONS || "").trim().toLowerCase(),
      ["qq", "engine"],
      "engine"
    ),
    claudeCliPath: env.CLAUDE_CLI_PATH || "claude",
    claudeModel: String(env.CODEX_REMOTE_CONTACT_CLAUDE_MODEL || "").trim() || "opus",
    claudeReasoningEffort: enumValue(
      String(env.CODEX_REMOTE_CONTACT_CLAUDE_EFFORT || "").trim().toLowerCase(),
      ["low", "medium", "high", "xhigh", "max"],
      null
    ),
    codexCliPath: env.CODEX_CLI_PATH || "/Applications/Codex.app/Contents/Resources/codex",
    codexModel: env.CODEX_REMOTE_CONTACT_CODEX_MODEL || "gpt-5.4-mini",
    codexReasoningEffort: env.CODEX_REMOTE_CONTACT_REASONING_EFFORT || "low",
    codexReasoningSummary: enumValue(
      env.CODEX_REMOTE_CONTACT_REASONING_SUMMARY,
      ["auto", "concise", "detailed", "none"],
      "auto"
    ),
    codexPersonality: enumValue(
      env.CODEX_REMOTE_CONTACT_CODEX_PERSONALITY,
      ["none", "friendly", "pragmatic"],
      "none"
    ),
    codexServiceTier: serviceTierValue(env.CODEX_REMOTE_CONTACT_CODEX_SERVICE_TIER),
    codexMaxConcurrency,
    codexMaxPending,
    codexQuotaCacheTtlMs,
    codexTaskTimeouts,

    qqEnhancerEnabled: env.CODEX_REMOTE_CONTACT_QQ_ENHANCER !== "0",
    qqMemoryLimit: numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_MEMORY_LIMIT, 10),
    qqGroupMemoryLimit: numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_GROUP_MEMORY_LIMIT, 200),
    qqProactiveReplyEnabled: env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE !== "0",
    qqProactiveJudgeEveryMessages: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_EVERY_MESSAGES, {
      defaultValue: 20,
      min: 1,
      max: 1_000
    }),
    qqProactiveJudgeEveryMinutes: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_EVERY_MINUTES, {
      defaultValue: 5,
      min: 0,
      max: 1_440
    }),
    qqProactiveMinutePollMs: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_MINUTE_POLL_MS, {
      defaultValue: 15_000,
      min: 5_000,
      max: 60_000
    }),
    qqProactiveJudgeEnabled: env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE !== "0",
    qqAccountStickersEnabled: env.CODEX_REMOTE_CONTACT_QQ_ACCOUNT_STICKERS !== "0",
    qqAccountStickerCount: Math.max(1, numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_ACCOUNT_STICKER_COUNT, 80)),
    qqAccountStickerCacheMs: Math.max(
      30_000,
      numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_ACCOUNT_STICKER_CACHE_MS, 5 * 60_000)
    ),
    qqProactiveJudgeProvider,
    defaultQqProactiveJudgeModel,
    qqProactiveJudgeModel: env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_MODEL || defaultQqProactiveJudgeModel,
    qqProactiveJudgeTimeoutMs: numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_TIMEOUT_MS, 6_500),
    // Codex / Claude subscription judges run a whole CLI turn per decision.
    qqProactiveJudgeReasoningEffort: normalizeInterestModelReasoningEffort(
      env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_REASONING_EFFORT
    ),
    qqProactiveJudgeAgentTimeoutMs: normalizeInterestAgentTimeoutMs(
      env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_AGENT_TIMEOUT_MS,
      DEFAULT_INTEREST_AGENT_TIMEOUT_MS
    ),
    qqProactiveJudgeAgentConcurrency: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_AGENT_CONCURRENCY, {
      defaultValue: 1,
      min: 1,
      max: 4
    }),
    qqProactiveJudgeVision: normalizeQqInterestVisionMode(env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_VISION),
    qqProactiveJudgeMinInterest: 20,
    qqSelfPersonaScopeInitialMessages: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_SCOPE_INITIAL_MESSAGES, {
      defaultValue: 64,
      min: 16,
      max: 200
    }),
    qqSelfPersonaScopeMessages: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_SCOPE_MESSAGES, {
      defaultValue: 96,
      min: 16,
      max: 400
    }),
    qqSelfPersonaScopeBotReplies: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_SCOPE_BOT_REPLIES, {
      defaultValue: 24,
      min: 4,
      max: 160
    }),
    qqSelfPersonaScopeCooldownHours: boundedNumber(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_SCOPE_COOLDOWN_HOURS, {
      defaultValue: 4,
      min: 1,
      max: 168
    }),
    qqSelfPersonaGenerationInitialMessages: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_GENERATION_INITIAL_MESSAGES, {
      defaultValue: 160,
      min: 40,
      max: 1_000
    }),
    qqSelfPersonaGenerationMessages: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_GENERATION_MESSAGES, {
      defaultValue: 320,
      min: 40,
      max: 2_000
    }),
    qqSelfPersonaGenerationBotReplies: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_GENERATION_BOT_REPLIES, {
      defaultValue: 80,
      min: 12,
      max: 600
    }),
    qqSelfPersonaGenerationScopeSummaries: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_GENERATION_SCOPE_SUMMARIES, {
      defaultValue: 12,
      min: 2,
      max: 40
    }),
    qqSelfPersonaGenerationCooldownHours: boundedNumber(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_GENERATION_COOLDOWN_HOURS, {
      defaultValue: 12,
      min: 1,
      max: 720
    }),
    qqSelfPersonaFailureRetryHours: boundedNumber(env.CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_FAILURE_RETRY_HOURS, {
      defaultValue: 1,
      min: 0.25,
      max: 24
    }),
    qqWebLookupEnabled: env.CODEX_REMOTE_CONTACT_QQ_WEB_LOOKUP !== "0",
    qqWebLookupTimeoutMs,
    qqWebLookupAttemptTimeoutMs: numberOrDefault(
      env.CODEX_REMOTE_CONTACT_QQ_WEB_ATTEMPT_TIMEOUT_MS,
      Math.min(6_500, Math.max(2_500, Math.floor(qqWebLookupTimeoutMs * 0.55)))
    ),
    qqWebSearchProvider: String(env.CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDER || "auto").trim().toLowerCase(),
    qqWebSearchPreset: String(env.CODEX_REMOTE_CONTACT_QQ_WEB_PRESET || "balanced").trim().toLowerCase(),
    qqWebSearchProviderConfig: String(env.CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDERS || "").trim(),
    qqSocialExtensionBase: String(env.CODEX_REMOTE_CONTACT_QQ_SOCIAL_API_BASE || "").trim().replace(/\/$/, ""),
    qqOwnerFileImageTasksEnabled: env.CODEX_REMOTE_CONTACT_QQ_OWNER_FILE_IMAGE_TASKS !== "0",
    qqImageMaxBytes,
    qqCompressedImageMaxEdge: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE, {
      defaultValue: 1600, min: 256, max: 4096
    }),
    qqFileMaxBytes,
    qqBubbleSeparator: normalizeBubbleSeparator(env.CODEX_REMOTE_CONTACT_QQ_BUBBLE_SEPARATOR),
    qqBubbleSendDelayMs: Math.max(0, numberOrDefault(env.CODEX_REMOTE_CONTACT_QQ_BUBBLE_SEND_DELAY_MS, 650)),
    // Follow-up bubbles wait in proportion to their length, like typing.
    qqTypingPace: env.CODEX_REMOTE_CONTACT_QQ_TYPING_PACE !== "0",
    // Private chats show QQ's "typing…" status while a reply is generated.
    qqTypingIndicator: env.CODEX_REMOTE_CONTACT_QQ_TYPING_INDICATOR !== "0",
    // One small background model task per day plans the Bot's routine.
    qqDailyRoutine: env.CODEX_REMOTE_CONTACT_QQ_DAILY_ROUTINE !== "0",
    qqBubbleMaxChars: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_BUBBLE_MAX_CHARS, {
      defaultValue: 900,
      min: 200,
      max: 4_000
    }),
    qqBubbleMaxCount: boundedInteger(env.CODEX_REMOTE_CONTACT_QQ_BUBBLE_MAX_COUNT, {
      defaultValue: 24,
      min: 1,
      max: 64
    }),

    openRouterApiKey: env.OPENROUTER_API_KEY || env.CODEX_REMOTE_CONTACT_OPENROUTER_API_KEY || "",
    openRouterBaseUrl: env.OPENROUTER_BASE_URL || env.CODEX_REMOTE_CONTACT_OPENROUTER_BASE_URL || getDefaultInterestModelBaseUrl("openrouter"),
    deepSeekApiKey: env.DEEPSEEK_API_KEY || env.CODEX_REMOTE_CONTACT_DEEPSEEK_API_KEY || "",
    deepSeekBaseUrl: env.DEEPSEEK_BASE_URL || env.CODEX_REMOTE_CONTACT_DEEPSEEK_BASE_URL || getDefaultInterestModelBaseUrl("deepseek"),
    customInterestModelApiKey: env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_API_KEY || "",
    customInterestModelBaseUrl: env.CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_BASE_URL || "",
    tavilyApiKey: env.TAVILY_API_KEY || env.CODEX_REMOTE_CONTACT_TAVILY_API_KEY || "",

    // Optional local media understanding (`ncc media install`). An empty
    // directory means <project>/runtime/media-tools.
    mediaToolsDir: String(env.CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR || "").trim(),
    mediaMaxVideoSeconds: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_MAX_VIDEO_SECONDS, {
      defaultValue: 1200,
      min: 30,
      max: 7200
    }),
    mediaMaxDownloadBytes: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_MAX_DOWNLOAD_MB, {
      defaultValue: 200,
      min: 10,
      max: 2048
    }) * 1024 * 1024,
    mediaAsrLanguage: enumValue(env.CODEX_REMOTE_CONTACT_MEDIA_ASR_LANGUAGE, ["auto", "zh", "en", "ja", "ko", "yue"], "auto"),
    mediaAsrThreads: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_ASR_THREADS, { defaultValue: 2, min: 1, max: 4 }),
    mediaJobTimeoutMs: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_JOB_TIMEOUT_MS, {
      defaultValue: 300_000,
      min: 30_000,
      max: 30 * 60_000
    }),
    mediaCookiesFile: String(env.CODEX_REMOTE_CONTACT_MEDIA_COOKIES_FILE || "").trim(),
    // Phones kill the whole session on a memory spike: heavy optional work
    // starts only while this much physical memory is available (0 disables).
    mediaMinAvailableBytes: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_MIN_AVAILABLE_MB, {
      defaultValue: 1200,
      min: 0,
      max: 64 * 1024
    }) * 1024 * 1024,
    subagentMinAvailableBytes: boundedInteger(env.CODEX_REMOTE_CONTACT_SUBAGENT_MIN_AVAILABLE_MB, {
      defaultValue: 1000,
      min: 0,
      max: 64 * 1024
    }) * 1024 * 1024,
    // New releases of the optional media components: compatible (default)
    // installs same-major / same-0.x-minor releases automatically, all
    // installs every release, check only reports, off disables checking.
    mediaAutoUpdate: normalizeQqMediaUpdateMode(env.CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE),
    mediaUpdateCheckHours: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_UPDATE_CHECK_HOURS, {
      defaultValue: 12,
      min: 1,
      max: 24 * 14
    }),
    // Local hours when the running Hub may install updates ("3-6"); empty
    // means any time. Outside it, or when busy or short of memory, updates
    // wait for the controller to apply them before the next start.
    mediaUpdateWindow: parseQqMediaUpdateWindow(env.CODEX_REMOTE_CONTACT_MEDIA_UPDATE_WINDOW ?? "3-6"),
    mediaUpdateMinAvailableBytes: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_UPDATE_MIN_MB, {
      defaultValue: 1500,
      min: 0,
      max: 64 * 1024
    }) * 1024 * 1024,
    mediaVoiceAutoTranscribe: env.CODEX_REMOTE_CONTACT_MEDIA_VOICE_AUTO !== "0",
    mediaVoiceAutoMaxSeconds: boundedInteger(env.CODEX_REMOTE_CONTACT_MEDIA_VOICE_AUTO_MAX_SECONDS, {
      defaultValue: 90,
      min: 5,
      max: 600
    }),

    // Host capacity gate before every agent CLI start. Android kills Termux
    // (QQ, the Hub and all agents) above 32 child processes; "auto" limits
    // processes and available memory only on Android hosts, 0 disables.
    agentProcessLimit: autoOrInteger(env.CODEX_REMOTE_CONTACT_AGENT_PROCESS_LIMIT, { min: 0, max: 100_000 }),
    // Processes left free after a turn starts, for its own short-lived
    // children (git, ripgrep, shell commands).
    agentProcessReserve: boundedInteger(env.CODEX_REMOTE_CONTACT_AGENT_PROCESS_RESERVE, {
      defaultValue: 2,
      min: 0,
      max: 16
    }),
    agentMinAvailableMb: autoOrInteger(env.CODEX_REMOTE_CONTACT_AGENT_MIN_AVAILABLE_MB, { min: 0, max: 64 * 1024 }),
    // How long a QQ reply waits for room before it is refused; background
    // model tasks wait a third of it, interest judgments never wait.
    agentCapacityWaitMs: boundedInteger(env.CODEX_REMOTE_CONTACT_AGENT_CAPACITY_WAIT_MS, {
      defaultValue: 90_000,
      min: 0,
      max: 10 * 60_000
    }),

    // Hub-managed background sub-agents (long tasks and routine activities)
    // run in their own small slot pool, never in the reply limiter.
    subagentMaxConcurrency: boundedInteger(env.CODEX_REMOTE_CONTACT_SUBAGENT_MAX_CONCURRENCY, {
      defaultValue: 1,
      min: 0,
      max: 4
    }),
    subagentMaxQueued: boundedInteger(env.CODEX_REMOTE_CONTACT_SUBAGENT_MAX_QUEUED, {
      defaultValue: 2,
      min: 0,
      max: 8
    }),
    subagentTimeoutMs: boundedInteger(env.CODEX_REMOTE_CONTACT_SUBAGENT_TIMEOUT_MS, {
      defaultValue: 20 * 60_000,
      min: 60_000,
      max: 2 * 60 * 60_000
    }),
    // The Bot really does the online parts of its daily routine through
    // background sub-agents, and may post/comment on Qzone by itself within
    // daily caps (privileged requests are not capped).
    lifeActivitiesEnabled: env.CODEX_REMOTE_CONTACT_LIFE_ACTIVITIES !== "0",
    lifeActivityDailyLimit: boundedInteger(env.CODEX_REMOTE_CONTACT_LIFE_ACTIVITY_DAILY_LIMIT, { defaultValue: 5, min: 0, max: 24 }),
    lifeActivityMinGapMinutes: boundedInteger(env.CODEX_REMOTE_CONTACT_LIFE_ACTIVITY_MIN_GAP_MINUTES, { defaultValue: 60, min: 10, max: 720 }),
    lifeChatsPerDay: boundedInteger(env.CODEX_REMOTE_CONTACT_LIFE_CHATS_PER_DAY, { defaultValue: 2, min: 0, max: 3 }),
    lifeQzonePostsPerDay: boundedInteger(env.CODEX_REMOTE_CONTACT_LIFE_QZONE_POSTS_PER_DAY, { defaultValue: 1, min: 0, max: 10 }),
    lifeQzoneCommentsPerDay: boundedInteger(env.CODEX_REMOTE_CONTACT_LIFE_QZONE_COMMENTS_PER_DAY, { defaultValue: 3, min: 0, max: 30 }),
    socialFriendRequestsPerDay: boundedInteger(env.CODEX_REMOTE_CONTACT_SOCIAL_FRIEND_REQUESTS_PER_DAY, { defaultValue: 3, min: 0, max: 10 }),

    sqliteTimeoutMs,
    sqliteMaxOutputBytes,

    hubPort,
    hubHostOverride: String(env.CODEX_REMOTE_CONTACT_HOST || "").trim(),
    hubAllowedOrigins: parseAllowedOrigins(env.CODEX_REMOTE_CONTACT_CORS_ORIGINS, [
      `http://127.0.0.1:${hubPort}`,
      `http://localhost:${hubPort}`,
      `http://[::1]:${hubPort}`
    ]),
    allowRemoteHubBinding: env.CODEX_REMOTE_CONTACT_ALLOW_REMOTE === "1"
  };
}

function numberOrDefault(value, defaultValue) {
  return Number(value || defaultValue);
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function serviceTierValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "";
}

function boundedInteger(value, { defaultValue, min, max }) {
  const number = Number(String(value ?? "").trim() || defaultValue);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

// "auto" (the default) or a bounded integer.
function autoOrInteger(value, { min, max }) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "auto") return "auto";
  const number = Number(text);
  if (!Number.isFinite(number)) return "auto";
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function boundedNumber(value, { defaultValue, min, max }) {
  const number = Number(value || defaultValue);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.max(min, Math.min(max, number));
}

function codexTaskTimeout(value, taskType, { max = 30 * 60_000 } = {}) {
  return boundedInteger(value, {
    defaultValue: CODEX_TASK_TIMEOUT_DEFAULTS[taskType],
    min: 10_000,
    max
  });
}

function normalizeBubbleSeparator(value) {
  return String(value || "").trim() || "|||";
}

function parsePort(value, defaultValue) {
  const port = Number(value || defaultValue);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : defaultValue;
}
