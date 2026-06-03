export async function recordBeforeCommit(worktreePath: string) {
  void worktreePath;
  return "";
}

export async function commitApprovedStep(worktreePath: string, message: string) {
  void worktreePath;
  void message;
  return "";
}

export async function resetToCommit(worktreePath: string, commit: string) {
  return { worktreePath, commit };
}
