"use client";

import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions
} from "@tanstack/react-query";
import { BaseApiError } from "@/lib/api/base-api";
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
} from "@/lib/api/api-contract";
import { workerApiClient } from "@/lib/api/worker-api-client";
import { workerApiQueryKeys } from "@/lib/api/query-keys";

type QueryOptions<TData> = Omit<
  UseQueryOptions<TData, BaseApiError, TData>,
  "queryKey" | "queryFn"
>;

type MutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, BaseApiError, TVariables>,
  "mutationFn"
>;

export function useHealth(options?: QueryOptions<HealthResponse>) {
  return useQuery({
    ...options,
    queryKey: workerApiQueryKeys.health(),
    queryFn: workerApiClient.getHealth
  });
}

export function useWorkflows(
  params?: PaginationParams,
  options?: QueryOptions<WorkflowListResponse>
) {
  return useQuery({
    ...options,
    queryKey: workerApiQueryKeys.workflows.list(params),
    queryFn: () => workerApiClient.listWorkflows(params)
  });
}

export function useWorkflow(
  workflowId?: string,
  options?: QueryOptions<WorkflowDetail>
) {
  return useQuery({
    ...options,
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.workflows.detail(workflowId ?? ""),
    queryFn: () => workerApiClient.getWorkflow(workflowId ?? "")
  });
}

export function useWorkflowVersions(
  workflowId?: string,
  params?: PaginationParams,
  options?: QueryOptions<WorkflowVersionListResponse>
) {
  return useQuery({
    ...options,
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.workflows.versions(workflowId ?? "", params),
    queryFn: () => workerApiClient.listWorkflowVersions(workflowId ?? "", params)
  });
}

export function useWorkflowVersion(
  workflowVersionId?: string,
  options?: QueryOptions<WorkflowVersion>
) {
  return useQuery({
    ...options,
    enabled: Boolean(workflowVersionId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.workflowVersions.detail(workflowVersionId ?? ""),
    queryFn: () => workerApiClient.getWorkflowVersion(workflowVersionId ?? "")
  });
}

export function useRunHistory(
  params?: WorkflowRunListParams,
  options?: QueryOptions<WorkflowRunListResponse>
) {
  return useQuery({
    ...options,
    queryKey: workerApiQueryKeys.runs.list(params),
    queryFn: () => workerApiClient.listWorkflowRuns(params)
  });
}

export function useWorkflowRun(
  runId?: string,
  options?: QueryOptions<WorkflowRunDetail>
) {
  return useQuery({
    ...options,
    enabled: Boolean(runId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.runs.detail(runId ?? ""),
    queryFn: () => workerApiClient.getWorkflowRun(runId ?? "")
  });
}

export function useRunEvents(
  runId?: string,
  params?: RunEventListParams,
  options?: QueryOptions<RunEventListResponse>
) {
  return useQuery({
    ...options,
    enabled: Boolean(runId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.runs.events(runId ?? "", params),
    queryFn: () => workerApiClient.listRunEvents(runId ?? "", params)
  });
}

export function useArtifactVersion(
  artifactVersionId?: string,
  params?: ArtifactVersionParams,
  options?: QueryOptions<ArtifactVersionContent>
) {
  return useQuery({
    ...options,
    enabled: Boolean(artifactVersionId) && (options?.enabled ?? true),
    queryKey: workerApiQueryKeys.artifacts.detail(artifactVersionId ?? "", params),
    queryFn: () => workerApiClient.getArtifactVersion(artifactVersionId ?? "", params)
  });
}

export function useCreateWorkflow(
  options?: MutationOptions<WorkflowDraft, CreateWorkflowRequest>
) {
  return useMutation({
    ...options,
    mutationFn: (body: CreateWorkflowRequest) => workerApiClient.createWorkflow(body)
  });
}

export function useUpdateWorkflowDraft(
  options?: MutationOptions<
    WorkflowDraft,
    { workflowId: string; body: UpdateDraftWorkflowRequest }
  >
) {
  return useMutation({
    ...options,
    mutationFn: ({ workflowId, body }: { workflowId: string; body: UpdateDraftWorkflowRequest }) =>
      workerApiClient.updateWorkflowDraft(workflowId, body)
  });
}

export function usePublishWorkflowDraft(
  options?: MutationOptions<WorkflowVersion, string>
) {
  return useMutation({
    ...options,
    mutationFn: (workflowId: string) => workerApiClient.publishWorkflowDraft(workflowId)
  });
}

export function useCreateWorkflowRun(
  options?: MutationOptions<
    WorkflowRunDetail,
    { workflowVersionId: string; body?: CreateRunRequest }
  >
) {
  return useMutation({
    ...options,
    mutationFn: ({
      workflowVersionId,
      body
    }: {
      workflowVersionId: string;
      body?: CreateRunRequest;
    }) =>
      workerApiClient.createWorkflowRun(workflowVersionId, body)
  });
}

export function useRerunStep(
  options?: MutationOptions<
    RerunStepResponse,
    { stepRunId: string; body: RerunStepRequest }
  >
) {
  return useMutation({
    ...options,
    mutationFn: ({ stepRunId, body }: { stepRunId: string; body: RerunStepRequest }) =>
      workerApiClient.rerunStep(stepRunId, body)
  });
}

export function useCreateHumanDecision(
  options?: MutationOptions<
    HumanDecisionResponse,
    { stepRunId: string; body: HumanDecisionRequest }
  >
) {
  return useMutation({
    ...options,
    mutationFn: ({ stepRunId, body }: { stepRunId: string; body: HumanDecisionRequest }) =>
      workerApiClient.createHumanDecision(stepRunId, body)
  });
}

export function useRespondToCodexInteraction(
  options?: MutationOptions<
    CodexInteractionResponse,
    { interactionEventId: string; body: CodexInteractionResponseRequest }
  >
) {
  return useMutation({
    ...options,
    mutationFn: ({
      interactionEventId,
      body
    }: {
      interactionEventId: string;
      body: CodexInteractionResponseRequest;
    }) =>
      workerApiClient.respondToCodexInteraction(interactionEventId, body)
  });
}
