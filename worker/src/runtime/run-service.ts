import { StepRunEvaluator, type Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

const STEP_RUN_EVALUATOR_BY_DEFINITION = {
  mixed: StepRunEvaluator.MIXED,
  human_review: StepRunEvaluator.HUMAN_REVIEW,
  evaluator_review: StepRunEvaluator.EVALUATOR_REVIEW
} as const;

function resolveStepRunEvaluator(evaluator: string) {
  return (
    STEP_RUN_EVALUATOR_BY_DEFINITION[
      evaluator as keyof typeof STEP_RUN_EVALUATOR_BY_DEFINITION
    ] ?? StepRunEvaluator.MIXED
  );
}

export async function createWorkflowRun(
  workflowVersionId: string,
  inputPayload: Record<string, unknown>
) {
  const workflowVersion = await prisma.workflowVersion.findUniqueOrThrow({
    where: { id: workflowVersionId }
  });
  const definition = parseVerifiedWorkflowSnapshot(
    workflowVersion.yamlSnapshot,
    workflowVersion.contentHash
  );
  // add workflow run with published snapshot YAML 
  return prisma.workflowRun.create({
    data: {
      workflowVersionId,
      inputPayload: inputPayload as Prisma.InputJsonValue,
      stepRuns: {
        create: definition.steps.map((step) => ({
          stepId: step.id,
          status: step.upstream ? ("PENDING" as const) : ("READY" as const),
          evaluator: resolveStepRunEvaluator(step.evaluate.evaluator),
          requiresCodeReview: step.type === "code_agent"
        }))
      }
    },
    include: {
      stepRuns: true
    }
  });
}
