import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../src/generated/prisma/client.js";
import type { ExecuteStepRunWithCodexInput } from "../src/runtime/codex-step-executor.js";
import type {
  EvaluateStepInput,
  EvaluateStepResult,
  EvaluatorDecision
} from "../src/runtime/evaluator-runner.js";
import { runNextReadyStep, type StepRunnerDependencies } from "../src/runtime/step-runner.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

type WorkflowRunStatus = "PENDING" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED";
type StepRunStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "CODEX_COMPLETED"
  | "WAITING_FOR_HUMAN_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "FAILED"
  | "STALE";

type WorkflowVersionRow = {
  id: string;
  workflowId: string;
  yamlSnapshot: string;
  contentHash: string;
};

type WorkflowRunRow = {
  id: string;
  workflowVersionId: string;
  status: WorkflowRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
};

type StepRunRow = {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  evaluator: StepRunEvaluator;
  codeWorkspaceId: string | null;
  beforeCommit: string | null;
  afterCommit: string | null;
  codexThreadId: string | null;
  promptSnapshot: string | null;
  codexOptions: unknown;
  codexFinalResponse: string | null;
  codexUsage: unknown;
  codexError: unknown;
  codexCompletedAt: Date | null;
  staleReason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

type CodeWorkspaceRow = {
  id: string;
  workflowRunId: string;
  worktreePath: string;
  createdAt: Date;
};

type DecisionEventRow = {
  workflowRunId: string;
  stepRunId: string;
  source: DecisionSource;
  verdict: DecisionVerdict;
  comment?: string;
};

type ArtifactVersionRow = {
  id: string;
  workflowRunId: string;
  artifactKey: string;
  version: number;
  producerStepRunId: string;
  parentVersionId?: string | null;
  status: "CANDIDATE" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "STALE";
  contentUri: string;
  contentHash: string;
  acceptedAt?: Date | null;
};

type CodeChangeRecordRow = {
  stepRunId: string;
  codeWorkspaceId: string;
  beforeCommit: string;
  afterCommit?: string | null;
  status: string;
};

type RunEventRow = {
  workflowRunId: string;
  eventType: string;
  payload: unknown;
};

function statusMatches(actual: string, expected: unknown) {
  if (typeof expected === "string") {
    return actual === expected;
  }

  if (
    expected &&
    typeof expected === "object" &&
    "in" in expected &&
    Array.isArray((expected as { in: unknown }).in)
  ) {
    return ((expected as { in: string[] }).in).includes(actual);
  }

  return true;
}

class FakeRuntimeDb {
  workflowVersion: WorkflowVersionRow;
  workflowRun: WorkflowRunRow = {
    id: "workflow-run-1",
    workflowVersionId: "workflow-version-1",
    status: "PENDING",
    startedAt: null,
    completedAt: null
  };
  stepRuns: StepRunRow[] = [];
  codeWorkspaces: CodeWorkspaceRow[] = [
    {
      id: "code-workspace-1",
      workflowRunId: "workflow-run-1",
      worktreePath: "C:\\worktrees\\workflow-run-1",
      createdAt: new Date(Date.UTC(2026, 0, 1))
    }
  ];
  decisionEvents: DecisionEventRow[] = [];
  artifactVersions: ArtifactVersionRow[] = [];
  codeChangeRecords: CodeChangeRecordRow[] = [];
  runEvents: RunEventRow[] = [];

  constructor(
    steps: Array<{
      id: string;
      type: "agent" | "code_agent";
      dependsOn?: string[];
      upstream?: string;
      downstream?: string;
      evaluator: StepRunEvaluator;
      rerun?: boolean;
      status?: StepRunStatus;
      createdAt?: Date;
      outputArtifacts?: Array<{
        artifact: string;
        filename?: string;
        format: "markdown" | "plain_text";
      }>;
    }>
  ) {
    const snapshot = canonicalizeWorkflowDefinition({
      id: "workflow-1",
      name: "Step runner test workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: steps.map((step) => ({
        id: step.id,
        type: step.type,
        depends_on: step.dependsOn ?? [],
        upstream: step.upstream,
        downstream: step.downstream,
        input_artifacts: [],
        output_artifacts: step.outputArtifacts ?? [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: {
          evaluator:
            step.evaluator === StepRunEvaluator.HUMAN_REVIEW
              ? "human_review"
              : step.evaluator === StepRunEvaluator.EVALUATOR_REVIEW
                ? "evaluator_review"
                : "mixed",
          rerun: step.rerun ?? false
        },
        prompt: `Run ${step.id}.`,
        acceptance: { criteria: [] }
      })),
      ui: {}
    });

    this.workflowVersion = {
      id: this.workflowRun.workflowVersionId,
      workflowId: "workflow-1",
      yamlSnapshot: snapshot.yaml,
      contentHash: snapshot.contentHash
    };
    this.stepRuns = steps.map((step, index) => ({
      id: `step-run-${step.id}`,
      workflowRunId: this.workflowRun.id,
      stepId: step.id,
      attempt: 1,
      status:
        step.status ??
        ((step.dependsOn?.length ?? 0) > 0 || step.upstream
          ? "PENDING"
          : "READY"),
      evaluator: step.evaluator,
      codeWorkspaceId: "code-workspace-1",
      beforeCommit: null,
      afterCommit: null,
      codexThreadId: null,
      promptSnapshot: null,
      codexOptions: {},
      codexFinalResponse: null,
      codexUsage: null,
      codexError: null,
      codexCompletedAt: null,
      staleReason: null,
      createdAt: step.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      startedAt: null,
      completedAt: null
    }));
  }

  client(): NonNullable<StepRunnerDependencies["client"]> {
    return {
      stepRun: {
        findFirst: async () => {
          const candidate = this.stepRuns
            .filter(
              (stepRun) =>
                stepRun.status === "READY" &&
                ["PENDING", "RUNNING"].includes(this.workflowRun.status)
            )
            .sort(
              (left, right) =>
                left.createdAt.getTime() - right.createdAt.getTime() ||
                left.id.localeCompare(right.id)
            )[0];

          if (!candidate) {
            return null;
          }

          return {
            ...candidate,
            workflowRun: {
              ...this.workflowRun,
              workflowVersion: this.workflowVersion
            }
          };
        },
        findMany: async (args: {
          where?: {
            workflowRunId?: string;
          };
          select?: {
            stepId?: boolean;
            status?: boolean;
          };
        }) =>
          this.stepRuns
            .filter(
              (stepRun) =>
                !args.where?.workflowRunId ||
                stepRun.workflowRunId === args.where.workflowRunId
            )
            .map((stepRun) => ({
              stepId: stepRun.stepId,
              status: stepRun.status
            })),
        findUnique: async (args: { where: { id: string } }) => {
          const stepRun = this.requireStepRun(args.where.id);
          return {
            status: stepRun.status,
            codexError: stepRun.codexError
          };
        },
        update: async (args: { where: { id: string }; data: Partial<StepRunRow> }) => {
          const stepRun = this.requireStepRun(args.where.id);
          Object.assign(stepRun, args.data);
          return stepRun;
        },
        updateMany: async (args: {
          where: {
            id?: string;
            workflowRunId?: string;
            stepId?: string;
            status?: unknown;
          };
          data: Partial<StepRunRow> & { attempt?: { increment: number } };
        }) => {
          const matches = this.stepRuns.filter(
            (stepRun) =>
              (!args.where.id || stepRun.id === args.where.id) &&
              (!args.where.workflowRunId || stepRun.workflowRunId === args.where.workflowRunId) &&
              (!args.where.stepId || stepRun.stepId === args.where.stepId) &&
              statusMatches(stepRun.status, args.where.status)
          );
          matches.forEach((stepRun) => {
            const { attempt, ...data } = args.data;
            Object.assign(stepRun, data);
            if (attempt?.increment) {
              stepRun.attempt += attempt.increment;
            }
          });
          return { count: matches.length };
        }
      },
      workflowRun: {
        updateMany: async (args: {
          where: { id: string; status?: unknown };
          data: Partial<WorkflowRunRow>;
        }) => {
          const matches =
            this.workflowRun.id === args.where.id &&
            statusMatches(this.workflowRun.status, args.where.status)
              ? [this.workflowRun]
              : [];
          matches.forEach((workflowRun) => Object.assign(workflowRun, args.data));
          return { count: matches.length };
        }
      },
      codeWorkspace: {
        findFirst: async (args: {
          where?: {
            id?: string;
            workflowRunId?: string;
          };
        }) =>
          this.codeWorkspaces.find(
            (workspace) =>
              (!args.where?.id || workspace.id === args.where.id) &&
              (!args.where?.workflowRunId ||
                workspace.workflowRunId === args.where.workflowRunId)
          ) ?? null
      },
      decisionEvent: {
        create: async (args: { data: DecisionEventRow }) => {
          this.decisionEvents.push(args.data);
          return args.data;
        }
      },
      runEvent: {
        create: async (args: { data: RunEventRow }) => {
          this.runEvents.push(args.data);
          return args.data;
        }
      },
      artifactVersion: {
        findFirst: async (args: {
          where: {
            workflowRunId?: string;
            artifactKey?: string;
            status?: string;
          };
        }) => {
          const matches = this.artifactVersions
            .filter(
              (artifactVersion) =>
                (!args.where.workflowRunId ||
                  artifactVersion.workflowRunId === args.where.workflowRunId) &&
                (!args.where.artifactKey ||
                  artifactVersion.artifactKey === args.where.artifactKey) &&
                (!args.where.status || artifactVersion.status === args.where.status)
            )
            .sort((left, right) => right.version - left.version);

          return matches[0] ?? null;
        },
        create: async (args: { data: Omit<ArtifactVersionRow, "id"> }) => {
          const artifactVersion = {
            ...args.data,
            id: `artifact-version-${this.artifactVersions.length + 1}`
          };
          this.artifactVersions.push(artifactVersion);
          return artifactVersion;
        },
        updateMany: async (args: {
          where: {
            producerStepRunId?: string;
            status?: string;
          };
          data: Partial<ArtifactVersionRow>;
        }) => {
          const matches = this.artifactVersions.filter(
            (artifactVersion) =>
              (!args.where.producerStepRunId ||
                artifactVersion.producerStepRunId === args.where.producerStepRunId) &&
              (!args.where.status || artifactVersion.status === args.where.status)
          );
          matches.forEach((artifactVersion) => Object.assign(artifactVersion, args.data));
          return { count: matches.length };
        }
      },
      stepRunArtifactInput: {
        create: async () => ({})
      },
      contextPathEvent: {
        create: async () => ({})
      },
      codeChangeRecord: {
        create: async (args: { data: CodeChangeRecordRow }) => {
          this.codeChangeRecords.push(args.data);
          return args.data;
        },
        updateMany: async (args: {
          where: Partial<CodeChangeRecordRow>;
          data: Partial<CodeChangeRecordRow>;
        }) => {
          const matches = this.codeChangeRecords.filter(
            (record) =>
              (!args.where.stepRunId || record.stepRunId === args.where.stepRunId) &&
              (!args.where.codeWorkspaceId ||
                record.codeWorkspaceId === args.where.codeWorkspaceId) &&
              (!args.where.beforeCommit ||
                record.beforeCommit === args.where.beforeCommit) &&
              (!args.where.status || record.status === args.where.status)
          );
          matches.forEach((record) => Object.assign(record, args.data));
          return { count: matches.length };
        }
      }
    } as NonNullable<StepRunnerDependencies["client"]>;
  }

  requireStepRun(stepRunId: string) {
    const stepRun = this.stepRuns.find((candidate) => candidate.id === stepRunId);
    if (!stepRun) {
      throw new Error(`Missing fake StepRun ${stepRunId}`);
    }

    return stepRun;
  }
}

function createExecutor(db: FakeRuntimeDb, executions: ExecuteStepRunWithCodexInput[] = []) {
  return async (input: ExecuteStepRunWithCodexInput) => {
    executions.push(input);
    const stepRun = db.requireStepRun(input.stepRunId);
    if (stepRun.status !== "READY") {
      throw new Error(`StepRun ${input.stepRunId} was not READY`);
    }

    if (input.runtimeContext) {
      for (const outputArtifact of input.runtimeContext.outputArtifacts) {
        await mkdir(path.dirname(outputArtifact.absolutePath), { recursive: true });
        await writeFile(
          outputArtifact.absolutePath,
          `Artifact content for ${outputArtifact.artifact}`,
          "utf8"
        );
      }
    }

    stepRun.status = "CODEX_COMPLETED";
    return {
      stepRunId: input.stepRunId,
      threadId: "thread-1",
      finalResponse: "Codex finished successfully.",
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0
      }
    };
  };
}

async function makeTempDirectory(prefix: string) {
  const root = path.resolve(process.cwd(), "..", "data", "test-temp");
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}

function createEvaluator(evaluations: EvaluateStepInput[] = []) {
  return async (input: EvaluateStepInput): Promise<EvaluateStepResult> => {
    evaluations.push(input);

    if (input.evaluator === StepRunEvaluator.HUMAN_REVIEW) {
      return {
        decisions: [],
        finalVerdict: DecisionVerdict.APPROVE
      };
    }

    const firstDecision: EvaluatorDecision = {
      stepRunId: input.stepRunId,
      source: DecisionSource.EVALUATOR,
      verdict: DecisionVerdict.APPROVE,
      comment: "Approved."
    };

    if (input.evaluator === StepRunEvaluator.MIXED) {
      return {
        decisions: [firstDecision],
        finalVerdict: DecisionVerdict.APPROVE
      };
    }

    return {
      decisions: [firstDecision],
      finalVerdict: DecisionVerdict.APPROVE
    };
  };
}

function createCheckpointRuntime(db: FakeRuntimeDb): NonNullable<StepRunnerDependencies["checkpointRuntime"]> {
  return {
    recordBefore: async (input) => {
      const beforeCommit = `before-${input.stepRunId}-attempt-${db.requireStepRun(input.stepRunId).attempt}`;
      const stepRun = db.requireStepRun(input.stepRunId);
      stepRun.beforeCommit = beforeCommit;
      db.codeChangeRecords.push({
        stepRunId: input.stepRunId,
        codeWorkspaceId: input.codeWorkspaceId ?? "code-workspace-1",
        beforeCommit,
        status: "candidate"
      });
      return beforeCommit;
    },
    commitApproved: async (input) => {
      const afterCommit = `after-${input.stepRunId}-attempt-${db.requireStepRun(input.stepRunId).attempt}`;
      const stepRun = db.requireStepRun(input.stepRunId);
      stepRun.afterCommit = afterCommit;
      db.codeChangeRecords
        .filter(
          (record) =>
            record.stepRunId === input.stepRunId &&
            record.beforeCommit === input.beforeCommit &&
            record.status === "candidate"
        )
        .forEach((record) => {
          record.afterCommit = afterCommit;
          record.status = "accepted";
        });
      return afterCommit;
    },
    resetBeforeRerun: async (input) => {
      db.codeChangeRecords
        .filter(
          (record) =>
            record.stepRunId === input.stepRunId &&
            record.beforeCommit === input.beforeCommit &&
            record.status === "candidate"
        )
        .forEach((record) => {
          record.status = "reverted";
        });
      return true;
    },
    markRejected: async (input) => {
      db.codeChangeRecords
        .filter(
          (record) =>
            record.stepRunId === input.stepRunId &&
            record.beforeCommit === input.beforeCommit &&
            record.status === "candidate"
        )
        .forEach((record) => {
          record.status = "rejected";
        });
    }
  };
}

function dependencies(
  db: FakeRuntimeDb,
  overrides: Partial<StepRunnerDependencies> = {}
): StepRunnerDependencies {
  return {
    client: db.client(),
    executeStepRun: createExecutor(db),
    evaluateStep: createEvaluator(),
    checkpointRuntime: createCheckpointRuntime(db),
    resolveWorkingDirectory: () => "C:\\repo",
    now: () => new Date(Date.UTC(2026, 0, 2)),
    ...overrides
  };
}

describe("runNextReadyStep", () => {
  it("returns picked false when no READY step exists", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED,
        status: "PENDING"
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toEqual({ picked: false });
  });

  it("executes agent + MIXED, records evaluator approval, and waits for human review", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED
      },
      {
        id: "step-2",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);
    const executions: ExecuteStepRunWithCodexInput[] = [];
    const evaluations: EvaluateStepInput[] = [];

    const result = await runNextReadyStep(
      dependencies(db, {
        executeStepRun: createExecutor(db, executions),
        evaluateStep: createEvaluator(evaluations)
      })
    );

    expect(result).toMatchObject({ picked: true, outcome: "waiting_for_human_review" });
    expect(executions).toEqual([
      {
        stepRunId: "step-run-step-1",
        workingDirectory: "C:\\repo"
      }
    ]);
    expect(evaluations).toMatchObject([
      {
        stepRunId: "step-run-step-1",
        evaluator: StepRunEvaluator.MIXED,
        workflowId: "workflow-1",
        workflowRunId: "workflow-run-1",
        workingDirectory: "C:\\repo",
        artifactStoreRoot: expect.any(String),
        codexFinalResponse: "Codex finished successfully."
      }
    ]);
    expect(db.requireStepRun("step-run-step-1").status).toBe("WAITING_FOR_HUMAN_REVIEW");
    expect(db.requireStepRun("step-run-step-2").status).toBe("PENDING");
    expect(db.workflowRun.status).toBe("WAITING");
    expect(db.decisionEvents).toMatchObject([
      {
        source: DecisionSource.EVALUATOR,
        verdict: DecisionVerdict.APPROVE
      }
    ]);
  });

  it("readies every eligible fanout child after a parent is accepted", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      },
      {
        id: "step-2",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      },
      {
        id: "step-3",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });

    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.requireStepRun("step-run-step-2").status).toBe("READY");
    expect(db.requireStepRun("step-run-step-3").status).toBe("READY");
    expect(db.workflowRun.status).toBe("RUNNING");
  });

  it("waits to ready a fanin child until all dependencies are accepted", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      },
      {
        id: "step-2",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      },
      {
        id: "step-3",
        type: "agent",
        dependsOn: ["step-1", "step-2"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });

    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.requireStepRun("step-run-step-2").status).toBe("READY");
    expect(db.requireStepRun("step-run-step-3").status).toBe("PENDING");

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });

    expect(db.requireStepRun("step-run-step-2").status).toBe("ACCEPTED");
    expect(db.requireStepRun("step-run-step-3").status).toBe("READY");
    expect(db.workflowRun.status).toBe("RUNNING");
  });

  it("uses the run CodeWorkspace worktree when no working directory override is provided", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);
    const executions: ExecuteStepRunWithCodexInput[] = [];

    await expect(
      runNextReadyStep(
        dependencies(db, {
          executeStepRun: createExecutor(db, executions),
          resolveWorkingDirectory: undefined
        })
      )
    ).resolves.toMatchObject({ picked: true, outcome: "accepted" });

    expect(executions[0]?.workingDirectory).toBe("C:\\worktrees\\workflow-run-1");
  });

  it("executes agent + EVALUATOR_REVIEW through the evaluator approval path", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });
    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.decisionEvents[0]?.source).toBe(DecisionSource.EVALUATOR);
  });

  it("executes code_agent + HUMAN_REVIEW and waits before advancing downstream", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "code_agent",
        evaluator: StepRunEvaluator.HUMAN_REVIEW
      },
      {
        id: "step-2",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.MIXED
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "waiting_for_human_review"
    });
    expect(db.requireStepRun("step-run-step-1").status).toBe("WAITING_FOR_HUMAN_REVIEW");
    expect(db.requireStepRun("step-run-step-2").status).toBe("PENDING");
    expect(db.workflowRun.status).toBe("WAITING");
    expect(db.decisionEvents).toHaveLength(0);
  });

  it("marks the workflow run completed after final step approval", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });
    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.workflowRun.status).toBe("COMPLETED");
    expect(db.workflowRun.completedAt).toEqual(new Date(Date.UTC(2026, 0, 2)));
  });

  it("rejects mixed evaluator failures, rejects candidate artifacts, and does not ready downstream", async () => {
    const workingDirectory = await makeTempDirectory("step-worktree-");
    const artifactStoreRoot = await makeTempDirectory("artifact-store-");
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED,
        outputArtifacts: [
          {
            artifact: "report",
            filename: "report.md",
            format: "markdown"
          }
        ]
      },
      {
        id: "step-2",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    const result = await runNextReadyStep(
      dependencies(db, {
        resolveWorkingDirectory: () => workingDirectory,
        resolveArtifactStoreRoot: () => artifactStoreRoot,
        evaluateStep: async (input) => ({
          decisions: [
            {
              stepRunId: input.stepRunId,
              source: DecisionSource.EVALUATOR,
              verdict: DecisionVerdict.REJECT,
              comment: "The report does not satisfy the criteria."
            }
          ],
          finalVerdict: DecisionVerdict.REJECT
        })
      })
    );

    expect(result).toMatchObject({ picked: true, outcome: "failed" });
    expect(db.requireStepRun("step-run-step-1").status).toBe("REJECTED");
    expect(db.requireStepRun("step-run-step-2").status).toBe("PENDING");
    expect(db.workflowRun.status).toBe("FAILED");
    expect(db.decisionEvents).toMatchObject([
      {
        source: DecisionSource.EVALUATOR,
        verdict: DecisionVerdict.REJECT,
        comment: "The report does not satisfy the criteria."
      }
    ]);
    expect(db.artifactVersions).toMatchObject([
      {
        artifactKey: "report",
        producerStepRunId: "step-run-step-1",
        status: "REJECTED"
      }
    ]);
  });

  it("queues a checkpointed rerun for evaluator rejection when the step opts in", async () => {
    const workingDirectory = await makeTempDirectory("step-worktree-");
    const artifactStoreRoot = await makeTempDirectory("artifact-store-");
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW,
        rerun: true,
        outputArtifacts: [
          {
            artifact: "report",
            filename: "report.md",
            format: "markdown"
          }
        ]
      },
      {
        id: "step-2",
        type: "agent",
        dependsOn: ["step-1"],
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    const result = await runNextReadyStep(
      dependencies(db, {
        resolveWorkingDirectory: () => workingDirectory,
        resolveArtifactStoreRoot: () => artifactStoreRoot,
        evaluateStep: async (input) => ({
          decisions: [
            {
              stepRunId: input.stepRunId,
              source: DecisionSource.EVALUATOR,
              verdict: DecisionVerdict.REJECT,
              comment: "The report needs concrete evidence."
            }
          ],
          finalVerdict: DecisionVerdict.REJECT
        })
      })
    );

    expect(result).toMatchObject({ picked: true, outcome: "rerun_queued" });
    expect(db.requireStepRun("step-run-step-1")).toMatchObject({
      status: "READY",
      attempt: 2
    });
    expect(db.requireStepRun("step-run-step-2").status).toBe("PENDING");
    expect(db.workflowRun.status).toBe("RUNNING");
    expect(db.artifactVersions).toMatchObject([
      {
        artifactKey: "report",
        producerStepRunId: "step-run-step-1",
        status: "SUPERSEDED"
      }
    ]);
    expect(db.codeChangeRecords).toMatchObject([
      {
        stepRunId: "step-run-step-1",
        status: "reverted"
      }
    ]);
    expect(db.runEvents).toMatchObject([
      {
        eventType: "step_run.rerun_requested",
        payload: {
          stepRunId: "step-run-step-1",
          reason: "evaluator_rejected",
          comment: "The report needs concrete evidence.",
          resetToBeforeCommit: true
        }
      }
    ]);
  });

  it("marks the step and workflow run failed when Codex execution fails", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED
      }
    ]);

    await expect(
      runNextReadyStep(
        dependencies(db, {
          executeStepRun: async () => {
            throw new Error("Codex failed before recorder persisted state");
          }
        })
      )
    ).resolves.toMatchObject({ picked: true, outcome: "failed" });
    expect(db.requireStepRun("step-run-step-1").status).toBe("FAILED");
    expect(db.workflowRun.status).toBe("FAILED");
    expect(db.decisionEvents).toHaveLength(0);
  });

  it("marks the step and workflow run failed when evaluator execution fails", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.EVALUATOR_REVIEW
      }
    ]);

    await expect(
      runNextReadyStep(
        dependencies(db, {
          evaluateStep: async () => {
            const error = new Error("Evaluator returned invalid JSON");
            Object.assign(error, { code: "evaluator_invalid_json" });
            throw error;
          }
        })
      )
    ).resolves.toMatchObject({ picked: true, outcome: "failed" });
    expect(db.requireStepRun("step-run-step-1").status).toBe("FAILED");
    expect(db.workflowRun.status).toBe("FAILED");
    expect(db.decisionEvents).toHaveLength(0);
  });

  it("treats READY transition races as non-fatal", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED
      }
    ]);

    await expect(
      runNextReadyStep(
        dependencies(db, {
          executeStepRun: async (input) => {
            db.requireStepRun(input.stepRunId).status = "RUNNING";
            throw new Error(`StepRun ${input.stepRunId} was not READY`);
          }
        })
      )
    ).resolves.toMatchObject({ picked: true, outcome: "race_lost" });
    expect(db.requireStepRun("step-run-step-1").status).toBe("RUNNING");
    expect(db.workflowRun.status).toBe("RUNNING");
    expect(db.decisionEvents).toHaveLength(0);
  });
});
