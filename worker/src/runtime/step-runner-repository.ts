import { Prisma, StepRunEvaluator } from "../generated/prisma/client.js";
import type { EvaluatorDecision } from "./evaluator-runner.js";
import { serializeError } from "./step-runner-errors.js";
import type { WorkflowStepRunStatus } from "./workflow-progression.js";

export type ReadyStepRun = {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  evaluator: StepRunEvaluator;
  codeWorkspaceId: string | null;
  beforeCommit: string | null;
  workflowRun: {
    inputPayload: Prisma.JsonValue;
    workflowVersion: {
      workflowId: string;
      yamlSnapshot: string;
      contentHash: string;
    };
  };
};

export type StepRunnerRepositoryClient = {
  stepRun: {
    findFirst(args: Prisma.StepRunFindFirstArgs): PromiseLike<ReadyStepRun | null>;
    findMany(
      args: Prisma.StepRunFindManyArgs
    ): PromiseLike<WorkflowStepRunStatus[]>;
    findUnique(args: Prisma.StepRunFindUniqueArgs): PromiseLike<{
      status: string;
      codexError: Prisma.JsonValue | null;
    } | null>;
    update(args: Prisma.StepRunUpdateArgs): PromiseLike<unknown>;
    updateMany(
      args: Prisma.StepRunUpdateManyArgs
    ): PromiseLike<{ count: number }>;
  };
  workflowRun: {
    updateMany(
      args: Prisma.WorkflowRunUpdateManyArgs
    ): PromiseLike<{ count: number }>;
  };
  artifactVersion: {
    updateMany(
      args: Prisma.ArtifactVersionUpdateManyArgs
    ): PromiseLike<{ count: number }>;
  };
  decisionEvent: {
    create(args: Prisma.DecisionEventCreateArgs): PromiseLike<unknown>;
  };
  runEvent: {
    create(args: Prisma.RunEventCreateArgs): PromiseLike<unknown>;
  };
};

export type StepRunnerRepository = {
  findNextReadyStep(): Promise<ReadyStepRun | null>;
  markWorkflowRunRunning(workflowRunId: string, now: Date): Promise<void>;
  markWorkflowRunFailed(workflowRunId: string, now: Date): Promise<void>;
  markWorkflowRunWaiting(workflowRunId: string): Promise<void>;
  completeWorkflowRun(workflowRunId: string, now: Date): Promise<void>;
  markStepRunFailed(
    stepRunId: string,
    error: unknown,
    now: Date
  ): Promise<void>;
  markStepRunWaitingForHumanReview(stepRunId: string): Promise<void>;
  markStepRunAccepted(stepRunId: string, now: Date): Promise<void>;
  markStepRunRejected(stepRunId: string, now: Date): Promise<void>;
  queueStepRunRerun(input: {
    workflowRunId: string;
    stepRunId: string;
    reason: string;
    comment?: string;
    resetToBeforeCommit: boolean;
  }): Promise<void>;
  persistDecisions(input: {
    workflowRunId: string;
    stepRunId: string;
    decisions: EvaluatorDecision[];
  }): Promise<void>;
  workflowStepRunStatuses(
    workflowRunId: string
  ): Promise<WorkflowStepRunStatus[]>;
  readyDownstreamStep(input: {
    workflowRunId: string;
    dependentStepId: string;
  }): Promise<void>;
};

export class StepStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepStateTransitionError";
  }
}

function requireTransition(result: { count: number }, message: string) {
  if (result.count !== 1) {
    throw new StepStateTransitionError(message);
  }
}

export class PrismaStepRunnerRepository implements StepRunnerRepository {
  constructor(private readonly client: StepRunnerRepositoryClient) {}

  async findNextReadyStep() {
    return this.client.stepRun.findFirst({
      where: {
        status: "READY",
        workflowRun: {
          status: {
            in: ["PENDING", "RUNNING"]
          }
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        workflowRun: {
          include: {
            workflowVersion: true
          }
        }
      }
    });
  }

  async markWorkflowRunRunning(workflowRunId: string, now: Date) {
    const result = await this.client.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: "PENDING"
      },
      data: {
        status: "RUNNING",
        startedAt: now
      }
    });
    console.log("[runtime.step-runner] workflow.status", {
      workflowRunId,
      from: "PENDING",
      to: "RUNNING",
      updated: result.count
    });
  }

  async markWorkflowRunFailed(workflowRunId: string, now: Date) {
    const result = await this.client.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: {
          in: ["PENDING", "RUNNING", "WAITING"]
        }
      },
      data: {
        status: "FAILED",
        completedAt: now
      }
    });
    console.log("[runtime.step-runner] workflow.status", {
      workflowRunId,
      from: ["PENDING", "RUNNING", "WAITING"],
      to: "FAILED",
      updated: result.count
    });
  }

  async markWorkflowRunWaiting(workflowRunId: string) {
    const result = await this.client.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: "RUNNING"
      },
      data: {
        status: "WAITING",
        completedAt: null
      }
    });
    console.log("[runtime.step-runner] workflow.status", {
      workflowRunId,
      from: "RUNNING",
      to: "WAITING",
      updated: result.count
    });
  }

  async completeWorkflowRun(workflowRunId: string, now: Date) {
    const result = await this.client.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: "RUNNING"
      },
      data: {
        status: "COMPLETED",
        completedAt: now
      }
    });
    console.log("[runtime.step-runner] workflow.status", {
      workflowRunId,
      from: "RUNNING",
      to: "COMPLETED",
      updated: result.count
    });
  }

  async markStepRunFailed(stepRunId: string, error: unknown, now: Date) {
    const current = await this.client.stepRun.findUnique({
      where: { id: stepRunId },
      select: {
        status: true,
        codexError: true
      }
    });

    if (!current || (current.status === "FAILED" && current.codexError)) {
      console.log("[runtime.step-runner] step.fail.skipped", {
        stepRunId,
        reason: !current ? "missing_step_run" : "already_failed_with_error",
        status: current?.status
      });
      return;
    }

    await this.client.stepRun.update({
      where: { id: stepRunId },
      data: {
        status: "FAILED",
        codexError: current.codexError ?? serializeError(error),
        completedAt: now
      }
    });
    console.log("[runtime.step-runner] step.status", {
      stepRunId,
      from: current.status,
      to: "FAILED"
    });
  }

  async markStepRunWaitingForHumanReview(stepRunId: string) {
    const result = await this.client.stepRun.updateMany({
      where: {
        id: stepRunId,
        status: "CODEX_COMPLETED"
      },
      data: {
        status: "WAITING_FOR_HUMAN_REVIEW",
        completedAt: null
      }
    });

    requireTransition(result, `StepRun ${stepRunId} was not CODEX_COMPLETED`);
    console.log("[runtime.step-runner] step.status", {
      stepRunId,
      from: "CODEX_COMPLETED",
      to: "WAITING_FOR_HUMAN_REVIEW",
      updated: result.count
    });
  }

  async markStepRunAccepted(stepRunId: string, now: Date) {
    const result = await this.client.stepRun.updateMany({
      where: {
        id: stepRunId,
        status: "CODEX_COMPLETED"
      },
      data: {
        status: "ACCEPTED",
        completedAt: now
      }
    });

    requireTransition(result, `StepRun ${stepRunId} was not CODEX_COMPLETED`);
    console.log("[runtime.step-runner] step.status", {
      stepRunId,
      from: "CODEX_COMPLETED",
      to: "ACCEPTED",
      updated: result.count
    });
  }

  async markStepRunRejected(stepRunId: string, now: Date) {
    const result = await this.client.stepRun.updateMany({
      where: {
        id: stepRunId,
        status: "CODEX_COMPLETED"
      },
      data: {
        status: "REJECTED",
        completedAt: now
      }
    });

    requireTransition(result, `StepRun ${stepRunId} was not CODEX_COMPLETED`);
    console.log("[runtime.step-runner] step.status", {
      stepRunId,
      from: "CODEX_COMPLETED",
      to: "REJECTED",
      updated: result.count
    });
  }

  async queueStepRunRerun(input: {
    workflowRunId: string;
    stepRunId: string;
    reason: string;
    comment?: string;
    resetToBeforeCommit: boolean;
  }) {
    await this.client.artifactVersion.updateMany({
      where: {
        producerStepRunId: input.stepRunId,
        status: "CANDIDATE"
      },
      data: {
        status: "SUPERSEDED"
      }
    });

    const result = await this.client.stepRun.updateMany({
      where: {
        id: input.stepRunId,
        status: "CODEX_COMPLETED"
      },
      data: {
        attempt: {
          increment: 1
        },
        status: "READY",
        codexThreadId: null,
        promptSnapshot: null,
        codexOptions: {},
        codexFinalResponse: null,
        codexUsage: Prisma.DbNull,
        codexError: Prisma.DbNull,
        codexCompletedAt: null,
        startedAt: null,
        completedAt: null,
        staleReason: null
      }
    });

    requireTransition(result, `StepRun ${input.stepRunId} was not CODEX_COMPLETED`);

    await this.client.workflowRun.updateMany({
      where: {
        id: input.workflowRunId,
        status: {
          in: ["PENDING", "RUNNING", "WAITING"]
        }
      },
      data: {
        status: "RUNNING",
        completedAt: null
      }
    });
    await this.client.runEvent.create({
      data: {
        workflowRunId: input.workflowRunId,
        eventType: "step_run.rerun_requested",
        payload: {
          stepRunId: input.stepRunId,
          reason: input.reason,
          comment: input.comment,
          resetToBeforeCommit: input.resetToBeforeCommit
        }
      }
    });
    console.log("[runtime.step-runner] step.rerun_queued", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      reason: input.reason,
      resetToBeforeCommit: input.resetToBeforeCommit
    });
  }

  async persistDecisions(input: {
    workflowRunId: string;
    stepRunId: string;
    decisions: EvaluatorDecision[];
  }) {
    for (const decision of input.decisions) {
      console.log("[runtime.step-runner] decision.persist.start", {
        workflowRunId: input.workflowRunId,
        stepRunId: input.stepRunId,
        source: decision.source,
        verdict: decision.verdict
      });
      await this.client.decisionEvent.create({
        data: {
          workflowRunId: input.workflowRunId,
          stepRunId: input.stepRunId,
          source: decision.source,
          verdict: decision.verdict,
          comment: decision.comment
        }
      });
      console.log("[runtime.step-runner] decision.persist.complete", {
        workflowRunId: input.workflowRunId,
        stepRunId: input.stepRunId,
        source: decision.source,
        verdict: decision.verdict
      });
    }
  }

  async workflowStepRunStatuses(workflowRunId: string) {
    return this.client.stepRun.findMany({
      where: {
        workflowRunId
      },
      select: {
        stepId: true,
        status: true
      }
    });
  }

  async readyDownstreamStep(input: {
    workflowRunId: string;
    dependentStepId: string;
  }) {
    const result = await this.client.stepRun.updateMany({
      where: {
        workflowRunId: input.workflowRunId,
        stepId: input.dependentStepId,
        status: "PENDING"
      },
      data: {
        status: "READY"
      }
    });

    requireTransition(
      result,
      `Dependent StepRun ${input.dependentStepId} was not PENDING`
    );
    console.log("[runtime.step-runner] downstream.status", {
      workflowRunId: input.workflowRunId,
      dependentStepId: input.dependentStepId,
      from: "PENDING",
      to: "READY",
      updated: result.count
    });
  }
}
