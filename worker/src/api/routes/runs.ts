import type { FastifyInstance } from "fastify";
import { CreateRunRequestSchema } from "@workflow-software/shared";
import { prisma } from "../../db/prisma.js";
import { createWorkflowRun } from "../../runtime/run-service.js";

export async function registerRunRoutes(app: FastifyInstance) {
  app.post("/workflow-versions/:workflowVersionId", async (request, reply) => {
    const { workflowVersionId } = request.params as { workflowVersionId: string };
    const body = CreateRunRequestSchema.parse(request.body ?? {});
    const run = await createWorkflowRun(workflowVersionId, body.inputPayload);
    return reply.code(201).send(run);
  });

  app.get("/:runId", async (request) =>
    prisma.workflowRun.findUniqueOrThrow({
      where: {
        id: (request.params as { runId: string }).runId
      },
      include: {
        stepRuns: true
      }
    })
  );
}
