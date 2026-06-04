import {
  buildCodexClientOptions,
  createOpenAICodexGateway,
  type CodexRuntimeSettings
} from "../codex/codex-client.js";
import { PrismaCodexRunRecorder } from "../codex/prisma-codex-run-recorder.js";
import { env } from "../config/env.js";
import {
  executeStepRunWithCodexCore,
  type ExecuteStepRunWithCodexInput
} from "./codex-step-executor.js";

function runtimeSettings(): CodexRuntimeSettings {
  return {
    model: env.CODEX_MODEL,
    modelReasoningEffort: env.CODEX_REASONING_EFFORT,
    timeoutMs: env.CODEX_TURN_TIMEOUT_MS
  };
}

export async function executeStepRunWithCodex(input: ExecuteStepRunWithCodexInput) {
  return executeStepRunWithCodexCore(input, {
    gateway: createOpenAICodexGateway(
      buildCodexClientOptions({
        apiKey: env.CODEX_API_KEY,
        baseUrl: env.CODEX_BASE_URL
      })
    ),
    recorder: new PrismaCodexRunRecorder(),
    settings: runtimeSettings()
  });
}
