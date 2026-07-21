import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const qzoneReadEndpoint = "https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6";
const qzoneWriteBase = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin";
const qzoneUploadEndpoint = "https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image";
const maxPublishImages = 9;
const maxImageBytes = 10 * 1024 * 1024;
const maxTotalImageBytes = 30 * 1024 * 1024;
const supportedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

export function createQqZoneClient({
  callOneBotAction,
  fetchImpl = fetch,
  readFileImpl = readFile,
  statImpl = stat,
  timeoutMs = 12000
}) {
  if (typeof callOneBotAction !== "function") throw new TypeError("callOneBotAction is required");

  async function credentials() {
    const result = await callOneBotAction("get_credentials", { domain: "qzone.qq.com" });
    const data = result?.body?.data || {};
    const cookies = String(data.cookies || "");
    const token = Number(data.token);
    const loginUin = (cookies.match(/(?:^|;\s*)uin=o0*([0-9]+)/) || [])[1] || "";
    const skey = readCookie(cookies, "skey");
    const pSkey = readCookie(cookies, "p_skey");
    if (!result?.ok || !cookies || !Number.isFinite(token) || !loginUin) {
      throw new Error(result?.error || "NapCat 未返回可用的 QQ 空间登录凭据");
    }
    return {
      cookies,
      token,
      loginUin,
      skey,
      pSkey,
      gtk: pSkey ? computeQzoneGtk(pSkey) : token
    };
  }

  async function list({ uin, count = 10 } = {}) {
    const auth = await credentials();
    const targetUin = normalizeQqId(uin) || auth.loginUin;
    const url = new URL(qzoneReadEndpoint);
    const callback = "_codexQzoneCallback";
    appendParams(url.searchParams, {
      uin: targetUin,
      ftype: 0,
      sort: 0,
      pos: 0,
      num: Math.max(1, Math.min(20, Number(count) || 10)),
      replynum: 0,
      g_tk: auth.gtk,
      callback,
      code_version: 1,
      format: "jsonp",
      need_private_comment: 1
    });
    const body = await qzoneFetch(url, { auth, method: "GET", callback });
    if (Number(body.code) !== 0) throw new Error(body.message || `QQ 空间返回错误 ${body.code}`);
    const items = Array.isArray(body.msglist) ? body.msglist : [];
    return items.map(normalizeQzoneMood).filter(Boolean);
  }

  async function publish(input) {
    const options = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { content: input };
    const text = normalizeContent(options.content, 2000);
    const imagePaths = normalizeImagePaths(options.imagePaths);
    if (!text && imagePaths.length === 0) throw new Error("动态内容和图片不能同时为空");
    const auth = await credentials();
    const uploadedImages = [];
    if (imagePaths.length > 0) {
      if (!auth.pSkey) throw new Error("NapCat 凭据缺少 QQ 空间 p_skey，暂时无法上传图片");
      let totalBytes = 0;
      for (const imagePath of imagePaths) {
        const info = await statImpl(imagePath);
        if (!info?.isFile?.()) throw new Error(`动态图片不是普通文件：${basename(imagePath)}`);
        if (Number(info.size) > maxImageBytes) throw new Error(`单张动态图片不能超过 ${maxImageBytes / 1024 / 1024} MiB`);
        totalBytes += Number(info.size) || 0;
        if (totalBytes > maxTotalImageBytes) throw new Error(`动态图片总大小不能超过 ${maxTotalImageBytes / 1024 / 1024} MiB`);
        uploadedImages.push(await uploadImage(imagePath, auth));
      }
    }
    const url = new URL(`${qzoneWriteBase}/emotion_cgi_publish_v6`);
    url.searchParams.set("g_tk", String(auth.gtk));
    url.searchParams.set("uin", auth.loginUin);
    const form = new URLSearchParams();
    appendParams(form, {
      syn_tweet_verson: 1,
      paramstr: 1,
      who: 1,
      con: text,
      feedversion: 1,
      ver: 1,
      ugc_right: 1,
      to_sign: 0,
      hostuin: auth.loginUin,
      code_version: 1,
      format: "json",
      qzreferrer: `https://user.qzone.qq.com/${auth.loginUin}`,
      ...(uploadedImages.length > 0 ? {
        pic_bo: uploadedImages.map((image) => image.picBo).join(","),
        richtype: 1,
        richval: uploadedImages.map((image) => image.richVal).join("\t")
      } : {})
    });
    const body = await qzoneFetch(url, { auth, method: "POST", form });
    assertQzoneWriteSuccess(body);
    return {
      tid: String(body.tid || body.topicId || body.data?.tid || ""),
      message: String(body.message || body.msg || "发表成功"),
      imageCount: uploadedImages.length
    };
  }

  async function uploadImage(imagePath, auth) {
    const extension = extname(imagePath).toLowerCase();
    if (!supportedImageExtensions.has(extension)) {
      throw new Error(`不支持的动态图片格式：${extension || "无扩展名"}`);
    }
    const content = await readFileImpl(imagePath);
    const form = new URLSearchParams();
    appendParams(form, {
      filename: basename(imagePath),
      uploadtype: 1,
      albumtype: 7,
      skey: auth.skey,
      uin: auth.loginUin,
      p_skey: auth.pSkey,
      output_type: "json",
      base64: 1,
      picfile: Buffer.from(content).toString("base64")
    });
    const body = await qzoneFetch(new URL(qzoneUploadEndpoint), {
      auth,
      method: "POST",
      form,
      referer: `https://user.qzone.qq.com/${auth.loginUin}`,
      origin: "https://user.qzone.qq.com"
    });
    assertQzoneWriteSuccess(body);
    const data = body?.data;
    if (!data || typeof data !== "object") throw new Error("QQ 空间图片上传响应缺少 data");
    const uploadUrl = String(data.url || "");
    const picBo = uploadUrl.includes("&bo=") ? uploadUrl.split("&bo=")[1] : "";
    if (!picBo) throw new Error("QQ 空间图片上传响应缺少 bo 参数");
    const height = finiteInteger(data.height);
    const width = finiteInteger(data.width);
    const richVal = `,${data.albumid || ""},${data.lloc || ""},${data.sloc || ""},${finiteInteger(data.type)},${height},${width},,${height},${width}`;
    return { picBo, richVal };
  }

  async function comment({ uin, tid, content }) {
    const text = normalizeContent(content, 500);
    const targetUin = normalizeQqId(uin);
    const targetTid = String(tid || "").trim();
    if (!targetUin || !targetTid) throw new Error("评论动态需要目标 QQ 和动态 tid");
    if (!text) throw new Error("评论内容不能为空");
    const auth = await credentials();
    const url = new URL(`${qzoneWriteBase}/emotion_cgi_re_feeds`);
    url.searchParams.set("g_tk", String(auth.gtk));
    const form = new URLSearchParams();
    appendParams(form, {
      topicId: `${targetUin}_${targetTid}__1`,
      uin: auth.loginUin,
      hostUin: targetUin,
      feedsType: 100,
      inCharset: "utf-8",
      outCharset: "utf-8",
      plat: "qzone",
      source: "ic",
      platformid: 52,
      format: "fs",
      ref: "feeds",
      content: text
    });
    const body = await qzoneFetch(url, { auth, method: "POST", form });
    assertQzoneWriteSuccess(body);
    return { message: String(body.message || body.msg || "评论成功") };
  }

  async function qzoneFetch(url, { auth, method, form, callback = "", referer = "", origin = "" }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          cookie: auth.cookies,
          referer: referer || `https://user.qzone.qq.com/${auth.loginUin}/main`,
          ...(origin ? { origin } : {}),
          "user-agent": "Mozilla/5.0 (Codex QQ Bot)",
          ...(form ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {})
        },
        body: form?.toString()
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`QQ 空间 HTTP ${response.status}`);
      return parseQzoneResponse(text, callback);
    } finally {
      clearTimeout(timer);
    }
  }

  return { list, publish, comment };
}

export function parseQzoneResponse(text, callback = "") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("QQ 空间返回了空响应");
  const candidates = [raw];
  if (callback && raw.startsWith(`${callback}(`)) candidates.push(raw.slice(callback.length + 1).replace(/\);?\s*$/, ""));
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    for (const json of [candidate, quoteUnquotedObjectKeys(candidate)]) {
      try {
        return JSON.parse(json);
      } catch {
        // Try the next wrapper format used by QZone's form sender.
      }
    }
  }
  throw new Error("无法解析 QQ 空间响应");
}

export function computeQzoneGtk(pSkey) {
  let hash = 5381;
  for (const char of String(pSkey || "")) hash += (hash << 5) + char.charCodeAt(0);
  return hash & 0x7fffffff;
}

function normalizeQzoneMood(item) {
  if (!item || typeof item !== "object" || !item.tid) return null;
  const content = normalizeContent(item.content || item.con || item.summary || "", 1200);
  return {
    tid: String(item.tid),
    uin: String(item.uin || ""),
    createdTime: Number(item.created_time || 0),
    content,
    commentCount: Number(item.cmtnum || 0),
    forwardCount: Number(item.fwdnum || 0),
    pictureCount: Number(item.pictotal || (Array.isArray(item.pic) ? item.pic.length : 0) || 0)
  };
}

function normalizeContent(value, maxLength) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim()
    .slice(0, maxLength);
}

function normalizeQqId(value) {
  const id = String(value || "").trim();
  return /^[1-9][0-9]{4,12}$/.test(id) ? id : "";
}

function normalizeImagePaths(value) {
  const paths = Array.isArray(value) ? value : [];
  if (paths.length > maxPublishImages) throw new Error(`动态最多只能包含 ${maxPublishImages} 张图片`);
  return [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))];
}

function readCookie(cookies, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(cookies || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`)) || [])[1] || "";
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function quoteUnquotedObjectKeys(value) {
  return String(value || "").replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
}

function appendParams(target, values) {
  for (const [key, value] of Object.entries(values)) target.set(key, String(value));
}

function assertQzoneWriteSuccess(body) {
  const code = body?.code ?? body?.ret ?? body?.err;
  if (code == null) throw new Error("QQ 空间响应缺少明确的操作结果码");
  if (code != null && Number(code) !== 0) {
    throw new Error(body.message || body.msg || `QQ 空间返回错误 ${code}`);
  }
}
