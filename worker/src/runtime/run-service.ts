import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CreateRunRequest, RunStepWorkspace } from "@workflow-software/shared";
import { StepRunEvaluator, type Prisma } from "../generated/prisma/client.js";
import {
  defaultRepository,
  defaultWorktreeRoot,
  repositories,
  type RepositoryConfig
} from "../config/repositories.js";
import { prisma } from "../db/prisma.js";
import {
  createRunWorktree,
  type CodeWorkspaceResult
} from "../code-workspace/worktree-manager.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

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

function createStepRuns(
  definition: ReturnType<typeof parseVerifiedWorkflowSnapshot>,
  codeWorkspaceIdByStepId: Map<string, string>
) {
  return definition.steps.map((step) => ({
    stepId: step.id,
    status: step.depends_on.length > 0 ? ("PENDING" as const) : ("READY" as const),
    evaluator: resolveStepRunEvaluator(step.evaluate.evaluator),
    codeWorkspaceId: requireCodeWorkspaceId(step.id, codeWorkspaceIdByStepId),
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

type CreateWorkflowRunInput =
  | Record<string, unknown>
  | CreateRunRequest;

type WorkspaceSelection = {
  key: string;
  repositoryId: string;
  repoPath: string;
  baseRef: string;
};

function isStructuredRunInput(input: CreateWorkflowRunInput): input is CreateRunRequest {
  return (
    Object.prototype.hasOwnProperty.call(input, "inputPayload") ||
    Object.prototype.hasOwnProperty.call(input, "stepWorkspaces")
  );
}

function normalizeRunInput(input: CreateWorkflowRunInput): CreateRunRequest {
  return isStructuredRunInput(input)
    ? {
        inputPayload: input.inputPayload ?? {},
        stepWorkspaces: input.stepWorkspaces ?? {}
      }
    : {
        inputPayload: input,
        stepWorkspaces: {}
      };
}

function defaultRepositoryForRun(
  dependencies: CreateWorkflowRunDependencies
): RepositoryConfig {
  const repository = defaultRepository();

  return {
    repositoryId: repository.repositoryId,
    repoPath: dependencies.resolveRepoPath?.() ?? repository.repoPath,
    defaultBaseRef: dependencies.baseRef ?? repository.defaultBaseRef
  };
}

function resolveRepositoryForRun(
  repositoryId: string | undefined,
  fallbackRepository: RepositoryConfig
) {
  const requestedRepositoryId = repositoryId?.trim();

  return requestedRepositoryId
    ? repositories[requestedRepositoryId] ?? fallbackRepository
    : fallbackRepository;
}

function compactStepWorkspace(
  workspace: RunStepWorkspace | undefined
): RunStepWorkspace | undefined {
  const repositoryId = workspace?.repositoryId?.trim();
  const baseRef = workspace?.baseRef?.trim();
  const compacted = {
    ...(repositoryId ? { repositoryId } : {}),
    ...(baseRef ? { baseRef } : {})
  };

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function workspaceSelectionKey(selection: Omit<WorkspaceSelection, "key">) {
  return `${path.resolve(selection.repoPath)}\0${selection.baseRef}`;
}

function createWorkspaceSelection(input: {
  repository: RepositoryConfig;
  baseRef: string;
}): WorkspaceSelection {
  const repoPath = path.resolve(input.repository.repoPath);
  const selection = {
    repositoryId: input.repository.repositoryId,
    repoPath,
    baseRef: input.baseRef
  };

  return {
    ...selection,
    key: workspaceSelectionKey(selection)
  };
}

function defaultWorkspaceSelection(fallbackRepository: RepositoryConfig) {
  return createWorkspaceSelection({
    repository: fallbackRepository,
    baseRef: fallbackRepository.defaultBaseRef
  });
}

function stepWorkspaceRequest(
  step: ReturnType<typeof parseVerifiedWorkflowSnapshot>["steps"][number],
  runStepWorkspace: RunStepWorkspace | undefined
) {
  return compactStepWorkspace({
    repositoryId: step.agent?.repository_id,
    baseRef: step.agent?.base_ref,
    ...runStepWorkspace
  });
}

function resolveStepWorkspaceSelections(input: {
  definition: ReturnType<typeof parseVerifiedWorkflowSnapshot>;
  stepWorkspaces: CreateRunRequest["stepWorkspaces"];
  fallbackRepository: RepositoryConfig;
}) {
  const selections = new Map<string, WorkspaceSelection>();
  let previousSelection: WorkspaceSelection | undefined;

  for (const step of input.definition.steps) {
    const request = stepWorkspaceRequest(step, input.stepWorkspaces[step.id]);
    const inheritedRepository: RepositoryConfig | undefined = previousSelection
      ? {
          repositoryId: previousSelection.repositoryId,
          repoPath: previousSelection.repoPath,
          defaultBaseRef: previousSelection.baseRef
        }
      : undefined;
    const repository = request?.repositoryId
      ? resolveRepositoryForRun(request.repositoryId, input.fallbackRepository)
      : inheritedRepository ?? input.fallbackRepository;
    const baseRef =
      request?.baseRef ??
      (request?.repositoryId
        ? repository.defaultBaseRef
        : previousSelection?.baseRef ?? repository.defaultBaseRef);
    const selection = createWorkspaceSelection({
      repository,
      baseRef
    });

    selections.set(step.id, selection);
    previousSelection = selection;
  }

  return selections;
}

function uniqueWorkspaceSelections(
  stepSelections: Map<string, WorkspaceSelection>,
  fallbackRepository: RepositoryConfig
) {
  const selectionsByKey = new Map<string, WorkspaceSelection>();
  const selections =
    stepSelections.size > 0
      ? [...stepSelections.values()]
      : [defaultWorkspaceSelection(fallbackRepository)];

  for (const selection of selections) {
    if (!selectionsByKey.has(selection.key)) {
      selectionsByKey.set(selection.key, selection);
    }
  }

  return [...selectionsByKey.values()];
}

function requireCodeWorkspaceId(
  stepId: string,
  codeWorkspaceIdByStepId: Map<string, string>
) {
  const codeWorkspaceId = codeWorkspaceIdByStepId.get(stepId);

  if (!codeWorkspaceId) {
    throw new Error(`Step ${stepId} did not resolve to a CodeWorkspace`);
  }

  return codeWorkspaceId;
}

export async function createWorkflowRun(
  workflowVersionId: string,
  input: CreateWorkflowRunInput,
  dependencies: CreateWorkflowRunDependencies = {}
) {
  const client = dependencies.client ?? (prisma as unknown as RunServiceClient);
  const runInput = normalizeRunInput(input);
  const inputPayload = runInput.inputPayload;
  const workflowRunId = dependencies.createId?.() ?? randomUUID();
  const createWorktree = dependencies.createWorktree ?? createRunWorktree;
  console.log("[runtime.run-service] workflow_run.create.start", {
    workflowVersionId,
    workflowRunId,
    inputKeys: Object.keys(inputPayload),
  });
  const workflowVersion = await client.workflowVersion.findUniqueOrThrow({
    where: { id: workflowVersionId }
  });
  console.log("[runtime.run-service] workflow_version.loaded", {
    workflowVersionId,
    workflowRunId,
    contentHash: workflowVersion.contentHash,
  });
  const definition = parseVerifiedWorkflowSnapshot(
    workflowVersion.yamlSnapshot,
    workflowVersion.contentHash
  );
  console.log("[runtime.run-service] workflow.loaded", {
    workflowId: definition.id,
    workflowRunId,
    workflowVersionId,
    name: definition.name,
    stepCount: definition.steps.length,
  });
  const fallbackRepository = defaultRepositoryForRun(dependencies);
  const worktreeRoot = dependencies.resolveWorktreeRoot?.() ?? defaultWorktreeRoot();
  const stepWorkspaceSelections = resolveStepWorkspaceSelections({
    definition,
    stepWorkspaces: runInput.stepWorkspaces,
    fallbackRepository
  });
  const workspaceSelections = uniqueWorkspaceSelections(
    stepWorkspaceSelections,
    fallbackRepository
  );
  const codeWorkspaceBySelectionKey = new Map<
    string,
    { id: string; workspace: CodeWorkspaceResult }
  >();
  const codeWorkspaces: ReturnType<typeof createCodeWorkspace>[] = [];

  for (const [index, selection] of workspaceSelections.entries()) {
    const codeWorkspaceId = dependencies.createId?.() ?? randomUUID();
    const workspace = await createWorktree({
      workflowRunId,
      repoPath: selection.repoPath,
      baseRef: selection.baseRef,
      worktreeRoot,
      ...(index > 0 ? { worktreeName: `${workflowRunId}-${index + 1}` } : {})
    });
    codeWorkspaceBySelectionKey.set(selection.key, {
      id: codeWorkspaceId,
      workspace
    });
    codeWorkspaces.push(createCodeWorkspace(workspace, codeWorkspaceId));
    console.log("[runtime.run-service] code_workspace.created", {
      workflowRunId,
      codeWorkspaceId,
      repositoryId: selection.repositoryId,
      repoPath: workspace.repoPath,
      baseRef: workspace.baseRef,
      worktreePath: workspace.worktreePath,
      baseCommit: workspace.baseCommit,
    });
  }

  const codeWorkspaceIdByStepId = new Map<string, string>();

  for (const [stepId, selection] of stepWorkspaceSelections) {
    const codeWorkspace = codeWorkspaceBySelectionKey.get(selection.key);

    if (!codeWorkspace) {
      throw new Error(`Step ${stepId} did not resolve to a created CodeWorkspace`);
    }

    codeWorkspaceIdByStepId.set(stepId, codeWorkspace.id);
  }

  const stepRuns = createStepRuns(definition, codeWorkspaceIdByStepId);
  console.log("[runtime.run-service] step_runs.prepared", {
    workflowRunId,
    steps: stepRuns.map((stepRun) => ({
      stepId: stepRun.stepId,
      status: stepRun.status,
      evaluator: stepRun.evaluator,
      requiresCodeReview: stepRun.requiresCodeReview,
      codeWorkspaceId: stepRun.codeWorkspaceId,
    })),
  });

  const created = await client.workflowRun.create({
    data: {
      id: workflowRunId,
      workflowVersionId,
      inputPayload: inputPayload as Prisma.InputJsonValue,
      codeWorkspaces: {
        create: codeWorkspaces
      },
      stepRuns: {
        create: stepRuns
      }
    },
    include: {
      codeWorkspaces: true,
      stepRuns: true
    }
  });
  console.log("[runtime.run-service] workflow_run.create.complete", {
    workflowVersionId,
    workflowRunId,
    codeWorkspaceIds: codeWorkspaces.map((workspace) => workspace.id),
    stepCount: stepRuns.length,
  });

  return created;
}
