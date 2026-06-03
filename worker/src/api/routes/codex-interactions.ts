import type { FastifyInstance } from "fastify";
import { CodexInteractionResponseSchema } from "@workflow-software/shared";

export async function registerCodexInteractionRoutes(app: FastifyInstance) {
  app.post("/:interactionId/respond", async (request, reply) => {
    const { interactionId } = request.params as { interactionId: string };
    const body = CodexInteractionResponseSchema.parse(request.body);
    return reply.code(202).send({ interactionId, ...body });
  });
}
