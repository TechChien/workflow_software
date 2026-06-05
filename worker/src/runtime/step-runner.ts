import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DecisionVerdict,
  type Prisma,
  type StepRunEvaluator
} from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import type { ExecuteStepRunWithCodexInput } from "./codex-step-executor.js";
import { executeStepRunWithCodex } from "./execute-step-run-with-codex.js";
import {
  evaluateStepArtifact,
  type EvaluatorDecision,
  type EvaluateStepInput
} from "./evaluator-runner.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

export type StepRunnerResult =
  | { picked: false }
  | {
      picked: true;
      stepRunId: string;
      workflowRunId: string;
      outcome: "accepted" | "failed" | "race_lost";
    };

type ReadyStepRun = {
  id: string;
  workflowRunId: string;
  stepId: string;
  evaluator: StepRunEvaluator;
  workflowRun: {
    workflowVersion: {
      yamlSnapshot: string;
      contentHash: string;
    };
  };
};

type StepRunnerClient = {
  stepRun: {
    findFirst(args: Prisma.StepRunFindFirstArgs): PromiseLike<ReadyStepRun | null>;
    findUnique(args: Prisma.StepRunFindUniqueArgs): PromiseLike<{
      status: string;
      codexError: Prisma.JsonValue | null;
    } | null>;
    update(args: Prisma.StepRunUpdateArgs): PromiseLike<unknown>;
    updateMany(args: Prisma.StepRunUpdateManyArgs): PromiseLike<{ count: number }>;
  };
  workflowRun: {
    updateMany(args: Prisma.WorkflowRunUpdateManyArgs): PromiseLike<{ count: number }>;
  };
  decisionEvent: {
    create(args: Prisma.DecisionEventCreateArgs): PromiseLike<unknown>;
  };
};

export type StepRunnerDependencies = {
  client?: StepRunnerClient;
  executeStepRun?: (input: ExecuteStepRunWithCodexInput) => Promise<unknown>;
  evaluateStep?: (input: EvaluateStepInput) => Promise<EvaluatorDecision>;
  resolveWorkingDirectory?: () => string | Promise<string>;
  now?: () => Date;
};

function defaultWorkingDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function serializeError(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) {
    return {
      code: "step_runner_error",
      message: error.message
    };
  }

  return {
    code: "step_runner_error",
    message: String(error)
  };
}

function isReadyRaceError(error: unknown) {
  return error instanceof Error && error.message.includes("was not READY");
}

async function markWorkflowRunRunning(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date
) {
  await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "PENDING"
    },
    data: {
      status: "RUNNING",
      startedAt: now
    }
  });
}

async function markWorkflowRunFailed(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date
) {
  await client.workflowRun.updateMany({
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
}

async function markStepRunFailed(
  client: StepRunnerClient,
  stepRunId: string,
  error: unknown,
  now: Date
) {
  const current = await client.stepRun.findUnique({
    where: { id: stepRunId },
    select: {
      status: true,
      codexError: true
    }
  });

  if (!current || (current.status === "FAILED" && current.codexError)) {
    return;
  }

  await client.stepRun.update({
    where: { id: stepRunId },
    data: {
      status: "FAILED",
      codexError: current.codexError ?? serializeError(error),
      completedAt: now
    }
  });
}

async function markStepRunAccepted(
  client: StepRunnerClient,
  stepRunId: string,
  now: Date
) {
  const result = await client.stepRun.updateMany({
    where: {
      id: stepRunId,
      status: "CODEX_COMPLETED"
    },
    data: {
      status: "ACCEPTED",
      completedAt: now
    }
  });

  if (result.count !== 1) {
    throw new Error(`StepRun ${stepRunId} was not CODEX_COMPLETED`);
  }
}

async function persistDecision(
  client: StepRunnerClient,
  input: {
    workflowRunId: string;
    stepRunId: string;
    decision: EvaluatorDecision;
  }
) {
  await client.decisionEvent.create({
    data: {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      source: input.decision.source,
      verdict: input.decision.verdict,
      comment: input.decision.comment
    }
  });
}

async function readyDownstreamStep(
  client: StepRunnerClient,
  input: {
    workflowRunId: string;
    downstreamStepId: string;
  }
) {
  const result = await client.stepRun.updateMany({
    where: {
      workflowRunId: input.workflowRunId,
      stepId: input.downstreamStepId,
      status: "PENDING"
    },
    data: {
      status: "READY"
    }
  });

  if (result.count !== 1) {
    throw new Error(`Downstream StepRun ${input.downstreamStepId} was not PENDING`);
  }
}

async function completeWorkflowRun(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date
) {
  await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "RUNNING"
    },
    data: {
      status: "COMPLETED",
      completedAt: now
    }
  });
}

export async function runNextReadyStep(
  dependencies: StepRunnerDependencies = {}
): Promise<StepRunnerResult> {
  const client: StepRunnerClient =
    dependencies.client ?? (prisma as unknown as StepRunnerClient);
  const executeStepRun = dependencies.executeStepRun ?? executeStepRunWithCodex;
  const evaluateStep = dependencies.evaluateStep ?? evaluateStepArtifact;
  const resolveWorkingDirectory =
    dependencies.resolveWorkingDirectory ?? defaultWorkingDirectory;
  const now = dependencies.now ?? (() => new Date());

  const stepRun = await client.stepRun.findFirst({
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

  if (!stepRun) {
    return { picked: false };
  }

  const resultBase = {
    picked: true as const,
    stepRunId: stepRun.id,
    workflowRunId: stepRun.workflowRunId
  };

  try {
    const workflow = parseVerifiedWorkflowSnapshot(
      stepRun.workflowRun.workflowVersion.yamlSnapshot,
      stepRun.workflowRun.workflowVersion.contentHash
    );
    const step = workflow.steps.find((candidate) => candidate.id === stepRun.stepId);

    if (!step) {
      throw new Error(`Published workflow snapshot does not contain step ${stepRun.stepId}`);
    }

    await markWorkflowRunRunning(client, stepRun.workflowRunId, now());
    await executeStepRun({
      stepRunId: stepRun.id,
      workingDirectory: await resolveWorkingDirectory()
    });

    const decision = await evaluateStep({
      stepRunId: stepRun.id,
      evaluator: stepRun.evaluator
    });
    await persistDecision(client, {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      decision
    });

    if (decision.verdict !== DecisionVerdict.APPROVE) {
      throw new Error(`Unsupported evaluator verdict for MVP: ${decision.verdict}`);
    }

    await markStepRunAccepted(client, stepRun.id, now());

    if (step.downstream) {
      await readyDownstreamStep(client, {
        workflowRunId: stepRun.workflowRunId,
        downstreamStepId: step.downstream
      });
    } else {
      await completeWorkflowRun(client, stepRun.workflowRunId, now());
    }

    return {
      ...resultBase,
      outcome: "accepted"
    };
  } catch (error) {
    if (isReadyRaceError(error)) {
      return {
        ...resultBase,
        outcome: "race_lost"
      };
    }

    const failureTime = now();
    await markStepRunFailed(client, stepRun.id, error, failureTime);
    await markWorkflowRunFailed(client, stepRun.workflowRunId, failureTime);

    return {
      ...resultBase,
      outcome: "failed"
    };
  }
}
