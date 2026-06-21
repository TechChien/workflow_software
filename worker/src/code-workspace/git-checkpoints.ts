import { execFile } from "node:child_process";

export type GitCommandRunner = (args: string[]) => Promise<string>;

export type GitCheckpointDependencies = {
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

function requireCommit(commit: string) {
  const normalized = commit.trim();

  if (!normalized) {
    throw new Error("A non-empty git commit is required");
  }

  return normalized;
}

async function currentHead(worktreePath: string, git: GitCommandRunner) {
  return (await git(["-C", worktreePath, "rev-parse", "HEAD"])).trim();
}

export async function recordBeforeCommit(
  worktreePath: string,
  dependencies: GitCheckpointDependencies = {}
) {
  return currentHead(worktreePath, dependencies.runGit ?? runGit);
}

export async function commitApprovedStep(
  worktreePath: string,
  message: string,
  dependencies: GitCheckpointDependencies = {}
) {
  const git = dependencies.runGit ?? runGit;

  await git(["-C", worktreePath, "add", "-A", "--", ".", ":(exclude).workflow-runtime"]);

  const stagedFiles = (
    await git(["-C", worktreePath, "diff", "--cached", "--name-only"])
  ).trim();

  if (!stagedFiles) {
    return currentHead(worktreePath, git);
  }

  await git(["-C", worktreePath, "commit", "-m", message]);

  return currentHead(worktreePath, git);
}

export async function resetToCommit(
  worktreePath: string,
  commit: string,
  dependencies: GitCheckpointDependencies = {}
) {
  const git = dependencies.runGit ?? runGit;
  const normalizedCommit = requireCommit(commit);

  await git(["-C", worktreePath, "reset", "--hard", normalizedCommit]);
  await git(["-C", worktreePath, "clean", "-fd"]);

  return {
    worktreePath,
    commit: normalizedCommit
  };
}
