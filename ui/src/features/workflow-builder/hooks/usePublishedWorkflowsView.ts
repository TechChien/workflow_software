import { useCallback, useState } from "react";
import {
  initialPublished,
  type PublishedWorkflow,
  type WorkflowRunStatus
} from "@/mock/workflowWorkbench";
import { useWorkbenchStore } from "../stores/useWorkbenchStore";

export type PublishedWorkflowsViewModel = {
  workflows: PublishedWorkflow[];
  selectedWorkflowId: string;
  selectedWorkflow?: PublishedWorkflow;
  addPublishedWorkflow: (workflow: PublishedWorkflow) => void;
  updateLastRunStatus: (workflowId: string, status: WorkflowRunStatus) => void;
  selectWorkflow: (workflow: PublishedWorkflow) => void;
};

export function usePublishedWorkflowsView(): PublishedWorkflowsViewModel {
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const [publishedWorkflows, setPublishedWorkflows] = useState<PublishedWorkflow[]>(initialPublished);
  const [selectedPublishedWorkflowVersionId, setSelectedPublishedWorkflowVersionId] = useState(
    initialPublished[0]?.id ?? ""
  );
  const selectedPublishedWorkflow =
    publishedWorkflows.find((workflow) => workflow.id === selectedPublishedWorkflowVersionId) ??
    publishedWorkflows[0];

  const addPublishedWorkflow = useCallback((workflow: PublishedWorkflow) => {
    setPublishedWorkflows((workflows) => [workflow, ...workflows]);
    setSelectedPublishedWorkflowVersionId(workflow.id);
  }, []);

  const updateLastRunStatus = useCallback((workflowId: string, status: WorkflowRunStatus) => {
    setPublishedWorkflows((workflows) =>
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
    addPublishedWorkflow,
    updateLastRunStatus,
    selectWorkflow
  };
}
