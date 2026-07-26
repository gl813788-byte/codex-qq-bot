import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLogDetailText,
  formatLogError,
  formatLogMessage,
  getLogDetailLabel,
  localizeLogDetails
} from "../src/log-presentation.js";

test("log presentation uses consistent Chinese event names and concise error chains", () => {
  assert.equal(formatLogMessage("OneBot health check failed"), "OneBot 健康检查失败");
  assert.equal(formatLogMessage("Unable to prepare QQ image for vision"), "准备 QQ 视觉图片失败");
  assert.equal(formatLogMessage("Codex model output captured"), "Codex 模型输出已记录");
  assert.equal(formatLogMessage("QQ knowledge deletion review completed"), "QQ 黑话删除审核完成");
  assert.equal(formatLogMessage("QQ knowledge deletion main review started"), "QQ 黑话删除主模型终审已开始");
  assert.equal(formatLogMessage("QQ cold-group topic-start judge completed"), "QQ 冷群新话题启动判定完成");
  assert.equal(formatLogMessage("QQ private proactive start judge completed"), "QQ 私聊主动联系启动判定完成");
  assert.equal(formatLogMessage("QQ autonomous proactive two-model contract verified"), "QQ 主动聊天双模型链路校验通过");
  assert.equal(formatLogMessage("QQ active social request failed"), "QQ 主动好友/入群申请失败");
  assert.equal(formatLogMessage("QQ request action completed"), "QQ 申请操作完成");
  assert.equal(formatLogDetailText("Mention-only mode ignored this message"), "群消息未 @ 或回复机器人，已按仅提及模式忽略");
  assert.equal(formatLogDetailText("model judge failed: OpenRouter judge did not return valid FINAL_JSON"), "判定模型失败：OpenRouter 判定模型未返回有效结构化结果");
  assert.equal(formatLogError({
    name: "TypeError",
    message: "fetch failed",
    code: null,
    cause: { message: "connect ECONNREFUSED 127.0.0.1:3000", code: "ECONNREFUSED", address: "127.0.0.1", port: 3000 }
  }), "网络请求失败；连接 127.0.0.1:3000 被拒绝；ECONNREFUSED");
});

test("QQ social action logs expose safe diagnostic fields in Chinese", () => {
  assert.deepEqual(localizeLogDetails({
    requestId: "abc123",
    requestType: "friend",
    subType: "add",
    targetId: "1148645252",
    endpoint: "add-friend",
    httpStatus: 502,
    oneBotRetCode: 1200,
    nativeCode: 40,
    nativeMessage: "risk control",
    nativeApiShape: "uin-message",
    verificationMode: "验证信息后审核",
    approve: true,
    autoHandled: false,
    handledBy: "3784642920"
  }), {
    "申请 ID": "abc123",
    申请类型: "friend",
    申请子类型: "add",
    "目标 QQ/群": "1148645252",
    接口: "add-friend",
    "HTTP 状态码": 502,
    "OneBot 返回码": 1200,
    "QQ 原生返回码": 40,
    "QQ 原生错误": "risk control",
    "QQ 原生接口形式": "uin-message",
    验证方式: "验证信息后审核",
    是否同意: true,
    是否自动处理: false,
    处理者: "3784642920"
  });
});

test("two-model proactive and complex review details are fully localized", () => {
  assert.deepEqual(localizeLogDetails({
    proactiveKind: "cold_group_chatter",
    interestGateRequired: true,
    interestGateApproved: true,
    mainContentRequired: true,
    reviewPipeline: "interest_triage_then_main_review",
    reviewStage: "completed",
    interestRecommendation: "delete",
    interestComplexity: "complex",
    mainModelDecision: "keep"
  }), {
    主动聊天类型: "冷群轻量水群",
    需要兴趣模型闸门: true,
    兴趣模型是否批准: true,
    需要主模型产出: true,
    审核模型链路: "兴趣模型初筛 → 主模型终审",
    审核阶段: "双模型审核完成",
    兴趣模型初筛建议: "建议删除",
    兴趣模型复杂度判断: "复杂",
    主模型最终决定: "保留"
  });
});

test("startup learning snapshots and knowledge details share recursive Chinese labels", () => {
  assert.equal(getLogDetailLabel("averageTextChars"), "平均文字长度");
  assert.equal(getLogDetailLabel("modelTemperature"), "模型温度");
  assert.deepEqual(localizeLogDetails({
    groupId: "10001",
    learning: {
      sampleSize: 42,
      activityLevel: "typical",
      socialHours: { source: "learned", wrapsMidnight: true }
    },
    proactiveIntervals: { judgeEveryMessages: 20, reason: "activity_typical" }
  }), {
    群: "10001",
    自动学习数据: {
      总样本数: 42,
      当前活跃度: "一般",
      常用社交时段: { 来源: "learned", 是否跨午夜: true }
    },
    主动兴趣间隔: { 消息间隔: 20, 原因: "当前活跃度一般" }
  });
});

test("cold-group research outcome details use Chinese labels and values", () => {
  assert.deepEqual(localizeLogDetails({
    contentMode: "interest_research",
    researchEnabled: true,
    researchRounds: 3,
    researchToolCalls: 4,
    researchToolKinds: ["web-search", "knowledge"],
    researchQueries: ["AI 新工具"],
    failedToolCalls: 0,
    topicStartShouldStart: true,
    topicStartMode: "topic",
    topicStartInterest: 82
  }), {
    冷群内容方式: "兴趣联网探索后开话题",
    允许兴趣探索: true,
    探索轮数: 3,
    探索工具调用数: 4,
    探索工具类型: ["联网搜索", "长期知识库"],
    联网探索查询: ["AI 新工具"],
    失败工具调用数: 0,
    是否启动新话题: true,
    冷群批准模式: "自主开话题",
    启动兴趣分: 82
  });
});

test("private proactive gate details expose the model decision and human-like variation", () => {
  assert.deepEqual(localizeLogDetails({
    privateStartShouldStart: true,
    privateStartInterest: 71,
    privateStartReason: "有自然延续点",
    spontaneityRoll: 0.08
  }), {
    是否启动私聊联系: true,
    私聊启动兴趣分: 71,
    私聊启动判定理由: "有自然延续点",
    拟人波动值: 0.08
  });
});

test("follow-up fusion logs use the existing Chinese detail style", () => {
  assert.equal(formatLogMessage("QQ follow-up trigger entered fusion buffer"), "QQ 追问触发已进入融合缓冲");
  assert.equal(formatLogMessage("Queued QQ messages steered into active turn"), "QQ 融合追问已一次性补充进当前回复");
  assert.equal(
    formatLogMessage("Queued QQ messages restarted after follow-up quiet window"),
    "QQ 追问静默满 5 秒，已截断旧回复并开始统一重答"
  );
  assert.equal(
    formatLogMessage("QQ pending follow-ups fused before send"),
    "QQ 待处理追问已在发送前融合"
  );
  assert.deepEqual(localizeLogDetails({
    outcome: "steered",
    action: "fuse-and-steer",
    source: "qq-follow-up",
    triggerMessageCount: 4,
    compactedTriggerCount: 2,
    contextMessageCount: 3,
    inputBatchCount: 1,
    triggerKinds: ["mention", "interest"],
    fusionPreview: "消息一：继续说"
  }), {
    结果: "已融合补充",
    操作: "融合后补充当前回答",
    来源: "QQ 融合追问",
    触发消息数: 4,
    压缩后触发数: 2,
    补充语境数: 3,
    模型输入批次数: 1,
    融合触发来源: ["@ 机器人", "兴趣模型选中"],
    融合内容预览: "消息一：继续说"
  });
  assert.deepEqual(localizeLogDetails({
    outcome: "restarted",
    action: "fuse-and-restart",
    interruptedTurnId: "turn-1",
    turnId: "turn-2"
  }), {
    结果: "已截断并续答",
    操作: "融合后截断并续答",
    "被截断的 Codex 轮次": "turn-1",
    "Codex 轮次": "turn-2"
  });
  assert.deepEqual(localizeLogDetails({
    outcome: "completed",
    action: "fuse-before-send",
    fusionRound: 2
  }), {
    结果: "已完成",
    操作: "发送前统一融合",
    发送前融合轮次: 2
  });
});

test("QQ Codex session mode logs localize their field and values", () => {
  assert.deepEqual(localizeLogDetails({
    sessionMode: "auto",
    persistent: "persistent",
    temporary: "temporary",
    inherit: "inherit"
  }), {
    会话模式: "自动",
    persistent: "persistent",
    temporary: "temporary",
    inherit: "inherit"
  });
  assert.deepEqual(
    ["persistent", "temporary", "inherit"].map((sessionMode) => (
      localizeLogDetails({ sessionMode }).会话模式
    )),
    ["长期", "临时", "继承默认"]
  );
});

test("stop-preservation and outgoing mention logs use Chinese detail fields", () => {
  assert.equal(
    formatLogMessage("QQ reply paused without resetting conversation"),
    "QQ 当前回复已暂停，会话保持不变"
  );
  assert.equal(formatLogMessage("QQ outgoing mentions processed"), "QQ 回复 @ 目标已解析");
  assert.deepEqual(localizeLogDetails({
    outcome: "stopped",
    action: "pause",
    pendingReplyRemovedCount: 2,
    contextPreserved: true,
    codexSessionPreserved: true,
    mentionCount: 1,
    mentionTargets: ["10001"],
    unresolvedMentions: []
  }), {
    结果: "已暂停",
    操作: "暂停当前回复",
    已取消待融合追问数: 2,
    是否保留上下文: true,
    "是否保留 Codex 会话": true,
    "真实 @ 数": 1,
    "真实 @ 目标": ["10001"],
    "未解析 @ 文本": []
  });
});
