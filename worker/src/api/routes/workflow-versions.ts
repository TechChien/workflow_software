import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { publishWorkflowDraft } from "../../runtime/publish-service.js";
import { notFound } from "../errors.js";
import { serializeWorkflowVersion } from "../serializers.js";

const versionRunInclude = {
  runs: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    include: {
      stepRuns: {
        select: {
          id: true,
          status: true
        }
      }
    }
  }
};

export async function registerWorkflowVersionRoutes(app: FastifyInstance) {
  app.post("/:workflowId/publish", async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true }
    });

    if (!workflow) {
      throw notFound(`Workflow ${workflowId} was not found`);
    }

    const publishedVersion = await publishWorkflowDraft(workflowId);
    return reply.code(201).send(serializeWorkflowVersion(publishedVersion));
  });

  app.get("/:workflowVersionId", async (request) => {
    const { workflowVersionId } = request.params as { workflowVersionId: string };
    const version = await prisma.workflowVersion.findUnique({
      where: { id: workflowVersionId },
      include: versionRunInclude
    });

    if (!version) {
      throw notFound(`WorkflowVersion ${workflowVersionId} was not found`);
    }

    return serializeWorkflowVersion(version);
  });
}
