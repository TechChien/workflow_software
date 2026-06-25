import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
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
import { readArtifactVersionContent } from "../src/artifacts/artifact-store.js";
import { executeStepRunWithCodexCore } from "../src/runtime/codex-step-executor.js";
import { evaluateStepArtifact } from "../src/runtime/evaluator-runner.js";
import { runNextReadyStep, type StepRunnerDependencies } from "../src/runtime/step-runner.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";
import { startPoller } from "../src/worker/poller.js";

type StepRunnerClient = NonNullable<StepRunnerDependencies["client"]>;
type DbClient = StepRunnerClient & PrismaCodexRunRecorderClient & Pick<
  PrismaClient,
  | "workflow"
  | "workflowVersion"
  | "workflowRun"
  | "stepRun"
  | "artifactVersion"
  | "stepRunArtifactInput"
  | "contextPathEvent"
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
const twoStepWorkflowTimeoutMs = integrationTimeoutMs * 4 + 60_000;
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
        depends_on: [],
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
        depends_on: [firstStepId],
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

async function createTwoStepArtifactWorkflowRun(
  client: DbClient,
  input: {
    firstToken: string;
    contextPath: string;
  }
) {
  const firstStepId = `step-${randomUUID()}`;
  const secondStepId = `step-${randomUUID()}`;
  const firstArtifactKey = `artifact_${randomUUID().replace(/-/g, "_")}`;
  const secondArtifactKey = `artifact_${randomUUID().replace(/-/g, "_")}`;
  const snapshot = canonicalizeWorkflowDefinition({
    id: `workflow-${randomUUID()}`,
    name: "Artifact Codex integration workflow",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: firstStepId,
        type: "code_agent",
        depends_on: [],
        input_artifacts: [],
        output_artifacts: [
          {
            artifact: firstArtifactKey,
            filename: "declared-step-one.md",
            format: "markdown"
          }
        ],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: [
          "Create the artifact content requested by the runtime contract.",
          "This prompt incorrectly mentions stale-step-one.md and extra-step-one.md; ignore those filenames if the runtime contract declares another output.",
          `The declared artifact content must contain this marker exactly once: ${input.firstToken}`,
          "Reply exactly STEP_1_ARTIFACT_DONE."
        ].join("\n"),
        acceptance: { criteria: [] }
      },
      {
        id: secondStepId,
        type: "code_agent",
        depends_on: [firstStepId],
        input_artifacts: [
          {
            artifact: firstArtifactKey,
            required: true,
          }
        ],
        output_artifacts: [
          {
            artifact: secondArtifactKey,
            filename: "declared-step-two.md",
            format: "plain_text"
          }
        ],
        context_paths: [
          {
            path: input.contextPath,
            type: "file"
          }
        ],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: [
          "Read the input artifact and context file listed in the runtime contract.",
          "Write the declared output artifact with the marker from the input artifact and the marker from the context file.",
          "This prompt incorrectly mentions second-extra-a.md and second-extra-b.md; ignore filenames not declared by the runtime contract.",
          "Reply exactly STEP_2_ARTIFACT_DONE."
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
    workflowId: workflow.id,
    workflowRunId: workflowRun.id,
    stepRunIds: [firstStepRun.id, secondStepRun.id],
    firstArtifactKey,
    secondArtifactKey
  };
}

async function createPlanExecutionWorkflowRun(
  client: DbClient,
  input: {
    planToken: string;
    executionToken: string;
  }
) {
  const firstStepId = `step-${randomUUID()}`;
  const secondStepId = `step-${randomUUID()}`;
  const planArtifactKey = "plan";
  const executionArtifactKey = "execution_result";
  const snapshot = canonicalizeWorkflowDefinition({
    id: `workflow-${randomUUID()}`,
    name: "Plan execution Codex integration workflow",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: firstStepId,
        type: "code_agent",
        depends_on: [],
        input_artifacts: [],
        output_artifacts: [
          {
            artifact: planArtifactKey,
            filename: "plan.md",
            format: "markdown"
          }
        ],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: [
          "Create the declared output artifact plan.md from the workflow runtime contract.",
          `The plan.md artifact must contain this exact marker once: ${input.planToken}`,
          "Include a short numbered plan with exactly two execution tasks.",
          "Do not create any extra artifact files.",
          "Reply exactly PLAN_ARTIFACT_DONE."
        ].join("\n"),
        acceptance: {
          criteria: [
            "The declared plan artifact is written to plan.md.",
            `plan.md contains the marker ${input.planToken}.`,
            "plan.md contains a numbered two-task execution plan."
          ]
        }
      },
      {
        id: secondStepId,
        type: "code_agent",
        depends_on: [firstStepId],
        input_artifacts: [
          {
            artifact: planArtifactKey,
            required: true
          }
        ],
        output_artifacts: [
          {
            artifact: executionArtifactKey,
            filename: "execution-result.md",
            format: "markdown"
          }
        ],
        context_paths: [],
        tool_capabilities: [],
        evaluate: { evaluator: "mixed" },
        prompt: [
          "Read the required input artifact from the workflow runtime contract. It is the plan.md produced by Step1.",
          "Execute that plan by writing the declared output artifact execution-result.md.",
          `The execution-result.md artifact must include the plan marker: ${input.planToken}`,
          `The execution-result.md artifact must include this execution marker: ${input.executionToken}`,
          "Do not modify the input artifact.",
          "Reply exactly PLAN_EXECUTION_DONE."
        ].join("\n"),
        acceptance: {
          criteria: [
            "The required plan input artifact is read before producing the result.",
            `execution-result.md contains the plan marker ${input.planToken}.`,
            `execution-result.md contains the execution marker ${input.executionToken}.`
          ]
        }
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
    workflowId: workflow.id,
    workflowRunId: workflowRun.id,
    stepRunIds: [firstStepRun.id, secondStepRun.id],
    planArtifactKey,
    executionArtifactKey
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

async function pollWorkflowRun(client: DbClient, workflowRunId: string, artifactStoreRoot?: string) {
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
    evaluateStep: (input) =>
      evaluateStepArtifact(input, {
        gateway: createOpenAICodexGateway(
          buildCodexClientOptions({
            apiKey: process.env.CODEX_API_KEY,
            baseUrl: process.env.CODEX_BASE_URL
          })
        ),
        settings: codexSettings()
      }),
    resolveWorkingDirectory: () => repoRoot,
    ...(artifactStoreRoot ? { resolveArtifactStoreRoot: () => artifactStoreRoot } : {})
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
  const deadline = Date.now() + twoStepWorkflowTimeoutMs;

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
            timeout: twoStepWorkflowTimeoutMs
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
    twoStepWorkflowTimeoutMs + 10_000
  );

  it(
    "passes declared artifacts between two real Codex steps, then rolls back DB changes",
    async () => {
      const prisma = await loadPrisma();
      const artifactStoreRoot = path.join(
        repoRoot,
        ".codex-integration-artifacts",
        randomUUID()
      );
      const contextDirectory = path.join(
        repoRoot,
        ".codex-integration-context",
        randomUUID()
      );
      const contextFile = path.join(contextDirectory, "context-marker.md");
      const firstToken = `STEP_ONE_INPUT_${randomUUID()}`;
      const contextToken = `CONTEXT_INPUT_${randomUUID()}`;
      let workflowId: string | undefined;
      let workflowRunId: string | undefined;
      let stepRunIds: string[] = [];

      await mkdir(contextDirectory, { recursive: true });
      await writeFile(contextFile, `Context marker: ${contextToken}\n`, "utf8");

      try {
        await prisma.$transaction(
          async (tx) => {
            const client = tx as unknown as DbClient;
            const created = await createTwoStepArtifactWorkflowRun(client, {
              firstToken,
              contextPath: path.relative(repoRoot, contextFile).replace(/\\/g, "/")
            });
            workflowId = created.workflowId;
            workflowRunId = created.workflowRunId;
            stepRunIds = created.stepRunIds;

            await expect(
              pollWorkflowRun(client, created.workflowRunId, artifactStoreRoot)
            ).resolves.toMatchObject({ picked: true, outcome: "accepted" });
            await expect(
              pollWorkflowRun(client, created.workflowRunId, artifactStoreRoot)
            ).resolves.toMatchObject({ picked: true, outcome: "accepted" });

            expect(await workflowStatus(client, created.workflowRunId)).toBe("COMPLETED");

            const secondArtifact = await client.artifactVersion.findFirst({
              where: {
                workflowRunId: created.workflowRunId,
                artifactKey: created.secondArtifactKey,
                status: "ACCEPTED"
              },
              orderBy: {
                version: "desc"
              }
            });
            expect(secondArtifact).not.toBeNull();

            const stored = await readArtifactVersionContent({
              root: artifactStoreRoot,
              workflowId: created.workflowId,
              runId: created.workflowRunId,
              artifactKey: created.secondArtifactKey,
              version: secondArtifact?.version ?? 0
            });
            expect(stored.content).toContain(firstToken);
            expect(stored.content).toContain(contextToken);

            throw new RollbackIntegrationTransaction();
          },
          {
            maxWait: 10_000,
            timeout: twoStepWorkflowTimeoutMs
          }
        );
      } catch (error) {
        if (!(error instanceof RollbackIntegrationTransaction)) {
          throw error;
        }
      } finally {
        await rm(artifactStoreRoot, { recursive: true, force: true });
        await rm(contextDirectory, { recursive: true, force: true });
        await Promise.all(
          stepRunIds.map((stepRunId) =>
            rm(path.join(repoRoot, ".workflow-runtime", "artifacts", stepRunId), {
              recursive: true,
              force: true
            })
          )
        );
      }

      expect(workflowRunId).toEqual(expect.any(String));
      await expect(
        prisma.workflowRun.findUnique({
          where: { id: workflowRunId }
        })
      ).resolves.toBeNull();
      await expect(
        prisma.artifactVersion.findMany({
          where: { workflowRunId }
        })
      ).resolves.toEqual([]);
      await expect(
        prisma.workflow.findUnique({
          where: { id: workflowId }
        })
      ).resolves.toBeNull();
    },
    twoStepWorkflowTimeoutMs + 10_000
  );

  it(
    "creates plan.md, consumes it in a downstream Codex step, rolls back DB rows, and leaves the artifact file",
    async () => {
      const prisma = await loadPrisma();
      const artifactStoreRoot = path.join(
        repoRoot,
        ".codex-integration-artifacts",
        randomUUID()
      );
      const planToken = `PLAN_INPUT_${randomUUID()}`;
      const executionToken = `PLAN_EXECUTED_${randomUUID()}`;
      let workflowId: string | undefined;
      let workflowRunId: string | undefined;
      let stepRunIds: string[] = [];
      let runtimePlanPath: string | undefined;
      let materializedInputPlanPath: string | undefined;
      let storedPlanPath: string | undefined;
      let storedExecutionPath: string | undefined;

      try {
        await prisma.$transaction(
          async (tx) => {
            const client = tx as unknown as DbClient;
            const created = await createPlanExecutionWorkflowRun(client, {
              planToken,
              executionToken
            });
            workflowId = created.workflowId;
            workflowRunId = created.workflowRunId;
            stepRunIds = created.stepRunIds;
            runtimePlanPath = path.join(
              repoRoot,
              ".workflow-runtime",
              "artifacts",
              created.stepRunIds[0] as string,
              "outputs",
              "plan.md"
            );
            materializedInputPlanPath = path.join(
              repoRoot,
              ".workflow-runtime",
              "artifacts",
              created.stepRunIds[1] as string,
              "inputs",
              "plan",
              "plan.md"
            );

            await expect(
              pollWorkflowRun(client, created.workflowRunId, artifactStoreRoot)
            ).resolves.toMatchObject({ picked: true, outcome: "accepted" });
            await expect(
              pollWorkflowRun(client, created.workflowRunId, artifactStoreRoot)
            ).resolves.toMatchObject({ picked: true, outcome: "accepted" });

            expect(await workflowStatus(client, created.workflowRunId)).toBe("COMPLETED");
            expect(await stepStatuses(client, created.workflowRunId)).toContain(
              `${created.stepRunIds[0]}:ACCEPTED`
            );
            expect(await stepStatuses(client, created.workflowRunId)).toContain(
              `${created.stepRunIds[1]}:ACCEPTED`
            );

            await expect(readFile(runtimePlanPath, "utf8")).resolves.toContain(planToken);
            await expect(readFile(materializedInputPlanPath, "utf8")).resolves.toContain(
              planToken
            );

            const planInput = await client.stepRunArtifactInput.findFirst({
              where: {
                stepRunId: created.stepRunIds[1],
                artifactKey: created.planArtifactKey
              }
            });
            expect(planInput).not.toBeNull();

            const planArtifact = await client.artifactVersion.findFirst({
              where: {
                workflowRunId: created.workflowRunId,
                artifactKey: created.planArtifactKey,
                status: "ACCEPTED"
              },
              orderBy: {
                version: "desc"
              }
            });
            expect(planArtifact).not.toBeNull();
            expect(planInput?.artifactVersionId).toBe(planArtifact?.id);

            const storedPlan = await readArtifactVersionContent({
              root: artifactStoreRoot,
              workflowId: created.workflowId,
              runId: created.workflowRunId,
              artifactKey: created.planArtifactKey,
              version: planArtifact?.version ?? 0
            });
            storedPlanPath = storedPlan.contentPath;
            expect(storedPlan.content).toContain(planToken);

            const executionArtifact = await client.artifactVersion.findFirst({
              where: {
                workflowRunId: created.workflowRunId,
                artifactKey: created.executionArtifactKey,
                status: "ACCEPTED"
              },
              orderBy: {
                version: "desc"
              }
            });
            expect(executionArtifact).not.toBeNull();

            const storedExecution = await readArtifactVersionContent({
              root: artifactStoreRoot,
              workflowId: created.workflowId,
              runId: created.workflowRunId,
              artifactKey: created.executionArtifactKey,
              version: executionArtifact?.version ?? 0
            });
            storedExecutionPath = storedExecution.contentPath;
            expect(storedExecution.content).toContain(planToken);
            expect(storedExecution.content).toContain(executionToken);

            const finishedSteps = await client.stepRun.findMany({
              where: {
                id: {
                  in: created.stepRunIds
                }
              },
              orderBy: {
                createdAt: "asc"
              },
              select: {
                codexFinalResponse: true
              }
            });
            expect(finishedSteps[0]?.codexFinalResponse).toContain("PLAN_ARTIFACT_DONE");
            expect(finishedSteps[1]?.codexFinalResponse).toContain("PLAN_EXECUTION_DONE");

            throw new RollbackIntegrationTransaction();
          },
          {
            maxWait: 10_000,
            timeout: twoStepWorkflowTimeoutMs
          }
        );
      } catch (error) {
        if (!(error instanceof RollbackIntegrationTransaction)) {
          throw error;
        }
      } finally {
        if (runtimePlanPath) {
          console.log(`[poller integration] plan.md left on disk: ${runtimePlanPath}`);
        }
        if (materializedInputPlanPath) {
          console.log(
            `[poller integration] downstream input plan.md left on disk: ${materializedInputPlanPath}`
          );
        }
        if (storedPlanPath) {
          console.log(`[poller integration] stored plan artifact left on disk: ${storedPlanPath}`);
        }
        if (storedExecutionPath) {
          console.log(
            `[poller integration] stored execution artifact left on disk: ${storedExecutionPath}`
          );
        }
      }

      expect(workflowId).toEqual(expect.any(String));
      expect(workflowRunId).toEqual(expect.any(String));
      expect(stepRunIds).toHaveLength(2);
      expect(runtimePlanPath).toEqual(expect.any(String));
      expect(materializedInputPlanPath).toEqual(expect.any(String));
      expect(storedPlanPath).toEqual(expect.any(String));
      expect(storedExecutionPath).toEqual(expect.any(String));
      await expect(
        prisma.workflowRun.findUnique({
          where: { id: workflowRunId }
        })
      ).resolves.toBeNull();
      await expect(
        prisma.artifactVersion.findMany({
          where: { workflowRunId }
        })
      ).resolves.toEqual([]);
      await expect(
        prisma.stepRun.findMany({
          where: { id: { in: stepRunIds } }
        })
      ).resolves.toEqual([]);
      await expect(
        prisma.workflow.findUnique({
          where: { id: workflowId }
        })
      ).resolves.toBeNull();
      await expect(readFile(runtimePlanPath as string, "utf8")).resolves.toContain(planToken);
      await expect(readFile(storedPlanPath as string, "utf8")).resolves.toContain(planToken);
    },
    twoStepWorkflowTimeoutMs + 10_000
  );
});
