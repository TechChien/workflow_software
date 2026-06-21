import { describe, expect, it, vi } from "vitest";
import {
  commitApprovedStep,
  recordBeforeCommit,
  resetToCommit
} from "../src/code-workspace/git-checkpoints.js";

describe("git checkpoints", () => {
  it("records the current worktree HEAD", async () => {
    const runGit = vi.fn(async () => "abc123\n");

    await expect(
      recordBeforeCommit("C:\\worktree", { runGit })
    ).resolves.toBe("abc123");
    expect(runGit).toHaveBeenCalledWith(["-C", "C:\\worktree", "rev-parse", "HEAD"]);
  });

  it("resets tracked and untracked worktree changes to a checkpoint", async () => {
    const runGit = vi.fn(async () => "");

    await expect(
      resetToCommit("C:\\worktree", "abc123\n", { runGit })
    ).resolves.toEqual({
      worktreePath: "C:\\worktree",
      commit: "abc123"
    });
    expect(runGit).toHaveBeenNthCalledWith(1, [
      "-C",
      "C:\\worktree",
      "reset",
      "--hard",
      "abc123"
    ]);
    expect(runGit).toHaveBeenNthCalledWith(2, ["-C", "C:\\worktree", "clean", "-fd"]);
  });

  it("commits approved source changes while excluding workflow runtime files", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes("--name-only")) {
        return "src/index.ts\n";
      }

      if (args.includes("rev-parse")) {
        return "def456\n";
      }

      return "";
    });

    await expect(
      commitApprovedStep("C:\\worktree", "Approve step", { runGit })
    ).resolves.toBe("def456");
    expect(runGit).toHaveBeenNthCalledWith(1, [
      "-C",
      "C:\\worktree",
      "add",
      "-A",
      "--",
      ".",
      ":(exclude).workflow-runtime"
    ]);
    expect(runGit).toHaveBeenCalledWith(["-C", "C:\\worktree", "commit", "-m", "Approve step"]);
  });

  it("skips creating an empty approved-step commit", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes("--name-only")) {
        return "";
      }

      if (args.includes("rev-parse")) {
        return "abc123\n";
      }

      return "";
    });

    await expect(
      commitApprovedStep("C:\\worktree", "Approve step", { runGit })
    ).resolves.toBe("abc123");
    expect(runGit).not.toHaveBeenCalledWith([
      "-C",
      "C:\\worktree",
      "commit",
      "-m",
      "Approve step"
    ]);
  });
});
