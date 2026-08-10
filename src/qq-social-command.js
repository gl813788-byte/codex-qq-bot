const activeJoinGroupCommandPattern = /^\/?主动加群\s+([1-9][0-9]{4,12})(?:\s+([\s\S]+))?$/i;

const optionKeyAliases = new Map([
  ["验证", "message"],
  ["验证信息", "message"],
  ["申请说明", "message"],
  ["留言", "message"],
  ["message", "message"],
  ["verify", "message"],
  ["答案", "answer"],
  ["回答", "answer"],
  ["answer", "answer"],
]);

const namedOptionPattern = /(?:^|[\s|｜;；])(?<key>验证信息|申请说明|验证|留言|答案|回答|message|verify|answer)\s*[:=：]\s*/gi;

export function parseQqActiveJoinGroupCommand(command) {
  const match = String(command || "").trim().match(activeJoinGroupCommandPattern);
  if (!match) return null;
  const rawOptions = String(match[2] || "").trim();
  const { prefix, values, hasNamedOptions } = parseNamedOptions(rawOptions);
  const fallbackAnswer = hasNamedOptions ? prefix : rawOptions;
  return {
    targetId: match[1],
    message: bounded(values.message, 300),
    answer: bounded(values.answer || values.message || fallbackAnswer, 300)
  };
}

export function buildQqActiveJoinGroupPayload(parsed) {
  if (!parsed) return null;
  return compactObject({
    target_id: parsed.targetId,
    message: parsed.message || parsed.answer,
    answer: parsed.answer
  });
}

export function parseQqZonePublishCommand(command) {
  const match = String(command || "").trim().match(/^\/?发动态(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const segments = String(match[1] || "")
    .split(/\s*[|｜;；]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const content = [];
  let useCurrentImages = false;
  let invalidImageSelector = "";
  for (const segment of segments) {
    const image = segment.match(/^图片\s*[:=：]\s*(.+)$/i);
    if (!image) {
      content.push(segment);
      continue;
    }
    const selector = String(image[1] || "").trim();
    if (/^(?:当前|本条|当前消息|引用|引用消息)$/i.test(selector)) useCurrentImages = true;
    else invalidImageSelector = selector;
  }
  return {
    content: content.join(" | ").trim().slice(0, 2000),
    useCurrentImages,
    invalidImageSelector
  };
}

export function formatQqActiveJoinGroupFailure(targetId, result, httpStatus) {
  const error = String(result?.error || "").trim();
  const question = String(result?.question || result?.questions?.filter(Boolean)?.join(" / ") || "").trim();
  if (error === "verification_required" || error === "answer_required") {
    return `加群问题${question ? `：${question}` : "需要作答"}。请提供答案后重试：/主动加群 ${targetId} 答案=正确答案`;
  }
  if (error === "group_join_disabled") return "该群当前禁止任何人申请加入。";
  if (error === "group_full") return "该群人数已满，当前无法加入。";
  if (error === "group_not_found") return `没有找到群 ${targetId}，请确认群号及该群是否允许被搜索。`;
  if (error === "group_join_unconfirmed") return "QQ 原生加群调用已返回，但群列表没有确认 Bot 已加入；本次按失败处理，没有假报成功。";
  if (error === "risk_control_required") return "QQ 风控要求在客户端完成安全验证；Bot 没有绕过风控，也没有伪报申请成功。";
  if (error === "native_timeout") {
    const nativeApi = String(result?.native_api || "QQ 原生接口");
    return `${nativeApi} 没有在限定时间内返回；本次没有伪报成功，请检查 NapCat 社交桥日志后重试。`;
  }
  return `发起加群申请失败：${error || result?.message || `HTTP ${httpStatus || "未知"}`}`;
}

function parseNamedOptions(raw) {
  const matches = [...String(raw || "").matchAll(namedOptionPattern)];
  if (!matches.length) return { prefix: "", values: {}, hasNamedOptions: false };
  const values = {};
  const prefix = cleanOptionValue(String(raw).slice(0, matches[0].index));
  for (const [index, match] of matches.entries()) {
    const key = optionKeyAliases.get(String(match.groups?.key || "").toLowerCase());
    if (!key) continue;
    const start = Number(match.index) + match[0].length;
    const end = matches[index + 1]?.index ?? String(raw).length;
    const value = cleanOptionValue(String(raw).slice(start, end));
    if (value) values[key] = value;
  }
  return { prefix, values, hasNamedOptions: true };
}

function cleanOptionValue(value) {
  return String(value || "").trim().replace(/^[|｜;；]+|[|｜;；]+$/g, "").trim();
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function bounded(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
