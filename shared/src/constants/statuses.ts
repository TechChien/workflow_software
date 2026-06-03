export const WORKFLOW_RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled"
] as const;

export const STEP_RUN_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_for_codex_permission",
  "waiting_for_codex_question",
  "waiting_for_human_review",
  "waiting_for_evaluator_feedback",
  "accepted",
  "rejected",
  "failed",
  "stale"
] as const;
