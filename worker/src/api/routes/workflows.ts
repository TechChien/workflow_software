import type { FastifyInstance } from "fastify";
import {
  CreateWorkflowRequestSchema,
  UpdateDraftWorkflowRequestSchema
} from "@workflow-software/shared";

export async function registerWorkflowRoutes(app: FastifyInstance) {
  app.get("/", async () => ({ items: [] }));

  app.post("/", async (request, reply) => {
    const body = CreateWorkflowRequestSchema.parse(request.body);
    return reply.code(201).send({
      id: "workflow_draft_placeholder",
      name: body.name,
      draftYaml: body.draftYaml
    });
  });

  app.patch("/:workflowId/draft", async (request) => {
    const body = UpdateDraftWorkflowRequestSchema.parse(request.body);
    return {
      workflowId: (request.params as { workflowId: string }).workflowId,
      draftYaml: body.draftYaml
    };
  });
}
