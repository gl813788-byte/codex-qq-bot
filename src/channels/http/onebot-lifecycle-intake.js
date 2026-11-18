// The OneBot webhook limiter bounds how many incoming events are parsed and
// remembered at once. A reply lifecycle can afterwards wait seconds for an
// interest judgment or minutes for a model turn. Holding the webhook slot for
// all of that let a busy group fill the queue, and NapCat's next events were
// refused with HTTP 429 and never reached the rolling context (2026-11-18).
//
// run(start) therefore resolves as soon as the lifecycle calls accept() (the
// event is remembered), or when it finishes first. A failure before
// acceptance still rejects, so the webhook answers with an error as before; a
// failure after acceptance goes to onLateError. Detached lifecycles stay
// tracked so shutdown can wait for them as it waited for open requests.
export function createOneBotLifecycleIntake({ onLateError = null } = {}) {
  const inFlight = new Set();

  return {
    run(start) {
      if (typeof start !== "function") return Promise.reject(new TypeError("start must be a function"));
      let accepted = false;
      let resolveAccepted;
      const acceptedSignal = new Promise((resolve) => { resolveAccepted = resolve; });
      const accept = () => {
        accepted = true;
        resolveAccepted();
      };
      const lifecycle = Promise.resolve().then(() => start(accept));
      const settled = lifecycle.then(() => undefined, (error) => {
        if (!accepted) return;
        try {
          onLateError?.(error);
        } catch {
          // Reporting must never turn a finished lifecycle into an unhandled rejection.
        }
      });
      inFlight.add(settled);
      settled.then(() => inFlight.delete(settled));
      return Promise.race([acceptedSignal, lifecycle]).then(() => undefined);
    },

    settle() {
      return Promise.allSettled([...inFlight]).then(() => undefined);
    },

    get size() {
      return inFlight.size;
    }
  };
}
