const friendLookupTimeoutMs = 2500;
const friendSubmitTimeoutMs = 5000;

export async function plugin_init(ctx) {
  ctx.router.getNoAuth("/health", (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    res.json({
      ok: true,
      status: "ok",
      plugin: ctx.pluginName,
      version: 8,
      capabilities: [
        "friend-verification",
        "friend-preflight",
        "friend-modern-api",
        "friend-api-signature-adapter",
        "friend-forced-uin-submit",
        "friend-native-timeout",
        "group-join-verification",
        "group-api-signature-adapter"
      ],
      native: {
        getAddBuddyServiceAvailable: typeof ctx.core.context.session.getAddBuddyService === "function",
        getBuddySettingArity: methodArity(getAddBuddyService(ctx), "getBuddySetting"),
        addBuddyArity: methodArity(getAddBuddyService(ctx), "addBuddy"),
        reqToAddFriendsArity: methodArity(ctx.core.context.session.getBuddyService(), "reqToAddFriends"),
        preferredFriendSubmitApi: selectFriendSubmissionApi(
          ctx.core.context.session.getBuddyService(),
          getAddBuddyService(ctx)
        ),
        reqToJoinGroupArity: methodArity(ctx.core.context.session.getGroupService(), "reqToJoinGroup"),
        joinGroupArity: methodArity(ctx.core.context.session.getGroupService(), "joinGroup")
      }
    });
  });

  ctx.router.postNoAuth("/inspect-friend", async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const targetId = normalizeQqId(req.body?.target_id);
    if (!targetId) return res.status(400).json({ ok: false, error: "invalid_target_id" });

    try {
      const buddyService = ctx.core.context.session.getBuddyService();
      const addBuddyService = getAddBuddyService(ctx);
      if (typeof addBuddyService?.addBuddy !== "function"
        && typeof buddyService?.reqToAddFriends !== "function") {
        return res.status(501).json({ ok: false, error: "add_friend_unavailable" });
      }
      const inspection = await inspectFriendTargetWithinBudget(ctx, buddyService, targetId, addBuddyService);
      return res.json({
        ok: true,
        status: inspection.alreadyFriend ? "already_friend" : "ready",
        target_id: targetId,
        uid_available: Boolean(inspection.uid),
        inspection_timed_out: Boolean(inspection.timedOut),
        inspection_api: inspection.requirements.api,
        submission_api: selectFriendSubmissionApi(buddyService, addBuddyService),
        verification_setting: inspection.requirements.setting ?? null,
        verification_mode: inspection.requirements.setting == null
          ? "未知（提交时由 QQ 决定）"
          : friendVerificationMode(inspection.requirements.setting),
        questions: inspection.requirements.questions
      });
    } catch (error) {
      ctx.logger.error("Unable to inspect QQ friend target", error);
      return sendCaughtFailure(res, error);
    }
  });

  ctx.router.postNoAuth("/add-friend", async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const targetId = normalizeQqId(req.body?.target_id);
    const message = String(req.body?.message || "").trim().slice(0, 120);
    const answer = String(req.body?.answer || "").trim().slice(0, 120);
    const remark = String(req.body?.remark || "").trim().slice(0, 60);
    const requestedSetting = normalizeOptionalInteger(req.body?.add_friend_setting, 0, 99);
    const categoryId = normalizeOptionalInteger(req.body?.category_id, 0, 999) ?? 0;
    if (!targetId) return res.status(400).json({ ok: false, error: "invalid_target_id" });

    try {
      const buddyService = ctx.core.context.session.getBuddyService();
      const addBuddyService = getAddBuddyService(ctx);
      if (typeof addBuddyService?.addBuddy !== "function"
        && typeof buddyService?.reqToAddFriends !== "function") {
        return res.status(501).json({ ok: false, error: "add_friend_unavailable" });
      }
      const inspection = await inspectFriendTargetWithinBudget(ctx, buddyService, targetId, addBuddyService);
      if (inspection.alreadyFriend) {
        return res.json({ ok: true, status: "already_friend", target_id: targetId });
      }
      const { uid, requirements } = inspection;
      const addFriendSetting = requirements.setting ?? requestedSetting ?? (answer ? 2 : 0);
      if (addFriendSetting === 99) {
        return res.status(409).json({
          ok: false,
          error: "friend_requests_disabled",
          verification_mode: friendVerificationMode(addFriendSetting)
        });
      }
      if ((addFriendSetting === 2 || addFriendSetting === 3) && !answer) {
        return res.status(409).json({
          ok: false,
          error: "verification_required",
          questions: requirements.questions,
          verification_mode: friendVerificationMode(addFriendSetting),
          requires_message: addFriendSetting === 3
        });
      }
      if (addFriendSetting === 1 && !message) {
        return res.status(409).json({
          ok: false,
          error: "verification_message_required",
          verification_mode: friendVerificationMode(addFriendSetting)
        });
      }
      const request = {
        buddyUin: Number(targetId),
        buddyUid: String(uid || ""),
        phoneNumber: "",
        addFriendSetting,
        answer,
        remark,
        defaultCatgory: categoryId,
        verifyInfo: message,
        sourceID: 0,
        sourceSubID: 0,
        qzoneNotWatch: false,
        qzoneNotWatched: false,
        onlyChat: false,
        randStr: "",
        friendPermissionList: []
      };
      const submission = await submitFriendRequest(addBuddyService, buddyService, request);
      const failure = nativeFailure(submission.result);
      if (failure) return sendNativeFailure(res, failure);
      const pendingApproval = addFriendSetting === 1 || addFriendSetting === 3;
      ctx.logger.info("Submitted QQ friend request", {
        targetId,
        addFriendSetting,
        pendingApproval,
        nativeApiShape: submission.apiShape,
        nativeApiArity: submission.apiArity
      });
      return res.json({
        ok: true,
        status: pendingApproval ? "pending_approval" : "submitted",
        target_id: targetId,
        verification_mode: friendVerificationMode(addFriendSetting),
        questions: requirements.questions,
        native_api_shape: submission.apiShape
      });
    } catch (error) {
      ctx.logger.error("Unable to submit QQ friend request", error);
      return sendCaughtFailure(res, error);
    }
  });

  ctx.router.postNoAuth("/join-group", async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const targetId = normalizeQqId(req.body?.target_id);
    const answer = String(req.body?.answer || req.body?.message || "").trim().slice(0, 300);
    if (!targetId) return res.status(400).json({ ok: false, error: "invalid_target_id" });

    try {
      const groupApi = ctx.core.apis.GroupApi;
      const groups = typeof groupApi?.getGroups === "function"
        ? await Promise.resolve(groupApi.getGroups(false)).catch(() => [])
        : [];
      if (Array.isArray(groups) && groups.some((group) => String(group?.groupCode || group?.group_id || "") === targetId)) {
        return res.json({ ok: true, status: "already_member", target_id: targetId });
      }
      if (!groupApi || typeof groupApi.searchGroup !== "function") {
        return res.status(501).json({ ok: false, error: "group_search_unavailable" });
      }
      const searchResult = await Promise.resolve(groupApi.searchGroup(targetId));
      const groupInfo = unwrapGroupInfo(searchResult, targetId);
      if (!groupInfo) return res.status(404).json({ ok: false, error: "group_not_found" });

      const groupOption = normalizeOptionalInteger(groupInfo.groupOption, 0, 99) ?? 0;
      const question = String(groupInfo.groupQuestion || "").trim().slice(0, 300);
      const memberNum = Number(groupInfo.memberNum);
      const maxMemberNum = Number(groupInfo.maxMemberNum);
      if (Number.isFinite(memberNum) && Number.isFinite(maxMemberNum) && maxMemberNum > 0 && memberNum >= maxMemberNum) {
        return res.status(409).json({ ok: false, error: "group_full", member_num: memberNum, max_member_num: maxMemberNum });
      }
      if (groupOption === 3) {
        return res.status(409).json({ ok: false, error: "group_join_disabled", group_option: groupOption, question });
      }
      if ((groupOption === 4 || groupOption === 5) && !answer) {
        return res.status(409).json({
          ok: false,
          error: "answer_required",
          group_option: groupOption,
          question,
          verification_mode: groupVerificationMode(groupOption)
        });
      }

      const groupService = ctx.core.context.session.getGroupService();
      if (!groupService) return res.status(501).json({ ok: false, error: "group_service_unavailable" });
      const joinRequest = {
        groupCode: Number(targetId),
        sourceId: 3,
        sourceSubId: 0,
        applyMsg: answer,
        auth: String(groupInfo.joinGroupAuth || ""),
        token: "",
        noVerifyAuth: ""
      };
      const submission = await invokeGroupJoin(groupService, joinRequest, { requiresApproval: groupOption === 2 || groupOption === 5 });
      const failure = nativeFailure(submission.result);
      if (failure) return sendNativeFailure(res, failure);
      const pendingApproval = groupOption === 2 || groupOption === 5;
      ctx.logger.info("Submitted QQ group join request", {
        targetId,
        groupOption,
        pendingApproval,
        nativeApiShape: submission.apiShape,
        nativeApiArity: submission.apiArity
      });
      return res.json({
        ok: true,
        status: pendingApproval ? "pending_approval" : "submitted",
        target_id: targetId,
        group_name: String(groupInfo.groupName || ""),
        group_option: groupOption,
        question,
        verification_mode: groupVerificationMode(groupOption),
        native_api_shape: submission.apiShape
      });
    } catch (error) {
      ctx.logger.error("Unable to submit QQ group join request", error);
      return sendCaughtFailure(res, error);
    }
  });

  ctx.logger.info("Codex QQ social bridge initialized");
}

export async function plugin_cleanup() {
}

function isLoopbackRequest(req) {
  const address = String(req?.raw?.socket?.remoteAddress || req?.raw?.connection?.remoteAddress || "").toLowerCase();
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return ipv4 === "127.0.0.1" || ipv4.startsWith("127.");
}

function normalizeQqId(value) {
  const id = String(value ?? "").trim();
  return /^[1-9][0-9]{4,12}$/.test(id) ? id : "";
}

async function readFriendRequirements(buddyService, targetId, ctx) {
  const attempts = [
    ["getTargetBuddySetting", [Number(targetId)]],
    ["getTargetBuddySettingByType", [Number(targetId), 0]]
  ];
  for (const [method, args] of attempts) {
    if (typeof buddyService?.[method] !== "function") continue;
    try {
      const result = await withNativeTimeout(
        buddyService[method](...args),
        `BuddyService.${method}`,
        friendLookupTimeoutMs
      );
      const candidate = result?.data || result?.setting || result;
      const setting = normalizeOptionalInteger(candidate?.addFriendSetting ?? candidate?.setting, 0, 99);
      if (setting !== undefined) {
        return {
          setting,
          questions: normalizeStringList(candidate?.question || candidate?.questions, 5, 120)
        };
      }
    } catch (error) {
      ctx.logger.info("Unable to inspect QQ friend verification setting", { targetId, method, error: String(error?.message || error) });
    }
  }
  return { setting: undefined, questions: [] };
}

async function inspectFriendTarget(ctx, buddyService, targetId, addBuddyService) {
  let uid = "";
  try {
    uid = String(await withNativeTimeout(
      ctx.core.apis.UserApi.getUidByUinV2(targetId),
      "UserApi.getUidByUinV2",
      friendLookupTimeoutMs
    ) || "");
  } catch (error) {
    // QQ can accept a UIN directly. UID lookup often fails for strangers, so it
    // must never prevent a valid friend request from reaching the native API.
    ctx.logger.info("Unable to resolve QQ UID; continuing with UIN", {
      targetId,
      error: String(error?.message || error)
    });
  }

  let alreadyFriend = false;
  if (uid && typeof ctx.core.apis.FriendApi?.isBuddy === "function") {
    try {
      alreadyFriend = Boolean(await withNativeTimeout(
        ctx.core.apis.FriendApi.isBuddy(uid),
        "FriendApi.isBuddy",
        friendLookupTimeoutMs
      ));
    } catch (error) {
      ctx.logger.info("Unable to inspect existing QQ friendship", {
        targetId,
        error: String(error?.message || error)
      });
    }
  }

  return {
    uid,
    alreadyFriend,
    requirements: await readFriendRequirementsWithModernFallback(
      addBuddyService,
      buddyService,
      targetId,
      uid,
      ctx
    )
  };
}

async function inspectFriendTargetWithinBudget(ctx, buddyService, targetId, addBuddyService) {
  try {
    return await withNativeTimeout(
      inspectFriendTarget(ctx, buddyService, targetId, addBuddyService),
      "friend preflight",
      friendLookupTimeoutMs
    );
  } catch (error) {
    if (error?.code !== "native_timeout") throw error;
    ctx.logger.info("QQ friend preflight timed out; forcing submission by UIN", {
      targetId,
      timeoutMs: friendLookupTimeoutMs
    });
    return {
      uid: "",
      alreadyFriend: false,
      timedOut: true,
      requirements: { api: "timed-out", setting: undefined, questions: [] }
    };
  }
}

function getAddBuddyService(ctx) {
  if (typeof ctx?.core?.context?.session?.getAddBuddyService !== "function") return null;
  try {
    return ctx.core.context.session.getAddBuddyService();
  } catch {
    return null;
  }
}

async function readFriendRequirementsWithModernFallback(addBuddyService, buddyService, targetId, uid, ctx) {
  if (typeof addBuddyService?.getBuddySetting === "function") {
    try {
      const targetInfo = friendAccountInfo(targetId, uid);
      const result = await withNativeTimeout(
        addBuddyService.getBuddySetting(
          "CodexRemoteContact",
          {
            targetInfo,
            sourceSubId: 0
          },
          []
        ),
        "AddBuddyService.getBuddySetting",
        friendLookupTimeoutMs
      );
      const candidate = unwrapModernFriendPayload(result);
      const failure = nativeFailure(result?.result) || nativeFailure(candidate);
      if (failure) throw new Error(`modern_friend_preflight_failed:${failure.code}:${failure.message}`);
      const setting = normalizeOptionalInteger(
        candidate?.querySetting ?? candidate?.addFriendSetting ?? candidate?.setting,
        0,
        99
      );
      return {
        api: "add-buddy-service",
        setting,
        questions: normalizeStringList(
          candidate?.question ?? candidate?.questions,
          5,
          120
        )
      };
    } catch (error) {
      ctx.logger.info("Unable to inspect QQ friend setting through AddBuddyService; falling back", {
        targetId,
        error: String(error?.message || error)
      });
    }
  }
  return {
    api: "buddy-service",
    ...await readFriendRequirements(buddyService, targetId, ctx)
  };
}

function friendAccountInfo(targetId, uid) {
  return {
    uid: String(uid || ""),
    uin: Number(targetId),
    phoneNum: ""
  };
}

function unwrapModernFriendPayload(value) {
  const candidates = [
    value?.[1],
    value?.[0]?.rsp,
    value?.rsp,
    value?.response,
    value?.data?.rsp,
    value?.data,
    value?.setting,
    value
  ];
  return candidates.find((item) => item && typeof item === "object") || {};
}

function unwrapGroupInfo(value, targetId) {
  const candidates = [
    value?.searchGroupInfo,
    value?.data?.searchGroupInfo,
    value?.data,
    value
  ];
  return candidates.find((item) => item
    && typeof item === "object"
    && (item.groupCode != null || item.group_id != null || item.groupOption != null)
    && String(item.groupCode || item.group_id || targetId) === targetId) || null;
}

async function invokeGroupJoin(groupService, request, { requiresApproval }) {
  if (typeof groupService.reqToJoinGroup === "function") {
    const apiArity = methodArity(groupService, "reqToJoinGroup");
    if (apiArity < 2) {
      try {
        return {
          result: await Promise.resolve(groupService.reqToJoinGroup(request)),
          apiShape: "request-object",
          apiArity
        };
      } catch (error) {
        if (!isNativeArgumentCountError(error, 2)) throw error;
      }
    }
    return {
      result: await Promise.resolve(groupService.reqToJoinGroup(String(request.groupCode), request)),
      apiShape: "group-code-request",
      apiArity
    };
  }
  if (!requiresApproval && typeof groupService.joinGroup === "function") {
    return {
      result: await Promise.resolve(groupService.joinGroup(request)),
      apiShape: "join-request-object",
      apiArity: methodArity(groupService, "joinGroup")
    };
  }
  const error = new Error("reqToJoinGroup_unavailable");
  error.code = "unsupported";
  throw error;
}

function isNativeArgumentCountError(error, expectedCount) {
  const message = String(error?.message || error || "");
  const expected = Number(expectedCount);
  if (!Number.isInteger(expected) || expected < 0) return false;
  const needsMatch = message.match(/\bneeds?\s+([0-9]+)\s+arguments?\b/i);
  if (needsMatch && Number(needsMatch[1]) === expected) return true;
  const assertionMatch = message.match(/\bargc\s*==\s*([0-9]+)\b/i);
  return Boolean(assertionMatch && Number(assertionMatch[1]) === expected);
}

function nativeFailure(result) {
  if (result == null) return null;
  const code = firstFiniteNumber(result.result, result.code, result.retCode, result.errCode, result.errorCode);
  if (code == null || code === 0) return null;
  return {
    code,
    message: String(result.errMsg || result.errorString || result.message || result.wording || `QQ native error ${code}`)
  };
}

function sendNativeFailure(res, failure) {
  const riskControl = isRiskControlError(failure.message, failure.code);
  return res.status(riskControl ? 409 : 502).json({
    ok: false,
    error: riskControl ? "risk_control_required" : failure.message,
    native_code: failure.code,
    native_message: failure.message
  });
}

function sendCaughtFailure(res, error) {
  const message = String(error?.message || error || "unknown_error");
  if (error?.code === "native_timeout") {
    return res.status(504).json({
      ok: false,
      error: "native_timeout",
      native_api: String(error.nativeApi || "unknown"),
      timeout_ms: Number(error.timeoutMs) || undefined,
      native_message: message
    });
  }
  if (message === "reqToJoinGroup_unavailable" || message === "add_friend_unavailable") {
    return res.status(501).json({ ok: false, error: message });
  }
  if (isRiskControlError(message)) return res.status(409).json({ ok: false, error: "risk_control_required", native_message: message });
  return res.status(500).json({ ok: false, error: message });
}

function isRiskControlError(message, code) {
  return /captcha|risk|security|safe|verify code|风控|安全验证|验证码|频繁/i.test(String(message || ""))
    || new Set([40, 120, 140, 210, 22009]).has(Number(code));
}

function friendVerificationMode(setting) {
  return ({
    0: "无需验证",
    1: "验证信息后审核",
    2: "正确答案",
    3: "回答问题后审核",
    99: "禁止添加"
  })[setting] || `未知验证方式 ${setting}`;
}

function groupVerificationMode(option) {
  return ({
    0: "未知群验证方式",
    1: "无需验证",
    2: "管理员审核",
    3: "禁止加入",
    4: "正确答案",
    5: "回答问题后审核"
  })[option] || `未知群验证方式 ${option}`;
}

function normalizeStringList(value, limit, maxLength) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => String(item || "").trim().slice(0, maxLength)).filter(Boolean).slice(0, limit);
}

function normalizeOptionalInteger(value, min, max) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return undefined;
  return number;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function methodArity(target, method) {
  return typeof target?.[method] === "function" ? target[method].length : null;
}

async function submitFriendRequest(addBuddyService, buddyService, request) {
  const verificationText = request.addFriendSetting === 2 || request.addFriendSetting === 3
    ? request.answer
    : request.verifyInfo;

  // The stable native interface accepts UIN + verification text and does not
  // depend on resolving a stranger UID. Prefer it over AddBuddyService, whose
  // request shape varies across QQ/NapCat releases and may never settle.
  if (typeof buddyService?.reqToAddFriends === "function") {
    const apiArity = methodArity(buddyService, "reqToAddFriends");
    if (apiArity === 1) {
      return {
        result: await withNativeTimeout(
          buddyService.reqToAddFriends(request),
          "BuddyService.reqToAddFriends(request)",
          friendSubmitTimeoutMs
        ),
        apiShape: "request-object",
        apiArity
      };
    }

    try {
      return {
        result: await withNativeTimeout(
          buddyService.reqToAddFriends(request.buddyUin, verificationText),
          "BuddyService.reqToAddFriends(uin,message)",
          friendSubmitTimeoutMs
        ),
        apiShape: "uin-message",
        apiArity
      };
    } catch (error) {
      if (!isNativeArgumentCountError(error, 1)) throw error;
      return {
        result: await withNativeTimeout(
          buddyService.reqToAddFriends(request),
          "BuddyService.reqToAddFriends(request)",
          friendSubmitTimeoutMs
        ),
        apiShape: "request-object",
        apiArity
      };
    }
  }

  if (typeof addBuddyService?.addBuddy === "function") {
    const modernRequest = {
      targetInfo: friendAccountInfo(request.buddyUin, request.buddyUid),
      sourceId: request.sourceID,
      sourceSubId: request.sourceSubID,
      name1: verificationText,
      addFriendSetting: request.addFriendSetting,
      srcFlag: 0,
      srcDescription: "",
      friendSrcDesc: "",
      isContactFriend: false,
      bSupportSecureTips: true,
      bSupportAddRelief: true,
      permissionInfo: 0,
      myFriendGroupId: request.defaultCatgory
    };
    return {
      result: await withNativeTimeout(
        addBuddyService.addBuddy("CodexRemoteContact", modernRequest, []),
        "AddBuddyService.addBuddy",
        friendSubmitTimeoutMs
      ),
      apiShape: "add-buddy-service",
      apiArity: methodArity(addBuddyService, "addBuddy")
    };
  }

  const error = new Error("add_friend_unavailable");
  error.code = "unsupported";
  throw error;
}

function selectFriendSubmissionApi(buddyService, addBuddyService) {
  if (typeof buddyService?.reqToAddFriends === "function") {
    return methodArity(buddyService, "reqToAddFriends") === 1
      ? "buddy-service-request-object"
      : "buddy-service-uin";
  }
  if (typeof addBuddyService?.addBuddy === "function") return "add-buddy-service";
  return "unavailable";
}

export async function withNativeTimeout(value, nativeApi, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${nativeApi} timed out after ${timeoutMs}ms`);
      error.code = "native_timeout";
      error.nativeApi = nativeApi;
      error.timeoutMs = timeoutMs;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(value), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
