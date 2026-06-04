import {
  buildCodexClientOptions,
  buildCodexThreadOptions,
  createOpenAICodexGateway
} from "./codex-client.js";
import { normalizeCodexEvent } from "./codex-event-normalizer.js";
import { env } from "../config/env.js";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Inspect the current workspace and reply with one sentence describing the project.";
const workingDirectory = process.cwd();
const gateway = createOpenAICodexGateway(
  buildCodexClientOptions({
    apiKey: env.CODEX_API_KEY,
    baseUrl: env.CODEX_BASE_URL
  })
);
const threadOptions = buildCodexThreadOptions(workingDirectory, {
  model: env.CODEX_MODEL,
  modelReasoningEffort: env.CODEX_REASONING_EFFORT
});
const controller = new AbortController();
const timer = setTimeout(
  () => controller.abort(new Error(`Codex smoke turn timed out after ${env.CODEX_TURN_TIMEOUT_MS}ms`)),
  env.CODEX_TURN_TIMEOUT_MS
);

try {
  const events = await gateway.runTurn({
    prompt,
    threadOptions,
    signal: controller.signal
  });
  let completed = false;

  for await (const event of events) {
    if (event.type === "thread.started") {
      console.log(JSON.stringify({ type: event.type, threadId: event.thread_id }));
      continue;
    }

    const normalized = normalizeCodexEvent(event);
    if (normalized) {
      console.log(JSON.stringify(normalized));
    }

    if (event.type === "turn.completed") {
      completed = true;
    }

    if (event.type === "turn.failed") {
      throw new Error(event.error.message);
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  if (!completed) {
    throw new Error("Codex smoke event stream ended before turn.completed");
  }
} finally {
  clearTimeout(timer);
}
