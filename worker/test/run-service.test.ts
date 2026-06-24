import { describe, expect, it, vi } from "vitest";
import { repositories } from "../src/config/repositories.js";
import type { CreateWorkflowRunDependencies } from "../src/runtime/run-service.js";
import { createWorkflowRun } from "../src/runtime/run-service.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

describe("createWorkflowRun", () => {
  it("creates one CodeWorkspace and assigns every StepRun to it", async () => {
    const snapshot = canonicalizeWorkflowDefinition({
      id: "workflow-1",
      name: "Run service test workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: [
        {
          id: "step-1",
          type: "agent",
          depends_on: [],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "mixed" },
          prompt: "Run step 1.",
          acceptance: { criteria: [] }
        },
        {
          id: "step-2",
          type: "code_agent",
          depends_on: ["step-1"],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" },
          prompt: "Run step 2.",
          acceptance: { criteria: [] }
        }
      ],
      ui: {}
    });
    const create = vi.fn(async (args) => args);
    const client = {
      workflowVersion: {
        findUniqueOrThrow: vi.fn(async () => ({
          yamlSnapshot: snapshot.yaml,
          contentHash: snapshot.contentHash
        }))
      },
      workflowRun: {
        create
      }
    } as CreateWorkflowRunDependencies["client"];
    const createWorktree = vi.fn(async (request) => ({
      workflowRunId: request.workflowRunId,
      repoPath: "C:\\repo",
      baseRef: request.baseRef,
      worktreePath: "C:\\worktrees\\run-workflow-run-1",
      baseCommit: "abc123"
    }));
    const ids = ["workflow-run-1", "code-workspace-1"];

    await createWorkflowRun(
      "workflow-version-1",
      { issue: "123" },
      {
        client,
        createWorktree,
        createId: () => ids.shift() ?? "extra-id",
        resolveRepoPath: () => "C:\\repo",
        resolveWorktreeRoot: () => "C:\\worktrees"
      }
    );

    expect(createWorktree).toHaveBeenCalledWith({
      workflowRunId: "workflow-run-1",
      repoPath: "C:\\repo",
      baseRef: "HEAD",
      worktreeRoot: "C:\\worktrees"
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        id: "workflow-run-1",
        workflowVersionId: "workflow-version-1",
        inputPayload: { issue: "123" },
        codeWorkspaces: {
          create: [
            {
              id: "code-workspace-1",
              repoPath: "C:\\repo",
              baseRef: "HEAD",
              worktreePath: "C:\\worktrees\\run-workflow-run-1",
              baseCommit: "abc123"
            }
          ]
        },
        stepRuns: {
          create: [
            {
              stepId: "step-1",
              status: "READY",
              evaluator: "MIXED",
              codeWorkspaceId: "code-workspace-1",
              requiresCodeReview: false
            },
            {
              stepId: "step-2",
              status: "PENDING",
              evaluator: "HUMAN_REVIEW",
              codeWorkspaceId: "code-workspace-1",
              requiresCodeReview: true
            }
          ]
        }
      },
      include: {
        codeWorkspaces: true,
        stepRuns: true
      }
    });
  });

  it("starts root fanout steps as ready and fanin dependents as pending", async () => {
    const snapshot = canonicalizeWorkflowDefinition({
      id: "workflow-1",
      name: "Fanout fanin run service test workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: [
        {
          id: "root-a",
          type: "agent",
          depends_on: [],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "mixed" },
          prompt: "Run root A.",
          acceptance: { criteria: [] }
        },
        {
          id: "root-b",
          type: "agent",
          depends_on: [],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "mixed" },
          prompt: "Run root B.",
          acceptance: { criteria: [] }
        },
        {
          id: "join",
          type: "code_agent",
          depends_on: ["root-a", "root-b"],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" },
          prompt: "Join both roots.",
          acceptance: { criteria: [] }
        }
      ],
      ui: {}
    });
    const create = vi.fn(async (args) => args);
    const client = {
      workflowVersion: {
        findUniqueOrThrow: vi.fn(async () => ({
          yamlSnapshot: snapshot.yaml,
          contentHash: snapshot.contentHash
        }))
      },
      workflowRun: {
        create
      }
    } as CreateWorkflowRunDependencies["client"];
    const createWorktree = vi.fn(async (request) => ({
      workflowRunId: request.workflowRunId,
      repoPath: "C:\\repo",
      baseRef: request.baseRef,
      worktreePath: "C:\\worktrees\\run-workflow-run-1",
      baseCommit: "abc123"
    }));
    const ids = ["workflow-run-1", "code-workspace-1"];

    await createWorkflowRun("workflow-version-1", {}, {
      client,
      createWorktree,
      createId: () => ids.shift() ?? "extra-id",
      resolveRepoPath: () => "C:\\repo",
      resolveWorktreeRoot: () => "C:\\worktrees"
    });

    expect(create.mock.calls[0]?.[0].data.stepRuns.create).toMatchObject([
      {
        stepId: "root-a",
        status: "READY"
      },
      {
        stepId: "root-b",
        status: "READY"
      },
      {
        stepId: "join",
        status: "PENDING"
      }
    ]);
  });

  it("creates step workspaces from repository overrides and inherits missing step settings", async () => {
    repositories.repo_two = {
      repositoryId: "repo_two",
      repoPath: "D:\\repo-two",
      defaultBaseRef: "main"
    };
    const snapshot = canonicalizeWorkflowDefinition({
      id: "workflow-1",
      name: "Step workspace run service test workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: [
        {
          id: "step-1",
          type: "agent",
          depends_on: [],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "mixed" },
          prompt: "Run step 1.",
          acceptance: { criteria: [] }
        },
        {
          id: "step-2",
          type: "code_agent",
          depends_on: ["step-1"],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" },
          prompt: "Run step 2.",
          acceptance: { criteria: [] }
        },
        {
          id: "step-3",
          type: "code_agent",
          depends_on: ["step-2"],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" },
          prompt: "Run step 3.",
          acceptance: { criteria: [] }
        },
        {
          id: "step-4",
          type: "code_agent",
          depends_on: ["step-3"],
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" },
          prompt: "Run step 4.",
          acceptance: { criteria: [] }
        }
      ],
      ui: {}
    });
    const create = vi.fn(async (args) => args);
    const client = {
      workflowVersion: {
        findUniqueOrThrow: vi.fn(async () => ({
          yamlSnapshot: snapshot.yaml,
          contentHash: snapshot.contentHash
        }))
      },
      workflowRun: {
        create
      }
    } as CreateWorkflowRunDependencies["client"];
    const createWorktree = vi.fn(async (request) => ({
      workflowRunId: request.workflowRunId,
      repoPath: request.repoPath,
      baseRef: request.baseRef,
      worktreePath: `C:\\worktrees\\${request.worktreeName ?? request.workflowRunId}`,
      baseCommit: `${request.baseRef}-commit`
    }));
    const ids = [
      "workflow-run-1",
      "code-workspace-1",
      "code-workspace-2",
      "code-workspace-3"
    ];

    try {
      await createWorkflowRun(
        "workflow-version-1",
        {
          inputPayload: {},
          stepWorkspaces: {
            "step-2": { repositoryId: "repo_two" },
            "step-4": { baseRef: "release" }
          }
        },
        {
          client,
          createWorktree,
          createId: () => ids.shift() ?? "extra-id",
          resolveRepoPath: () => "C:\\repo",
          resolveWorktreeRoot: () => "C:\\worktrees"
        }
      );
    } finally {
      delete repositories.repo_two;
    }

    expect(createWorktree).toHaveBeenCalledTimes(3);
    expect(createWorktree).toHaveBeenNthCalledWith(1, {
      workflowRunId: "workflow-run-1",
      repoPath: "C:\\repo",
      baseRef: "HEAD",
      worktreeRoot: "C:\\worktrees"
    });
    expect(createWorktree).toHaveBeenNthCalledWith(2, {
      workflowRunId: "workflow-run-1",
      repoPath: "D:\\repo-two",
      baseRef: "main",
      worktreeRoot: "C:\\worktrees",
      worktreeName: "workflow-run-1-2"
    });
    expect(createWorktree).toHaveBeenNthCalledWith(3, {
      workflowRunId: "workflow-run-1",
      repoPath: "D:\\repo-two",
      baseRef: "release",
      worktreeRoot: "C:\\worktrees",
      worktreeName: "workflow-run-1-3"
    });
    expect(create.mock.calls[0]?.[0].data.codeWorkspaces.create).toEqual([
      {
        id: "code-workspace-1",
        repoPath: "C:\\repo",
        baseRef: "HEAD",
        worktreePath: "C:\\worktrees\\workflow-run-1",
        baseCommit: "HEAD-commit"
      },
      {
        id: "code-workspace-2",
        repoPath: "D:\\repo-two",
        baseRef: "main",
        worktreePath: "C:\\worktrees\\workflow-run-1-2",
        baseCommit: "main-commit"
      },
      {
        id: "code-workspace-3",
        repoPath: "D:\\repo-two",
        baseRef: "release",
        worktreePath: "C:\\worktrees\\workflow-run-1-3",
        baseCommit: "release-commit"
      }
    ]);
    expect(create.mock.calls[0]?.[0].data.stepRuns.create).toMatchObject([
      {
        stepId: "step-1",
        codeWorkspaceId: "code-workspace-1"
      },
      {
        stepId: "step-2",
        codeWorkspaceId: "code-workspace-2"
      },
      {
        stepId: "step-3",
        codeWorkspaceId: "code-workspace-2"
      },
      {
        stepId: "step-4",
        codeWorkspaceId: "code-workspace-3"
      }
    ]);
  });
});
