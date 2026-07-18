const imageNounSource = [
  "图片",
  "图像",
  "照片",
  "相片",
  "截图",
  "海报",
  "示意图",
  "表情包",
  "头像",
  "壁纸",
  "封面",
  "插画",
  "画面",
  "原图",
  "参考图",
  "这张图",
  "这幅图",
  "这个图",
  "此图",
  "png",
  "jpe?g",
  "webp",
  "image",
  "photo",
  "screenshot",
  "poster",
  "图"
].join("|");

const createVerbSource = [
  "生成",
  "绘制",
  "制作",
  "创作",
  "设计",
  "重画",
  "重绘",
  "画",
  "做",
  "create",
  "generate",
  "draw",
  "render",
  "design"
].join("|");

const editVerbSource = [
  "编辑",
  "修改",
  "改(?:成|为|一下|一改)?",
  "变成",
  "转成",
  "转换(?:成)?",
  "换(?:成|为|掉)?",
  "更换",
  "替换",
  "去掉",
  "去除",
  "移除",
  "删除",
  "抹除",
  "加(?:上|个|一个|入)?",
  "添加",
  "补上",
  "美化",
  "修图",
  "润色",
  "重绘",
  "重画",
  "抠图",
  "扩图",
  "补全",
  "裁剪",
  "旋转",
  "翻转",
  "上色",
  "调色",
  "调整",
  "处理",
  "edit",
  "modify",
  "replace",
  "remove",
  "add",
  "recolor",
  "restyle",
  "transform",
  "crop",
  "resize",
  "inpaint",
  "outpaint"
].join("|");

const deliveryVerbSource = "(?:输出|保存|导出|发送|发)";
const imageNounPattern = `(?:${imageNounSource})`;
const createVerbPattern = `(?:${createVerbSource})`;
const editVerbPattern = `(?:${editVerbSource})`;
const createBeforeImage = new RegExp(`${createVerbPattern}.{0,40}${imageNounPattern}`, "i");
const imageBeforeCreate = new RegExp(`${imageNounPattern}.{0,48}${createVerbPattern}`, "i");
const editBeforeImage = new RegExp(`${editVerbPattern}.{0,40}${imageNounPattern}`, "i");
const imageBeforeEdit = new RegExp(`${imageNounPattern}.{0,48}${editVerbPattern}`, "i");
const standaloneEdit = new RegExp(editVerbPattern, "i");
const deliverImage = new RegExp(`${deliveryVerbSource}.{0,32}${imageNounPattern}`, "i");

export function classifyQqImageTaskIntent(text, { hasImageReference = false } = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { isCreation: false, isEdit: false, isDelivery: false, isImageOutput: false };
  }

  const isCreation = createBeforeImage.test(normalized) || imageBeforeCreate.test(normalized);
  const isEdit = editBeforeImage.test(normalized)
    || imageBeforeEdit.test(normalized)
    || (hasImageReference && standaloneEdit.test(normalized));
  const isDelivery = deliverImage.test(normalized);
  return {
    isCreation,
    isEdit,
    isDelivery,
    isImageOutput: isCreation || isEdit || isDelivery
  };
}

export function isQqImageOutputRequest(text, options = {}) {
  return classifyQqImageTaskIntent(text, options).isImageOutput;
}

export function isQqPublicImageGenerationRequest(text, options = {}) {
  const normalized = String(text || "");
  const intent = classifyQqImageTaskIntent(normalized, options);
  if (!intent.isCreation && !intent.isEdit) return false;
  if (hasAbsoluteLocalPath(normalized) || isQqFileReadRequest(normalized) || isQqLocalImageReadRequest(normalized)) return false;
  return true;
}

export function shouldUseQqFileImageTask({
  enabled,
  text,
  isOwner,
  isPrivateMessage,
  isMentioned,
  isReplyToSelf,
  hasImageReference
} = {}) {
  const normalized = String(text || "").trim();
  if (!enabled || !normalized) return false;

  const intentOptions = { hasImageReference: Boolean(hasImageReference) };
  const isOwnerImageOutput = Boolean(isOwner) && isQqImageOutputRequest(normalized, intentOptions);
  const isPublicImageGeneration = isQqPublicImageGenerationRequest(normalized, intentOptions);
  if (!isOwner && !isPublicImageGeneration) return false;
  if (!isPrivateMessage && !isMentioned && !isReplyToSelf) return false;

  // Explicit generation/editing must win over broad look-request words such
  // as “这张” and “图片”, which are also present in reference-image prompts.
  if (isOwnerImageOutput || isPublicImageGeneration) return true;
  if (hasImageReference && isQqImageLookRequest(normalized)) return false;
  if (!isOwner) return false;
  return isQqFileReadRequest(normalized) || isQqLocalImageReadRequest(normalized) || hasAbsoluteLocalPath(normalized);
}

export function isQqFileReadRequest(text) {
  return /(读|读取|打开|看看|看一下|查看|分析|总结|解释|发我|贴出来|列一下|列出).{0,24}(文件|日志|配置|代码|目录|路径|readme|json|txt|md|js|ts|py|png|jpe?g|webp|gif)/i.test(String(text || ""));
}

export function isQqLocalImageReadRequest(text) {
  return /(看|查看|分析|识别|描述|评价).{0,16}(本机|本地|这个路径|这张|图片|截图|图).{0,80}(\/|~\/|\.png|\.jpe?g|\.webp|\.gif)/i.test(String(text || ""));
}

export function hasAbsoluteLocalPath(text) {
  return /(?:^|\s)(?:\/[^\s"'，。！？]+|~\/[^\s"'，。！？]+)/.test(String(text || ""));
}

export function isQqImageLookRequest(text) {
  return /(看图|看一下图|看看图|这图|这个图|这张|图片|截图|表情包|图里|图上|什么图|配图|识别|看得懂|看不懂|何意味|逆天|抽象|离谱|绷不住|典中典|味太冲|评价一下|锐评|说说|怎么看|看法)/i.test(String(text || ""));
}
