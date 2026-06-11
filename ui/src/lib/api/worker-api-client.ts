import { baseApi } from "./base-api";
import type {
  ArtifactVersionContent,
  ArtifactVersionParams,
  CodexInteractionResponse,
  CodexInteractionResponseRequest,
  CreateRunRequest,
  CreateWorkflowRequest,
  HealthResponse,
  HumanDecisionRequest,
  HumanDecisionResponse,
  PaginationParams,
  RerunStepRequest,
  RerunStepResponse,
  RunEventListParams,
  RunEventListResponse,
  UpdateDraftWorkflowRequest,
  WorkflowDetail,
  WorkflowDraft,
  WorkflowListResponse,
  WorkflowRunDetail,
  WorkflowRunListParams,
  WorkflowRunListResponse,
  WorkflowVersion,
  WorkflowVersionListResponse
} from "./api-contract";

export const workerApiClient = {
  getHealth: () => baseApi.get<HealthResponse>("/health"),

  listWorkflows: (params?: PaginationParams) =>
    baseApi.get<WorkflowListResponse>("/api/workflows", { params }),

  createWorkflow: (body: CreateWorkflowRequest) =>
    baseApi.post<WorkflowDraft, CreateWorkflowRequest>("/api/workflows", body),

  getWorkflow: (workflowId: string) =>
    baseApi.get<WorkflowDetail>(`/api/workflows/${encodePath(workflowId)}`),

  updateWorkflowDraft: (workflowId: string, body: UpdateDraftWorkflowRequest) =>
    baseApi.patch<WorkflowDraft, UpdateDraftWorkflowRequest>(
      `/api/workflows/${encodePath(workflowId)}/draft`,
      body
    ),

  listWorkflowVersions: (workflowId: string, params?: PaginationParams) =>
    baseApi.get<WorkflowVersionListResponse>(
      `/api/workflows/${encodePath(workflowId)}/versions`,
      { params }
    ),

  publishWorkflowDraft: (workflowId: string) =>
    baseApi.post<WorkflowVersion>(`/api/workflow-versions/${encodePath(workflowId)}/publish`),

  getWorkflowVersion: (workflowVersionId: string) =>
    baseApi.get<WorkflowVersion>(`/api/workflow-versions/${encodePath(workflowVersionId)}`),

  listWorkflowRuns: (params?: WorkflowRunListParams) =>
    baseApi.get<WorkflowRunListResponse>("/api/runs", { params }),

  createWorkflowRun: (workflowVersionId: string, body?: CreateRunRequest) =>
    baseApi.post<WorkflowRunDetail, CreateRunRequest | undefined>(
      `/api/runs/workflow-versions/${encodePath(workflowVersionId)}`,
      body
    ),

  getWorkflowRun: (runId: string) =>
    baseApi.get<WorkflowRunDetail>(`/api/runs/${encodePath(runId)}`),

  listRunEvents: (runId: string, params?: RunEventListParams) =>
    baseApi.get<RunEventListResponse>(`/api/runs/${encodePath(runId)}/events`, { params }),

  rerunStep: (stepRunId: string, body: RerunStepRequest) =>
    baseApi.post<RerunStepResponse, RerunStepRequest>(
      `/api/step-runs/${encodePath(stepRunId)}/rerun`,
      body
    ),

  createHumanDecision: (stepRunId: string, body: HumanDecisionRequest) =>
    baseApi.post<HumanDecisionResponse, HumanDecisionRequest>(
      `/api/human-decisions/${encodePath(stepRunId)}`,
      body
    ),

  respondToCodexInteraction: (
    interactionEventId: string,
    body: CodexInteractionResponseRequest
  ) =>
    baseApi.post<CodexInteractionResponse, CodexInteractionResponseRequest>(
      `/api/codex-interactions/${encodePath(interactionEventId)}/response`,
      body
    ),

  getArtifactVersion: (artifactVersionId: string, params?: ArtifactVersionParams) =>
    baseApi.get<ArtifactVersionContent>(`/api/artifacts/${encodePath(artifactVersionId)}`, {
      params
    })
};

function encodePath(value: string) {
  return encodeURIComponent(value);
}
