import { parse, stringify } from "yaml";
import { WorkflowYamlSchema, type WorkflowYaml } from "../schemas/workflow-yaml";

export function parseWorkflowYaml(source: string): WorkflowYaml {
  return WorkflowYamlSchema.parse(parse(source));
}

export function stringifyWorkflowYaml(workflow: WorkflowYaml): string {
  return stringify(WorkflowYamlSchema.parse(workflow));
}
