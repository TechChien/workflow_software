import type { FastifyInstance } from "fastify";
import {
  CreateWorkflowRequestSchema,
  UpdateDraftWorkflowRequestSchema,
  parseWorkflowYaml
} from "@workflow-software/shared";
import { prisma } from "../../db/prisma.js";
import { canonicalizeWorkflowDefinition } from "../../runtime/workflow-definition.js";

export async function registerWorkflowRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    const workflows = await prisma.workflow.findMany({
      orderBy: { updatedAt: "desc" }
    });

    return {
      items: workflows.map((workflow) => ({
        ...workflow,
        draftYaml: parseWorkflowYaml(workflow.draftYaml)
      }))
    };
  });

  app.post("/", async (request, reply) => {
    const body = CreateWorkflowRequestSchema.parse(request.body);
    const draft = canonicalizeWorkflowDefinition(body.draftYaml);
    const workflow = await prisma.workflow.create({
      data: {
        name: draft.definition.name,
        draftYaml: draft.yaml
      }
    });

    return reply.code(201).send({
      ...workflow,
      draftYaml: draft.definition
    });
  });

  app.patch("/:workflowId/draft", async (request) => {
    const body = UpdateDraftWorkflowRequestSchema.parse(request.body);
    const draft = canonicalizeWorkflowDefinition(body.draftYaml);
    const workflow = await prisma.workflow.update({
      where: {
        id: (request.params as { workflowId: string }).workflowId
      },
      data: {
        name: draft.definition.name,
        draftYaml: draft.yaml
      }
    });

    return {
      ...workflow,
      draftYaml: draft.definition
    };
  });
}
