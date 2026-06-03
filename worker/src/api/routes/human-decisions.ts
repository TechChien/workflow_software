import type { FastifyInstance } from "fastify";
import { HumanDecisionRequestSchema } from "@workflow-software/shared";

export async function registerHumanDecisionRoutes(app: FastifyInstance) {
  app.post("/:stepRunId", async (request, reply) => {
    const { stepRunId } = request.params as { stepRunId: string };
    const body = HumanDecisionRequestSchema.parse(request.body);
    return reply.code(201).send({ stepRunId, ...body });
  });
}
