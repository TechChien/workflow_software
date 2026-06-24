import { createExecutorAgentRuntime } from "../agents/agent-factory.js";
import { PrismaCodexRunRecorder } from "../codex/prisma-codex-run-recorder.js";
import {
  executeStepRunWithAgentCore,
  type ExecuteStepRunWithCodexInput
} from "./codex-step-executor.js";

export async function executeStepRunWithAgent(input: ExecuteStepRunWithCodexInput) {
  const runtime = createExecutorAgentRuntime(input.agentOptions?.provider);

  return executeStepRunWithAgentCore(input, {
    ...runtime,
    recorder: new PrismaCodexRunRecorder()
  });
}
