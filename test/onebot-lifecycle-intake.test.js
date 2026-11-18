import assert from "node:assert/strict";
import test from "node:test";
import { createConcurrencyLimiter } from "../src/concurrency-limiter.js";
import { createOneBotLifecycleIntake } from "../src/channels/http/onebot-lifecycle-intake.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("the webhook is answered once the event is accepted, while the lifecycle continues", async () => {
  const intake = createOneBotLifecycleIntake();
  const turn = deferred();
  let finished = false;
  await intake.run(async (accept) => {
    accept();
    await turn.promise;
    finished = true;
  });
  assert.equal(finished, false);
  assert.equal(intake.size, 1);
  turn.resolve();
  await intake.settle();
  assert.equal(finished, true);
  assert.equal(intake.size, 0);
});

// Events of a busy group arrive one after another while a judgment or model
// turn is still running (the low profile allows 2 webhook slots, 8 queued).
async function deliverBurst(handle, count = 30) {
  const limiter = createConcurrencyLimiter(2, { maxPending: 8 });
  const requests = [];
  for (let index = 0; index < count; index += 1) {
    requests.push(limiter.run(handle).then(
      () => ({ status: "fulfilled" }),
      (reason) => ({ status: "rejected", reason })
    ));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return Promise.all(requests);
}

test("a long lifecycle no longer holds the webhook slot, so a burst is not refused", async () => {
  const judge = deferred();
  const holding = deliverBurst(async () => { await judge.promise; });
  const intake = createOneBotLifecycleIntake();
  const detached = await deliverBurst(() => intake.run(async (accept) => {
    accept();
    await judge.promise;
  }));
  assert.equal(detached.filter((result) => result.status === "rejected").length, 0);
  assert.equal(intake.size, 30);
  judge.resolve();
  const refused = (await holding).filter((result) => result.status === "rejected");
  assert.equal(refused.length, 20);
  assert.equal(refused[0].reason.code, "LIMITER_QUEUE_FULL");
  await intake.settle();
  assert.equal(intake.size, 0);
});

test("a failure before acceptance still fails the webhook request", async () => {
  const late = [];
  const intake = createOneBotLifecycleIntake({ onLateError: (error) => late.push(error) });
  await assert.rejects(intake.run(async () => {
    throw new Error("remember failed");
  }), /remember failed/);
  await intake.settle();
  assert.deepEqual(late, []);
});

test("a failure after acceptance is reported instead of becoming an unhandled rejection", async () => {
  const late = [];
  const intake = createOneBotLifecycleIntake({
    onLateError: (error) => {
      late.push(error.message);
      throw new Error("reporter failed");
    }
  });
  await intake.run(async (accept) => {
    accept();
    await Promise.resolve();
    throw new Error("turn failed");
  });
  await intake.settle();
  assert.deepEqual(late, ["turn failed"]);
});

test("a lifecycle that ends without accepting resolves the request normally", async () => {
  const intake = createOneBotLifecycleIntake();
  await intake.run(async () => "ignored");
  await intake.settle();
  assert.equal(intake.size, 0);
});
