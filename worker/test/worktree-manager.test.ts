import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunWorktree } from "../src/code-workspace/worktree-manager.js";

describe("createRunWorktree", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-worktree-manager-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a detached worktree for the fixed base commit", async () => {
    const repoPath = path.join(root, "repo", "nested");
    const worktreeRoot = path.join(root, "worktrees");
    const gitRepoPath = path.join(root, "repo");
    const baseCommit = "abc123def456";
    const runGit = vi.fn(async (args: string[]) => {
      if (args.at(-1) === "--show-toplevel") {
        return `${gitRepoPath}\n`;
      }

      if (args.at(-1) === "main^{commit}") {
        return `${baseCommit}\n`;
      }

      if (args.slice(-3).join(" ") === "rev-parse --abbrev-ref HEAD") {
        return "feature/test\n";
      }

      return "";
    });

    await expect(
      createRunWorktree(
        {
          workflowRunId: "workflow/run 1",
          repoPath,
          baseRef: "main",
          worktreeRoot
        },
        { runGit }
      )
    ).resolves.toEqual({
      workflowRunId: "workflow/run 1",
      repoPath: gitRepoPath,
      baseRef: "main",
      worktreePath: path.join(worktreeRoot, "workflow-run-1-feature-test-repo"),
      baseCommit
    });

    expect(runGit).toHaveBeenCalledWith([
      "-C",
      path.resolve(repoPath),
      "rev-parse",
      "--show-toplevel"
    ]);
    expect(runGit).toHaveBeenCalledWith([
      "-C",
      gitRepoPath,
      "rev-parse",
      "main^{commit}"
    ]);
    expect(runGit).toHaveBeenCalledWith([
      "-C",
      gitRepoPath,
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    expect(runGit).toHaveBeenCalledWith([
      "-C",
      gitRepoPath,
      "worktree",
      "add",
      "--detach",
      path.join(worktreeRoot, "workflow-run-1-feature-test-repo"),
      baseCommit
    ]);
  });
});
