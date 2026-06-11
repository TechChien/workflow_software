import type {
  CreateRunRequest,
  CreateWorkflowRequest,
  HumanDecisionRequest,
  StepDefinition,
  UpdateDraftWorkflowRequest,
  WorkflowYaml
} from "@workflow-software/shared";

export type {
  CreateRunRequest,
  CreateWorkflowRequest,
  HumanDecisionRequest,
  UpdateDraftWorkflowRequest
} from "@workflow-software/shared";

export type JsonObject = Record<string, unknown>;

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: JsonObject;
  };
};

export type HealthResponse = {
  ok: true;
};

export type PaginationParams = {
  limit?: number;
  cursor?: string;
};

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type StepRunStatus =
  | "pending"
  | "ready"
  | "running"
  | "codex_completed"
  | "waiting_for_codex_permission"
  | "waiting_for_codex_question"
  | "waiting_for_human_review"
  | "waiting_for_evaluator_feedback"
  | "accepted"
  | "rejected"
  | "failed"
  | "stale";

export type StepRunEvaluator = StepDefinition["evaluate"]["evaluator"];
export type ArtifactStatus = "candidate" | "accepted" | "rejected" | "superseded" | "stale";
export type DecisionSource = "evaluator" | "human";
export type DecisionVerdict = "approve" | "reject" | "request_revision";

export type WorkflowDraft = {
  id: string;
  name: string;
  draftYaml: WorkflowYaml;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowSummary = WorkflowDraft & {
  latestPublishedVersion?: WorkflowVersionSummary;
  lastRun?: WorkflowRunSummary;
};

export type WorkflowDetail = WorkflowDraft & {
  versions: WorkflowVersionSummary[];
  recentRuns: WorkflowRunSummary[];
};

export type WorkflowListResponse = {
  items: WorkflowSummary[];
  nextCursor?: string;
};

export type WorkflowVersion = {
  id: string;
  workflowId: string;
  revision: number;
  yamlSnapshot: WorkflowYaml;
  contentHash: string;
  publishedAt: string;
  lastRun?: WorkflowRunSummary;
};

export type WorkflowVersionSummary = {
  id: string;
  workflowId: string;
  revision: number;
  workflowName: string;
  publishedAt: string;
  contentHash: string;
  lastRun?: WorkflowRunSummary;
};

export type WorkflowVersionListResponse = {
  items: WorkflowVersion[];
  nextCursor?: string;
};

export type WorkflowRunSummary = {
  id: string;
  workflowVersionId: string;
  workflowId: string;
  workflowName: string;
  revision: number;
  status: WorkflowRunStatus;
  triggerType: string;
  inputPayload: JsonObject;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  stepCount: number;
  completedStepCount: number;
  waitingStepRunId?: string;
};

export type WorkflowRunListParams = PaginationParams & {
  workflowId?: string;
  workflowVersionId?: string;
  status?: WorkflowRunStatus;
};

export type WorkflowRunListResponse = {
  items: WorkflowRunSummary[];
  nextCursor?: string;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  workflow: WorkflowYaml;
  stepRuns: StepRunDetail[];
  artifactVersions: ArtifactVersion[];
  decisionEvents: DecisionEvent[];
  runEvents: RunEvent[];
  codeWorkspaces: CodeWorkspace[];
};

export type StepRunDetail = {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  evaluator: StepRunEvaluator;
  upstreamStepRunId?: string;
  downstreamStepRunId?: string;
  codexThreadId?: string;
  promptSnapshot?: string;
  codexOptions: JsonObject;
  codexFinalResponse?: string;
  codexUsage?: JsonObject;
  codexError?: JsonObject;
  codexCompletedAt?: string;
  codeWorkspaceId?: string;
  beforeCommit?: string;
  afterCommit?: string;
  requiresCodeReview: boolean;
  staleReason?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  artifactInputs: StepRunArtifactInput[];
  producedArtifacts: ArtifactVersion[];
  decisionEvents: DecisionEvent[];
  toolInvocations: ToolInvocation[];
  contextPathEvents: ContextPathEvent[];
  codexInteractions: CodexInteractionEvent[];
  codeChangeRecords: CodeChangeRecord[];
};

export type StepRunArtifactInput = {
  id: string;
  stepRunId: string;
  artifactKey: string;
  artifactVersionId: string;
  artifactVersion: ArtifactVersion;
};

export type ArtifactVersion = {
  id: string;
  workflowRunId: string;
  artifactKey: string;
  version: number;
  displayVersion?: string;
  producerStepRunId: string;
  parentVersionId?: string;
  status: ArtifactStatus;
  contentUri: string;
  contentHash: string;
  filename?: string;
  format?: "markdown" | "plain_text";
  createdAt: string;
  acceptedAt?: string;
};

export type ArtifactVersionContent = ArtifactVersion & {
  content?: string;
  encoding?: "utf-8" | "base64";
  mimeType?: string;
  truncated?: boolean;
};

export type ArtifactVersionParams = {
  includeContent?: boolean;
};

export type DecisionEvent = {
  id: string;
  workflowRunId: string;
  stepRunId: string;
  source: DecisionSource;
  verdict: DecisionVerdict;
  comment?: string;
  targetStepId?: string;
  createdAt: string;
};

export type HumanDecisionResponse = {
  decisionEvent: DecisionEvent;
  stepRun: StepRunDetail;
  workflowRun: WorkflowRunSummary;
};

export type RerunStepRequest = {
  reason: "human_rejected" | "revision_requested" | "stale_artifact" | "manual_retry";
  comment?: string;
  resetToBeforeCommit?: boolean;
};

export type RerunStepResponse = {
  queuedStepRun: StepRunDetail;
  affectedStepRuns: StepRunDetail[];
};

export type CodexInteractionEvent = {
  id: string;
  stepRunId: string;
  sequence: number;
  externalItemId?: string;
  kind: string;
  status: string;
  payload: JsonObject;
  createdAt: string;
};

export type CodexInteractionResponseRequest = {
  responseType: "approve_permission" | "deny_permission" | "answer_question";
  answer?: string;
  comment?: string;
};

export type CodexInteractionResponse = {
  interactionEvent: CodexInteractionEvent;
  acceptedAt: string;
};

export type ContextPathEvent = {
  id: string;
  stepRunId: string;
  path: string;
  type: string;
  status: string;
  reason?: string;
  createdAt: string;
};

export type ToolInvocation = {
  id: string;
  stepRunId: string;
  toolName: string;
  status: string;
  argumentsRedacted: JsonObject;
  resultRef?: string;
  createdAt: string;
};

export type RunEvent = {
  id: string;
  workflowRunId: string;
  eventType: string;
  payload: JsonObject;
  createdAt: string;
};

export type RunEventListParams = {
  after?: string;
};

export type RunEventListResponse = {
  items: RunEvent[];
  nextCursor?: string;
};

export type CodeWorkspace = {
  id: string;
  workflowRunId: string;
  repoPath: string;
  baseRef: string;
  worktreePath: string;
  baseCommit: string;
  createdAt: string;
  changes: CodeChangeRecord[];
};

export type CodeChangeRecord = {
  id: string;
  stepRunId: string;
  codeWorkspaceId: string;
  beforeCommit: string;
  afterCommit?: string;
  diffUri?: string;
  diffHash?: string;
  status: string;
  createdAt: string;
};
