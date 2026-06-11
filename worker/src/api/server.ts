import Fastify from "fastify";
import { ZodError } from "zod";
import { ApiError } from "./errors.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerHumanDecisionRoutes } from "./routes/human-decisions.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerStepRunRoutes } from "./routes/step-runs.js";
import { registerWorkflowVersionRoutes } from "./routes/workflow-versions.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }

    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: {
            issues: error.issues
          }
        }
      });
    }

    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: {
        code: "internal_error",
        message: "Unexpected API error"
      }
    });
  });

  app.options("/*", async (_request, reply) => reply.code(204).send());

  app.get("/health", async () => ({ ok: true }));

  await app.register(registerWorkflowRoutes, { prefix: "/api/workflows" });
  await app.register(registerWorkflowVersionRoutes, { prefix: "/api/workflow-versions" });
  await app.register(registerRunRoutes, { prefix: "/api/runs" });
  await app.register(registerStepRunRoutes, { prefix: "/api/step-runs" });
  await app.register(registerHumanDecisionRoutes, { prefix: "/api/human-decisions" });
  await app.register(registerArtifactRoutes, { prefix: "/api/artifacts" });

  return app;
}
