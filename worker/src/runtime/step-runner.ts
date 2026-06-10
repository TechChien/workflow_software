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
  const result = await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      startedAt: now,
    },
  });
  console.log("[runtime.step-runner] workflow.status", {
    workflowRunId,
    from: "PENDING",
    to: "RUNNING",
    updated: result.count,
  });
}

async function markWorkflowRunFailed(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date,
) {
  const result = await client.workflowRun.updateMany({
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
  console.log("[runtime.step-runner] workflow.status", {
    workflowRunId,
    from: ["PENDING", "RUNNING", "WAITING"],
    to: "FAILED",
    updated: result.count,
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
    console.log("[runtime.step-runner] step.fail.skipped", {
      stepRunId,
      reason: !current ? "missing_step_run" : "already_failed_with_error",
      status: current?.status,
    });
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
  console.log("[runtime.step-runner] step.status", {
    stepRunId,
    from: current.status,
    to: "FAILED",
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
  console.log("[runtime.step-runner] step.status", {
    stepRunId,
    from: "CODEX_COMPLETED",
    to: "ACCEPTED",
    updated: result.count,
  });
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
  console.log("[runtime.step-runner] step.status", {
    stepRunId,
    from: "CODEX_COMPLETED",
    to: "REJECTED",
    updated: result.count,
  });
}

async function persistDecision(
  client: StepRunnerClient,
  input: {
    workflowRunId: string;
    stepRunId: string;
    decision: EvaluatorDecision;
  },
) {
  console.log("[runtime.step-runner] decision.persist.start", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    source: input.decision.source,
    verdict: input.decision.verdict,
  });
  await client.decisionEvent.create({
    data: {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      source: input.decision.source,
      verdict: input.decision.verdict,
      comment: input.decision.comment,
    },
  });
  console.log("[runtime.step-runner] decision.persist.complete", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    source: input.decision.source,
    verdict: input.decision.verdict,
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
  console.log("[runtime.step-runner] downstream.status", {
    workflowRunId: input.workflowRunId,
    downstreamStepId: input.downstreamStepId,
    from: "PENDING",
    to: "READY",
    updated: result.count,
  });
}

async function completeWorkflowRun(
  client: StepRunnerClient,
  workflowRunId: string,
  now: Date,
) {
  const result = await client.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: "RUNNING",
    },
    data: {
      status: "COMPLETED",
      completedAt: now,
    },
  });
  console.log("[runtime.step-runner] workflow.status", {
    workflowRunId,
    from: "RUNNING",
    to: "COMPLETED",
    updated: result.count,
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

  console.log("[runtime.step-runner] workspace.resolved", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    codeWorkspaceId: input.codeWorkspaceId,
    workingDirectory: workspace.worktreePath,
  });

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
    console.log("[runtime.step-runner] poll.no_ready_step");
    return { picked: false };
  }

  console.log("[runtime.step-runner] poll.picked_step", {
    workflowId: stepRun.workflowRun.workflowVersion.workflowId,
    workflowRunId: stepRun.workflowRunId,
    stepRunId: stepRun.id,
    stepId: stepRun.stepId,
    status: "READY",
    evaluator: stepRun.evaluator,
    codeWorkspaceId: stepRun.codeWorkspaceId,
  });

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

    console.log("[runtime.step-runner] workflow.loaded", {
      workflowId: stepRun.workflowRun.workflowVersion.workflowId,
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      stepId: step.id,
      stepType: step.type,
      upstreamStepId: step.upstream,
      downstreamStepId: step.downstream,
      evaluator: stepRun.evaluator,
      totalSteps: workflow.steps.length,
    });

    await markWorkflowRunRunning(client, stepRun.workflowRunId, now());
    const workingDirectory = await resolveWorkingDirectory({
      stepRunId: stepRun.id,
      workflowRunId: stepRun.workflowRunId,
      codeWorkspaceId: stepRun.codeWorkspaceId,
    });
    console.log("[runtime.step-runner] working_directory.ready", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      workingDirectory,
    });
    const artifactStoreRoot = await resolveArtifactStoreRoot();
    console.log("[runtime.step-runner] artifact_store.ready", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      artifactStoreRoot,
    });
    const artifactClient = stepNeedsArtifactRuntime(step)
      ? requireArtifactRuntimeClient(client)
      : undefined;
    console.log("[runtime.step-runner] artifact_runtime", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      enabled: Boolean(artifactClient),
      contextPaths: step.context_paths.length,
      inputArtifacts: step.input_artifacts.length,
      outputArtifacts: step.output_artifacts.length,
    });
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

    if (runtimeContext) {
      console.log("[runtime.step-runner] runtime_context.ready", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        contextPaths: runtimeContext.contextPaths.length,
        inputArtifacts: runtimeContext.inputArtifacts.length,
        outputArtifacts: runtimeContext.outputArtifacts.length,
      });
    }

    console.log("[runtime.step-runner] codex_executor.start", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      stepId: step.id,
      stepType: step.type,
      workingDirectory,
    });
    const executionResult = await executeStepRun({
      stepRunId: stepRun.id,
      workingDirectory,
      ...(runtimeContext ? { runtimeContext } : {}),
    });
    console.log("[runtime.step-runner] codex_executor.complete", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      threadId:
        executionResult &&
        typeof executionResult === "object" &&
        "threadId" in executionResult
          ? (executionResult as { threadId?: unknown }).threadId
          : undefined,
      finalResponseLength: extractCodexFinalResponse(executionResult)?.length ?? 0,
    });

    if (
      runtimeContext &&
      runtimeContext.outputArtifacts.length > 0 &&
      artifactClient
    ) {
      console.log("[runtime.step-runner] output_artifacts.persist.start", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        count: runtimeContext.outputArtifacts.length,
      });
      await persistDeclaredOutputArtifacts({
        client: artifactClient,
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        artifactStoreRoot,
        outputArtifacts: runtimeContext.outputArtifacts,
      });
      console.log("[runtime.step-runner] output_artifacts.persist.complete", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        count: runtimeContext.outputArtifacts.length,
      });
    }

    console.log("[runtime.step-runner] evaluator.start", {
      workflowId: stepRun.workflowRun.workflowVersion.workflowId,
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      stepId: step.id,
      evaluator: stepRun.evaluator,
    });
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
    console.log("[runtime.step-runner] evaluator.complete", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      finalVerdict: evaluation.finalVerdict,
      decisions: evaluation.decisions.map((decision) => ({
        source: decision.source,
        verdict: decision.verdict,
      })),
    });
    await persistDecisions(client, {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      decisions: evaluation.decisions,
    });

    if (evaluation.finalVerdict !== DecisionVerdict.APPROVE) {
      console.log("[runtime.step-runner] step.rejected", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: step.id,
        finalVerdict: evaluation.finalVerdict,
      });
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

    console.log("[runtime.step-runner] step.approved", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      stepId: step.id,
      finalVerdict: evaluation.finalVerdict,
    });
    if (artifactClient) {
      console.log("[runtime.step-runner] output_artifacts.accept.start", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
      });
      await acceptProducedArtifacts({
        client: artifactClient,
        stepRunId: stepRun.id,
        now: now(),
      });
      console.log("[runtime.step-runner] output_artifacts.accept.complete", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
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
      console.log("[runtime.step-runner] step.race_lost", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: stepRun.stepId,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : { message: String(error) },
      });
      return {
        ...resultBase,
        outcome: "race_lost",
      };
    }

    const failureTime = now();
    await markStepRunFailed(client, stepRun.id, error, failureTime);
    await markWorkflowRunFailed(client, stepRun.workflowRunId, failureTime);
    console.log("[runtime.step-runner] step.failed", {
      workflowRunId: stepRun.workflowRunId,
      stepRunId: stepRun.id,
      stepId: stepRun.stepId,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              code:
                "code" in error && typeof (error as { code?: unknown }).code === "string"
                  ? (error as { code: string }).code
                  : undefined,
            }
          : { message: String(error) },
    });

    return {
      ...resultBase,
      outcome: "failed",
    };
  }
}
