import {
  directDependentStepIds,
  type WorkflowYaml
} from "@workflow-software/shared";

export type WorkflowStepRunStatus = {
  stepId: string;
  status: string;
};

export function statusByStepId(stepRuns: WorkflowStepRunStatus[]) {
  return new Map(stepRuns.map((stepRun) => [stepRun.stepId, stepRun.status]));
}

export function dependenciesAccepted(
  workflow: WorkflowYaml,
  stepId: string,
  statuses: Map<string, string>
) {
  const step = workflow.steps.find((candidate) => candidate.id === stepId);

  return Boolean(
    step &&
      step.depends_on.every(
        (dependencyId) => statuses.get(dependencyId) === "ACCEPTED"
      )
  );
}

export function allWorkflowStepsAccepted(
  workflow: WorkflowYaml,
  statuses: Map<string, string>
) {
  return workflow.steps.every((step) => statuses.get(step.id) === "ACCEPTED");
}

export function eligibleDependentStepIds(input: {
  workflow: WorkflowYaml;
  completedStepId: string;
  statuses: Map<string, string>;
}) {
  return directDependentStepIds(input.workflow, input.completedStepId).filter(
    (dependentStepId) =>
      input.statuses.get(dependentStepId) === "PENDING" &&
      dependenciesAccepted(input.workflow, dependentStepId, input.statuses)
  );
}
