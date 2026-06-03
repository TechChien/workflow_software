export async function markDownstreamStale(
  workflowRunId: string,
  changedArtifactVersionId: string
) {
  return { workflowRunId, changedArtifactVersionId, marked: 0 };
}
