import type { CodexInteractionKind } from "@workflow-software/shared";

export type AgentProvider = "claude" | "codex";
export type AgentRunPurpose = "step_execution" | "step_evaluation";
export type AgentPermissionProfile = "workspace-write" | "read-only";

export type AgentRunUsage = Record<string, unknown>;

export type AgentRunRequest = {
  purpose: AgentRunPurpose;
  permissionProfile: AgentPermissionProfile;
  prompt: string;
  workingDirectory: string;
  additionalDirectories?: string[];
  outputSchema?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type AgentRecordedEvent = {
  externalItemId?: string;
  kind: CodexInteractionKind;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
};

export type AgentRunObserver = {
  onSessionStarted?: (sessionId: string) => void | Promise<void>;
  onEvent?: (event: AgentRecordedEvent) => void | Promise<void>;
};

export type AgentRunResult = {
  provider: AgentProvider;
  sessionId: string;
  threadId: string;
  finalResponse: string;
  usage: AgentRunUsage;
  structuredOutput?: unknown;
};

export interface IAgent {
  readonly provider: AgentProvider;
  optionsSnapshot(request: AgentRunRequest): Record<string, unknown>;
  run(
    request: AgentRunRequest,
    observer?: AgentRunObserver
  ): Promise<AgentRunResult>;
}

export class AgentRunError extends Error {
  constructor(
    readonly provider: AgentProvider,
    readonly code: string,
    message: string,
    readonly eventRecorded = false,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "AgentRunError";
  }
}

export function safeUrlOrigin(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
