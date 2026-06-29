import { stat } from "node:fs/promises";
import path from "node:path";
import type { ContextPath } from "@workflow-software/shared";

export type ResolvedContextPath =
  | {
      status: "resolved";
      path: string;
      absolutePath: string;
      type: "file" | "directory";
    }
  | {
      status: "skipped";
      path: string;
      type: "file" | "directory";
      reason: string;
    };

export type ContextPathResolutionOptions = {
  inputPayload?: Record<string, unknown>;
};

const INPUT_PAYLOAD_PATH_PATTERN = /^\$\{inputPayload\.([A-Za-z0-9_.-]+)\}$/;

function lookupInputPayloadValue(
  inputPayload: Record<string, unknown> | undefined,
  keyPath: string
) {
  let current: unknown = inputPayload;

  for (const key of keyPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function resolveContextPathValue(
  contextPath: ContextPath,
  options: ContextPathResolutionOptions
):
  | { status: "resolved"; path: string }
  | { status: "skipped"; reason: string } {
  const match = contextPath.path.trim().match(INPUT_PAYLOAD_PATH_PATTERN);

  if (!match) {
    return { status: "resolved", path: contextPath.path };
  }

  const keyPath = match[1] ?? "";
  const value = lookupInputPayloadValue(options.inputPayload, keyPath);

  if (value === undefined || value === null) {
    return { status: "skipped", reason: "input_payload_path_missing" };
  }

  if (typeof value !== "string") {
    return { status: "skipped", reason: "input_payload_path_not_string" };
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return { status: "skipped", reason: "input_payload_path_not_string" };
  }

  return { status: "resolved", path: trimmedValue };
}

export async function resolveContextPath(
  worktreeRoot: string,
  contextPath: ContextPath,
  options: ContextPathResolutionOptions = {}
): Promise<ResolvedContextPath> {
  const resolvedPath = resolveContextPathValue(contextPath, options);

  if (resolvedPath.status === "skipped") {
    return { ...contextPath, status: "skipped", reason: resolvedPath.reason };
  }

  const absolutePath = path.resolve(worktreeRoot, resolvedPath.path);

  try {
    const info = await stat(absolutePath);
    const actualType = info.isDirectory() ? "directory" : "file";

    if (actualType !== contextPath.type) {
      return {
        path: resolvedPath.path,
        type: contextPath.type,
        status: "skipped",
        reason: "path_type_mismatch"
      };
    }

    return {
      path: resolvedPath.path,
      type: contextPath.type,
      status: "resolved",
      absolutePath
    };
  } catch {
    return {
      path: resolvedPath.path,
      type: contextPath.type,
      status: "skipped",
      reason: "path_missing_or_inaccessible"
    };
  }
}
