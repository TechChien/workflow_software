import { createHash } from "node:crypto";
import {
  WorkflowYamlSchema,
  parseWorkflowYaml,
  stringifyWorkflowYaml,
  type WorkflowYamlInput
} from "@workflow-software/shared";

export function hashWorkflowYaml(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

export function canonicalizeWorkflowDefinition(input: WorkflowYamlInput) {
  const definition = WorkflowYamlSchema.parse(input);
  const yaml = stringifyWorkflowYaml(definition);

  return {
    definition,
    yaml,
    contentHash: hashWorkflowYaml(yaml)
  };
}

export function parseVerifiedWorkflowSnapshot(snapshot: string, expectedHash: string) {
  if (hashWorkflowYaml(snapshot) !== expectedHash) {
    throw new Error("Published workflow snapshot failed its content hash check");
  }

  return parseWorkflowYaml(snapshot);
}
