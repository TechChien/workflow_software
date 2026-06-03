import type { ResolvedContextPath } from "./context-path-resolver.js";

export async function recordContextPathEvent(stepRunId: string, result: ResolvedContextPath) {
  return {
    stepRunId,
    ...result
  };
}
