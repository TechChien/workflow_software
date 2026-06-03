export async function createWorkflowRun(
  workflowVersionId: string,
  inputPayload: Record<string, unknown>
) {
  return {
    id: "workflow_run_placeholder",
    workflowVersionId,
    triggerType: "run_button",
    status: "pending",
    inputPayload
  };
}
