import { z } from "zod";
import { WorkflowYamlSchema } from "./workflow-yaml.js";

export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(1),
  draftYaml: WorkflowYamlSchema
});

export const UpdateDraftWorkflowRequestSchema = z.object({
  draftYaml: WorkflowYamlSchema
});

export const CreateRunRequestSchema = z.object({
  inputPayload: z.record(z.string(), z.unknown()).default({})
});

export const HumanDecisionRequestSchema = z.object({
  verdict: z.enum(["approve", "reject", "request_revision"]),
  comment: z.string().optional(),
  targetStepId: z.string().optional()
});

export const CodexInteractionResponseSchema = z.object({
  decision: z.enum(["approve", "deny", "answer"]),
  answer: z.string().optional()
});

export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;
export type UpdateDraftWorkflowRequest = z.infer<typeof UpdateDraftWorkflowRequestSchema>;
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type HumanDecisionRequest = z.infer<typeof HumanDecisionRequestSchema>;
export type CodexInteractionResponse = z.infer<typeof CodexInteractionResponseSchema>;
