import { describe, expect, it } from "vitest";
import type { WorkflowYaml } from "@workflow-software/shared";
import {
  allWorkflowStepsAccepted,
  eligibleDependentStepIds,
  statusByStepId
} from "../src/runtime/workflow-progression.js";

function workflowWithDependencies(
  dependencies: Record<string, string[]>
): WorkflowYaml {
  return {
    id: "workflow-1",
    name: "Progression test",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: Object.entries(dependencies).map(([id, dependsOn]) => ({
      id,
      type: "agent",
      depends_on: dependsOn,
      input_artifacts: [],
      output_artifacts: [],
      context_paths: [],
      tool_capabilities: [],
      evaluate: { evaluator: "mixed", rerun: false },
      prompt: `Run ${id}.`,
      acceptance: { criteria: [] }
    })),
    ui: {}
  } as WorkflowYaml;
}

describe("workflow progression", () => {
  it("readies every eligible fanout child", () => {
    const workflow = workflowWithDependencies({
      "step-1": [],
      "step-2": ["step-1"],
      "step-3": ["step-1"]
    });
    const statuses = statusByStepId([
      { stepId: "step-1", status: "ACCEPTED" },
      { stepId: "step-2", status: "PENDING" },
      { stepId: "step-3", status: "PENDING" }
    ]);

    expect(
      eligibleDependentStepIds({
        workflow,
        completedStepId: "step-1",
        statuses
      })
    ).toEqual(["step-2", "step-3"]);
  });

  it("waits to ready a fanin child until all dependencies are accepted", () => {
    const workflow = workflowWithDependencies({
      "step-1": [],
      "step-2": [],
      "step-3": ["step-1", "step-2"]
    });
    const statuses = statusByStepId([
      { stepId: "step-1", status: "ACCEPTED" },
      { stepId: "step-2", status: "READY" },
      { stepId: "step-3", status: "PENDING" }
    ]);

    expect(
      eligibleDependentStepIds({
        workflow,
        completedStepId: "step-1",
        statuses
      })
    ).toEqual([]);
  });

  it("detects when all workflow steps are accepted", () => {
    const workflow = workflowWithDependencies({
      "step-1": [],
      "step-2": ["step-1"]
    });

    expect(
      allWorkflowStepsAccepted(
        workflow,
        statusByStepId([
          { stepId: "step-1", status: "ACCEPTED" },
          { stepId: "step-2", status: "ACCEPTED" }
        ])
      )
    ).toBe(true);
    expect(
      allWorkflowStepsAccepted(
        workflow,
        statusByStepId([
          { stepId: "step-1", status: "ACCEPTED" },
          { stepId: "step-2", status: "READY" }
        ])
      )
    ).toBe(false);
  });
});
