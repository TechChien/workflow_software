import { parseWorkflowYaml } from "@workflow-software/shared";
import type { WorkflowVersion } from "../generated/prisma/client.js";
import { canonicalizeWorkflowDefinition } from "./workflow-definition.js";

type PublishWorkflowTransaction = {
  workflow: {
    findUniqueOrThrow(args: { where: { id: string } }): PromiseLike<{ draftYaml: string }>;
  };
  workflowVersion: {
    findFirst(args: {
      where: { workflowId: string };
      orderBy: { revision: "desc" };
      select: { revision: true };
    }): PromiseLike<{ revision: number } | null>;
    create(args: {
      data: {
        workflowId: string;
        revision: number;
        yamlSnapshot: string;
        contentHash: string;
      };
    }): PromiseLike<WorkflowVersion>;
  };
};

export type PublishWorkflowDraftClient = {
  $transaction<T>(fn: (tx: PublishWorkflowTransaction) => Promise<T>): Promise<T>;
};

export type PublishWorkflowDraftDependencies = {
  client?: PublishWorkflowDraftClient;
};

async function defaultClient() {
  const { prisma } = await import("../db/prisma.js");
  return prisma as unknown as PublishWorkflowDraftClient;
}

export async function publishWorkflowDraft(
  workflowId: string,
  dependencies: PublishWorkflowDraftDependencies = {}
) {
  const client = dependencies.client ?? (await defaultClient());

  return client.$transaction(async (tx) => {
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
