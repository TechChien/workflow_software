export const cliUsage =
  "Usage: pnpm --filter @workflow-software/worker cli -- <workflow.yaml> [--repo-path <path>] [--input-payload '{\"key\":\"value\"}']";

export type CliOptions =
  | {
      help: true;
    }
  | {
      help: false;
      workflowPath: string;
      inputPayload: Record<string, unknown>;
      repoPath?: string;
    };

function parseInputPayload(source: string, optionName: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${optionName} must be valid JSON`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${optionName} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function parseCliArgs(args: string[]): CliOptions {
  let workflowPath: string | undefined;
  let inputPayload: Record<string, unknown> = {};
  let repoPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help") {
      return { help: true };
    }

    if (arg === "--input" || arg === "--input-payload" || arg === "--inputPayload") {
      const source = args[index + 1];

      if (!source) {
        throw new Error(`${arg} requires a JSON object argument`);
      }

      inputPayload = parseInputPayload(source, arg);
      index += 1;
      continue;
    }

    if (arg === "--repo-path") {
      const source = args[index + 1];

      if (!source) {
        throw new Error("--repo-path requires a path argument");
      }

      repoPath = source;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (workflowPath) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    workflowPath = arg;
  }

  if (!workflowPath) {
    throw new Error(`Missing required workflow.yaml path\n${cliUsage}`);
  }

  return {
    help: false,
    workflowPath,
    inputPayload,
    ...(repoPath ? { repoPath } : {})
  };
}
