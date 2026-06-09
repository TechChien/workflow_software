export const cliUsage =
  "Usage: pnpm --filter @workflow-software/worker cli -- <workflow.yaml> [--input '{\"key\":\"value\"}']";

export type CliOptions =
  | {
      help: true;
    }
  | {
      help: false;
      workflowPath: string;
      inputPayload: Record<string, unknown>;
    };

function parseInputPayload(source: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("--input must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export function parseCliArgs(args: string[]): CliOptions {
  let workflowPath: string | undefined;
  let inputPayload: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help") {
      return { help: true };
    }

    if (arg === "--input") {
      const source = args[index + 1];

      if (!source) {
        throw new Error("--input requires a JSON object argument");
      }

      inputPayload = parseInputPayload(source);
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
    inputPayload
  };
}
