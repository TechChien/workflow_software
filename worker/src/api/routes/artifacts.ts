import type { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflowYaml } from "@workflow-software/shared";
import { readArtifactVersionContent } from "../../artifacts/artifact-store.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { notFound } from "../errors.js";
import { artifactMimeType, serializeArtifactVersion } from "../serializers.js";

const workerRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

function artifactStoreRoot() {
  return path.resolve(workerRoot, env.ARTIFACT_STORE_ROOT);
}

function shouldIncludeContent(query: unknown) {
  const includeContent = (query as { includeContent?: unknown })?.includeContent;
  return includeContent !== false && includeContent !== "false";
}

export async function registerArtifactRoutes(app: FastifyInstance) {
  app.get("/:artifactVersionId", async (request) => {
    const { artifactVersionId } = request.params as { artifactVersionId: string };
    const artifact = await prisma.artifactVersion.findUnique({
      where: { id: artifactVersionId },
      include: {
        producerStepRun: {
          select: {
            stepId: true
          }
        },
        workflowRun: {
          include: {
            workflowVersion: true
          }
        }
      }
    });

    if (!artifact) {
      throw notFound(`ArtifactVersion ${artifactVersionId} was not found`);
    }

    const workflow = parseWorkflowYaml(artifact.workflowRun.workflowVersion.yamlSnapshot);
    const metadata = serializeArtifactVersion(artifact, { workflow });

    if (!shouldIncludeContent(request.query)) {
      return metadata;
    }

    const stored = await readArtifactVersionContent({
      root: artifactStoreRoot(),
      workflowId: artifact.workflowRun.workflowVersion.workflowId,
      runId: artifact.workflowRunId,
      artifactKey: artifact.artifactKey,
      version: artifact.version
    });

    return {
      ...metadata,
      content: stored.content,
      encoding: "utf-8",
      mimeType: artifactMimeType(metadata.format),
      truncated: false
    };
  });
}
