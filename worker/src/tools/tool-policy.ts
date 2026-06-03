import type { ToolCapability } from "./tool-registry.js";

export function resolveAllowedTools(
  requestedCapabilities: string[],
  registeredTools: ToolCapability[]
) {
  if (requestedCapabilities.includes("*")) {
    return registeredTools;
  }

  const requested = new Set(requestedCapabilities);
  return registeredTools.filter((tool) => requested.has(tool.name));
}
