const nativeLookupTimeoutMs = 3000;
const nativeSubmitTimeoutMs = 5000;
const confirmationTimeoutMs = 3500;
const confirmationPollMs = 200;
const groupNotifyLimit = 200;

export async function plugin_init(ctx) {
  ctx.router.getNoAuth("/health", (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const session = ctx.core.context.session;
    res.json({
      ok: true,
      status: "ok",
      plugin: ctx.pluginName,
      version: 19,
      capabilities: [
        "incoming-friend-request-list",
        "incoming-friend-request-handle",
        "incoming-group-request-list",
        "incoming-group-request-handle",
        "incoming-request-postcondition-confirmation",
        "group-join-verification",
        "group-join-postcondition-confirmation",
        "group-api-signature-adapter"
      ],
      native: {
        approvalFriendRequestAvailable: typeof session.getBuddyService()?.approvalFriendRequest === "function",
        approvalDoubtBuddyReqAvailable: typeof session.getBuddyService()?.approvalDoubtBuddyReq === "function",
        handleGroupRequestAvailable: typeof ctx.core.apis.GroupApi?.handleGroupRequest === "function",
        reqToJoinGroupArity: methodArity(session.getGroupService(), "reqToJoinGroup"),
        joinGroupArity: methodArity(session.getGroupService(), "joinGroup")
      }
    });
  });

  ctx.router.postNoAuth("/pending-requests", async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const count = normalizeOptionalInteger(req.body?.count, 1, groupNotifyLimit) ?? 100;
    try {
      const listing = await listPendingRequests(ctx, count);
      return res.json({ ok: true, status: "ok", requests: listing.requests, source_errors: listing.sourceErrors });
    } catch (error) {
      ctx.logger.error("Unable to list incoming QQ requests", error);
      return sendCaughtFailure(res, error);
    }
  });

  ctx.router.postNoAuth("/handle-request", async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: "loopback_only" });
    const requestType = req.body?.request_type === "friend" || req.body?.request_type === "group"
      ? req.body.request_type
      : "";
    const flag = String(req.body?.flag || "").trim().slice(0, 512);
    const approve = normalizeBoolean(req.body?.approve);
    const note = String(req.body?.note || req.body?.remark || req.body?.reason || "").trim().slice(0, 300);
    const expectedUserId = normalizeQqId(req.body?.user_id);
    const expectedGroupId = normalizeQqId(req.body?.group_id);
    if (!requestType || !flag || approve == null) {
      return res.status(400).json({ ok: false, error: "invalid_request_action" });
    }

    try {
      const result = requestType === "friend"
        ? await handleIncomingFriendRequest(ctx, { flag, approve, note, expectedUserId })
        : await handleIncomingGroupRequest(ctx, { flag, approve, note, expectedGroupId });
      ctx.logger.info("Handled incoming QQ request", {
        requestType,
        subType: result.sub_type,
        flag,
        approve,
        confirmation: result.confirmation
      });
      return res.json({
        ok: true,
        status: approve ? "approved" : "rejected",
        request_type: requestType,
        flag,
        ...result
      });
    } catch (error) {
      ctx.logger.error("Unable to handle incoming QQ request", error);
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
      if (await isGroupMember(groupApi, targetId)) {
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
      const submission = await invokeGroupJoin(groupService, joinRequest, {
        requiresApproval: groupOption === 2 || groupOption === 5
      });
      const failure = nativeFailure(submission.result);
      if (failure) return sendNativeFailure(res, failure);
      const pendingApproval = groupOption === 2 || groupOption === 5;
      const joined = !pendingApproval && groupOption === 1
        ? await confirmGroupMembership(groupApi, targetId)
        : false;
      if (!pendingApproval && groupOption === 1 && !joined) {
        return res.status(502).json({ ok: false, error: "group_join_unconfirmed", target_id: targetId });
      }
      ctx.logger.info("Submitted QQ group join request", {
        targetId,
        groupOption,
        pendingApproval,
        nativeApiShape: submission.apiShape,
        nativeApiArity: submission.apiArity
      });
      return res.json({
        ok: true,
        status: joined ? "joined" : pendingApproval ? "pending_approval" : "submitted",
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

  ctx.logger.info("Codex QQ incoming-request and group bridge initialized");
}

export async function plugin_cleanup() {
}

async function listPendingRequests(ctx, count) {
  const sources = await Promise.allSettled([
    readBuddyRequests(ctx),
    readDoubtFriendRequests(ctx, count),
    readGroupRequests(ctx, count)
  ]);
  const [buddyRequests, doubtRequests, groupRequests] = sources.map((result) => result.status === "fulfilled" ? result.value : []);
  const sourceNames = ["ordinary_friend", "doubt_friend", "group"];
  const sourceErrors = sources.flatMap((result, index) => result.status === "rejected"
    ? [{ source: sourceNames[index], error: String(result.reason?.message || result.reason || "unknown_error").slice(0, 200) }]
    : []);
  if (sourceErrors.length === sources.length) throw codedError("request_sources_unavailable");
  const output = [];
  for (const request of buddyRequests.filter(isPendingIncomingBuddyRequest).slice(0, count)) {
    output.push(await normalizeBuddyRequest(ctx, request));
  }
  for (const request of doubtRequests.slice(0, count)) {
    const normalized = normalizeDoubtFriendRequest(request);
    if (normalized.flag && !output.some((item) => item.request_type === "friend" && item.flag === normalized.flag)) {
      output.push(normalized);
    }
  }
  for (const item of groupRequests.filter((item) => isPendingGroupNotify(item.notify)).slice(0, count)) {
    output.push(await normalizeGroupRequest(ctx, item));
  }
  return { requests: output.slice(0, count), sourceErrors };
}

async function handleIncomingFriendRequest(ctx, { flag, approve, note, expectedUserId }) {
  const buddyRequests = await readBuddyRequests(ctx);
  const request = buddyRequests.find((item) => String(item?.reqTime || "") === flag && isPendingIncomingBuddyRequest(item));
  if (request) {
    const resolvedUin = await resolveUin(ctx, request.friendUid);
    assertExpectedTarget(expectedUserId, resolvedUin, "request_target_mismatch");
    const buddyService = ctx.core.context.session.getBuddyService();
    if (typeof buddyService?.approvalFriendRequest !== "function") throw codedError("friend_request_action_unavailable");
    const nativeResult = await withNativeTimeout(
      buddyService.approvalFriendRequest({
        friendUid: request.friendUid,
        reqTime: String(request.reqTime),
        accept: approve
      }),
      "BuddyService.approvalFriendRequest",
      nativeSubmitTimeoutMs
    );
    const failure = nativeFailure(nativeResult);
    if (failure) throw codedError(failure.message, { nativeCode: failure.code });
    const confirmed = await confirmBuddyRequest(ctx, request, approve);
    if (!confirmed) throw codedError("request_action_unconfirmed");
    let remarkApplied = false;
    if (approve && note && typeof ctx.core.apis.FriendApi?.setBuddyRemark === "function") {
      try {
        await withNativeTimeout(
          ctx.core.apis.FriendApi.setBuddyRemark(request.friendUid, note),
          "FriendApi.setBuddyRemark",
          nativeLookupTimeoutMs
        );
        remarkApplied = true;
      } catch {
        remarkApplied = false;
      }
    }
    return {
      sub_type: request.isDoubt ? "doubt" : "add",
      target_id: resolvedUin || null,
      confirmation: approve ? "friend_list" : "request_resolved",
      remark_applied: remarkApplied
    };
  }

  const doubtRequests = await readDoubtFriendRequests(ctx, 100);
  const doubt = doubtRequests.find((item) => doubtRequestFlag(item) === flag);
  if (!doubt) throw codedError("request_not_found");
  if (!approve) throw codedError("doubt_reject_unsupported");
  const targetId = normalizeQqId(doubt?.user_id ?? doubt?.uin);
  assertExpectedTarget(expectedUserId, targetId, "request_target_mismatch");
  const buddyService = ctx.core.context.session.getBuddyService();
  if (typeof buddyService?.approvalDoubtBuddyReq !== "function") throw codedError("doubt_friend_request_action_unavailable");
  const nativeResult = await withNativeTimeout(
    buddyService.approvalDoubtBuddyReq(flag, "", ""),
    "BuddyService.approvalDoubtBuddyReq",
    nativeSubmitTimeoutMs
  );
  const failure = nativeFailure(nativeResult);
  if (failure) throw codedError(failure.message, { nativeCode: failure.code });
  const confirmed = await confirmDoubtFriendRequest(ctx, flag, targetId);
  if (!confirmed) throw codedError("request_action_unconfirmed");
  return {
    sub_type: "doubt",
    target_id: targetId || null,
    confirmation: targetId ? "friend_list_or_request_resolved" : "request_resolved",
    remark_applied: false
  };
}

async function handleIncomingGroupRequest(ctx, { flag, approve, note, expectedGroupId }) {
  const requests = await readGroupRequests(ctx, groupNotifyLimit);
  const found = requests.find((item) => String(item.notify?.seq || "") === flag && isPendingGroupNotify(item.notify));
  if (!found) throw codedError("request_not_found");
  const groupId = normalizeQqId(found.notify?.group?.groupCode);
  assertExpectedTarget(expectedGroupId, groupId, "request_target_mismatch");
  const groupApi = ctx.core.apis.GroupApi;
  if (typeof groupApi?.handleGroupRequest !== "function") throw codedError("group_request_action_unavailable");
  const nativeResult = await withNativeTimeout(
    groupApi.handleGroupRequest(found.doubt, found.notify, approve ? 1 : 2, approve ? " " : (note || " ")),
    "GroupApi.handleGroupRequest",
    nativeSubmitTimeoutMs
  );
  const failure = nativeFailure(nativeResult);
  if (failure) throw codedError(failure.message, { nativeCode: failure.code });
  const subType = groupNotifySubType(found.notify);
  const confirmed = await confirmGroupRequest(ctx, found.notify, found.doubt, approve, subType);
  if (!confirmed) throw codedError("request_action_unconfirmed");
  return {
    sub_type: subType,
    target_id: groupId || null,
    confirmation: approve && subType === "invite" ? "group_list" : "request_resolved"
  };
}

async function readBuddyRequests(ctx) {
  if (typeof ctx.core.apis.FriendApi?.getBuddyReq !== "function") return [];
  const result = await withNativeTimeout(
    ctx.core.apis.FriendApi.getBuddyReq(),
    "FriendApi.getBuddyReq",
    nativeLookupTimeoutMs
  );
  return Array.isArray(result?.buddyReqs) ? result.buddyReqs : [];
}

async function readDoubtFriendRequests(ctx, count) {
  if (typeof ctx.core.apis.FriendApi?.getDoubtFriendRequest !== "function") return [];
  const result = await withNativeTimeout(
    ctx.core.apis.FriendApi.getDoubtFriendRequest(count),
    "FriendApi.getDoubtFriendRequest",
    nativeLookupTimeoutMs
  );
  for (const candidate of [result, result?.data, result?.requests, result?.buddyReqs]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function readGroupRequests(ctx, count) {
  const groupApi = ctx.core.apis.GroupApi;
  if (typeof groupApi?.getSingleScreenNotifies !== "function") return [];
  const [normal, doubt] = await Promise.all([
    withNativeTimeout(groupApi.getSingleScreenNotifies(false, count), "GroupApi.getSingleScreenNotifies", nativeLookupTimeoutMs),
    withNativeTimeout(groupApi.getSingleScreenNotifies(true, count), "GroupApi.getSingleScreenDoubtNotifies", nativeLookupTimeoutMs)
  ]);
  const output = [];
  const seen = new Set();
  for (const [items, isDoubt] of [[normal, false], [doubt, true]]) {
    for (const notify of Array.isArray(items) ? items : []) {
      const flag = String(notify?.seq || "");
      if (!flag || seen.has(flag)) continue;
      seen.add(flag);
      output.push({ doubt: isDoubt, notify });
    }
  }
  return output;
}

function isPendingIncomingBuddyRequest(request) {
  if (!request || request.isInitiator === true || request.isBuddy === true) return false;
  if (Number(request.reqType) === 1) return request.isDecide !== true;
  return request.isDecide !== true && Boolean(request.friendUid) && Boolean(request.reqTime);
}

function isPendingGroupNotify(notify) {
  return notify && Number(notify.status) === 1 && [1, 5, 7].includes(Number(notify.type));
}

async function normalizeBuddyRequest(ctx, request) {
  return {
    request_type: "friend",
    sub_type: request.isDoubt ? "doubt" : "add",
    flag: String(request.reqTime || ""),
    user_id: await resolveUin(ctx, request.friendUid),
    comment: String(request.extWords || "").slice(0, 500),
    requester_nickname: String(request.friendNick || request.nameMore || "").slice(0, 100),
    group_id: normalizeQqId(request.groupCode),
    source: request.sourceId == null ? "" : `source:${request.sourceId}`,
    time: normalizeRequestTime(request.reqTime)
  };
}

function normalizeDoubtFriendRequest(request) {
  return {
    request_type: "friend",
    sub_type: "doubt",
    flag: doubtRequestFlag(request),
    user_id: normalizeQqId(request?.user_id ?? request?.uin),
    comment: String(request?.reason || request?.msg || "").slice(0, 500),
    requester_nickname: String(request?.nickname || request?.nick || "").slice(0, 100),
    group_id: normalizeQqId(request?.group_code),
    source: String(request?.source || "").slice(0, 120),
    time: normalizeRequestTime(request?.time)
  };
}

async function normalizeGroupRequest(ctx, { notify }) {
  const actor = Number(notify.type) === 1 ? notify.user2 : notify.user1;
  return {
    request_type: "group",
    sub_type: groupNotifySubType(notify),
    flag: String(notify.seq || ""),
    user_id: await resolveUin(ctx, actor?.uid),
    group_id: normalizeQqId(notify.group?.groupCode),
    comment: String(notify.postscript || "").slice(0, 500),
    requester_nickname: String(actor?.nickName || "").slice(0, 100),
    group_name: String(notify.group?.groupName || "").slice(0, 100),
    time: normalizeRequestTime(notify.seq)
  };
}

async function confirmBuddyRequest(ctx, request, approve) {
  const deadline = Date.now() + confirmationTimeoutMs;
  do {
    if (approve && await isBuddyUid(ctx, request.friendUid)) return true;
    const current = await readBuddyRequests(ctx).catch(() => []);
    const found = current.find((item) => String(item?.reqTime || "") === String(request.reqTime));
    if (!approve && (!found || !isPendingIncomingBuddyRequest(found))) return true;
    if (Date.now() >= deadline) break;
    await delay(confirmationPollMs);
  } while (Date.now() < deadline);
  return false;
}

async function confirmDoubtFriendRequest(ctx, flag, targetId) {
  const deadline = Date.now() + confirmationTimeoutMs;
  do {
    if (targetId && await isFriendUin(ctx, targetId)) return true;
    const current = await readDoubtFriendRequests(ctx, 100).catch(() => []);
    if (!current.some((item) => doubtRequestFlag(item) === flag)) return true;
    if (Date.now() >= deadline) break;
    await delay(confirmationPollMs);
  } while (Date.now() < deadline);
  return false;
}

async function confirmGroupRequest(ctx, original, doubt, approve, subType) {
  const deadline = Date.now() + confirmationTimeoutMs;
  const groupId = normalizeQqId(original?.group?.groupCode);
  do {
    if (approve && subType === "invite" && groupId && await isGroupMember(ctx.core.apis.GroupApi, groupId)) return true;
    const current = await readGroupRequests(ctx, groupNotifyLimit).catch(() => []);
    const found = current.find((item) => item.doubt === doubt && String(item.notify?.seq || "") === String(original.seq));
    if (!(approve && subType === "invite") && (!found || !isPendingGroupNotify(found.notify))) return true;
    if (Date.now() >= deadline) break;
    await delay(confirmationPollMs);
  } while (Date.now() < deadline);
  return false;
}

async function isBuddyUid(ctx, uid) {
  if (!uid || typeof ctx.core.apis.FriendApi?.isBuddy !== "function") return false;
  return Boolean(await withNativeTimeout(
    ctx.core.apis.FriendApi.isBuddy(uid),
    "FriendApi.isBuddy",
    nativeLookupTimeoutMs
  ).catch(() => false));
}

async function isFriendUin(ctx, uin) {
  const uid = typeof ctx.core.apis.UserApi?.getUidByUinV2 === "function"
    ? await withNativeTimeout(ctx.core.apis.UserApi.getUidByUinV2(uin), "UserApi.getUidByUinV2", nativeLookupTimeoutMs).catch(() => "")
    : "";
  return isBuddyUid(ctx, uid);
}

async function isGroupMember(groupApi, targetId) {
  if (typeof groupApi?.getGroups !== "function") return false;
  const groups = await withNativeTimeout(groupApi.getGroups(false), "GroupApi.getGroups", nativeLookupTimeoutMs).catch(() => []);
  return Array.isArray(groups) && groups.some((group) => String(group?.groupCode || group?.group_id || "") === targetId);
}

async function confirmGroupMembership(groupApi, targetId) {
  const deadline = Date.now() + confirmationTimeoutMs;
  do {
    if (await isGroupMember(groupApi, targetId)) return true;
    if (Date.now() >= deadline) break;
    await delay(confirmationPollMs);
  } while (Date.now() < deadline);
  return false;
}

async function resolveUin(ctx, uid) {
  if (!uid || typeof ctx.core.apis.UserApi?.getUinByUidV2 !== "function") return "";
  const value = await withNativeTimeout(
    ctx.core.apis.UserApi.getUinByUidV2(uid),
    "UserApi.getUinByUidV2",
    nativeLookupTimeoutMs
  ).catch(() => "");
  return normalizeQqId(value);
}

function assertExpectedTarget(expected, actual, code) {
  if (expected && actual && expected !== actual) throw codedError(code);
}

function doubtRequestFlag(request) {
  return String(request?.flag || request?.uid || "").trim().slice(0, 512);
}

function groupNotifySubType(notify) {
  return Number(notify?.type) === 1 ? "invite" : "add";
}

function normalizeRequestTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  if (number > 10_000_000_000_000) return Math.floor(number / 1_000_000);
  if (number > 10_000_000_000) return Math.floor(number / 1_000);
  return Math.floor(number);
}

function unwrapGroupInfo(value, targetId) {
  const candidates = [value?.searchGroupInfo, value?.data?.searchGroupInfo, value?.data, value];
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
          result: await withNativeTimeout(groupService.reqToJoinGroup(request), "GroupService.reqToJoinGroup(request)", nativeSubmitTimeoutMs),
          apiShape: "request-object",
          apiArity
        };
      } catch (error) {
        if (!isNativeArgumentCountError(error, 2)) throw error;
      }
    }
    return {
      result: await withNativeTimeout(
        groupService.reqToJoinGroup(String(request.groupCode), request),
        "GroupService.reqToJoinGroup(groupCode,request)",
        nativeSubmitTimeoutMs
      ),
      apiShape: "group-code-request",
      apiArity
    };
  }
  if (!requiresApproval && typeof groupService.joinGroup === "function") {
    return {
      result: await withNativeTimeout(groupService.joinGroup(request), "GroupService.joinGroup(request)", nativeSubmitTimeoutMs),
      apiShape: "join-request-object",
      apiArity: methodArity(groupService, "joinGroup")
    };
  }
  throw codedError("reqToJoinGroup_unavailable");
}

function isNativeArgumentCountError(error, expectedCount) {
  const message = String(error?.message || error || "");
  const expected = Number(expectedCount);
  const needsMatch = message.match(/\bneeds?\s+([0-9]+)\s+arguments?\b/i);
  if (needsMatch && Number(needsMatch[1]) === expected) return true;
  const assertionMatch = message.match(/\bargc\s*==\s*([0-9]+)\b/i);
  return Boolean(assertionMatch && Number(assertionMatch[1]) === expected);
}

function nativeFailure(result, seen = new Set(), depth = 0) {
  if (result == null) return null;
  if (typeof result === "number") return result === 0 ? null : { code: result, message: `QQ native error ${result}` };
  if (typeof result !== "object" || depth > 4 || seen.has(result)) return null;
  seen.add(result);
  if (Array.isArray(result) && Number.isFinite(Number(result[0])) && Number(result[0]) !== 0) {
    return { code: Number(result[0]), message: String(typeof result[1] === "string" ? result[1] : `QQ native error ${result[0]}`) };
  }
  const code = firstFiniteNumber(result.result, result.code, result.retCode, result.errCode, result.errorCode);
  if (code != null && code !== 0) {
    return { code, message: String(result.errMsg || result.errorString || result.message || result.wording || `QQ native error ${code}`) };
  }
  const nested = Array.isArray(result)
    ? result.filter((item) => item && typeof item === "object")
    : [result.result, result.rsp, result.response, result.data].filter((item) => item && typeof item === "object");
  for (const candidate of nested) {
    const failure = nativeFailure(candidate, seen, depth + 1);
    if (failure) return failure;
  }
  return null;
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
  if (message === "request_not_found") return res.status(404).json({ ok: false, error: message });
  if (message === "request_target_mismatch" || message === "doubt_reject_unsupported") {
    return res.status(409).json({ ok: false, error: message });
  }
  if (message === "request_action_unconfirmed") return res.status(502).json({ ok: false, error: message });
  if (/unavailable$/.test(message)) return res.status(501).json({ ok: false, error: message });
  if (isRiskControlError(message, error?.nativeCode)) {
    return res.status(409).json({ ok: false, error: "risk_control_required", native_message: message });
  }
  return res.status(500).json({ ok: false, error: message, native_code: error?.nativeCode });
}

function codedError(code, fields = {}) {
  return Object.assign(new Error(code), fields);
}

function isRiskControlError(message, code) {
  return /captcha|risk|security|safe|verify code|风控|安全验证|验证码|频繁/i.test(String(message || ""))
    || new Set([40, 120, 140, 210, 22009]).has(Number(code));
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

function isLoopbackRequest(req) {
  const address = String(req?.raw?.socket?.remoteAddress || req?.raw?.connection?.remoteAddress || "").toLowerCase();
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return ipv4 === "127.0.0.1" || ipv4.startsWith("127.");
}

function normalizeQqId(value) {
  const id = String(value ?? "").trim();
  return /^[1-9][0-9]{3,19}$/.test(id) ? id : "";
}

function normalizeBoolean(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
