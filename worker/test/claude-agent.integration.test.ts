import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ClaudeCodeAgent,
  DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS,
  DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS,
  type ClaudeCodeAgentSettings
} from "../src/agents/claude-code-agent.js";
import type { AgentRecordedEvent } from "../src/agents/agent.js";

type LoadEnvProcess = typeof process & {
  loadEnvFile?: (path?: string) => void;
};

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(testRoot, "..");
const repoRoot = path.resolve(workerRoot, "..");
const envFile = path.join(workerRoot, ".env");
const SMOKE_MARKER = "CLAUDE_AGENT_INTEGRATION_DONE";

if (existsSync(envFile)) {
  (process as LoadEnvProcess).loadEnvFile?.(envFile);
}

const runIntegration = process.env.RUN_CLAUDE_AGENT_INTEGRATION === "true";
const integrationTimeoutMs = Number(
  process.env.CLAUDE_AGENT_INTEGRATION_TIMEOUT_MS ??
    process.env.AGENT_TURN_TIMEOUT_MS ??
    180_000
);
const describeIntegration = runIntegration ? describe : describe.skip;

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

describeIntegration("Claude agent integration", () => {
  beforeAll(() => {
    if (!Number.isInteger(integrationTimeoutMs) || integrationTimeoutMs <= 0) {
      throw new Error("CLAUDE_AGENT_INTEGRATION_TIMEOUT_MS must be positive");
    }
  });

  it(
    "runs a real read-only Claude agent turn through the configured router",
    async () => {
      const agent = new ClaudeCodeAgent(claudeSettings());
      const events: AgentRecordedEvent[] = [];
      const sessions: string[] = [];
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          controller.abort(
            new Error(
              `Claude integration turn timed out after ${integrationTimeoutMs}ms`
            )
          ),
        integrationTimeoutMs
      );

      try {
        const result = await agent.run(
          {
            purpose: "step_evaluation",
            permissionProfile: "read-only",
            prompt: [
              "Inspect this repository using only read-only tools.",
              "Reply with one short sentence describing the project.",
              `Finish the final response with ${SMOKE_MARKER}.`
            ].join("\n"),
            workingDirectory: repoRoot,
            timeoutMs: integrationTimeoutMs,
            signal: controller.signal
          },
          {
            onSessionStarted: (sessionId) => {
              sessions.push(sessionId);
            },
            onEvent: (event) => {
              events.push(event);
            }
          }
        );

        expect(result.provider).toBe("claude");
        expect(result.sessionId).toEqual(expect.any(String));
        expect(result.threadId).toBe(result.sessionId);
        expect(result.finalResponse).toContain(SMOKE_MARKER);
        expect(result.usage).toEqual(expect.any(Object));
        expect(sessions).toContain(result.sessionId);
        expect(events.some((event) => event.kind === "turn.completed")).toBe(true);
      } finally {
        clearTimeout(timer);
      }
    },
    integrationTimeoutMs
  );
});
