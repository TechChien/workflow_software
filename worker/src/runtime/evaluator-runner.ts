import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../generated/prisma/client.js";

export type EvaluatorDecision = {
  stepRunId: string;
  source: DecisionSource;
  verdict: DecisionVerdict;
  comment?: string;
};

export type EvaluateStepInput = {
  stepRunId: string;
  evaluator: StepRunEvaluator;
};

export async function evaluateStepArtifact(
  input: EvaluateStepInput
): Promise<EvaluatorDecision> {
  // Temporary MVP stub: every configured evaluator mode simulates a verified approval.
  return {
    stepRunId: input.stepRunId,
    source:
      input.evaluator === StepRunEvaluator.HUMAN_REVIEW
        ? DecisionSource.HUMAN
        : DecisionSource.EVALUATOR,
    verdict: DecisionVerdict.APPROVE
  };
}
