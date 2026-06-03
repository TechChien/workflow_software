import type { FastifyInstance } from "fastify";

export async function registerArtifactRoutes(app: FastifyInstance) {
  app.get("/:artifactVersionId", async (request) => ({
    id: (request.params as { artifactVersionId: string }).artifactVersionId,
    contentUri: "artifact://placeholder"
  }));
}
