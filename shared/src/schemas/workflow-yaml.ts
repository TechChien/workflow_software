import { z } from "zod";
import { StepDefinitionSchema } from "./steps.js";

export const WorkflowYamlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  description: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(StepDefinitionSchema),
  ui: z.record(z.string(), z.unknown()).default({})
});

export type WorkflowYaml = z.infer<typeof WorkflowYamlSchema>;
