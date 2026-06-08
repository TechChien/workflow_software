import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StepRunEvaluator, type Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import {
  createRunWorktree,
  type CodeWorkspaceResult
} from "../code-workspace/worktree-manager.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CODE_BASE_REF = "HEAD";

const STEP_RUN_EVALUATOR_BY_DEFINITION = {
  mixed: StepRunEvaluator.MIXED,
  human_review: StepRunEvaluator.HUMAN_REVIEW,
  evaluator_review: StepRunEvaluator.EVALUATOR_REVIEW
} as const;

function resolveStepRunEvaluator(evaluator: string) {
  return (
    STEP_RUN_EVALUATOR_BY_DEFINITION[
      evaluator as keyof typeof STEP_RUN_EVALUATOR_BY_DEFINITION
    ] ?? StepRunEvaluator.MIXED
  );
}

type RunServiceClient = {
  workflowVersion: {
    findUniqueOrThrow(args: Prisma.WorkflowVersionFindUniqueOrThrowArgs): PromiseLike<{
      yamlSnapshot: string;
      contentHash: string;
    }>;
  };
  workflowRun: {
    create(args: Prisma.WorkflowRunCreateArgs): PromiseLike<unknown>;
  };
};

export type CreateWorkflowRunDependencies = {
  client?: RunServiceClient;
  createWorktree?: typeof createRunWorktree;
  createId?: () => string;
  resolveRepoPath?: () => string;
  resolveWorktreeRoot?: () => string;
  baseRef?: string;
};

function defaultRepoPath() {
  return env.CODE_WORKSPACE_REPO_PATH
    ? path.resolve(workerRoot, env.CODE_WORKSPACE_REPO_PATH)
    : path.resolve(workerRoot, "..");
}

function defaultWorktreeRoot() {
  return path.resolve(workerRoot, env.CODE_WORKTREE_ROOT);
}

function createStepRuns(
  definition: ReturnType<typeof parseVerifiedWorkflowSnapshot>,
  codeWorkspaceId: string
) {
  return definition.steps.map((step) => ({
    stepId: step.id,
    status: step.upstream ? ("PENDING" as const) : ("READY" as const),
    evaluator: resolveStepRunEvaluator(step.evaluate.evaluator),
    codeWorkspaceId,
    requiresCodeReview: step.type === "code_agent"
  }));
}

function createCodeWorkspace(workspace: CodeWorkspaceResult, codeWorkspaceId: string) {
  return {
    id: codeWorkspaceId,
    repoPath: workspace.repoPath,
    baseRef: workspace.baseRef,
    worktreePath: workspace.worktreePath,
    baseCommit: workspace.baseCommit
  };
}

export async function createWorkflowRun(
  workflowVersionId: string,
  inputPayload: Record<string, unknown>,
  dependencies: CreateWorkflowRunDependencies = {}
) {
  const client = dependencies.client ?? (prisma as unknown as RunServiceClient);
  const workflowRunId = dependencies.createId?.() ?? randomUUID();
  const codeWorkspaceId = dependencies.createId?.() ?? randomUUID();
  const createWorktree = dependencies.createWorktree ?? createRunWorktree;
  const workflowVersion = await client.workflowVersion.findUniqueOrThrow({
    where: { id: workflowVersionId }
  });
  const definition = parseVerifiedWorkflowSnapshot(
    workflowVersion.yamlSnapshot,
    workflowVersion.contentHash
  );
  const workspace = await createWorktree({
    workflowRunId,
    repoPath: dependencies.resolveRepoPath?.() ?? defaultRepoPath(),
    baseRef: dependencies.baseRef ?? DEFAULT_CODE_BASE_REF,
    worktreeRoot: dependencies.resolveWorktreeRoot?.() ?? defaultWorktreeRoot()
  });

  return client.workflowRun.create({
    data: {
      id: workflowRunId,
      workflowVersionId,
      inputPayload: inputPayload as Prisma.InputJsonValue,
      codeWorkspaces: {
        create: [createCodeWorkspace(workspace, codeWorkspaceId)]
      },
      stepRuns: {
        create: createStepRuns(definition, codeWorkspaceId)
      }
    },
    include: {
      codeWorkspaces: true,
      stepRuns: true
    }
  });
}
