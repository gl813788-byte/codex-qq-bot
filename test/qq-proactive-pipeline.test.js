import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqTwoModelProactiveApproval,
  QQ_AUTONOMOUS_PROACTIVE_KINDS,
  reconcileQqOrdinaryProactiveDecisionActivity,
  validateQqTwoModelProactiveDecision
} from "../src/qq-proactive-pipeline.js";

test("all autonomous QQ chat kinds carry an interest-gate then main-content contract", () => {
  for (const kind of Object.values(QQ_AUTONOMOUS_PROACTIVE_KINDS)) {
    const decision = {
      ok: true,
      proactive: true,
      ...createQqTwoModelProactiveApproval({
        kind,
        provider: "openrouter",
        model: "interest/test",
        task: `judge_${kind}`,
        interest: 76,
        reason: "现在适合出现",
        temperature: 0.8
      })
    };
    const result = validateQqTwoModelProactiveDecision(decision);
    assert.deepEqual(result, {
      ok: true,
      required: true,
      kind,
      reason: "two-model approval present"
    });
    assert.equal(decision.modelPipeline.interestGate.approved, true);
    assert.equal(decision.modelPipeline.mainContent.role, "conversation_content");
  }
});

test("autonomous QQ chat is blocked when either model role is missing", () => {
  const missingInterestGate = validateQqTwoModelProactiveDecision({
    ok: true,
    proactive: true,
    autonomous: true,
    proactiveKind: QQ_AUTONOMOUS_PROACTIVE_KINDS.COLD_GROUP_TOPIC,
    modelPipeline: {
      contract: "interest_gate_then_main_content",
      mainContent: { required: true, role: "conversation_content" }
    }
  });
  assert.equal(missingInterestGate.ok, false);
  assert.equal(missingInterestGate.required, true);

  const missingMain = validateQqTwoModelProactiveDecision({
    ok: true,
    proactive: true,
    ...createQqTwoModelProactiveApproval({
      kind: QQ_AUTONOMOUS_PROACTIVE_KINDS.PRIVATE_CONTACT
    }),
    modelPipeline: {
      contract: "interest_gate_then_main_content",
      interestGate: { required: true, approved: true }
    }
  });
  assert.equal(missingMain.ok, false);
});

test("reactive QQ replies do not require the autonomous two-model contract", () => {
  assert.deepEqual(validateQqTwoModelProactiveDecision({ ok: true }), {
    ok: true,
    required: false,
    kind: null,
    reason: "not autonomous"
  });
  assert.equal(validateQqTwoModelProactiveDecision({ ok: true }, { forceRequired: true }).ok, false);
});

test("unsupported proactive kinds cannot create an approval envelope", () => {
  assert.throws(
    () => createQqTwoModelProactiveApproval({ kind: "fixed_text_bypass" }),
    /Unsupported QQ autonomous proactive kind/
  );
});

test("ordinary interest approval survives human activity that arrives while its judge is running", () => {
  const decision = {
    ok: true,
    proactive: true,
    reason: "model final decision",
    ...createQqTwoModelProactiveApproval({
      kind: QQ_AUTONOMOUS_PROACTIVE_KINDS.ORDINARY_GROUP_REPLY,
      provider: "deepseek",
      model: "interest/test",
      task: "qq_ordinary_group_reply",
      interest: 45,
      reason: "the current exchange merits a reply"
    })
  };

  const reconciled = reconcileQqOrdinaryProactiveDecisionActivity(decision, {
    judgedActivityVersion: 10,
    currentActivityVersion: 12
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.reason, "model final decision");
  assert.equal(reconciled.activityAdvancedDuringJudge, true);
  assert.equal(reconciled.additionalActivityCount, 2);
  assert.equal(validateQqTwoModelProactiveDecision(reconciled).ok, true);
});

test("activity reconciliation does not revive declined or non-ordinary proactive decisions", () => {
  const declined = { ok: false, proactive: false, reason: "declined" };
  assert.equal(reconcileQqOrdinaryProactiveDecisionActivity(declined, {
    judgedActivityVersion: 2,
    currentActivityVersion: 3
  }), declined);

  const coldDecision = {
    ok: true,
    proactive: true,
    ...createQqTwoModelProactiveApproval({
      kind: QQ_AUTONOMOUS_PROACTIVE_KINDS.COLD_GROUP_TOPIC
    })
  };
  assert.equal(reconcileQqOrdinaryProactiveDecisionActivity(coldDecision, {
    judgedActivityVersion: 2,
    currentActivityVersion: 3
  }), coldDecision);
});
