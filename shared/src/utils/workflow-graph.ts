import type { WorkflowYaml } from "../schemas/workflow-yaml.js";

export function workflowStepIds(workflow: WorkflowYaml) {
  return new Set(workflow.steps.map((step) => step.id));
}

export function directDependentStepIds(workflow: WorkflowYaml, stepId: string) {
  return workflow.steps
    .filter((step) => step.depends_on.includes(stepId))
    .map((step) => step.id);
}

export function transitiveDependentStepIds(workflow: WorkflowYaml, stepId: string) {
  const dependents: string[] = [];
  const queue = directDependentStepIds(workflow, stepId);
  const seen = new Set<string>([stepId]);

  while (queue.length > 0) {
    const nextStepId = queue.shift() as string;

    if (seen.has(nextStepId)) {
      continue;
    }

    seen.add(nextStepId);
    dependents.push(nextStepId);
    queue.push(...directDependentStepIds(workflow, nextStepId));
  }

  return dependents;
}
