export async function publishWorkflowDraft(workflowId: string) {
  return {
    id: "workflow_version_placeholder",
    workflowId,
    version: 1,
    status: "published"
  };
}
