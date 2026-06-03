import { z } from "zod";

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
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
