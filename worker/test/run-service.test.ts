import { describe, expect, it, vi } from "vitest";
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
});
