import { z } from "zod";
import { STEP_RUN_STATUSES, WORKFLOW_RUN_STATUSES } from "../constants/statuses.js";

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowVersionId: z.string(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  triggerType: z.literal("run_button"),
  inputPayload: z.record(z.string(), z.unknown()).default({})
});

export const StepRunSchema = z.object({
  id: z.string(),
  workflowRunId: z.string(),
  stepId: z.string(),
  attempt: z.number().int().positive(),
  status: z.enum(STEP_RUN_STATUSES),
  codexThreadId: z.string().optional(),
  staleReason: z.string().optional()
});

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
export type StepRun = z.infer<typeof StepRunSchema>;
