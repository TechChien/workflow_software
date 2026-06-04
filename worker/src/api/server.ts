import Fastify from "fastify";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerHumanDecisionRoutes } from "./routes/human-decisions.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerWorkflowVersionRoutes } from "./routes/workflow-versions.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  await app.register(registerWorkflowRoutes, { prefix: "/api/workflows" });
  await app.register(registerWorkflowVersionRoutes, { prefix: "/api/workflow-versions" });
  await app.register(registerRunRoutes, { prefix: "/api/runs" });
  await app.register(registerHumanDecisionRoutes, { prefix: "/api/human-decisions" });
  await app.register(registerArtifactRoutes, { prefix: "/api/artifacts" });

  return app;
}
