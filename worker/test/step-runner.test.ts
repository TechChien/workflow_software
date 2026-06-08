import { describe, expect, it } from "vitest";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../src/generated/prisma/client.js";
import type { ExecuteStepRunWithCodexInput } from "../src/runtime/codex-step-executor.js";
import type { EvaluateStepInput, EvaluatorDecision } from "../src/runtime/evaluator-runner.js";
import { runNextReadyStep, type StepRunnerDependencies } from "../src/runtime/step-runner.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

type WorkflowRunStatus = "PENDING" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED";
type StepRunStatus = "PENDING" | "READY" | "RUNNING" | "CODEX_COMPLETED" | "ACCEPTED" | "FAILED";

type WorkflowVersionRow = {
  id: string;
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
  status: StepRunStatus;
  evaluator: StepRunEvaluator;
  codeWorkspaceId: string | null;
  codexError: unknown;
  createdAt: Date;
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

  constructor(
    steps: Array<{
      id: string;
      type: "agent" | "code_agent";
      upstream?: string;
      downstream?: string;
      evaluator: StepRunEvaluator;
      status?: StepRunStatus;
      createdAt?: Date;
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
        upstream: step.upstream,
        downstream: step.downstream,
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: `Run ${step.id}.`,
        acceptance: { criteria: [] }
      })),
      ui: {}
    });

    this.workflowVersion = {
      id: this.workflowRun.workflowVersionId,
      yamlSnapshot: snapshot.yaml,
      contentHash: snapshot.contentHash
    };
    this.stepRuns = steps.map((step, index) => ({
      id: `step-run-${step.id}`,
      workflowRunId: this.workflowRun.id,
      stepId: step.id,
      status: step.status ?? (step.upstream ? "PENDING" : "READY"),
      evaluator: step.evaluator,
      codeWorkspaceId: "code-workspace-1",
      codexError: null,
      createdAt: step.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
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
          data: Partial<StepRunRow>;
        }) => {
          const matches = this.stepRuns.filter(
            (stepRun) =>
              (!args.where.id || stepRun.id === args.where.id) &&
              (!args.where.workflowRunId || stepRun.workflowRunId === args.where.workflowRunId) &&
              (!args.where.stepId || stepRun.stepId === args.where.stepId) &&
              statusMatches(stepRun.status, args.where.status)
          );
          matches.forEach((stepRun) => Object.assign(stepRun, args.data));
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

    stepRun.status = "CODEX_COMPLETED";
  };
}

function createEvaluator(evaluations: EvaluateStepInput[] = []) {
  return async (input: EvaluateStepInput): Promise<EvaluatorDecision> => {
    evaluations.push(input);
    return {
      stepRunId: input.stepRunId,
      source:
        input.evaluator === StepRunEvaluator.HUMAN_REVIEW
          ? DecisionSource.HUMAN
          : DecisionSource.EVALUATOR,
      verdict: DecisionVerdict.APPROVE
    };
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

  it("executes agent + MIXED, records approval, accepts the step, and readies downstream", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        downstream: "step-2",
        evaluator: StepRunEvaluator.MIXED
      },
      {
        id: "step-2",
        type: "agent",
        upstream: "step-1",
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

    expect(result).toMatchObject({ picked: true, outcome: "accepted" });
    expect(executions).toEqual([
      {
        stepRunId: "step-run-step-1",
        workingDirectory: "C:\\repo"
      }
    ]);
    expect(evaluations).toEqual([
      {
        stepRunId: "step-run-step-1",
        evaluator: StepRunEvaluator.MIXED
      }
    ]);
    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.requireStepRun("step-run-step-2").status).toBe("READY");
    expect(db.workflowRun.status).toBe("RUNNING");
    expect(db.decisionEvents).toMatchObject([
      {
        source: DecisionSource.EVALUATOR,
        verdict: DecisionVerdict.APPROVE
      }
    ]);
  });

  it("uses the run CodeWorkspace worktree when no working directory override is provided", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED
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

  it("executes agent + EVALUATOR_REVIEW through the stub approval path", async () => {
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

  it("executes code_agent + HUMAN_REVIEW through the stub approval path and advances downstream", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "code_agent",
        downstream: "step-2",
        evaluator: StepRunEvaluator.HUMAN_REVIEW
      },
      {
        id: "step-2",
        type: "agent",
        upstream: "step-1",
        evaluator: StepRunEvaluator.MIXED
      }
    ]);

    await expect(runNextReadyStep(dependencies(db))).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });
    expect(db.requireStepRun("step-run-step-1").status).toBe("ACCEPTED");
    expect(db.requireStepRun("step-run-step-2").status).toBe("READY");
    expect(db.decisionEvents[0]?.source).toBe(DecisionSource.HUMAN);
  });

  it("marks the workflow run completed after final step approval", async () => {
    const db = new FakeRuntimeDb([
      {
        id: "step-1",
        type: "agent",
        evaluator: StepRunEvaluator.MIXED
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
