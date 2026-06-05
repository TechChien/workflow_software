import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator,
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
import { runNextReadyStep, type StepRunnerDependencies } from "../src/runtime/step-runner.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";
import { startPoller } from "../src/worker/poller.js";

type StepRunnerClient = NonNullable<StepRunnerDependencies["client"]>;
type DbClient = StepRunnerClient & PrismaCodexRunRecorderClient & Pick<
  PrismaClient,
  "workflow" | "workflowVersion" | "workflowRun" | "stepRun"
>;

class RollbackIntegrationTransaction extends Error {
  constructor() {
    super("ROLLBACK_POLLER_INTEGRATION_TEST");
  }
}

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testRoot, "..", "..");
const runIntegration = process.env.RUN_CODEX_DB_INTEGRATION === "true";
const integrationTimeoutMs = Number(process.env.CODEX_DB_INTEGRATION_TIMEOUT_MS ?? 180_000);
const describeIntegration = runIntegration ? describe : describe.skip;
let prismaClient: PrismaClient | undefined;

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

async function createTwoStepWorkflowRun(client: DbClient) {
  const firstStepId = `step-${randomUUID()}`;
  const secondStepId = `step-${randomUUID()}`;
  const snapshot = canonicalizeWorkflowDefinition({
    id: `workflow-${randomUUID()}`,
    name: "Poller Codex integration workflow",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: firstStepId,
        type: "code_agent",
        downstream: secondStepId,
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: "Reply exactly STEP_1_DONE. Do not modify files.",
        acceptance: { criteria: [] }
      },
      {
        id: secondStepId,
        type: "code_agent",
        upstream: firstStepId,
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: "Reply exactly STEP_2_DONE. Do not modify files.",
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
  const workflowRun = await client.workflowRun.create({
    data: {
      workflowVersionId: version.id
    }
  });
  const firstStepRun = await client.stepRun.create({
    data: {
      workflowRunId: workflowRun.id,
      stepId: firstStepId,
      status: "READY",
      evaluator: StepRunEvaluator.MIXED
    }
  });
  const secondStepRun = await client.stepRun.create({
    data: {
      workflowRunId: workflowRun.id,
      stepId: secondStepId,
      status: "PENDING",
      evaluator: StepRunEvaluator.MIXED,
      upstreamStepRunId: firstStepRun.id
    }
  });

  return {
    workflowRunId: workflowRun.id,
    stepRunIds: [firstStepRun.id, secondStepRun.id]
  };
}

async function stepStatuses(client: DbClient, workflowRunId: string) {
  const steps = await client.stepRun.findMany({
    where: { workflowRunId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true
    }
  });

  return steps.map((step) => `${step.id}:${step.status}`).join(", ");
}

async function workflowStatus(client: DbClient, workflowRunId: string) {
  const workflowRun = await client.workflowRun.findUniqueOrThrow({
    where: { id: workflowRunId },
    select: { status: true }
  });

  return workflowRun.status;
}

async function pollWorkflowRun(client: DbClient, workflowRunId: string) {
  console.log(
    `[poller] before workflow=${await workflowStatus(client, workflowRunId)} steps=${await stepStatuses(client, workflowRunId)}`
  );

  const result = await runNextReadyStep({
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
      stepRunId: input.stepRunId,
      source: DecisionSource.EVALUATOR,
      verdict: DecisionVerdict.APPROVE
    }),
    resolveWorkingDirectory: () => repoRoot
  });

  console.log(
    `[poller] after workflow=${await workflowStatus(client, workflowRunId)} steps=${await stepStatuses(client, workflowRunId)}`
  );

  return result;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCompletedWorkflow(client: DbClient, workflowRunId: string) {
  const deadline = Date.now() + integrationTimeoutMs;

  while (Date.now() < deadline) {
    if ((await workflowStatus(client, workflowRunId)) === "COMPLETED") {
      return;
    }

    await delay(500);
  }

  throw new Error(`WorkflowRun ${workflowRunId} did not complete before timeout`);
}

describeIntegration("startPoller Codex integration", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("RUN_CODEX_DB_INTEGRATION=true requires DATABASE_URL");
    }

  });

  afterAll(async () => {
    const prisma = await loadPrisma();
    await prisma.$disconnect();
  });

  it(
    "uses the real DB client and Codex execution to poll a two-step workflow, then rolls back DB changes",
    async () => {
      const prisma = await loadPrisma();
      let workflowRunId: string | undefined;
      let stepRunIds: string[] = [];

      try {
        await prisma.$transaction(
          async (tx) => {
            const client = tx as unknown as DbClient;
            const created = await createTwoStepWorkflowRun(client);
            workflowRunId = created.workflowRunId;
            stepRunIds = created.stepRunIds;
            let polling = false;
            const runNextReadyStepFromDb = vi.fn(async () => {
              if (polling) {
                return { picked: false };
              }

              polling = true;
              try {
                return await pollWorkflowRun(client, created.workflowRunId);
              } finally {
                polling = false;
              }
            });
            const timer = startPoller({
              intervalMs: 500,
              runNextReadyStep: runNextReadyStepFromDb
            });

            try {
              await waitForCompletedWorkflow(client, created.workflowRunId);
              expect(await stepStatuses(client, created.workflowRunId)).toContain(
                `${created.stepRunIds[0]}:ACCEPTED`
              );
              expect(await stepStatuses(client, created.workflowRunId)).toContain(
                `${created.stepRunIds[1]}:ACCEPTED`
              );
              expect(runNextReadyStepFromDb.mock.calls.length).toBeGreaterThanOrEqual(2);
            } finally {
              clearInterval(timer);
            }

            throw new RollbackIntegrationTransaction();
          },
          {
            maxWait: 10_000,
            timeout: integrationTimeoutMs + 10_000
          }
        );
      } catch (error) {
        if (!(error instanceof RollbackIntegrationTransaction)) {
          throw error;
        }
      }

      expect(workflowRunId).toEqual(expect.any(String));
      await expect(
        prisma.workflowRun.findUnique({
          where: { id: workflowRunId }
        })
      ).resolves.toBeNull();
      await expect(
        prisma.stepRun.findMany({
          where: { id: { in: stepRunIds } }
        })
      ).resolves.toEqual([]);
    },
    integrationTimeoutMs + 20_000
  );
});
