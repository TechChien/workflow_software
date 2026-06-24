import path from "node:path";
import type { WorkflowYaml } from "@workflow-software/shared";
import { describe, expect, it, vi } from "vitest";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../src/generated/prisma/client.js";
import { StepRunnerOrchestrator } from "../src/runtime/step-runner-orchestrator.js";
import type { ReadyStepRun, StepRunnerRepository } from "../src/runtime/step-runner-repository.js";
import type { StepArtifactRuntime } from "../src/runtime/step-artifact-runtime.js";
import type { WorkspaceResolver } from "../src/runtime/workspace-resolver.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

function snapshotFor(step: {
  id: string;
  type?: "agent" | "code_agent";
  rerun?: boolean;
}): Pick<ReadyStepRun["workflowRun"]["workflowVersion"], "yamlSnapshot" | "contentHash"> {
  const workflow: WorkflowYaml = {
    id: "workflow-1",
    name: "Orchestrator test",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: step.id,
        type: step.type ?? "agent",
        depends_on: [],
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed", rerun: step.rerun ?? false },
        prompt: `Run ${step.id}.`,
        acceptance: { criteria: [] }
      }
    ],
    ui: {}
  } as WorkflowYaml;
  const snapshot = canonicalizeWorkflowDefinition(workflow);

  return {
    yamlSnapshot: snapshot.yaml,
    contentHash: snapshot.contentHash
  };
}

function readyStepRun(
  evaluator: StepRunEvaluator,
  options: { rerun?: boolean; attempt?: number } = {}
): ReadyStepRun {
  return {
    id: "step-run-1",
    workflowRunId: "workflow-run-1",
    stepId: "step-1",
    attempt: options.attempt ?? 1,
    evaluator,
    codeWorkspaceId: "workspace-1",
    beforeCommit: null,
    workflowRun: {
      workflowVersion: {
        workflowId: "workflow-1",
        ...snapshotFor({ id: "step-1", rerun: options.rerun })
      }
    }
  };
}

function createHarness(input: {
  stepRun?: ReadyStepRun | null;
  finalVerdict?: DecisionVerdict;
  executeStepRun?: () => Promise<unknown>;
}) {
  const workingDirectory = path.resolve(process.cwd());
  const stepRun = input.stepRun === undefined ? readyStepRun(StepRunEvaluator.EVALUATOR_REVIEW) : input.stepRun;
  const statuses = [{ stepId: "step-1", status: "CODEX_COMPLETED" }];
  const repository: StepRunnerRepository = {
    findNextReadyStep: vi.fn(async () => stepRun),
    markWorkflowRunRunning: vi.fn(async () => undefined),
    markWorkflowRunFailed: vi.fn(async () => undefined),
    markWorkflowRunWaiting: vi.fn(async () => undefined),
    completeWorkflowRun: vi.fn(async () => undefined),
    markStepRunFailed: vi.fn(async () => undefined),
    markStepRunWaitingForHumanReview: vi.fn(async () => undefined),
    markStepRunAccepted: vi.fn(async () => {
      statuses[0] = { stepId: "step-1", status: "ACCEPTED" };
    }),
    markStepRunRejected: vi.fn(async () => undefined),
    queueStepRunRerun: vi.fn(async () => undefined),
    persistDecisions: vi.fn(async () => undefined),
    workflowStepRunStatuses: vi.fn(async () => statuses),
    readyDownstreamStep: vi.fn(async () => undefined)
  };
  const workspaceResolver: WorkspaceResolver = {
    resolve: vi.fn(async () => workingDirectory)
  };
  const artifactRuntime: StepArtifactRuntime = {
    prepare: vi.fn(async () => ({ enabled: false })),
    persistDeclaredOutputs: vi.fn(async () => undefined),
    acceptProduced: vi.fn(async () => undefined),
    rejectProduced: vi.fn(async () => undefined)
  };
  const checkpointRuntime = {
    recordBefore: vi.fn(async () => "before-commit"),
    commitApproved: vi.fn(async () => "after-commit"),
    resetBeforeRerun: vi.fn(async () => true),
    markRejected: vi.fn(async () => undefined)
  };
  const executeStepRun =
    input.executeStepRun ??
    vi.fn(async () => ({
      stepRunId: "step-run-1",
      threadId: "thread-1",
      finalResponse: "Done.",
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0
      }
    }));
  const evaluateStep = vi.fn(async () => ({
    decisions:
      stepRun?.evaluator === StepRunEvaluator.HUMAN_REVIEW
        ? []
        : [
            {
              stepRunId: "step-run-1",
              source: DecisionSource.EVALUATOR,
              verdict: input.finalVerdict ?? DecisionVerdict.APPROVE,
              comment: "Reviewed."
            }
          ],
    finalVerdict: input.finalVerdict ?? DecisionVerdict.APPROVE
  }));
  const orchestrator = new StepRunnerOrchestrator({
    repository,
    workspaceResolver,
    artifactRuntime,
    checkpointRuntime,
    executeStepRun,
    evaluateStep,
    resolveArtifactStoreRoot: () => "C:\\artifacts",
    now: () => new Date(Date.UTC(2026, 0, 2))
  });

  return {
    orchestrator,
    repository,
    workspaceResolver,
    artifactRuntime,
    checkpointRuntime,
    executeStepRun,
    evaluateStep
  };
}

describe("StepRunnerOrchestrator", () => {
  it("returns picked false when no READY step exists", async () => {
    const { orchestrator, executeStepRun } = createHarness({ stepRun: null });

    await expect(orchestrator.runNextReadyStep()).resolves.toEqual({ picked: false });
    expect(executeStepRun).not.toHaveBeenCalled();
  });

  it("accepts an evaluator-approved step and completes a single-step workflow", async () => {
    const { orchestrator, repository, artifactRuntime } = createHarness({});

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "accepted"
    });
    expect(repository.markStepRunAccepted).toHaveBeenCalledWith(
      "step-run-1",
      new Date(Date.UTC(2026, 0, 2))
    );
    expect(repository.completeWorkflowRun).toHaveBeenCalledWith(
      "workflow-run-1",
      new Date(Date.UTC(2026, 0, 2))
    );
    expect(artifactRuntime.acceptProduced).toHaveBeenCalled();
  });

  it("rejects non-approved evaluation results and fails the workflow", async () => {
    const { orchestrator, repository, artifactRuntime } = createHarness({
      finalVerdict: DecisionVerdict.REJECT
    });

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "failed"
    });
    expect(artifactRuntime.rejectProduced).toHaveBeenCalled();
    expect(repository.markStepRunRejected).toHaveBeenCalled();
    expect(repository.markWorkflowRunFailed).toHaveBeenCalled();
  });

  it("queues a rerun for non-approved evaluation results when the step opts in", async () => {
    const { orchestrator, repository, artifactRuntime, checkpointRuntime } = createHarness({
      stepRun: readyStepRun(StepRunEvaluator.EVALUATOR_REVIEW, { rerun: true }),
      finalVerdict: DecisionVerdict.REJECT
    });

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "rerun_queued"
    });
    expect(checkpointRuntime.resetBeforeRerun).toHaveBeenCalledWith({
      stepRunId: "step-run-1",
      codeWorkspaceId: "workspace-1",
      workingDirectory: path.resolve(process.cwd()),
      beforeCommit: "before-commit"
    });
    expect(repository.queueStepRunRerun).toHaveBeenCalledWith({
      workflowRunId: "workflow-run-1",
      stepRunId: "step-run-1",
      reason: "evaluator_rejected",
      comment: "Reviewed.",
      resetToBeforeCommit: true
    });
    expect(artifactRuntime.rejectProduced).not.toHaveBeenCalled();
    expect(repository.markWorkflowRunFailed).not.toHaveBeenCalled();
  });

  it("waits for human review without accepting downstream progress", async () => {
    const { orchestrator, repository } = createHarness({
      stepRun: readyStepRun(StepRunEvaluator.HUMAN_REVIEW)
    });

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "waiting_for_human_review"
    });
    expect(repository.markStepRunWaitingForHumanReview).toHaveBeenCalledWith("step-run-1");
    expect(repository.markWorkflowRunWaiting).toHaveBeenCalledWith("workflow-run-1");
    expect(repository.markStepRunAccepted).not.toHaveBeenCalled();
  });

  it("treats READY transition races as non-fatal", async () => {
    const { orchestrator, repository } = createHarness({
      executeStepRun: vi.fn(async () => {
        throw new Error("StepRun step-run-1 was not READY");
      })
    });

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "race_lost"
    });
    expect(repository.markStepRunFailed).not.toHaveBeenCalled();
    expect(repository.markWorkflowRunFailed).not.toHaveBeenCalled();
  });

  it("marks the step and workflow failed when execution fails", async () => {
    const { orchestrator, repository } = createHarness({
      executeStepRun: vi.fn(async () => {
        throw new Error("Codex failed");
      })
    });

    await expect(orchestrator.runNextReadyStep()).resolves.toMatchObject({
      picked: true,
      outcome: "failed"
    });
    expect(repository.markStepRunFailed).toHaveBeenCalled();
    expect(repository.markWorkflowRunFailed).toHaveBeenCalled();
  });
});
