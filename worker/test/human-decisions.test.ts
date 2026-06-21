import { describe, expect, it } from "vitest";
import type { StepDefinition } from "@workflow-software/shared";
import { shouldRerunForHumanDecision } from "../src/api/routes/human-decision-policy.js";

function step(rerun: boolean): StepDefinition {
  return {
    id: "step-1",
    type: "agent",
    evaluate: { evaluator: "human_review", rerun },
    depends_on: [],
    input_artifacts: [],
    output_artifacts: [],
    context_paths: [],
    tool_capabilities: [],
    prompt: "Run the step.",
    acceptance: { criteria: [] }
  };
}

describe("human decision rerun behavior", () => {
  it("keeps human reject as terminal when rerun is disabled", () => {
    expect(shouldRerunForHumanDecision(step(false), "reject")).toBe(false);
  });

  it("reruns human reject when the step opts in", () => {
    expect(shouldRerunForHumanDecision(step(true), "reject")).toBe(true);
  });

  it("continues to rerun request_revision decisions", () => {
    expect(shouldRerunForHumanDecision(step(false), "request_revision")).toBe(true);
  });
});
