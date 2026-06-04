import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

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

  return prisma.workflowRun.create({
    data: {
      workflowVersionId,
      inputPayload: inputPayload as Prisma.InputJsonValue,
      stepRuns: {
        create: definition.steps.map((step) => ({
          stepId: step.id,
          status: step.upstream ? ("PENDING" as const) : ("READY" as const),
          requiresCodeReview: step.type === "code_agent"
        }))
      }
    },
    include: {
      stepRuns: true
    }
  });
}
