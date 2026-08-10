import assert from "node:assert/strict";
import test from "node:test";
import { plugin_init, withNativeTimeout } from "../modules/napcat-social-bridge/index.mjs";

test("NapCat bridge removes proactive friend routes and exposes incoming request capabilities", async () => {
  const routes = new Map();
  await plugin_init(createContext(routes));

  assert.equal(routes.has("POST /add-friend"), false);
  assert.equal(routes.has("POST /inspect-friend"), false);
  assert.equal(routes.has("POST /pending-requests"), true);
  assert.equal(routes.has("POST /handle-request"), true);

  const response = responseRecorder();
  routes.get("GET /health")(localRequest(), response);
  assert.equal(response.body.version, 19);
  assert.ok(response.body.capabilities.includes("incoming-friend-request-handle"));
  assert.ok(response.body.capabilities.includes("incoming-group-request-handle"));
  assert.equal(response.body.capabilities.some((item) => /friend.*submit/i.test(item)), false);
});

test("NapCat bridge lists and truly approves an incoming friend request through the native service", async () => {
  const routes = new Map();
  const state = {
    friends: new Set(),
    requests: [{
      reqTime: "1700000000",
      friendUid: "uid:123456",
      reqType: 1,
      isInitiator: false,
      isDecide: false,
      isBuddy: false,
      isDoubt: false,
      extWords: "我是测试账号",
      friendNick: "测试用户",
      sourceId: 3999,
      groupCode: ""
    }]
  };
  const submissions = [];
  await plugin_init(createContext(routes, {
    friendApi: {
      async getBuddyReq() { return { buddyReqs: state.requests }; },
      async getDoubtFriendRequest() { return []; },
      async isBuddy(uid) { return state.friends.has(uid); },
      async setBuddyRemark() {}
    },
    buddyService: {
      async approvalFriendRequest(request) {
        submissions.push(request);
        state.requests = [];
        if (request.accept) state.friends.add(request.friendUid);
        return { result: 0 };
      }
    },
    userApi: {
      async getUinByUidV2() { return "123456"; }
    }
  }));

  const pending = responseRecorder();
  await routes.get("POST /pending-requests")(localRequest({ count: 20 }), pending);
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(pending.body.requests, [{
    request_type: "friend",
    sub_type: "add",
    flag: "1700000000",
    user_id: "123456",
    comment: "我是测试账号",
    requester_nickname: "测试用户",
    group_id: "",
    source: "source:3999",
    time: 1700000000
  }]);

  const handled = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "friend",
    flag: "1700000000",
    user_id: "123456",
    approve: true,
    note: "已验证"
  }), handled);
  assert.equal(handled.statusCode, 200);
  assert.equal(handled.body.status, "approved");
  assert.equal(handled.body.confirmation, "friend_list");
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    friendUid: "uid:123456",
    reqTime: "1700000000",
    accept: true
  });
});

test("NapCat bridge reports a failed request source instead of presenting it as an empty list", async () => {
  const routes = new Map();
  await plugin_init(createContext(routes, {
    friendApi: {
      async getBuddyReq() { throw new Error("buddy source unavailable"); },
      async getDoubtFriendRequest() { return []; }
    }
  }));

  const response = responseRecorder();
  await routes.get("POST /pending-requests")(localRequest({ count: 20 }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.requests, []);
  assert.deepEqual(response.body.source_errors, [{
    source: "ordinary_friend",
    error: "buddy source unavailable"
  }]);
});

test("NapCat bridge rejects an incoming friend request only after it leaves the pending list", async () => {
  const routes = new Map();
  let requests = [{
    reqTime: "1700000001",
    friendUid: "uid:654321",
    reqType: 1,
    isInitiator: false,
    isDecide: false,
    isBuddy: false
  }];
  let submissions = 0;
  await plugin_init(createContext(routes, {
    friendApi: {
      async getBuddyReq() { return { buddyReqs: requests }; },
      async getDoubtFriendRequest() { return []; },
      async isBuddy() { return false; }
    },
    buddyService: {
      async approvalFriendRequest(request) {
        submissions += 1;
        assert.equal(request.accept, false);
        requests = [];
      }
    },
    userApi: { async getUinByUidV2() { return "654321"; } }
  }));

  const handled = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "friend",
    flag: "1700000001",
    user_id: "654321",
    approve: false
  }), handled);
  assert.equal(handled.statusCode, 200);
  assert.equal(handled.body.status, "rejected");
  assert.equal(handled.body.confirmation, "request_resolved");
  assert.equal(submissions, 1);
});

test("NapCat bridge handles suspicious friend requests without pretending rejection is supported", async () => {
  const routes = new Map();
  let doubts = [{ flag: "doubt-flag", user_id: 998877, nickname: "可疑账号", reason: "来源异常" }];
  let approvals = 0;
  await plugin_init(createContext(routes, {
    friendApi: {
      async getBuddyReq() { return { buddyReqs: [] }; },
      async getDoubtFriendRequest() { return doubts; },
      async isBuddy() { return false; }
    },
    buddyService: {
      async approvalDoubtBuddyReq(flag) {
        assert.equal(flag, "doubt-flag");
        approvals += 1;
        doubts = [];
      }
    }
  }));

  const rejected = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "friend",
    flag: "doubt-flag",
    approve: false
  }), rejected);
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.error, "doubt_reject_unsupported");
  assert.equal(approvals, 0);

  const approved = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "friend",
    flag: "doubt-flag",
    approve: true
  }), approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.status, "approved");
  assert.equal(approvals, 1);
});

test("NapCat bridge lists and confirms group invitations and join requests", async () => {
  const routes = new Map();
  const invited = {
    seq: "1800000000000000",
    type: 1,
    status: 1,
    group: { groupCode: "987654", groupName: "邀请测试群" },
    user1: { uid: "unused", nickName: "" },
    user2: { uid: "uid:123456", nickName: "邀请人" },
    postscript: "来玩"
  };
  const join = {
    seq: "1800000000000001",
    type: 7,
    status: 1,
    group: { groupCode: "998877", groupName: "管理测试群" },
    user1: { uid: "uid:654321", nickName: "申请人" },
    user2: { uid: "", nickName: "" },
    postscript: "申请加入"
  };
  const groups = [];
  const operations = [];
  await plugin_init(createContext(routes, {
    groupApi: {
      async getSingleScreenNotifies(doubt) { return doubt ? [] : [invited, join]; },
      async handleGroupRequest(doubt, notify, operation, reason) {
        operations.push({ doubt, notify, operation, reason });
        notify.status = operation === 1 ? 2 : 3;
        if (notify.type === 1 && operation === 1) groups.push({ groupCode: notify.group.groupCode });
        return { result: 0 };
      },
      async getGroups() { return groups; }
    },
    userApi: {
      async getUinByUidV2(uid) { return uid === "uid:123456" ? "123456" : "654321"; }
    }
  }));

  const pending = responseRecorder();
  await routes.get("POST /pending-requests")(localRequest({ count: 20 }), pending);
  assert.deepEqual(pending.body.requests.map((item) => [item.sub_type, item.group_id, item.user_id]), [
    ["invite", "987654", "123456"],
    ["add", "998877", "654321"]
  ]);

  const acceptInvite = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "group",
    flag: invited.seq,
    group_id: "987654",
    approve: true
  }), acceptInvite);
  assert.equal(acceptInvite.statusCode, 200);
  assert.equal(acceptInvite.body.confirmation, "group_list");

  const rejectJoin = responseRecorder();
  await routes.get("POST /handle-request")(localRequest({
    request_type: "group",
    flag: join.seq,
    group_id: "998877",
    approve: false,
    reason: "资料不符"
  }), rejectJoin);
  assert.equal(rejectJoin.statusCode, 200);
  assert.equal(rejectJoin.body.confirmation, "request_resolved");
  assert.equal(operations.length, 2);
  assert.equal(operations[0].operation, 1);
  assert.equal(operations[1].operation, 2);
  assert.equal(operations[1].reason, "资料不符");
});

test("NapCat bridge handles active group questions, approval and membership states", async () => {
  const routes = new Map();
  const submitted = [];
  const groupInfo = {
    groupCode: "987654",
    groupName: "测试群",
    groupOption: 5,
    groupQuestion: "项目口令",
    joinGroupAuth: "auth-token",
    memberNum: 10,
    maxMemberNum: 200
  };
  await plugin_init(createContext(routes, {
    groupApi: {
      async getGroups() { return []; },
      async searchGroup() { return { groupCode: "987654", searchGroupInfo: groupInfo }; },
      async getSingleScreenNotifies() { return []; }
    },
    groupService: {
      reqToJoinGroup(request) {
        submitted.push(request);
        return { result: 0 };
      }
    }
  }));
  const handler = routes.get("POST /join-group");

  const missing = responseRecorder();
  await handler(localRequest({ target_id: "987654" }), missing);
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.body.error, "answer_required");

  const answered = responseRecorder();
  await handler(localRequest({ target_id: "987654", answer: "OpenAI" }), answered);
  assert.equal(answered.statusCode, 200);
  assert.equal(answered.body.status, "pending_approval");
  assert.deepEqual(submitted[0], {
    groupCode: 987654,
    sourceId: 3,
    sourceSubId: 0,
    applyMsg: "OpenAI",
    auth: "auth-token",
    token: "",
    noVerifyAuth: ""
  });
});

test("NapCat bridge reports a verification-free group join only after the group list changes", async () => {
  const routes = new Map();
  const groups = [];
  await plugin_init(createContext(routes, {
    groupApi: {
      async getGroups() { return groups; },
      async getSingleScreenNotifies() { return []; },
      async searchGroup() {
        return { searchGroupInfo: { groupCode: "987654", groupName: "直加群", groupOption: 1 } };
      }
    },
    groupService: {
      reqToJoinGroup(request) {
        groups.push({ groupCode: String(request.groupCode) });
        return { result: 0 };
      }
    }
  }));

  const response = responseRecorder();
  await routes.get("POST /join-group")(localRequest({ target_id: "987654" }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "joined");
});

test("NapCat bridge adapts hidden and explicit two-argument group APIs", async () => {
  for (const [groupService, expectedShape] of [
    [{ reqToJoinGroup(...args) { this.args = args; return { result: 0 }; } }, "request-object"],
    [{ reqToJoinGroup(groupCode, request) { this.args = [groupCode, request]; return { result: 0 }; } }, "group-code-request"]
  ]) {
    const routes = new Map();
    await plugin_init(createContext(routes, {
      groupApi: {
        async getGroups() { return []; },
        async getSingleScreenNotifies() { return []; },
        async searchGroup() {
          return { searchGroupInfo: { groupCode: "987654", groupOption: 2, joinGroupAuth: "auth" } };
        }
      },
      groupService
    }));
    const response = responseRecorder();
    await routes.get("POST /join-group")(localRequest({ target_id: "987654" }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.native_api_shape, expectedShape);
  }
});

test("NapCat bridge blocks non-loopback request operations and bounds native calls", async () => {
  const routes = new Map();
  await plugin_init(createContext(routes));
  const response = responseRecorder();
  await routes.get("POST /handle-request")({
    body: { request_type: "friend", flag: "x", approve: true },
    raw: { socket: { remoteAddress: "203.0.113.9" } }
  }, response);
  assert.equal(response.statusCode, 403);

  await assert.rejects(
    withNativeTimeout(new Promise(() => {}), "native-test", 10),
    (error) => error?.code === "native_timeout" && error?.nativeApi === "native-test"
  );
});

function createContext(routes, { buddyService, friendApi, groupApi, groupService, userApi } = {}) {
  const defaultFriendApi = {
    async getBuddyReq() { return { buddyReqs: [] }; },
    async getDoubtFriendRequest() { return []; },
    async isBuddy() { return false; }
  };
  const defaultGroupApi = {
    async getGroups() { return []; },
    async getSingleScreenNotifies() { return []; }
  };
  return {
    pluginName: "napcat-plugin-builtin",
    router: {
      getNoAuth(path, handler) { routes.set(`GET ${path}`, handler); },
      postNoAuth(path, handler) { routes.set(`POST ${path}`, handler); }
    },
    core: {
      apis: {
        FriendApi: friendApi || defaultFriendApi,
        GroupApi: groupApi || defaultGroupApi,
        UserApi: userApi || {
          async getUinByUidV2() { return ""; },
          async getUidByUinV2() { return ""; }
        }
      },
      context: {
        session: {
          getBuddyService() { return buddyService || {}; },
          getGroupService() { return groupService || {}; }
        }
      }
    },
    logger: { info() {}, error() {} }
  };
}

function localRequest(body = {}) {
  return { body, raw: { socket: { remoteAddress: "127.0.0.1" } } };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}
