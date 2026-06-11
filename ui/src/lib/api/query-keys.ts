import type {
  ArtifactVersionParams,
  PaginationParams,
  RunEventListParams,
  WorkflowRunListParams
} from "./api-contract";

const rootKey = ["worker-api"] as const;
const workflowRootKey = [...rootKey, "workflows"] as const;
const workflowDetailKey = (workflowId: string) =>
  [...workflowRootKey, "detail", workflowId] as const;
const workflowVersionRootKey = [...rootKey, "workflow-versions"] as const;
const runRootKey = [...rootKey, "runs"] as const;
const runDetailKey = (runId: string) => [...runRootKey, "detail", runId] as const;
const artifactRootKey = [...rootKey, "artifacts"] as const;

export const workerApiQueryKeys = {
  all: rootKey,
  health: () => [...rootKey, "health"] as const,
  workflows: {
    all: workflowRootKey,
    list: (params?: PaginationParams) =>
      [...workflowRootKey, "list", params ?? {}] as const,
    detail: workflowDetailKey,
    versions: (workflowId: string, params?: PaginationParams) =>
      [...workflowDetailKey(workflowId), "versions", params ?? {}] as const
  },
  workflowVersions: {
    all: workflowVersionRootKey,
    detail: (workflowVersionId: string) =>
      [...workflowVersionRootKey, "detail", workflowVersionId] as const
  },
  runs: {
    all: runRootKey,
    list: (params?: WorkflowRunListParams) =>
      [...runRootKey, "list", params ?? {}] as const,
    detail: runDetailKey,
    events: (runId: string, params?: RunEventListParams) =>
      [...runDetailKey(runId), "events", params ?? {}] as const
  },
  artifacts: {
    all: artifactRootKey,
    detail: (artifactVersionId: string, params?: ArtifactVersionParams) =>
      [...artifactRootKey, "detail", artifactVersionId, params ?? {}] as const
  }
};
