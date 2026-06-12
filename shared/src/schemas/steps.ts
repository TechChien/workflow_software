import { z } from "zod";
import { STEP_RUN_EVALUATORS } from "../constants/evaluators.js";
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

export const AcceptanceCriteriaSchema = z
  .union([z.string(), z.array(z.string().min(1))])
  .transform((criteria) => (typeof criteria === "string" ? (criteria ? [criteria] : []) : criteria))
  .default([]);

export const StepEvaluateSchema = z
  .object({
    evaluator: z.enum(STEP_RUN_EVALUATORS).catch("mixed").default("mixed")
  })
  .catch({ evaluator: "mixed" })
  .default({ evaluator: "mixed" });

const StepDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.enum(STEP_TYPES),
  evaluate: StepEvaluateSchema,
  depends_on: z.array(z.string().min(1)).default([]),
  input_artifacts: z.array(StepArtifactInputSchema).default([]),
  output_artifacts: z.array(ArtifactDefinitionSchema).default([]),
  context_paths: z.array(ContextPathSchema).default([]),
  tool_capabilities: z.array(z.string().min(1)).default([]),
  prompt: z.string().default(""),
  acceptance: z
    .object({
      criteria: AcceptanceCriteriaSchema
    })
    .default({ criteria: [] })
});

export const NormalizedStepDefinitionSchema = StepDefinitionBaseSchema;

export const RawStepDefinitionSchema = StepDefinitionBaseSchema.extend({
  upstream: z.string().min(1).optional(),
  downstream: z.string().min(1).optional()
});

function uniqueStepIds(values: string[]) {
  return Array.from(new Set(values));
}

export const StepDefinitionSchema = RawStepDefinitionSchema.transform((rawStep) => {
  const { upstream, downstream: _downstream, ...step } = rawStep;

  return {
    ...step,
    depends_on: uniqueStepIds([
      ...step.depends_on,
      ...(upstream ? [upstream] : [])
    ])
  };
});

export type StepArtifactInput = z.infer<typeof StepArtifactInputSchema>;
export type ContextPath = z.infer<typeof ContextPathSchema>;
export type StepEvaluate = z.infer<typeof StepEvaluateSchema>;
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;
export type RawStepDefinition = z.infer<typeof RawStepDefinitionSchema>;
