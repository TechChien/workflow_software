import { env } from "../config/env.js";
import { runNextReadyStep } from "../runtime/step-runner.js";

export function startPoller() {
  const timer = setInterval(async () => {
    await runNextReadyStep();
  }, env.WORKER_POLL_INTERVAL_MS);

  timer.unref();
  return timer;
}
