import { directDependentStepIds } from "@workflow-software/shared";
import type { ExecuteStepRunWithCodexInput } from "./codex-step-executor.js";
import type {
  EvaluateStepInput,
  EvaluateStepResult
} from "./evaluator-runner.js";
import { resolveStepCompletion } from "./step-completion-policy.js";
import { StepRunnerErrorHandler, extractCodexFinalResponse } from "./step-runner-errors.js";
import type { StepRunnerRepository } from "./step-runner-repository.js";
import type { StepRunnerResult } from "./step-runner.js";
import type { StepArtifactRuntime } from "./step-artifact-runtime.js";
import type { StepCheckpointRuntime } from "./step-checkpoint-runtime.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";
import {
  allWorkflowStepsAccepted,
  eligibleDependentStepIds,
  statusByStepId
} from "./workflow-progression.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

export type StepRunnerOrchestratorDependencies = {
  repository: StepRunnerRepository;
  executeStepRun: (input: ExecuteStepRunWithCodexInput) => Promise<unknown>;
  evaluateStep: (input: EvaluateStepInput) => Promise<EvaluateStepResult>;
  workspaceResolver: WorkspaceResolver;
  artifactRuntime: StepArtifactRuntime;
  checkpointRuntime: StepCheckpointRuntime;
  resolveArtifactStoreRoot: () => string | Promise<string>;
  now: () => Date;
};

const MAX_AUTOMATIC_RERUN_ATTEMPTS = 2;

function latestDecisionComment(evaluation: EvaluateStepResult) {
  for (const decision of [...evaluation.decisions].reverse()) {
    const comment = decision.comment?.trim();

    if (comment) {
      return comment;
    }
  }

  return undefined;
}

function approvedStepCommitMessage(stepId: string, stepRunId: string) {
  return `Approve workflow step ${stepId} (${stepRunId})`;
}

export class StepRunnerOrchestrator {
  private readonly errorHandler: StepRunnerErrorHandler;

  constructor(private readonly dependencies: StepRunnerOrchestratorDependencies) {
    this.errorHandler = new StepRunnerErrorHandler(
      dependencies.repository,
      dependencies.now
    );
  }

  async runNextReadyStep(): Promise<StepRunnerResult> {
    const stepRun = await this.dependencies.repository.findNextReadyStep();

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
      codeWorkspaceId: stepRun.codeWorkspaceId
    });

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
      const step = workflow.steps.find(
        (candidate) => candidate.id === stepRun.stepId
      );

      if (!step) {
        throw new Error(
          `Published workflow snapshot does not contain step ${stepRun.stepId}`
        );
      }

      console.log("[runtime.step-runner] workflow.loaded", {
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: step.id,
        stepType: step.type,
        dependencyStepIds: step.depends_on,
        dependentStepIds: directDependentStepIds(workflow, step.id),
        evaluator: stepRun.evaluator,
        totalSteps: workflow.steps.length
      });

      await this.dependencies.repository.markWorkflowRunRunning(
        stepRun.workflowRunId,
        this.dependencies.now()
      );
      const workingDirectory = await this.dependencies.workspaceResolver.resolve({
        stepRunId: stepRun.id,
        workflowRunId: stepRun.workflowRunId,
        codeWorkspaceId: stepRun.codeWorkspaceId
      });
      console.log("[runtime.step-runner] working_directory.ready", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        workingDirectory
      });
      const beforeCommit = await this.dependencies.checkpointRuntime.recordBefore({
        stepRunId: stepRun.id,
        codeWorkspaceId: stepRun.codeWorkspaceId,
        workingDirectory
      });
      console.log("[runtime.step-runner] checkpoint.before_commit", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        beforeCommit
      });
      const artifactStoreRoot = await this.dependencies.resolveArtifactStoreRoot();
      console.log("[runtime.step-runner] artifact_store.ready", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        artifactStoreRoot
      });

      const artifactSession = await this.dependencies.artifactRuntime.prepare({
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        step,
        workingDirectory,
        artifactStoreRoot
      });

      console.log("[runtime.step-runner] codex_executor.start", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: step.id,
        stepType: step.type,
        workingDirectory
      });
      const executionResult = await this.dependencies.executeStepRun({
        stepRunId: stepRun.id,
        workingDirectory,
        ...(artifactSession.runtimeContext
          ? { runtimeContext: artifactSession.runtimeContext }
          : {})
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
        finalResponseLength:
          extractCodexFinalResponse(executionResult)?.length ?? 0
      });

      await this.dependencies.artifactRuntime.persistDeclaredOutputs({
        session: artifactSession,
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        artifactStoreRoot
      });

      console.log("[runtime.step-runner] evaluator.start", {
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: step.id,
        evaluator: stepRun.evaluator
      });
      const evaluation = await this.dependencies.evaluateStep({
        stepRunId: stepRun.id,
        evaluator: stepRun.evaluator,
        workflowId: stepRun.workflowRun.workflowVersion.workflowId,
        workflowRunId: stepRun.workflowRunId,
        step,
        workingDirectory,
        artifactStoreRoot,
        codexFinalResponse: extractCodexFinalResponse(executionResult),
        ...(artifactSession.runtimeContext
          ? { runtimeContext: artifactSession.runtimeContext }
          : {})
      });
      console.log("[runtime.step-runner] evaluator.complete", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        finalVerdict: evaluation.finalVerdict,
        decisions: evaluation.decisions.map((decision) => ({
          source: decision.source,
          verdict: decision.verdict
        }))
      });
      await this.dependencies.repository.persistDecisions({
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        decisions: evaluation.decisions
      });

      const completion = resolveStepCompletion({
        finalVerdict: evaluation.finalVerdict,
        evaluator: stepRun.evaluator
      });

      if (completion === "reject") {
        console.log("[runtime.step-runner] step.rejected", {
          workflowRunId: stepRun.workflowRunId,
          stepRunId: stepRun.id,
          stepId: step.id,
          finalVerdict: evaluation.finalVerdict,
          rerun: step.evaluate.rerun,
          attempt: stepRun.attempt
        });
        if (
          step.evaluate.rerun &&
          stepRun.attempt < MAX_AUTOMATIC_RERUN_ATTEMPTS
        ) {
          const resetToBeforeCommit =
            await this.dependencies.checkpointRuntime.resetBeforeRerun({
              stepRunId: stepRun.id,
              codeWorkspaceId: stepRun.codeWorkspaceId,
              workingDirectory,
              beforeCommit
            });
          await this.dependencies.repository.queueStepRunRerun({
            workflowRunId: stepRun.workflowRunId,
            stepRunId: stepRun.id,
            reason: "evaluator_rejected",
            comment: latestDecisionComment(evaluation),
            resetToBeforeCommit
          });

          return {
            ...resultBase,
            outcome: "rerun_queued"
          };
        }

        await this.dependencies.artifactRuntime.rejectProduced({
          session: artifactSession,
          stepRunId: stepRun.id
        });
        await this.dependencies.checkpointRuntime.markRejected({
          stepRunId: stepRun.id,
          codeWorkspaceId: stepRun.codeWorkspaceId,
          beforeCommit
        });

        const rejectionTime = this.dependencies.now();
        await this.dependencies.repository.markStepRunRejected(
          stepRun.id,
          rejectionTime
        );
        await this.dependencies.repository.markWorkflowRunFailed(
          stepRun.workflowRunId,
          rejectionTime
        );

        return {
          ...resultBase,
          outcome: "failed"
        };
      }

      if (completion === "wait_for_human_review") {
        console.log("[runtime.step-runner] step.waiting_for_human_review", {
          workflowRunId: stepRun.workflowRunId,
          stepRunId: stepRun.id,
          stepId: step.id,
          evaluator: stepRun.evaluator
        });
        await this.dependencies.repository.markStepRunWaitingForHumanReview(
          stepRun.id
        );
        await this.dependencies.repository.markWorkflowRunWaiting(
          stepRun.workflowRunId
        );

        return {
          ...resultBase,
          outcome: "waiting_for_human_review"
        };
      }

      console.log("[runtime.step-runner] step.approved", {
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        stepId: step.id,
        finalVerdict: evaluation.finalVerdict
      });
      await this.dependencies.checkpointRuntime.commitApproved({
        stepRunId: stepRun.id,
        codeWorkspaceId: stepRun.codeWorkspaceId,
        workingDirectory,
        beforeCommit,
        message: approvedStepCommitMessage(step.id, stepRun.id)
      });
      await this.dependencies.artifactRuntime.acceptProduced({
        session: artifactSession,
        workflowRunId: stepRun.workflowRunId,
        stepRunId: stepRun.id,
        now: this.dependencies.now()
      });

      await this.dependencies.repository.markStepRunAccepted(
        stepRun.id,
        this.dependencies.now()
      );
      const statuses = statusByStepId(
        await this.dependencies.repository.workflowStepRunStatuses(
          stepRun.workflowRunId
        )
      );
      for (const dependentStepId of eligibleDependentStepIds({
        workflow,
        completedStepId: step.id,
        statuses
      })) {
        await this.dependencies.repository.readyDownstreamStep({
          workflowRunId: stepRun.workflowRunId,
          dependentStepId
        });
      }

      const updatedStatuses = statusByStepId(
        await this.dependencies.repository.workflowStepRunStatuses(
          stepRun.workflowRunId
        )
      );

      if (allWorkflowStepsAccepted(workflow, updatedStatuses)) {
        await this.dependencies.repository.completeWorkflowRun(
          stepRun.workflowRunId,
          this.dependencies.now()
        );
      }

      return {
        ...resultBase,
        outcome: "accepted"
      };
    } catch (error) {
      return this.errorHandler.handle({
        stepRun,
        error
      });
    }
  }
}
