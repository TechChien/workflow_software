export type CodeWorkspaceRequest = {
  workflowRunId: string;
  repoPath: string;
  baseRef: string;
};

export async function createRunWorktree(request: CodeWorkspaceRequest) {
  return {
    ...request,
    worktreePath: "",
    baseCommit: ""
  };
}
