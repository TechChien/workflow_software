import type { Usage } from "@openai/codex-sdk";
import type { CodexInteractionKind } from "@workflow-software/shared";

export type CodexStepRunSource = {
  stepId: string;
  yamlSnapshot: string;
  contentHash: string;
};

export type RecordedCodexEvent = {
  sequence: number;
  externalItemId?: string;
  kind: CodexInteractionKind;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
};

export type CodexRunFailure = {
  code: string;
  message: string;
};

export interface CodexRunRecorder {
  loadSource(stepRunId: string): Promise<CodexStepRunSource>;
  markStarted(input: {
    stepRunId: string;
    promptSnapshot: string;
    codexOptions: Record<string, unknown>;
  }): Promise<void>;
  recordThreadStarted(stepRunId: string, threadId: string): Promise<void>;
  appendEvent(stepRunId: string, event: RecordedCodexEvent): Promise<void>;
  markCompleted(input: {
    stepRunId: string;
    finalResponse: string;
    usage: Usage;
  }): Promise<void>;
  markFailed(stepRunId: string, failure: CodexRunFailure): Promise<void>;
}
