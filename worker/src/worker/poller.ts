import { env } from "../config/env.js";
import { runNextReadyStep as defaultRunNextReadyStep } from "../runtime/step-runner.js";

type PollerDependencies = {
  intervalMs?: number;
  runNextReadyStep?: () => Promise<unknown>;
};

export function startPoller(dependencies: PollerDependencies = {}) {
  const intervalMs = dependencies.intervalMs ?? env.WORKER_POLL_INTERVAL_MS;
  const runNextReadyStep = dependencies.runNextReadyStep ?? defaultRunNextReadyStep;

  console.log("[worker.poller] started", { intervalMs });

  const timer = setInterval(async () => {
    const startedAt = Date.now();
    console.log("[worker.poller] tick.start", { intervalMs });

    try {
      const result = await runNextReadyStep();
      console.log("[worker.poller] tick.complete", {
        durationMs: Date.now() - startedAt,
        result
      });
    } catch (error) {
      console.log("[worker.poller] tick.failed", {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message
              }
            : { message: String(error) }
      });
      throw error;
    }
  }, intervalMs);

  timer.unref();
  return timer;
}
