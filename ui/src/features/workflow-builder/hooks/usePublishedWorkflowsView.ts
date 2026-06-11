import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowVersion } from "@/lib/api/api-contract";
import {
  type PublishedWorkflow,
  type WorkflowRunStatus
} from "@/mock/workflowWorkbench";
import { useWorkflowVersionsForWorkflows, useWorkflows } from "@/services/worker-api-service";
import { useWorkbenchStore } from "../stores/useWorkbenchStore";

export type PublishedWorkflowsViewModel = {
  workflows: PublishedWorkflow[];
  selectedWorkflowId: string;
  selectedWorkflow?: PublishedWorkflow;
  isLoading: boolean;
  errorMessage?: string;
  addPublishedWorkflow: (workflow: PublishedWorkflow) => void;
  updateLastRunStatus: (workflowId: string, status: WorkflowRunStatus) => void;
  selectWorkflow: (workflow: PublishedWorkflow) => void;
};

export function usePublishedWorkflowsView(): PublishedWorkflowsViewModel {
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const workflowsQuery = useWorkflows();
  const workflowIds = useMemo(
    () => workflowsQuery.data?.items.map((workflow) => workflow.id) ?? [],
    [workflowsQuery.data?.items]
  );
  const workflowVersionsQueries = useWorkflowVersionsForWorkflows(workflowIds);
  const [localPublishedWorkflows, setLocalPublishedWorkflows] = useState<PublishedWorkflow[]>([]);
  const [lastRunStatusOverrides, setLastRunStatusOverrides] = useState<Record<string, WorkflowRunStatus>>({});
  const apiPublishedWorkflows = useMemo(
    () =>
      workflowVersionsQueries
        .flatMap((query) => query.data?.items ?? [])
        .map(toPublishedWorkflow),
    [workflowVersionsQueries]
  );
  const publishedWorkflows = useMemo(() => {
    const localWorkflowIds = new Set(localPublishedWorkflows.map((workflow) => workflow.id));
    const workflows = [
      ...localPublishedWorkflows,
      ...apiPublishedWorkflows.filter((workflow) => !localWorkflowIds.has(workflow.id))
    ];

    return workflows.map((workflow) => ({
      ...workflow,
      lastRunStatus: lastRunStatusOverrides[workflow.id] ?? workflow.lastRunStatus
    }));
  }, [apiPublishedWorkflows, lastRunStatusOverrides, localPublishedWorkflows]);
  const [selectedPublishedWorkflowVersionId, setSelectedPublishedWorkflowVersionId] = useState("");
  const selectedPublishedWorkflow =
    publishedWorkflows.find((workflow) => workflow.id === selectedPublishedWorkflowVersionId) ??
    publishedWorkflows[0];

  useEffect(() => {
    if (!selectedPublishedWorkflowVersionId && publishedWorkflows[0]) {
      setSelectedPublishedWorkflowVersionId(publishedWorkflows[0].id);
    }
  }, [publishedWorkflows, selectedPublishedWorkflowVersionId]);

  const addPublishedWorkflow = useCallback((workflow: PublishedWorkflow) => {
    setLocalPublishedWorkflows((workflows) => [workflow, ...workflows]);
    setSelectedPublishedWorkflowVersionId(workflow.id);
  }, []);

  const updateLastRunStatus = useCallback((workflowId: string, status: WorkflowRunStatus) => {
    setLastRunStatusOverrides((statuses) => ({ ...statuses, [workflowId]: status }));
    setLocalPublishedWorkflows((workflows) =>
      workflows.map((workflow) => (workflow.id === workflowId ? { ...workflow, lastRunStatus: status } : workflow))
    );
  }, []);

  const selectWorkflow = useCallback(
    (workflow: PublishedWorkflow) => {
      setSelectedPublishedWorkflowVersionId(workflow.id);
      setViewMode("published");
    },
    [setViewMode]
  );

  return {
    workflows: publishedWorkflows,
    selectedWorkflowId: selectedPublishedWorkflowVersionId,
    selectedWorkflow: selectedPublishedWorkflow,
    isLoading: workflowsQuery.isLoading || workflowVersionsQueries.some((query) => query.isLoading),
    errorMessage:
      workflowsQuery.error?.message ??
      workflowVersionsQueries.find((query) => query.error)?.error?.message,
    addPublishedWorkflow,
    updateLastRunStatus,
    selectWorkflow
  };
}

function toPublishedWorkflow(workflowVersion: WorkflowVersion): PublishedWorkflow {
  return {
    id: workflowVersion.id,
    revision: workflowVersion.revision,
    publishedAt: workflowVersion.publishedAt,
    workflow: workflowVersion.yamlSnapshot,
    lastRunStatus: workflowVersion.lastRun?.status ?? "pending"
  };
}
