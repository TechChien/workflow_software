import {
  DecisionVerdict,
  StepRunEvaluator
} from "../generated/prisma/client.js";

export type StepCompletionAction =
  | "accept"
  | "reject"
  | "wait_for_human_review";

export function shouldWaitForHumanReview(evaluator: StepRunEvaluator) {
  return (
    evaluator === StepRunEvaluator.HUMAN_REVIEW ||
    evaluator === StepRunEvaluator.MIXED
  );
}

export function resolveStepCompletion(input: {
  finalVerdict: DecisionVerdict;
  evaluator: StepRunEvaluator;
}): StepCompletionAction {
  if (input.finalVerdict !== DecisionVerdict.APPROVE) {
    return "reject";
  }

  if (shouldWaitForHumanReview(input.evaluator)) {
    return "wait_for_human_review";
  }

  return "accept";
}
