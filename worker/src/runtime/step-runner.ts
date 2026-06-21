import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import type { ExecuteStepRunWithCodexInput } from "./codex-step-executor.js";
import { executeStepRunWithCodex } from "./execute-step-run-with-codex.js";
import type {
  EvaluateStepInput,
  EvaluateStepResult
} from "./evaluator-runner.js";
import { evaluateStepArtifact } from "./evaluator-runner.js";
import {
  PrismaStepRunnerRepository,
  type StepRunnerRepository,
  type StepRunnerRepositoryClient
} from "./step-runner-repository.js";
import {
  DefaultStepArtifactRuntime,
  type StepArtifactRuntime,
  type StepArtifactRuntimeClient
} from "./step-artifact-runtime.js";
import {
  DefaultStepCheckpointRuntime,
  type StepCheckpointRuntime,
  type StepCheckpointRuntimeClient
} from "./step-checkpoint-runtime.js";
import { StepRunnerOrchestrator } from "./step-runner-orchestrator.js";
import {
  FunctionWorkspaceResolver,
  PrismaWorkspaceResolver,
  type StepWorkingDirectoryInput,
  type WorkspaceResolver,
  type WorkspaceResolverClient
} from "./workspace-resolver.js";

export type StepRunnerResult =
  | { picked: false }
  | {
      picked: true;
      stepRunId: string;
      workflowRunId: string;
      outcome:
        | "accepted"
        | "failed"
        | "race_lost"
        | "rerun_queued"
        | "waiting_for_human_review";
    };

export type StepRunnerClient = StepRunnerRepositoryClient &
  WorkspaceResolverClient &
  StepArtifactRuntimeClient &
  StepCheckpointRuntimeClient;

export type { StepWorkingDirectoryInput };

export type StepRunnerDependencies = {
  client?: StepRunnerClient;
  repository?: StepRunnerRepository;
  artifactRuntime?: StepArtifactRuntime;
  checkpointRuntime?: StepCheckpointRuntime;
  workspaceResolver?: WorkspaceResolver;
  executeStepRun?: (input: ExecuteStepRunWithCodexInput) => Promise<unknown>;
  evaluateStep?: (input: EvaluateStepInput) => Promise<EvaluateStepResult>;
  resolveWorkingDirectory?: (
    input: StepWorkingDirectoryInput
  ) => string | Promise<string>;
  resolveArtifactStoreRoot?: () => string | Promise<string>;
  now?: () => Date;
};

function defaultArtifactStoreRoot() {
  const workerRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
  );
  return path.resolve(workerRoot, env.ARTIFACT_STORE_ROOT);
}

function resolveWorkspaceResolver(
  client: StepRunnerClient,
  dependencies: StepRunnerDependencies
): WorkspaceResolver {
  if (dependencies.workspaceResolver) {
    return dependencies.workspaceResolver;
  }

  if (dependencies.resolveWorkingDirectory) {
    return new FunctionWorkspaceResolver(dependencies.resolveWorkingDirectory);
  }

  return new PrismaWorkspaceResolver(client);
}

export async function runNextReadyStep(
  dependencies: StepRunnerDependencies = {}
): Promise<StepRunnerResult> {
  const client: StepRunnerClient =
    dependencies.client ?? (prisma as unknown as StepRunnerClient);

  const orchestrator = new StepRunnerOrchestrator({
    repository:
      dependencies.repository ?? new PrismaStepRunnerRepository(client),
    executeStepRun: dependencies.executeStepRun ?? executeStepRunWithCodex,
    evaluateStep: dependencies.evaluateStep ?? evaluateStepArtifact,
    workspaceResolver: resolveWorkspaceResolver(client, dependencies),
    artifactRuntime:
      dependencies.artifactRuntime ?? new DefaultStepArtifactRuntime(client),
    checkpointRuntime:
      dependencies.checkpointRuntime ?? new DefaultStepCheckpointRuntime(client),
    resolveArtifactStoreRoot:
      dependencies.resolveArtifactStoreRoot ?? defaultArtifactStoreRoot,
    now: dependencies.now ?? (() => new Date())
  });

  return orchestrator.runNextReadyStep();
}
