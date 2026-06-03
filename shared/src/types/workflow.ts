import type { WorkflowYaml } from "../schemas/workflow-yaml";

export type WorkflowDraft = {
  id: string;
  name: string;
  draftYaml: WorkflowYaml;
};
