import {
  Codex,
  type CodexOptions,
  type ModelReasoningEffort,
  type ThreadEvent,
  type ThreadOptions
} from "@openai/codex-sdk";

export const CODEX_THREAD_POLICY = {
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled"
} as const satisfies ThreadOptions;

export type CodexRuntimeSettings = {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  timeoutMs: number;
};

export type CodexTurnRequest = {
  prompt: string;
  threadOptions: ThreadOptions;
  signal?: AbortSignal;
};

export interface CodexGateway {
  runTurn(request: CodexTurnRequest): Promise<AsyncIterable<ThreadEvent>>;
}

export class OpenAICodexGateway implements CodexGateway {
  constructor(private readonly client: Codex = new Codex()) {}

  async runTurn(request: CodexTurnRequest): Promise<AsyncIterable<ThreadEvent>> {
    const thread = this.client.startThread(request.threadOptions);
    const streamed = await thread.runStreamed(request.prompt, { signal: request.signal });
    return streamed.events;
  }
}

export function createOpenAICodexGateway(options: CodexOptions = {}) {
  return new OpenAICodexGateway(new Codex(options));
}

export function buildCodexClientOptions(input: { apiKey?: string; baseUrl?: string }): CodexOptions {
  return {
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {})
  };
}

export function buildCodexThreadOptions(
  workingDirectory: string,
  settings: Pick<CodexRuntimeSettings, "model" | "modelReasoningEffort">
): ThreadOptions {
  return {
    ...CODEX_THREAD_POLICY,
    workingDirectory,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.modelReasoningEffort
      ? { modelReasoningEffort: settings.modelReasoningEffort }
      : {})
  };
}

export function buildCodexOptionsSnapshot(threadOptions: ThreadOptions): Record<string, unknown> {
  return {
    workingDirectory: threadOptions.workingDirectory,
    sandboxMode: threadOptions.sandboxMode,
    approvalPolicy: threadOptions.approvalPolicy,
    networkAccessEnabled: threadOptions.networkAccessEnabled,
    webSearchMode: threadOptions.webSearchMode,
    ...(threadOptions.model ? { model: threadOptions.model } : {}),
    ...(threadOptions.modelReasoningEffort
      ? { modelReasoningEffort: threadOptions.modelReasoningEffort }
      : {})
  };
}
