import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = path.join(workerRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  CODEX_API_KEY: z.string().min(1).optional(),
  CODEX_BASE_URL: z.string().url().optional(),
  CODEX_MODEL: z.string().min(1).optional(),
  CODEX_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  CODEX_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  ARTIFACT_STORE_ROOT: z.string().default("../data/artifacts"),
  CODE_WORKTREE_ROOT: z.string().default("../data/worktrees"),
  EXPORT_ROOT: z.string().default("../data/exports"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_POLLING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export const env = EnvSchema.parse(process.env);
