import { z } from "zod";
import { STEP_TYPES } from "../constants/step-types.js";
import { ArtifactDefinitionSchema } from "./artifacts.js";

export const StepArtifactInputSchema = z.object({
  artifact: z.string().min(1),
  required: z.boolean().default(true)
});

export const ContextPathSchema = z.object({
  path: z.string().min(1),
  type: z.enum(["file", "directory"]),
  optional: z.boolean().default(true)
});

export const StepDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.enum(STEP_TYPES),
  upstream: z.string().min(1).optional(),
  downstream: z.string().min(1).optional(),
  input_artifacts: z.array(StepArtifactInputSchema).default([]),
  output_artifacts: z.array(ArtifactDefinitionSchema).default([]),
  context_paths: z.array(ContextPathSchema).default([]),
  tool_capabilities: z.array(z.string().min(1)).default([]),
  prompt: z.string().default(""),
  acceptance: z
    .object({
      criteria: z.string().default("")
    })
    .default({ criteria: "" })
});

export type StepArtifactInput = z.infer<typeof StepArtifactInputSchema>;
export type ContextPath = z.infer<typeof ContextPathSchema>;
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;
