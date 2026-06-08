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

export async function resolveContextPath(
  worktreeRoot: string,
  contextPath: ContextPath
): Promise<ResolvedContextPath> {
  const absolutePath = path.resolve(worktreeRoot, contextPath.path);

  try {
    const info = await stat(absolutePath);
    const actualType = info.isDirectory() ? "directory" : "file";

    if (actualType !== contextPath.type) {
      return { ...contextPath, status: "skipped", reason: "path_type_mismatch" };
    }

    return { ...contextPath, status: "resolved", absolutePath };
  } catch {
    return { ...contextPath, status: "skipped", reason: "path_missing_or_inaccessible" };
  }
}
