const maxRobotCommands = 12;
const riskyRobotCommandPattern = /(?:管理员|管理|禁言|解禁|踢人|移出|封禁|拉黑|退群|加群|好友|申请|授权|绑定|解绑|支付|转账|购买|兑换|充值|登录|验证码|密码|口令|token|密钥|删除|清空|上传|下载|文件|shell|终端|命令行|执行代码|提示词|系统指令|system\s*prompt|developer\s*message|忽略.{0,12}(?:规则|指令|系统)|越权|绕过)/i;
const unsafeRobotCommandPattern = /(?:https?:\/\/|file:\/\/|\r|\n|\[\[|```)/i;

export function createEmptyQqRobotProfile() {
  return {
    isRobot: false,
    source: "unknown",
    confidence: 0,
    evidence: "",
    officialMarker: null,
    officialMarkerUpdatedAt: null,
    commands: [],
    updatedAt: null
  };
}

export function normalizeQqOfficialRobotMarker(...values) {
  for (const value of values) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || String(value || "").toLowerCase() === "true") return true;
    if (value === 0 || value === "0" || String(value || "").toLowerCase() === "false") return false;
  }
  return undefined;
}

export function normalizeQqRobotProfile(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const officialMarker = normalizeQqOfficialRobotMarker(source.officialMarker);
  const detectionSource = ["official", "context"].includes(source.source) ? source.source : "unknown";
  const profile = {
    isRobot: source.isRobot === true,
    source: detectionSource,
    confidence: clampConfidence(source.confidence),
    evidence: compact(source.evidence, 240),
    officialMarker: officialMarker === undefined ? null : officialMarker,
    officialMarkerUpdatedAt: normalizeTime(source.officialMarkerUpdatedAt),
    commands: normalizeQqRobotCommands(source.commands),
    updatedAt: normalizeTime(source.updatedAt)
  };
  if (profile.officialMarker === true) {
    profile.isRobot = true;
    profile.source = "official";
    profile.confidence = 1;
    profile.evidence ||= "QQ/OneBot 官方机器人标记";
  } else if (profile.source === "unknown") {
    profile.isRobot = false;
    profile.confidence = 0;
    profile.evidence = "";
    profile.commands = [];
  }
  if (!profile.isRobot) profile.commands = [];
  return profile;
}

export function applyQqOfficialRobotMarker(profile, marker, { at = new Date() } = {}) {
  const normalized = normalizeQqRobotProfile(profile);
  const officialMarker = normalizeQqOfficialRobotMarker(marker);
  if (officialMarker === undefined) return { profile: normalized, changed: false };
  if (normalized.officialMarker === officialMarker) return { profile: normalized, changed: false };
  const updatedAt = toIsoTime(at);
  const next = {
    ...normalized,
    officialMarker,
    officialMarkerUpdatedAt: updatedAt,
    updatedAt
  };
  if (officialMarker) {
    next.isRobot = true;
    next.source = "official";
    next.confidence = 1;
    next.evidence = "QQ/OneBot 官方机器人标记";
  } else if (normalized.officialMarker === true) {
    next.source = normalized.isRobot ? "context" : "unknown";
    next.confidence = normalized.isRobot ? Math.max(0.9, normalized.confidence) : 0;
    next.evidence = normalized.isRobot ? "此前曾有 QQ/OneBot 官方机器人标记" : "";
  }
  return { profile: next, changed: !sameProfile(normalized, next) };
}

export function applyQqRobotContextAssessment(profile, assessment, { at = new Date() } = {}) {
  const normalized = normalizeQqRobotProfile(profile);
  const source = assessment && typeof assessment === "object" && !Array.isArray(assessment)
    ? assessment
    : {};
  const confidence = clampConfidence(source.confidence);
  const evidence = compact(source.evidence, 240);
  const assessed = typeof source.isRobot === "boolean" && confidence >= 0.72 && evidence.length >= 4;
  if (!assessed) return { profile: normalized, changed: false };
  if (normalized.officialMarker === true && source.isRobot === false) {
    return { profile: normalized, changed: false };
  }

  const commands = source.isRobot ? normalizeQqRobotCommands(source.commands) : [];
  const updatedAt = toIsoTime(at);
  const next = {
    ...normalized,
    isRobot: normalized.officialMarker === true ? true : source.isRobot,
    source: normalized.officialMarker === true ? "official" : "context",
    confidence: normalized.officialMarker === true ? 1 : confidence,
    evidence: normalized.officialMarker === true
      ? (normalized.evidence || "QQ/OneBot 官方机器人标记")
      : evidence,
    commands,
    updatedAt
  };
  return { profile: next, changed: !sameProfile(normalized, next) };
}

export function normalizeQqRobotCommands(value) {
  const commands = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const command = compact(typeof item === "string" ? item : item?.command, 100);
    const effect = compact(typeof item === "string" ? "" : (item?.effect || item?.description), 200);
    const requiresMention = typeof item === "object" && item !== null
      ? !(
        item.requiresMention === false
        || item.requireMention === false
        || item.needAt === false
        || item.requiresAt === false
      )
      : true;
    if (!isSafeQqRobotCommand(command, effect)) continue;
    const key = command.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push({ command, effect, requiresMention });
    if (commands.length >= maxRobotCommands) break;
  }
  return commands;
}

export function isSafeQqRobotCommand(command, effect = "") {
  const text = compact(command, 100);
  const combined = `${text} ${compact(effect, 200)}`;
  if ([...text].length < 2 || unsafeRobotCommandPattern.test(combined)) return false;
  return !riskyRobotCommandPattern.test(combined);
}

function clampConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function compact(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toIsoTime(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value || ""));
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

function sameProfile(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
