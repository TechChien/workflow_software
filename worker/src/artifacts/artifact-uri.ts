export function buildArtifactUri(
  workflowId: string,
  runId: string,
  artifactKey: string,
  version: number
) {
  return `artifact://workflows/${workflowId}/runs/${runId}/${artifactKey}/v${version}`;
}
