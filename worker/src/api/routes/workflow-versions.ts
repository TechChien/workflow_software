import type { FastifyInstance } from "fastify";
import { publishWorkflowDraft } from "../../runtime/publish-service.js";

export async function registerWorkflowVersionRoutes(app: FastifyInstance) {
  app.post("/:workflowId/publish", async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const version = await publishWorkflowDraft(workflowId);
    return reply.code(201).send(version);
  });
}
