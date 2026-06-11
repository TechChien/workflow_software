import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowSummary } from "@/lib/api/api-contract";
import {
  type PublishedWorkflow,
  type WorkflowRunStatus
} from "@/mock/workflowWorkbench";
import { useWorkflows } from "@/services/worker-api-service";
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
  const [localPublishedWorkflows, setLocalPublishedWorkflows] = useState<PublishedWorkflow[]>([]);
  const [lastRunStatusOverrides, setLastRunStatusOverrides] = useState<Record<string, WorkflowRunStatus>>({});
  const apiPublishedWorkflows = useMemo(
    () =>
      workflowsQuery.data?.items
        .map(toPublishedWorkflow)
        .filter((workflow): workflow is PublishedWorkflow => Boolean(workflow)) ?? [],
    [workflowsQuery.data?.items]
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
    isLoading: workflowsQuery.isLoading,
    errorMessage: workflowsQuery.error?.message,
    addPublishedWorkflow,
    updateLastRunStatus,
    selectWorkflow
  };
}

function toPublishedWorkflow(workflow: WorkflowSummary): PublishedWorkflow | undefined {
  if (!workflow.latestPublishedVersion) {
    return undefined;
  }

  return {
    id: workflow.latestPublishedVersion.id,
    revision: workflow.latestPublishedVersion.revision,
    publishedAt: workflow.latestPublishedVersion.publishedAt,
    workflow: workflow.draftYaml,
    lastRunStatus: workflow.latestPublishedVersion.lastRun?.status ?? workflow.lastRun?.status ?? "pending"
  };
}
