import { env } from "../config/env.js";
import { runNextReadyStep as defaultRunNextReadyStep } from "../runtime/step-runner.js";

type PollerDependencies = {
  intervalMs?: number;
  runNextReadyStep?: () => Promise<unknown>;
};

export function startPoller(dependencies: PollerDependencies = {}) {
  const intervalMs = dependencies.intervalMs ?? env.WORKER_POLL_INTERVAL_MS;
  const runNextReadyStep = dependencies.runNextReadyStep ?? defaultRunNextReadyStep;

  const timer = setInterval(async () => {
    await runNextReadyStep();
  }, intervalMs);

  timer.unref();
  return timer;
}
