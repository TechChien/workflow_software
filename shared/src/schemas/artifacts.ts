import { z } from "zod";
import { ARTIFACT_STATUSES } from "../constants/artifact-status";

export const ArtifactDefinitionSchema = z.object({
  artifact: z.string().min(1),
  filename: z.string().min(1).optional(),
  format: z.enum(["markdown", "plain_text"]).default("markdown")
});

export const ArtifactVersionSchema = z.object({
  id: z.string(),
  artifactKey: z.string(),
  version: z.number().int().positive(),
  status: z.enum(ARTIFACT_STATUSES),
  contentUri: z.string(),
  contentHash: z.string()
});

export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
