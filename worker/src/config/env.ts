import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS,
  DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS
} from "../agents/claude-code-agent.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = path.join(workerRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

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

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  AGENT_EXECUTOR: z.enum(["claude", "codex"]).default("claude"),
  AGENT_EVALUATOR: z.enum(["claude", "codex"]).default("claude"),
  AGENT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  CLAUDE_MODEL: z.string().min(1).optional(),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  CLAUDE_PERMISSION_MODE: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"])
    .default("acceptEdits"),
  CLAUDE_ALLOWED_TOOLS: z
    .string()
    .optional()
    .transform((value) =>
      commaSeparated(value, DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS)
    ),
  CLAUDE_DISALLOWED_TOOLS: z
    .string()
    .optional()
    .transform((value) =>
      commaSeparated(value, DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS)
    ),
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: z.string().optional(),
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: z.string().optional(),
  CLAUDE_CODE_DISABLE_THINKING: z.string().optional(),
  CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: z.string().optional(),
  API_TIMEOUT_MS: z.string().optional(),
  CODEX_API_KEY: z.string().min(1).optional(),
  CODEX_BASE_URL: z.string().url().optional(),
  CODEX_MODEL: z.string().min(1).optional(),
  CODEX_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  CODEX_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  CODE_WORKSPACE_REPO_PATH: z.string().min(1).optional(),
  ARTIFACT_STORE_ROOT: z.string().default("../data/artifacts"),
  CODE_WORKTREE_ROOT: z.string().default("../data/worktrees"),
  EXPORT_ROOT: z.string().default("../data/exports"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_POLLING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export function parseWorkerEnv(input: NodeJS.ProcessEnv) {
  return EnvSchema.parse(input);
}

export const env = parseWorkerEnv(process.env);
