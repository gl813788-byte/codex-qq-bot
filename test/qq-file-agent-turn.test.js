import assert from "node:assert/strict";
import test from "node:test";
import { buildQqFileAgentTurn } from "../src/app/qq-file-agent-turn.js";

const taskWorkspace = {
  root: "/runtime/task-1",
  inputDir: "/runtime/task-1/input",
  outputDir: "/runtime/task-1/output"
};

test("owner file Agent receives project capability with bounded writes", () => {
  const turn = buildQqFileAgentTurn({
    isOwner: true,
    ownerLabel: "主人",
    projectDir: "/project",
    taskWorkspace,
    requestText: "修改 src/app.js"
  });
  assert.equal(turn.cwd, "/project");
  assert.deepEqual(turn.writableRoots, [taskWorkspace.root, "/project"]);
  assert.deepEqual(turn.runtimeWorkspaceRoots, ["/project", taskWorkspace.root]);
  assert.match(turn.developerInstructions, /原生文件 Agent/);
  assert.match(turn.prompt, /修改 src\/app\.js/);
});

test("public image Agent is isolated to its task workspace", () => {
  const turn = buildQqFileAgentTurn({
    isOwner: false,
    projectDir: "/project",
    taskWorkspace,
    imagePaths: ["/runtime/task-1/input/source.png"],
    isImageGeneration: true
  });
  assert.equal(turn.cwd, taskWorkspace.root);
  assert.deepEqual(turn.writableRoots, [taskWorkspace.root]);
  assert.deepEqual(turn.runtimeWorkspaceRoots, [taskWorkspace.root]);
  assert.equal(turn.prompt.includes("当前项目：/project"), false);
  assert.match(turn.developerInstructions, /不得探查本机其他文件/);
});

test("Bot administrator file Agent can edit the project but must judge destructive risk", () => {
  const turn = buildQqFileAgentTurn({
    isOwner: false,
    isAdministrator: true,
    ownerLabel: "主人",
    projectDir: "/project",
    taskWorkspace,
    requestText: "整理项目文件"
  });
  assert.equal(turn.cwd, "/project");
  assert.deepEqual(turn.writableRoots, [taskWorkspace.root, "/project"]);
  assert.match(turn.developerInstructions, /对方不是主人/);
  assert.match(turn.developerInstructions, /删除重要文件/);
  assert.match(turn.developerInstructions, /必须拒绝/);
});
