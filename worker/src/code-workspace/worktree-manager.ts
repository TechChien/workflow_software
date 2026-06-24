import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export type CodeWorkspaceRequest = {
  workflowRunId: string;
  repoPath: string;
  baseRef: string;
  worktreeRoot: string;
  worktreeName?: string;
};

export type CodeWorkspaceResult = {
  workflowRunId: string;
  repoPath: string;
  baseRef: string;
  worktreePath: string;
  baseCommit: string;
};

export type GitCommandRunner = (args: string[]) => Promise<string>;

export type WorktreeManagerDependencies = {
  runGit?: GitCommandRunner;
};

function runGit(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `git ${args.join(" ")} failed: ${stderr.trim() || error.message}`
          )
        );
        return;
      }

      resolve(stdout);
    });
  });
}

function sanitizePathSegment(label: string, value: string) {
  const segment = value.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!segment) {
    throw new Error(`${label} did not contain any safe path characters`);
  }

  return segment;
}

export async function createRunWorktree(
  request: CodeWorkspaceRequest,
  dependencies: WorktreeManagerDependencies = {}
): Promise<CodeWorkspaceResult> {
  const git = dependencies.runGit ?? runGit;
  const repoPath = path.resolve(request.repoPath);
  const worktreeRoot = path.resolve(request.worktreeRoot);
  const gitRepoPath = (await git(["-C", repoPath, "rev-parse", "--show-toplevel"]))
    .trim();
  const baseCommit = (
    await git(["-C", gitRepoPath, "rev-parse", `${request.baseRef}^{commit}`])
  ).trim();
  const headBranch = (
    await git(["-C", gitRepoPath, "rev-parse", "--abbrev-ref", "HEAD"])
  ).trim();
  const repoName = path.basename(gitRepoPath);
  const worktreeName = request.worktreeName ?? request.workflowRunId;
  const worktreePath = path.join(
    worktreeRoot,
    [
      sanitizePathSegment("workflowRunId", worktreeName),
      sanitizePathSegment("headBranch", headBranch),
      sanitizePathSegment("repoName", repoName)
    ].join("-")
  );

  await mkdir(worktreeRoot, { recursive: true });
  await git(["-C", gitRepoPath, "worktree", "add", "--detach", worktreePath, baseCommit]);

  return {
    workflowRunId: request.workflowRunId,
    repoPath: gitRepoPath,
    baseRef: request.baseRef,
    worktreePath,
    baseCommit
  };
}
