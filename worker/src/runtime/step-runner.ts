import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DecisionVerdict,
  type Prisma,
  type StepRunEvaluator,
} from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import type { ExecuteStepRunWithCodexInput } from "./codex-step-executor.js";
import { executeStepRunWithCodex } from "./execute-step-run-with-codex.js";
import {
  acceptProducedArtifacts,
  prepareCodexRuntimeContext,
  persistDeclaredOutputArtifacts,
  rejectProducedArtifacts,
  stepNeedsArtifactRuntime,
  type ArtifactRuntimeClient,
} from "./artifact-runtime.js";
import {
  evaluateStepArtifact,
  type EvaluateStepInput,
  type EvaluateStepResult,
  type EvaluatorDecision,
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
  codeWorkspaceId: string | null;
  workflowRun: {
    workflowVersion: {
      workflowId: string;
      yamlSnapshot: string;
      contentHash: string;
    };
  };
};

type StepRunnerClient = {
  stepRun: {
    findFirst(
      args: Prisma.StepRunFindFirstArgs,
    ): PromiseLike<ReadyStepRun | null>;
    findUnique(args: Prisma.StepRunFindUniqueArgs): PromiseLike<{
      status: string;
      codexError: Prisma.JsonValue | null;
    } | null>;
    update(args: Prisma.StepRunUpdateArgs): PromiseLike<unknown>;
    updateMany(
      args: Prisma.StepRunUpdateManyArgs,
    ): PromiseLike<{ count: number }>;
  };
  workflowRun: {
    updateMany(
      args: Prisma.WorkflowRunUpdateManyArgs,
    ): PromiseLike<{ count: number }>;
  };
  codeWorkspace: {
    findFirst(args: Prisma.CodeWorkspaceFindFirstArgs): PromiseLike<{
      worktreePath: string;
    } | null>;
  };
  decisionEvent: {
    create(args: Prisma.DecisionEventCreateArgs): PromiseLike<unknown>;
  };
} & Partial<ArtifactRuntimeClient>;

export type StepWorkingDirectoryInput = {
  stepRunId: string;
  workflowRunId: string;
  codeWorkspaceId: string | null;
};

export type StepRunnerDependencies = {
  client?: StepRunnerClient;
  executeStepRun?: (input: ExecuteStepRunWithCodexInput) => Promise<unknown>;
  evaluateStep?: (input: EvaluateStepInput) => Promise<EvaluateStepResult>;
  resolveWorkingDirectory?: (
    input: StepWorkingDirectoryInput,
  ) => string | Promise<string>;
  resolveArtifactStoreRoot?: () => string | Promise<string>;
  now?: () => Date;
};

function defaultArtifactStoreRoot() {
  const workerRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  return path.resolve(workerRoot, env.ARTIFACT_STORE_ROOT);
}

function serializeError(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "step_runner_error";

    return {
      code,
      message: error.message,
    };
  }

  return {
    code: "step_runner_error",
    message: String(error),
  };
}

function extractCodexFinalResponse(result: unknown) {
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

function isReadyRaceError(error: unknown) {
  return error instanceof Error && error.message.includes("was not READY");
}

async function markWorkflowRunRunning(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date,
) {
  await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      startedAt: now,
    },
  });
}

async function markWorkflowRunFailed(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date,
) {
  await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: {
        in: ["PENDING", "RUNNING", "WAITING"],
      },
    },
    data: {
      status: "FAILED",
      completedAt: now,
    },
  });
}

async function markStepRunFailed(
  client: StepRunnerClient,
  stepRunId: string,
  error: unknown,
  now: Date,
) {
  const current = await client.stepRun.findUnique({
    where: { id: stepRunId },
    select: {
      status: true,
      codexError: true,
    },
  });

  if (!current || (current.status === "FAILED" && current.codexError)) {
    return;
  }

  await client.stepRun.update({
    where: { id: stepRunId },
    data: {
      status: "FAILED",
      codexError: current.codexError ?? serializeError(error),
      completedAt: now,
    },
  });
}

async function markStepRunAccepted(
  client: StepRunnerClient,
  stepRunId: string,
  now: Date,
) {
  const result = await client.stepRun.updateMany({
    where: {
      id: stepRunId,
      status: "CODEX_COMPLETED",
    },
    data: {
      status: "ACCEPTED",
      completedAt: now,
    },
  });

  if (result.count !== 1) {
    throw new Error(`StepRun ${stepRunId} was not CODEX_COMPLETED`);
  }
}

async function markStepRunRejected(
  client: StepRunnerClient,
  stepRunId: string,
  now: Date,
) {
  const result = await client.stepRun.updateMany({
    where: {
      id: stepRunId,
      status: "CODEX_COMPLETED",
    },
    data: {
      status: "REJECTED",
      completedAt: now,
    },
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
  },
) {
  await client.decisionEvent.create({
    data: {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      source: input.decision.source,
      verdict: input.decision.verdict,
      comment: input.decision.comment,
    },
  });
}

async function persistDecisions(
  client: StepRunnerClient,
  input: {
    workflowRunId: string;
    stepRunId: string;
    decisions: EvaluatorDecision[];
  },
) {
  for (const decision of input.decisions) {
    await persistDecision(client, {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      decision,
    });
  }
}

async function readyDownstreamStep(
  client: StepRunnerClient,
  input: {
    workflowRunId: string;
    downstreamStepId: string;
  },
) {
  const result = await client.stepRun.updateMany({
    where: {
      workflowRunId: input.workflowRunId,
      stepId: input.downstreamStepId,
      status: "PENDING",
    },
    data: {
      status: "READY",
    },
  });

  if (result.count !== 1) {
    throw new Error(
      `Downstream StepRun ${input.downstreamStepId} was not PENDING`,
    );
  }
}

async function completeWorkflowRun(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date,
) {
  await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "RUNNING",
    },
    data: {
      status: "COMPLETED",
      completedAt: now,
    },
  });
}

function requireArtifactRuntimeClient(
  client: StepRunnerClient,
): ArtifactRuntimeClient {
  if (
    !client.artifactVersion ||
    !client.stepRunArtifactInput ||
    !client.contextPathEvent
  ) {
    throw new Error(
      "Artifact runtime requires artifactVersion, stepRunArtifactInput, and contextPathEvent clients",
    );
  }

  return client as ArtifactRuntimeClient;
}

async function resolveCodeWorkspaceWorkingDirectory(
  client: StepRunnerClient,
  input: StepWorkingDirectoryInput,
) {
  const workspace = await client.codeWorkspace.findFirst({
    where: input.codeWorkspaceId
      ? {
          id: input.codeWorkspaceId,
          workflowRunId: input.workflowRunId,
        }
      : {
          workflowRunId: input.workflowRunId,
        },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      worktreePath: true,
    },
  });

  if (!workspace) {
    throw new Error(`StepRun ${input.stepRunId} does not have a CodeWorkspace`);
  }

  return workspace.worktreePath;
}

export async function runNextReadyStep(
  dependencies: StepRunnerDependencies = {},
): Promise<StepRunnerResult> {
  const client: StepRunnerClient =
    dependencies.client ?? (prisma as unknown as StepRunnerClient);
  const executeStepRun = dependencies.executeStepRun ?? executeStepRunWithCodex;
  const evaluateStep = dependencies.evaluateStep ?? evaluateStepArtifact;
  const resolveWorkingDirectory =
    dependencies.resolveWorkingDirectory ??
    ((input: StepWorkingDirectoryInput) =>
      resolveCodeWorkspaceWorkingDirectory(client, input));
  const resolveArtifactStoreRoot =
    dependencies.resolveArtifactStoreRoot ?? defaultArtifactStoreRoot;
  const now = dependencies.now ?? (() => new Date());

  const stepRun = await client.stepRun.findFirst({
    where: {
      status: "READY",
      workflowRun: {
        status: {
          in: ["PENDING", "RUNNING"],
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      workflowRun: {
        include: {
          workflowVersion: true,
        },
      },
    },
  });

  if (!stepRun) {
    return { picked: false };
  }

  const resultBase = {
    picked: true as const,
    stepRunId: stepRun.id,
    workflowRunId: stepRun.workflowRunId,
  };

  try {
    const workflow = parseVerifiedWorkflowSnapshot(
      stepRun.workflowRun.workflowVersion.yamlSnapshot,
      stepRun.workflowRun.workflowVersion.contentHash,
    );
    const step = workflow.steps.find(
      (candidate) => candidate.id === stepRun.stepId,
    );

    if (!step) {
      throw new Error(
        `Published workflow snapshot does not contain step ${stepRun.stepId}`,
      );
    }

    await markWorkflowRunRunning(client, stepRun.workflowRunId, now());
    const workingDirectory = await resolveWorkingDirectory({
      stepRunId: stepRun.id,
      workflowRunId: stepRun.workflowRunId,
      codeWorkspaceId: stepRun.codeWorkspaceId,
    });
    const artifactStoreRoot = await resolveArtifactStoreRoot();
    const artifactClient = stepNeedsArtifactRuntime(step)
      ? requireArtifactRuntimeClient(client)
      : undefined;
    const runtimeContext = artifactClient
      ? await prepareCodexRuntimeContext({
          client: artifactClient,
          workflowId: stepRun.workflowRun.workflowVersion.workflowId,
          workflowRunId: stepRun.workflowRunId,
          stepRunId: stepRun.id,
          step,
          workingDirectory,
          artifactStoreRoot,
        })
      : undefined;

    const executionResult = await executeStepRun({
      stepRunId: stepRun.id,
      workingDirectory,
      ...(runtimeContext ? { runtimeContext } : {}),
    });

    if (
      runtimeContext &&
      runtimeContext.outputArtifacts.length > 0 &&
      artifactClient
    ) {
      await persistDeclaredOutputArtifacts({
        client: artifactClient,
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        artifactStoreRoot,
        outputArtifacts: runtimeContext.outputArtifacts,
      });
    }

    const evaluation = await evaluateStep({
      stepRunId: stepRun.id,
      evaluator: stepRun.evaluator,
      workflowId: stepRun.workflowRun.workflowVersion.workflowId,
      workflowRunId: stepRun.workflowRunId,
      step,
      workingDirectory,
      artifactStoreRoot,
      codexFinalResponse: extractCodexFinalResponse(executionResult),
      ...(runtimeContext ? { runtimeContext } : {}),
    });
    await persistDecisions(client, {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      decisions: evaluation.decisions,
    });

    if (evaluation.finalVerdict !== DecisionVerdict.APPROVE) {
      if (artifactClient) {
        await rejectProducedArtifacts({
          client: artifactClient,
          stepRunId: stepRun.id,
        });
      }

      const rejectionTime = now();
      await markStepRunRejected(client, stepRun.id, rejectionTime);
      await markWorkflowRunFailed(client, stepRun.workflowRunId, rejectionTime);

      return {
        ...resultBase,
        outcome: "failed",
      };
    }

    if (artifactClient) {
      await acceptProducedArtifacts({
        client: artifactClient,
        stepRunId: stepRun.id,
        now: now(),
      });
    }

    await markStepRunAccepted(client, stepRun.id, now());

    if (step.downstream) {
      await readyDownstreamStep(client, {
        workflowRunId: stepRun.workflowRunId,
        downstreamStepId: step.downstream,
      });
    } else {
      await completeWorkflowRun(client, stepRun.workflowRunId, now());
    }

    return {
      ...resultBase,
      outcome: "accepted",
    };
  } catch (error) {
    if (isReadyRaceError(error)) {
      return {
        ...resultBase,
        outcome: "race_lost",
      };
    }

    const failureTime = now();
    await markStepRunFailed(client, stepRun.id, error, failureTime);
    await markWorkflowRunFailed(client, stepRun.workflowRunId, failureTime);

    return {
      ...resultBase,
      outcome: "failed",
    };
  }
}
