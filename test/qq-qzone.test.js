import assert from "node:assert/strict";
import test from "node:test";
import { computeQzoneGtk, createQqZoneClient, parseQzoneResponse } from "../src/qq-qzone.js";

test("parseQzoneResponse parses JSON, JSONP and form sender wrappers", () => {
  assert.deepEqual(parseQzoneResponse('{"code":0}'), { code: 0 });
  assert.deepEqual(parseQzoneResponse('cb({"code":0,"msglist":[]});', "cb"), { code: 0, msglist: [] });
  assert.deepEqual(parseQzoneResponse('<script>parent.callback({"ret":0,"message":"ok"})</script>'), { ret: 0, message: "ok" });
  assert.deepEqual(parseQzoneResponse('callback({ret:0,data:{url:"https://example.test/a&bo=abc"}})'), {
    ret: 0,
    data: { url: "https://example.test/a&bo=abc" }
  });
});

test("QQ Zone client reads and normalizes recent moods", async () => {
  const actions = [];
  const client = createQqZoneClient({
    callOneBotAction: async (endpoint, payload) => {
      actions.push({ endpoint, payload });
      return {
        ok: true,
        body: { data: { cookies: "uin=o0123456; skey=session; p_skey=test", token: 42 } }
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
      body: { data: { cookies: "uin=o0123456; skey=session; p_skey=test", token: 42 } }
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
  assert.equal(form.get("who"), "1");
  assert.equal(form.get("format"), "json");
  assert.equal(form.get("qzreferrer"), "https://user.qzone.qq.com/123456");
  assert.equal(request.url.searchParams.get("g_tk"), String(computeQzoneGtk("test")));
});

test("QQ Zone client builds the current comment request", async () => {
  let request;
  const client = createQqZoneClient({
    callOneBotAction: credentialsAction,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('{"code":0,"message":"ok"}');
    }
  });

  await client.comment({ uin: "654321", tid: "mood-tid", content: "看到了" });

  assert.match(request.url.pathname, /emotion_cgi_re_feeds$/);
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("topicId"), "654321_mood-tid__1");
  assert.equal(form.get("uin"), "123456");
  assert.equal(form.get("hostUin"), "654321");
  assert.equal(form.get("inCharset"), "utf-8");
  assert.equal(form.get("outCharset"), "utf-8");
  assert.equal(form.get("plat"), "qzone");
  assert.equal(form.get("source"), "ic");
});

for (const [label, content] of [["pure image", ""], ["text and image", "配图动态"]]) {
  test(`QQ Zone client publishes ${label} moods`, async () => {
    const requests = [];
    const client = createQqZoneClient({
      callOneBotAction: credentialsAction,
      statImpl: async () => ({ size: 3, isFile: () => true }),
      readFileImpl: async () => Buffer.from([1, 2, 3]),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (url.hostname === "up.qzone.qq.com") {
          return new Response('{ret:0,data:{url:"https://photo.test/image?x=1&bo=picture-bo",albumid:"album",lloc:"lloc",sloc:"sloc",type:1,height:480,width:640}}');
        }
        return new Response('{"code":0,"tid":"image-tid"}');
      }
    });

    const result = await client.publish({ content, imagePaths: ["/safe/task/photo.jpg"] });

    assert.equal(result.imageCount, 1);
    assert.equal(requests.length, 2);
    const upload = new URLSearchParams(requests[0].options.body);
    assert.equal(requests[0].url.hostname, "up.qzone.qq.com");
    assert.equal(upload.get("p_skey"), "test");
    assert.equal(upload.get("base64"), "1");
    assert.equal(upload.get("picfile"), "AQID");
    assert.equal(requests[0].options.headers.origin, "https://user.qzone.qq.com");
    const publish = new URLSearchParams(requests[1].options.body);
    assert.equal(publish.get("con"), content);
    assert.equal(publish.get("pic_bo"), "picture-bo");
    assert.equal(publish.get("richtype"), "1");
    assert.equal(publish.get("richval"), ",album,lloc,sloc,1,480,640,,480,640");
  });
}

test("QQ Zone client rejects more than nine images before making requests", async () => {
  const client = createQqZoneClient({ callOneBotAction: credentialsAction });
  await assert.rejects(
    () => client.publish({ imagePaths: Array.from({ length: 10 }, (_, index) => `/safe/${index}.jpg`) }),
    /最多只能包含 9 张图片/
  );
});

async function credentialsAction() {
  return {
    ok: true,
    body: { data: { cookies: "uin=o0123456; skey=session; p_skey=test", token: 42 } }
  };
}
