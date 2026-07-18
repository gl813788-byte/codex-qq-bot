import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyQqImageTaskIntent,
  isQqImageOutputRequest,
  isQqPublicImageGenerationRequest,
  shouldUseQqFileImageTask
} from "../src/qq-file-image-task-intent.js";

test("recognizes natural reference-image generation and editing wording", () => {
  const requests = [
    "用这张图做参考画一张类似的图片",
    "参考这张图生成一张赛博朋克海报",
    "编辑这张图片，把背景换成蓝色",
    "修改这张图，把人物衣服改成红色",
    "把这张图的背景换成蓝色",
    "按这张图的风格再画一个角色",
    "将这张照片改成油画风",
    "给这个图加一个帽子"
  ];

  for (const request of requests) {
    assert.equal(isQqImageOutputRequest(request), true, request);
  }
});

test("uses an attached or quoted image to disambiguate short edit instructions", () => {
  assert.equal(isQqImageOutputRequest("把背景换成蓝色"), false);
  assert.equal(isQqImageOutputRequest("把背景换成蓝色", { hasImageReference: true }), true);
  assert.equal(isQqImageOutputRequest("去掉右边的人", { hasImageReference: true }), true);
  assert.equal(classifyQqImageTaskIntent("看看这张图里有什么").isImageOutput, false);
});

test("public image tasks allow generation and edits without exposing local files", () => {
  assert.equal(isQqPublicImageGenerationRequest("画一张猫咪图片"), true);
  assert.equal(isQqPublicImageGenerationRequest("编辑这张图片，把背景换成蓝色"), true);
  assert.equal(isQqPublicImageGenerationRequest("把背景换成蓝色", { hasImageReference: true }), true);
  assert.equal(isQqPublicImageGenerationRequest("发我图片"), false);
  assert.equal(isQqPublicImageGenerationRequest("编辑本地图片 /root/private.png"), false);
});

test("routes explicit reference edits before the broad image-look fallback", () => {
  const base = {
    enabled: true,
    isOwner: false,
    isPrivateMessage: false,
    isMentioned: true,
    isReplyToSelf: false,
    hasImageReference: true
  };

  assert.equal(shouldUseQqFileImageTask({ ...base, text: "编辑这张图片，把背景换成蓝色" }), true);
  assert.equal(shouldUseQqFileImageTask({ ...base, text: "把背景换成蓝色" }), true);
  assert.equal(shouldUseQqFileImageTask({ ...base, text: "看看这张图里有什么" }), false);
  assert.equal(shouldUseQqFileImageTask({ ...base, text: "编辑这张图片", isMentioned: false }), false);
});
