import assert from "node:assert/strict";
import test from "node:test";
import { createQqZoneClient, parseQzoneResponse } from "../src/qq-qzone.js";

test("parseQzoneResponse parses JSON, JSONP and form sender wrappers", () => {
  assert.deepEqual(parseQzoneResponse('{"code":0}'), { code: 0 });
  assert.deepEqual(parseQzoneResponse('cb({"code":0,"msglist":[]});', "cb"), { code: 0, msglist: [] });
  assert.deepEqual(parseQzoneResponse('<script>parent.callback({"ret":0,"message":"ok"})</script>'), { ret: 0, message: "ok" });
});

test("QQ Zone client reads and normalizes recent moods", async () => {
  const actions = [];
  const client = createQqZoneClient({
    callOneBotAction: async (endpoint, payload) => {
      actions.push({ endpoint, payload });
      return {
        ok: true,
        body: { data: { cookies: "uin=o0123456; p_skey=test", token: 42 } }
      };
    },
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, "user.qzone.qq.com");
      assert.equal(url.searchParams.get("uin"), "123456");
      assert.match(options.headers.cookie, /p_skey/);
      return new Response('_codexQzoneCallback({"code":0,"msglist":[{"tid":"abc","uin":123456,"created_time":10,"content":"hello<br>world","cmtnum":2}]});');
    }
  });
  const items = await client.list({ count: 1 });
  assert.equal(actions[0].endpoint, "get_credentials");
  assert.deepEqual(items, [{
    tid: "abc",
    uin: "123456",
    createdTime: 10,
    content: "hello\nworld",
    commentCount: 2,
    forwardCount: 0,
    pictureCount: 0
  }]);
});

test("QQ Zone client builds current text publish request", async () => {
  let request;
  const client = createQqZoneClient({
    callOneBotAction: async () => ({
      ok: true,
      body: { data: { cookies: "uin=o0123456; p_skey=test", token: 42 } }
    }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('callback({"code":0,"tid":"new-tid"})');
    }
  });
  const result = await client.publish("测试动态");
  assert.equal(result.tid, "new-tid");
  assert.match(request.url.pathname, /emotion_cgi_publish_v6$/);
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("con"), "测试动态");
  assert.equal(form.get("ugc_right"), "1");
  assert.equal(form.get("format"), "fs");
});
