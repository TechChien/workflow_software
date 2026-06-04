import { parseWorkflowYaml } from "@workflow-software/shared";
import { prisma } from "../db/prisma.js";
import { canonicalizeWorkflowDefinition } from "./workflow-definition.js";

export async function publishWorkflowDraft(workflowId: string) {
  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.findUniqueOrThrow({
      where: { id: workflowId }
    });
    const snapshot = canonicalizeWorkflowDefinition(parseWorkflowYaml(workflow.draftYaml));
    const latestVersion = await tx.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { revision: "desc" },
      select: { revision: true }
    });

    return tx.workflowVersion.create({
      data: {
        workflowId,
        revision: (latestVersion?.revision ?? 0) + 1,
        yamlSnapshot: snapshot.yaml,
        contentHash: snapshot.contentHash
      }
    });
  });
}
