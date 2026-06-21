import type { StepDefinition } from "@workflow-software/shared";

export function shouldRerunForHumanDecision(step: StepDefinition, verdict: string) {
  return verdict === "request_revision" || (verdict === "reject" && step.evaluate.rerun);
}
