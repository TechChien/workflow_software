export async function evaluateStepArtifact(stepRunId: string) {
  return {
    stepRunId,
    verdict: "pending_human_review"
  };
}
