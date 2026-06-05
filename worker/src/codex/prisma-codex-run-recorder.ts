import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import type {
  CodexRunFailure,
  CodexRunRecorder,
  CodexStepRunSource,
  RecordedCodexEvent
} from "./codex-run-recorder.js";

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function requireTransition(result: { count: number }, message: string) {
  if (result.count !== 1) {
    throw new Error(message);
  }
}

export class PrismaCodexRunRecorder implements CodexRunRecorder {
  constructor(private readonly client: PrismaClient = prisma) {}

  async loadSource(stepRunId: string): Promise<CodexStepRunSource> {
    const stepRun = await this.client.stepRun.findUniqueOrThrow({
      where: { id: stepRunId },
      select: {
        stepId: true,
        workflowRun: {
          select: {
            workflowVersion: {
              select: {
                yamlSnapshot: true,
                contentHash: true
              }
            }
          }
        }
      }
    });

    return {
      stepId: stepRun.stepId,
      yamlSnapshot: stepRun.workflowRun.workflowVersion.yamlSnapshot,
      contentHash: stepRun.workflowRun.workflowVersion.contentHash
    };
  }

  async markStarted(input: {
    stepRunId: string;
    promptSnapshot: string;
    codexOptions: Record<string, unknown>;
  }): Promise<void> {
    const result = await this.client.stepRun.updateMany({
      where: {
        id: input.stepRunId,
        status: "READY"
      },
      data: {
        status: "RUNNING",
        promptSnapshot: input.promptSnapshot,
        codexOptions: inputJson(input.codexOptions),
        startedAt: new Date()
      }
    });

    await requireTransition(result, `StepRun ${input.stepRunId} was not READY`);
  }

  async recordThreadStarted(stepRunId: string, threadId: string): Promise<void> {
    await this.client.stepRun.update({
      where: { id: stepRunId },
      data: { codexThreadId: threadId }
    });
  }

  async appendEvent(stepRunId: string, event: RecordedCodexEvent): Promise<void> {
    await this.client.codexInteractionEvent.create({
      data: {
        stepRunId,
        sequence: event.sequence,
        externalItemId: event.externalItemId,
        kind: event.kind,
        status: event.status,
        payload: inputJson(event.payload)
      }
    });
  }

  async markCompleted(input: {
    stepRunId: string;
    finalResponse: string;
    usage: {
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      reasoning_output_tokens: number;
    };
  }): Promise<void> {
    const result = await this.client.stepRun.updateMany({
      where: {
        id: input.stepRunId,
        status: "RUNNING"
      },
      data: {
        status: "CODEX_COMPLETED",
        codexFinalResponse: input.finalResponse,
        codexUsage: inputJson(input.usage),
        codexCompletedAt: new Date()
      }
    });

    await requireTransition(result, `StepRun ${input.stepRunId} was not RUNNING`);
  }

  async markFailed(stepRunId: string, failure: CodexRunFailure): Promise<void> {
    const now = new Date();
    const result = await this.client.stepRun.updateMany({
      where: {
        id: stepRunId,
        status: "RUNNING"
      },
      data: {
        status: "FAILED",
        codexError: inputJson(failure),
        codexCompletedAt: now,
        completedAt: now
      }
    });

    await requireTransition(result, `StepRun ${stepRunId} was not RUNNING`);
  }
}
