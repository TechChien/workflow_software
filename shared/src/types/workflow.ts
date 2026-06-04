import type { WorkflowYaml } from "../schemas/workflow-yaml.js";

export type WorkflowDraft = {
  id: string;
  name: string;
  draftYaml: WorkflowYaml;
};
