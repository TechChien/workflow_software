import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DecisionSource,
  DecisionVerdict,
  type PrismaClient
} from "../src/generated/prisma/client.js";
import {
  buildCodexClientOptions,
  createOpenAICodexGateway,
  type CodexRuntimeSettings
} from "../src/codex/codex-client.js";
import {
  PrismaCodexRunRecorder,
  type PrismaCodexRunRecorderClient
} from "../src/codex/prisma-codex-run-recorder.js";
import { executeStepRunWithCodexCore } from "../src/runtime/codex-step-executor.js";
import {
  createWorkflowRun,
  type CreateWorkflowRunDependencies
} from "../src/runtime/run-service.js";
import { runNextReadyStep, type StepRunnerDependencies } from "../src/runtime/step-runner.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

type LoadEnvProcess = typeof process & {
  loadEnvFile?: (path?: string) => void;
};

type StepRunnerClient = NonNullable<StepRunnerDependencies["client"]>;
type RunServiceClient = NonNullable<CreateWorkflowRunDependencies["client"]>;
type DbClient = StepRunnerClient &
  RunServiceClient &
  PrismaCodexRunRecorderClient &
  Pick<PrismaClient, "workflow" | "workflowVersion" | "workflowRun" | "stepRun">;

type CreatedWorkspaceRun = {
  id: string;
  codeWorkspaces: Array<{
    id: string;
    repoPath: string;
    baseRef: string;
    worktreePath: string;
    baseCommit: string;
  }>;
  stepRuns: Array<{
    id: string;
    stepId: string;
    status: string;
  }>;
};

class RollbackWorkspaceIntegrationTransaction extends Error {
  constructor() {
    super("ROLLBACK_WORKSPACE_INTEGRATION_TEST");
  }
}

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(testRoot, "..");
const envFile = path.join(workerRoot, ".env");
const runIntegration = process.env.RUN_WORKSPACE_INTEGRATION === "true";
const integrationTimeoutMs = Number(
  process.env.WORKSPACE_INTEGRATION_TIMEOUT_MS ??
    process.env.CODEX_DB_INTEGRATION_TIMEOUT_MS ??
    180_000
);
const workspaceRepoPath = path.resolve(
  workerRoot,
  process.env.WORKSPACE_INTEGRATION_REPO_PATH ??
    process.env.CODE_WORKSPACE_REPO_PATH ??
    ".."
);
const worktreeRoot = path.resolve(
  workerRoot,
  process.env.WORKSPACE_INTEGRATION_WORKTREE_ROOT ?? "../data/worktrees/integration"
);
const baseRef = process.env.WORKSPACE_INTEGRATION_BASE_REF ?? "HEAD";
const describeIntegration = runIntegration ? describe : describe.skip;
let prismaClient: PrismaClient | undefined;

if (existsSync(envFile)) {
  (process as LoadEnvProcess).loadEnvFile?.(envFile);
}

function codexSettings(): CodexRuntimeSettings {
  return {
    model: process.env.CODEX_MODEL,
    modelReasoningEffort: process.env.CODEX_REASONING_EFFORT as CodexRuntimeSettings["modelReasoningEffort"],
    timeoutMs: integrationTimeoutMs
  };
}

async function loadPrisma() {
  if (!prismaClient) {
    const dbModule = await import("../src/db/prisma.js");
    prismaClient = dbModule.prisma;
  }

  return prismaClient;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function quotePath(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function manualWorktreeDeleteCommand(repoPath: string, worktreePath: string) {
  return `git -C ${quotePath(repoPath)} worktree remove --force ${quotePath(worktreePath)}`;
}

async function createPublishedWorkflow(client: DbClient, marker: string) {
  const stepId = `step-${randomUUID()}`;
  const snapshot = canonicalizeWorkflowDefinition({
    id: `workflow-${randomUUID()}`,
    name: "Workspace integration workflow",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: stepId,
        type: "code_agent",
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: [
          "Create a file named workspace-integration-marker.txt in the current working directory.",
          `Write exactly this marker followed by a newline: ${marker}`,
          "Do not modify any other files.",
          "Reply exactly WORKSPACE_INTEGRATION_DONE."
        ].join("\n"),
        acceptance: { criteria: [] }
      }
    ],
    ui: {}
  });

  const workflow = await client.workflow.create({
    data: {
      name: snapshot.definition.name,
      draftYaml: snapshot.yaml
    }
  });
  const version = await client.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      revision: 1,
      yamlSnapshot: snapshot.yaml,
      contentHash: snapshot.contentHash
    }
  });

  return {
    workflowId: workflow.id,
    workflowVersionId: version.id
  };
}

async function runWorkspaceStep(client: DbClient) {
  return runNextReadyStep({
    client,
    executeStepRun: (input) =>
      executeStepRunWithCodexCore(input, {
        gateway: createOpenAICodexGateway(
          buildCodexClientOptions({
            apiKey: process.env.CODEX_API_KEY,
            baseUrl: process.env.CODEX_BASE_URL
          })
        ),
        recorder: new PrismaCodexRunRecorder(client),
        settings: codexSettings()
      }),
    evaluateStep: async (input) => ({
      decisions: [
        {
          stepRunId: input.stepRunId,
          source: DecisionSource.EVALUATOR,
          verdict: DecisionVerdict.APPROVE
        }
      ],
      finalVerdict: DecisionVerdict.APPROVE
    })
  });
}

describeIntegration("workspace integration", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("RUN_WORKSPACE_INTEGRATION=true requires DATABASE_URL");
    }
  });

  afterAll(async () => {
    const prisma = await loadPrisma();
    await prisma.$disconnect();
  });

  it(
    "creates a real git worktree, runs Codex through the real DB client, rolls back DB rows, and leaves the worktree",
    async () => {
      const prisma = await loadPrisma();
      const marker = `WORKSPACE_INTEGRATION_${randomUUID()}`;
      let workflowId: string | undefined;
      let workflowRunId: string | undefined;
      let stepRunId: string | undefined;
      let worktreePath: string | undefined;
      let repoPath: string | undefined;

      try {
        await prisma.$transaction(
          async (tx) => {
            const client = tx as unknown as DbClient;
            const workflow = await createPublishedWorkflow(client, marker);
            workflowId = workflow.workflowId;

            const run = (await createWorkflowRun(
              workflow.workflowVersionId,
              {},
              {
                client,
                resolveRepoPath: () => workspaceRepoPath,
                resolveWorktreeRoot: () => worktreeRoot,
                baseRef
              }
            )) as CreatedWorkspaceRun;
            workflowRunId = run.id;
            stepRunId = run.stepRuns[0]?.id;
            worktreePath = run.codeWorkspaces[0]?.worktreePath;
            repoPath = run.codeWorkspaces[0]?.repoPath;

            expect(worktreePath).toEqual(expect.any(String));
            expect(await pathExists(worktreePath as string)).toBe(true);

            await expect(runWorkspaceStep(client)).resolves.toMatchObject({
              picked: true,
              outcome: "accepted"
            });

            const stepRun = await client.stepRun.findUniqueOrThrow({
              where: { id: stepRunId },
              include: {
                codexInteractions: {
                  orderBy: [{ attempt: "asc" }, { sequence: "asc" }]
                }
              }
            });
            expect(stepRun.status).toBe("ACCEPTED");
            expect(stepRun.codexFinalResponse).toContain("WORKSPACE_INTEGRATION_DONE");
            expect(stepRun.codexInteractions.some((event) => event.kind === "turn.completed")).toBe(
              true
            );
            await expect(
              readFile(path.join(worktreePath as string, "workspace-integration-marker.txt"), "utf8")
            ).resolves.toMatch(marker);

            throw new RollbackWorkspaceIntegrationTransaction();
          },
          {
            maxWait: 10_000,
            timeout: integrationTimeoutMs + 20_000
          }
        );
      } catch (error) {
        if (!(error instanceof RollbackWorkspaceIntegrationTransaction)) {
          throw error;
        }
      } finally {
        if (repoPath && worktreePath) {
          console.log(`[workspace integration] worktree left on disk: ${worktreePath}`);
          console.log(
            `[workspace integration] manual cleanup: ${manualWorktreeDeleteCommand(
              repoPath,
              worktreePath
            )}`
          );
        }
      }

      expect(workflowId).toEqual(expect.any(String));
      expect(workflowRunId).toEqual(expect.any(String));
      expect(stepRunId).toEqual(expect.any(String));
      expect(worktreePath).toEqual(expect.any(String));
      await expect(
        prisma.workflow.findUnique({
          where: { id: workflowId }
        })
      ).resolves.toBeNull();
      await expect(
        prisma.workflowRun.findUnique({
          where: { id: workflowRunId }
        })
      ).resolves.toBeNull();
      await expect(
        prisma.stepRun.findMany({
          where: { id: stepRunId }
        })
      ).resolves.toEqual([]);
      expect(await pathExists(worktreePath as string)).toBe(true);
    },
    integrationTimeoutMs + 30_000
  );
});
