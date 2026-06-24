import { z } from "zod";
import { WorkflowYamlSchema } from "./workflow-yaml.js";

const NonEmptyStringSchema = z.string().trim().min(1);

export const CreateWorkflowRequestSchema = z.object({
  draftYaml: WorkflowYamlSchema
});

export const UpdateDraftWorkflowRequestSchema = z.object({
  draftYaml: WorkflowYamlSchema
});

export const RunStepWorkspaceSchema = z.object({
  repositoryId: NonEmptyStringSchema.optional(),
  baseRef: NonEmptyStringSchema.optional()
});

export const CreateRunRequestSchema = z.object({
  inputPayload: z.record(z.string(), z.unknown()).default({}),
  stepWorkspaces: z.record(z.string().min(1), RunStepWorkspaceSchema).default({})
});

export const HumanDecisionRequestSchema = z.object({
  verdict: z.enum(["approve", "reject", "request_revision"]),
  comment: z.string().optional(),
  targetStepId: z.string().optional()
});

export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;
export type UpdateDraftWorkflowRequest = z.infer<typeof UpdateDraftWorkflowRequestSchema>;
export type RunStepWorkspace = z.infer<typeof RunStepWorkspaceSchema>;
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type HumanDecisionRequest = z.infer<typeof HumanDecisionRequestSchema>;
