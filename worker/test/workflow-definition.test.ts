import { describe, expect, it } from "vitest";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

function baseWorkflow(step: Record<string, unknown>) {
  return {
    id: "workflow-1",
    name: "Workflow definition test",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: "step-1",
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        prompt: "Run the step.",
        acceptance: { criteria: [] },
        ...step
      }
    ],
    ui: {}
  };
}

describe("canonicalizeWorkflowDefinition", () => {
  it("defaults step evaluation to mixed", () => {
    const snapshot = canonicalizeWorkflowDefinition(baseWorkflow({ type: "agent" }));

    expect(snapshot.definition.steps[0]?.evaluate.evaluator).toBe("mixed");
  });

  it("accepts explicit evaluator settings", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      baseWorkflow({
        type: "code_agent",
        evaluate: { evaluator: "human_review" }
      })
    );

    expect(snapshot.definition.steps[0]?.evaluate.evaluator).toBe("human_review");
  });

  it("falls back to mixed for invalid evaluator settings", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      baseWorkflow({
        type: "agent",
        evaluate: { evaluator: "invalid_evaluator" }
      })
    );

    expect(snapshot.definition.steps[0]?.evaluate.evaluator).toBe("mixed");
  });

  it("rejects human_review as a step type", () => {
    expect(() => canonicalizeWorkflowDefinition(baseWorkflow({ type: "human_review" }))).toThrow();
  });
});
