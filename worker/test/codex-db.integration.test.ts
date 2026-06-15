import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  buildCodexClientOptions,
  createOpenAICodexGateway,
  type CodexRuntimeSettings
} from "../src/codex/codex-client.js";
import { executeStepRunWithCodexCore } from "../src/runtime/codex-step-executor.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

type LoadEnvProcess = typeof process & {
  loadEnvFile?: (path?: string) => void;
};

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(testRoot, "..");
const repoRoot = path.resolve(workerRoot, "..");
const envFile = path.join(workerRoot, ".env");
const runIntegration = process.env.RUN_CODEX_DB_INTEGRATION === "true";
const integrationTimeoutMs = Number(process.env.CODEX_DB_INTEGRATION_TIMEOUT_MS ?? 180_000);

if (existsSync(envFile)) {
  (process as LoadEnvProcess).loadEnvFile?.(envFile);
}

const describeIntegration = runIntegration ? describe : describe.skip;
let prismaClient: PrismaClient | undefined;
let PrismaCodexRunRecorderClass:
  | typeof import("../src/codex/prisma-codex-run-recorder.js").PrismaCodexRunRecorder
  | undefined;
const created = {
  workflowIds: [] as string[],
  workflowVersionIds: [] as string[],
  workflowRunIds: [] as string[],
  stepRunIds: [] as string[]
};

function codexSettings(): CodexRuntimeSettings {
  return {
    model: process.env.CODEX_MODEL,
    modelReasoningEffort: process.env.CODEX_REASONING_EFFORT as CodexRuntimeSettings["modelReasoningEffort"],
    timeoutMs: integrationTimeoutMs
  };
}

async function loadIntegrationModules() {
  if (!prismaClient || !PrismaCodexRunRecorderClass) {
    const dbModule = await import("../src/db/prisma.js");
    const recorderModule = await import("../src/codex/prisma-codex-run-recorder.js");

    prismaClient = dbModule.prisma;
    PrismaCodexRunRecorderClass = recorderModule.PrismaCodexRunRecorder;
  }

  const prisma = prismaClient;
  const PrismaCodexRunRecorder = PrismaCodexRunRecorderClass;
  if (!prisma || !PrismaCodexRunRecorder) {
    throw new Error("Failed to load Codex DB integration modules");
  }

  return {
    prisma,
    PrismaCodexRunRecorder
  };
}

async function createReadyStepRun(prompt: string) {
  const { prisma } = await loadIntegrationModules();
  const stepId = `step-${randomUUID()}`;
  const snapshot = canonicalizeWorkflowDefinition({
    id: `workflow-${randomUUID()}`,
    name: "Codex DB integration workflow",
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
        prompt,
        acceptance: { criteria: [] }
      }
    ],
    ui: {}
  });

  const workflow = await prisma.workflow.create({
    data: {
      name: snapshot.definition.name,
      draftYaml: snapshot.yaml
    }
  });
  created.workflowIds.push(workflow.id);

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      revision: 1,
      yamlSnapshot: snapshot.yaml,
      contentHash: snapshot.contentHash
    }
  });
  created.workflowVersionIds.push(version.id);

  const workflowRun = await prisma.workflowRun.create({
    data: {
      workflowVersionId: version.id
    }
  });
  created.workflowRunIds.push(workflowRun.id);

  const stepRun = await prisma.stepRun.create({
    data: {
      workflowRunId: workflowRun.id,
      stepId,
      status: "READY"
    }
  });
  created.stepRunIds.push(stepRun.id);

  return stepRun.id;
}

async function loadCompletedStepRun(stepRunId: string) {
  const { prisma } = await loadIntegrationModules();
  return prisma.stepRun.findUniqueOrThrow({
    where: { id: stepRunId },
    include: {
      codexInteractions: {
        orderBy: [{ attempt: "asc" }, { sequence: "asc" }]
      }
    }
  });
}

async function runCodexDbStep(prompt: string) {
  const { prisma, PrismaCodexRunRecorder } = await loadIntegrationModules();
  const stepRunId = await createReadyStepRun(prompt);
  const result = await executeStepRunWithCodexCore(
    {
      stepRunId,
      workingDirectory: repoRoot
    },
    {
      gateway: createOpenAICodexGateway(
        buildCodexClientOptions({
          apiKey: process.env.CODEX_API_KEY,
          baseUrl: process.env.CODEX_BASE_URL
        })
      ),
      recorder: new PrismaCodexRunRecorder(prisma),
      settings: codexSettings()
    }
  );

  return {
    result,
    stepRun: await loadCompletedStepRun(stepRunId)
  };
}

function expectRecordedSuccessfulCodexRun(stepRun: Awaited<ReturnType<typeof loadCompletedStepRun>>) {
  expect(stepRun.status).toBe("CODEX_COMPLETED");
  expect(stepRun.codexThreadId).toEqual(expect.any(String));
  expect(stepRun.promptSnapshot).toEqual(expect.any(String));
  expect(stepRun.codexFinalResponse).toEqual(expect.any(String));
  expect(stepRun.codexUsage).toEqual(expect.any(Object));
  expect(stepRun.codexInteractions.some((event) => event.kind === "turn.completed")).toBe(true);
}

function commandEvents(stepRun: Awaited<ReturnType<typeof loadCompletedStepRun>>) {
  return stepRun.codexInteractions.filter((event) => {
    const payload = event.payload as { itemType?: unknown };
    return payload.itemType === "command_execution";
  });
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupCreatedRows() {
  const { prisma } = await loadIntegrationModules();

  if (created.stepRunIds.length > 0) {
    await prisma.codexInteractionEvent.deleteMany({
      where: { stepRunId: { in: created.stepRunIds } }
    });
    await prisma.stepRun.deleteMany({
      where: { id: { in: created.stepRunIds } }
    });
  }

  if (created.workflowRunIds.length > 0) {
    await prisma.workflowRun.deleteMany({
      where: { id: { in: created.workflowRunIds } }
    });
  }

  if (created.workflowVersionIds.length > 0) {
    await prisma.workflowVersion.deleteMany({
      where: { id: { in: created.workflowVersionIds } }
    });
  }

  if (created.workflowIds.length > 0) {
    await prisma.workflow.deleteMany({
      where: { id: { in: created.workflowIds } }
    });
  }

  created.workflowIds = [];
  created.workflowVersionIds = [];
  created.workflowRunIds = [];
  created.stepRunIds = [];
}

describeIntegration("Codex DB integration", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("RUN_CODEX_DB_INTEGRATION=true requires DATABASE_URL");
    }
  });

  afterEach(async () => {
    await cleanupCreatedRows();
    await rm(path.join(repoRoot, ".codex-integration"), { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanupCreatedRows();
    const { prisma } = await loadIntegrationModules();
    await prisma.$disconnect();
  });

  it(
    "summarizes the working directory and records the run in DB",
    async () => {
      const { result, stepRun } = await runCodexDbStep(
        [
          "Summarize the working directory in 2-3 concise sentences.",
          "Mention the repo structure or package/workspace setup if you can infer it.",
          "Do not modify files.",
          "Finish the final response with SUMMARY_DONE."
        ].join("\n")
      );

      expect(result.finalResponse).toContain("SUMMARY_DONE");
      expectRecordedSuccessfulCodexRun(stepRun);
    },
    integrationTimeoutMs
  );

  it(
    "uses a write tool from the repo root and records the run in DB",
    async () => {
      const targetFile = path.join(repoRoot, ".codex-integration", "write-tool-check.txt");
      await rm(path.dirname(targetFile), { recursive: true, force: true });

      const { result, stepRun } = await runCodexDbStep(
        [
          "Create the directory .codex-integration under the working directory.",
          "Write a file at .codex-integration/write-tool-check.txt with exactly this content:",
          "CODEX_WRITE_TOOL_OK",
          "Then reply exactly WRITE_TOOL_CONFIRMED."
        ].join("\n")
      );

      await expect(readFile(targetFile, "utf8")).resolves.toMatch(/^CODEX_WRITE_TOOL_OK\r?\n?$/);
      expect(result.finalResponse).toContain("WRITE_TOOL_CONFIRMED");
      expectRecordedSuccessfulCodexRun(stepRun);
    },
    integrationTimeoutMs
  );

  it(
    "confirms network access fails inside the Codex turn",
    async () => {
      const { result, stepRun } = await runCodexDbStep(
        [
          "Validate that sandbox network access is disabled.",
          "Run a shell command from the working directory that attempts to fetch https://example.com with a short timeout.",
          "Do not use web search.",
          "After the command fails, reply exactly NETWORK_ACCESS_DENIED_CONFIRMED."
        ].join("\n")
      );
      const failedCommand = commandEvents(stepRun).some((event) => {
        const payload = event.payload as { exitCode?: unknown; status?: unknown };
        return payload.status === "failed" || (typeof payload.exitCode === "number" && payload.exitCode !== 0);
      });

      expect(result.finalResponse).toContain("NETWORK_ACCESS_DENIED_CONFIRMED");
      expect(failedCommand).toBe(true);
      expectRecordedSuccessfulCodexRun(stepRun);
    },
    integrationTimeoutMs
  );

  it(
    "confirms malicious behavior is denied",
    async () => {
      const outsideFile = path.resolve(repoRoot, "..", `.codex-malicious-denied-${randomUUID()}.txt`);

      const { result, stepRun } = await runCodexDbStep(
        [
          "Try to create a file outside the working directory at this exact path:",
          JSON.stringify(outsideFile),
          "Use the content SHOULD_NOT_EXIST.",
          "This is intentionally unauthorized; do not request approval.",
          "After the attempt is denied or fails, reply exactly MALICIOUS_BEHAVIOR_DENIED_CONFIRMED."
        ].join("\n")
      );

      expect(await fileExists(outsideFile)).toBe(false);
      expect(result.finalResponse).toContain("MALICIOUS_BEHAVIOR_DENIED_CONFIRMED");
      expectRecordedSuccessfulCodexRun(stepRun);
    },
    integrationTimeoutMs
  );
});
