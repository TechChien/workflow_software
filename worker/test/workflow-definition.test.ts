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

function workflowWithSteps(steps: Array<Record<string, unknown>>) {
  return {
    id: "workflow-1",
    name: "Workflow definition test",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: steps.map((step) => ({
      type: "agent",
      input_artifacts: [],
      output_artifacts: [],
      context_paths: [],
      tool_capabilities: [],
      prompt: "Run the step.",
      acceptance: { criteria: [] },
      ...step
    })),
    ui: {}
  };
}

describe("canonicalizeWorkflowDefinition", () => {
  it("defaults step evaluation to mixed", () => {
    const snapshot = canonicalizeWorkflowDefinition(baseWorkflow({ type: "agent" }));

    expect(snapshot.definition.steps[0]?.evaluate.evaluator).toBe("mixed");
    expect(snapshot.definition.steps[0]?.evaluate.rerun).toBe(false);
  });

  it("accepts explicit evaluator settings", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      baseWorkflow({
        type: "code_agent",
        evaluate: { evaluator: "human_review" }
      })
    );

    expect(snapshot.definition.steps[0]?.evaluate.evaluator).toBe("human_review");
    expect(snapshot.definition.steps[0]?.evaluate.rerun).toBe(false);
  });

  it("accepts explicit rerun settings", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      baseWorkflow({
        type: "code_agent",
        evaluate: { evaluator: "human_review", rerun: true }
      })
    );

    expect(snapshot.definition.steps[0]?.evaluate).toEqual({
      evaluator: "human_review",
      rerun: true
    });
  });

  it("rejects legacy optional flags on context paths", () => {
    expect(() =>
      canonicalizeWorkflowDefinition(
        baseWorkflow({
          type: "code_agent",
          context_paths: [{ path: "src", type: "directory", optional: true }]
        })
      )
    ).toThrow();
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

  it("accepts fanout and fanin dependencies", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      workflowWithSteps([
        { id: "step-1", depends_on: [] },
        { id: "step-2", depends_on: ["step-1"] },
        { id: "step-3", depends_on: ["step-1"] },
        { id: "step-4", depends_on: ["step-2", "step-3"] }
      ])
    );

    expect(snapshot.definition.steps.map((step) => step.depends_on)).toEqual([
      [],
      ["step-1"],
      ["step-1"],
      ["step-2", "step-3"]
    ]);
    expect(snapshot.yaml).toContain("depends_on");
    expect(snapshot.yaml).not.toContain("upstream:");
    expect(snapshot.yaml).not.toContain("downstream:");
  });

  it("converts legacy upstream and downstream fields to depends_on", () => {
    const snapshot = canonicalizeWorkflowDefinition(
      workflowWithSteps([
        { id: "step-1", downstream: "step-2" },
        { id: "step-2", upstream: "step-1" }
      ])
    );

    expect(snapshot.definition.steps[0]?.depends_on).toEqual([]);
    expect(snapshot.definition.steps[1]?.depends_on).toEqual(["step-1"]);
    expect(snapshot.yaml).not.toContain("upstream:");
    expect(snapshot.yaml).not.toContain("downstream:");
  });

  it("rejects missing dependencies", () => {
    expect(() =>
      canonicalizeWorkflowDefinition(
        workflowWithSteps([{ id: "step-1", depends_on: ["missing-step"] }])
      )
    ).toThrow("depends on missing step");
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      canonicalizeWorkflowDefinition(
        workflowWithSteps([
          { id: "step-1", depends_on: ["step-2"] },
          { id: "step-2", depends_on: ["step-1"] }
        ])
      )
    ).toThrow("Workflow dependency cycle detected");
  });
});
