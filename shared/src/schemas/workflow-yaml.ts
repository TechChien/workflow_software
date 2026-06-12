import { z } from "zod";
import {
  NormalizedStepDefinitionSchema,
  RawStepDefinitionSchema,
  type RawStepDefinition,
  type StepDefinition
} from "./steps.js";

const WorkflowYamlInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  description: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(RawStepDefinitionSchema),
  ui: z.record(z.string(), z.unknown()).default({})
});

function uniqueStepIds(values: string[]) {
  return Array.from(new Set(values));
}

function addGraphIssue(
  ctx: z.RefinementCtx,
  message: string,
  path: Array<string | number> = ["steps"]
) {
  ctx.addIssue({
    code: "custom",
    message,
    path
  });
}

function dependencyCycle(steps: StepDefinition[]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  function visit(stepId: string): string[] | undefined {
    if (visiting.has(stepId)) {
      const cycleStart = path.indexOf(stepId);
      return [...path.slice(cycleStart), stepId];
    }

    if (visited.has(stepId)) {
      return undefined;
    }

    visiting.add(stepId);
    path.push(stepId);

    for (const dependencyId of byId.get(stepId)?.depends_on ?? []) {
      const cycle = visit(dependencyId);

      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    visiting.delete(stepId);
    visited.add(stepId);

    return undefined;
  }

  for (const step of steps) {
    const cycle = visit(step.id);

    if (cycle) {
      return cycle;
    }
  }

  return undefined;
}

function normalizeWorkflowSteps(
  rawSteps: RawStepDefinition[],
  ctx: z.RefinementCtx
) {
  const dependenciesById = new Map<string, string[]>();
  const stepIds = new Set<string>();
  let hasIssue = false;

  rawSteps.forEach((step, index) => {
    if (stepIds.has(step.id)) {
      addGraphIssue(ctx, `Duplicate workflow step id: ${step.id}`, [
        "steps",
        index,
        "id"
      ]);
      hasIssue = true;
    }

    stepIds.add(step.id);
    dependenciesById.set(
      step.id,
      uniqueStepIds([
        ...step.depends_on,
        ...(step.upstream ? [step.upstream] : [])
      ])
    );
  });

  rawSteps.forEach((step, index) => {
    if (!step.downstream) {
      return;
    }

    if (!stepIds.has(step.downstream)) {
      addGraphIssue(
        ctx,
        `Step ${step.id} downstream references missing step ${step.downstream}`,
        ["steps", index, "downstream"]
      );
      hasIssue = true;
      return;
    }

    dependenciesById.set(
      step.downstream,
      uniqueStepIds([...(dependenciesById.get(step.downstream) ?? []), step.id])
    );
  });

  const normalizedSteps = rawSteps.map((rawStep) => {
    const { upstream: _upstream, downstream: _downstream, ...step } = rawStep;

    return NormalizedStepDefinitionSchema.parse({
      ...step,
      depends_on: dependenciesById.get(step.id) ?? []
    });
  });

  normalizedSteps.forEach((step, index) => {
    for (const dependencyId of step.depends_on) {
      if (dependencyId === step.id) {
        addGraphIssue(ctx, `Step ${step.id} cannot depend on itself`, [
          "steps",
          index,
          "depends_on"
        ]);
        hasIssue = true;
      }

      if (!stepIds.has(dependencyId)) {
        addGraphIssue(
          ctx,
          `Step ${step.id} depends on missing step ${dependencyId}`,
          ["steps", index, "depends_on"]
        );
        hasIssue = true;
      }
    }
  });

  if (!hasIssue) {
    const cycle = dependencyCycle(normalizedSteps);

    if (cycle) {
      addGraphIssue(
        ctx,
        `Workflow dependency cycle detected: ${cycle.join(" -> ")}`
      );
      hasIssue = true;
    }
  }

  if (hasIssue) {
    return undefined;
  }

  return normalizedSteps;
}

export const WorkflowYamlSchema = WorkflowYamlInputSchema.transform((workflow, ctx) => {
  const steps = normalizeWorkflowSteps(workflow.steps, ctx);

  if (!steps) {
    return z.NEVER;
  }

  return {
    ...workflow,
    steps
  };
});

export type WorkflowYaml = z.infer<typeof WorkflowYamlSchema>;
export type WorkflowYamlInput = z.input<typeof WorkflowYamlSchema>;
