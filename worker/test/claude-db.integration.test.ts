import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ClaudeCodeAgent,
  DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS,
  DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS,
  type ClaudeCodeAgentSettings
} from "../src/agents/claude-code-agent.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { executeStepRunWithAgentCore } from "../src/runtime/codex-step-executor.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

type LoadEnvProcess = typeof process & {
  loadEnvFile?: (path?: string) => void;
};

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(testRoot, "..");
const repoRoot = path.resolve(workerRoot, "..");
const envFile = path.join(workerRoot, ".env");

if (existsSync(envFile)) {
  (process as LoadEnvProcess).loadEnvFile?.(envFile);
}

const runIntegration = process.env.RUN_CLAUDE_DB_INTEGRATION === "true";
const integrationTimeoutMs = Number(
  process.env.CLAUDE_DB_INTEGRATION_TIMEOUT_MS ?? process.env.AGENT_TURN_TIMEOUT_MS ?? 180_000
);
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

function commaSeparated(value: string | undefined, fallback: readonly string[]) {
  if (!value) {
    return [...fallback];
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : [...fallback];
}

function claudeSettings(): ClaudeCodeAgentSettings {
  return {
    model: process.env.CLAUDE_MODEL,
    effort: process.env.CLAUDE_EFFORT as ClaudeCodeAgentSettings["effort"],
    permissionMode:
      (process.env.CLAUDE_PERMISSION_MODE as ClaudeCodeAgentSettings["permissionMode"]) ??
      "acceptEdits",
    allowedTools: commaSeparated(
      process.env.CLAUDE_ALLOWED_TOOLS,
      DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS
    ),
    disallowedTools: commaSeparated(
      process.env.CLAUDE_DISALLOWED_TOOLS,
      DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS
    ),
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
    envOverrides: {
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:
        process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:
        process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS,
      CLAUDE_CODE_DISABLE_THINKING: process.env.CLAUDE_CODE_DISABLE_THINKING,
      CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT,
      API_TIMEOUT_MS: process.env.API_TIMEOUT_MS
    }
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
    throw new Error("Failed to load Claude DB integration modules");
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
    name: "Claude DB integration workflow",
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

describeIntegration("Claude DB integration", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("RUN_CLAUDE_DB_INTEGRATION=true requires DATABASE_URL");
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new Error(
        "RUN_CLAUDE_DB_INTEGRATION=true requires ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN"
      );
    }
  });

  afterEach(async () => {
    await cleanupCreatedRows();
  });

  afterAll(async () => {
    await cleanupCreatedRows();
    const { prisma } = await loadIntegrationModules();
    await prisma.$disconnect();
  });

  it(
    "runs a Claude agent turn through DB persistence",
    async () => {
      const { prisma, PrismaCodexRunRecorder } = await loadIntegrationModules();
      const stepRunId = await createReadyStepRun(
        [
          "Summarize this repository in one short sentence.",
          "Do not modify files.",
          "Finish the final response with CLAUDE_DB_SMOKE_DONE."
        ].join("\n")
      );

      const result = await executeStepRunWithAgentCore(
        {
          stepRunId,
          workingDirectory: repoRoot
        },
        {
          agent: new ClaudeCodeAgent(claudeSettings()),
          recorder: new PrismaCodexRunRecorder(prisma),
          timeoutMs: integrationTimeoutMs
        }
      );
      const stepRun = await prisma.stepRun.findUniqueOrThrow({
        where: { id: stepRunId },
        include: {
          codexInteractions: {
            orderBy: [{ attempt: "asc" }, { sequence: "asc" }]
          }
        }
      });

      expect(result.provider).toBe("claude");
      expect(result.finalResponse).toContain("CLAUDE_DB_SMOKE_DONE");
      expect(stepRun.status).toBe("CODEX_COMPLETED");
      expect(stepRun.codexOptions).toMatchObject({
        agentProvider: "claude",
        anthropicBaseUrlConfigured: Boolean(process.env.ANTHROPIC_BASE_URL)
      });
      expect(stepRun.codexThreadId).toEqual(expect.any(String));
      expect(stepRun.codexFinalResponse).toContain("CLAUDE_DB_SMOKE_DONE");
      expect(stepRun.codexInteractions.some((event) => event.kind === "turn.completed")).toBe(
        true
      );
    },
    integrationTimeoutMs
  );
});
