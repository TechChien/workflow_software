import { z } from "zod";
import { STEP_RUN_EVALUATORS } from "../constants/evaluators.js";
import { STEP_TYPES } from "../constants/step-types.js";
import { ArtifactDefinitionSchema } from "./artifacts.js";

export const AGENT_PROVIDERS = ["claude", "codex"] as const;
export const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const NonEmptyStringSchema = z.string().trim().min(1);

export const StepArtifactInputSchema = z.object({
  artifact: z.string().min(1),
  required: z.boolean().default(true)
});

export const ContextPathSchema = z.object({
  path: z.string().min(1),
  type: z.enum(["file", "directory"])
}).strict();

export const AcceptanceCriteriaSchema = z
  .union([z.string(), z.array(z.string().min(1))])
  .transform((criteria) => (typeof criteria === "string" ? (criteria ? [criteria] : []) : criteria))
  .default([]);

export const StepEvaluateSchema = z
  .object({
    evaluator: z.enum(STEP_RUN_EVALUATORS).catch("mixed").default("mixed"),
    rerun: z.boolean().catch(false).default(false)
  })
  .catch({ evaluator: "mixed", rerun: false })
  .default({ evaluator: "mixed", rerun: false });

export const StepAgentOptionsSchema = z.object({
  provider: z.enum(AGENT_PROVIDERS).optional(),
  model: NonEmptyStringSchema.optional(),
  reasoning_effort: z.enum(CODEX_REASONING_EFFORTS).optional(),
  effort: z.enum(CLAUDE_EFFORTS).optional(),
  timeout_ms: z.coerce.number().int().positive().optional()
});

export const StepAgentSettingsSchema = z.object({
  repository_id: NonEmptyStringSchema.optional(),
  base_ref: NonEmptyStringSchema.optional(),
  options: StepAgentOptionsSchema.optional()
});

const StepDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.enum(STEP_TYPES),
  agent: StepAgentSettingsSchema.optional(),
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
export type StepAgentOptions = z.infer<typeof StepAgentOptionsSchema>;
export type StepAgentSettings = z.infer<typeof StepAgentSettingsSchema>;
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;
export type RawStepDefinition = z.infer<typeof RawStepDefinitionSchema>;
