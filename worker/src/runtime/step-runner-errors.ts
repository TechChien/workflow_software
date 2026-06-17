import type { Prisma } from "../generated/prisma/client.js";
import type { ReadyStepRun, StepRunnerRepository } from "./step-runner-repository.js";
import type { StepRunnerResult } from "./step-runner.js";

export function serializeError(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "step_runner_error";

    return {
      code,
      message: error.message
    };
  }

  return {
    code: "step_runner_error",
    message: String(error)
  };
}

export function extractCodexFinalResponse(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "finalResponse" in result &&
    typeof (result as { finalResponse?: unknown }).finalResponse === "string"
  ) {
    return (result as { finalResponse: string }).finalResponse;
  }

  return undefined;
}

export function isReadyRaceError(error: unknown) {
  return error instanceof Error && error.message.includes("was not READY");
}

export class StepRunnerErrorHandler {
  constructor(
    private readonly repository: StepRunnerRepository,
    private readonly now: () => Date
  ) {}

  async handle(input: {
    stepRun: ReadyStepRun;
    error: unknown;
  }): Promise<StepRunnerResult> {
    if (isReadyRaceError(input.error)) {
      console.log("[runtime.step-runner] step.race_lost", {
        workflowRunId: input.stepRun.workflowRunId,
        stepRunId: input.stepRun.id,
        stepId: input.stepRun.stepId,
        error:
          input.error instanceof Error
            ? {
                name: input.error.name,
                message: input.error.message
              }
            : { message: String(input.error) }
      });
      return {
        picked: true,
        stepRunId: input.stepRun.id,
        workflowRunId: input.stepRun.workflowRunId,
        outcome: "race_lost"
      };
    }

    const failureTime = this.now();
    await this.repository.markStepRunFailed(
      input.stepRun.id,
      input.error,
      failureTime
    );
    await this.repository.markWorkflowRunFailed(
      input.stepRun.workflowRunId,
      failureTime
    );
    console.log("[runtime.step-runner] step.failed", {
      workflowRunId: input.stepRun.workflowRunId,
      stepRunId: input.stepRun.id,
      stepId: input.stepRun.stepId,
      error:
        input.error instanceof Error
          ? {
              name: input.error.name,
              message: input.error.message,
              code:
                "code" in input.error &&
                typeof (input.error as { code?: unknown }).code === "string"
                  ? (input.error as { code: string }).code
                  : undefined
            }
          : { message: String(input.error) }
    });

    return {
      picked: true,
      stepRunId: input.stepRun.id,
      workflowRunId: input.stepRun.workflowRunId,
      outcome: "failed"
    };
  }
}
