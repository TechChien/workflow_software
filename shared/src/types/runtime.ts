import { ARTIFACT_STATUSES } from "../constants/artifact-status.js";
import { STEP_RUN_STATUSES, WORKFLOW_RUN_STATUSES } from "../constants/statuses.js";

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
