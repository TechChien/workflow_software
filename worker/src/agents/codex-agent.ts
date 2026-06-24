import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import {
  buildCodexEvaluatorThreadOptions,
  buildCodexOptionsSnapshot,
  buildCodexThreadOptions,
  type CodexGateway,
  type CodexRuntimeSettings
} from "../codex/codex-client.js";
import { normalizeCodexEvent } from "../codex/codex-event-normalizer.js";
import {
  AgentRunError,
  type AgentRecordedEvent,
  type AgentRunObserver,
  type AgentRunRequest,
  type AgentRunResult,
  type IAgent
} from "./agent.js";

export class CodexAgent implements IAgent {
  readonly provider = "codex" as const;

  constructor(
    private readonly gateway: CodexGateway,
    private readonly settings: Pick<
      CodexRuntimeSettings,
      "model" | "modelReasoningEffort"
    >
  ) {}

  optionsSnapshot(request: AgentRunRequest): Record<string, unknown> {
    return {
      agentProvider: this.provider,
      ...buildCodexOptionsSnapshot(this.threadOptionsFor(request))
    };
  }

  async run(
    request: AgentRunRequest,
    observer: AgentRunObserver = {}
  ): Promise<AgentRunResult> {
    const threadOptions = this.threadOptionsFor(request);
    const events = await this.gateway.runTurn({
      prompt: request.prompt,
      threadOptions,
      ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });

    let sessionId: string | undefined;
    let finalResponse: string | undefined;
    let usage: Usage | undefined;
    let completed = false;
    let terminalFailure: AgentRunError | undefined;

    for await (const event of events) {
      if (event.type === "thread.started") {
        sessionId = event.thread_id;
        await observer.onSessionStarted?.(event.thread_id);
        continue;
      }

      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }

      const normalized = normalizeCodexEvent(event);
      if (normalized) {
        await observer.onEvent?.(withProvider(normalized, this.provider));
      }

      if (event.type === "turn.completed") {
        usage = event.usage;
        completed = true;
      }

      terminalFailure ??= failureFromTerminalEvent(event);
      if (terminalFailure) {
        break;
      }
    }

    if (terminalFailure) {
      throw terminalFailure;
    }

    if (!completed || !usage) {
      throw new AgentRunError(
        this.provider,
        "codex_stream_ended_without_completion",
        "Codex event stream ended before turn.completed"
      );
    }

    if (!sessionId && request.purpose === "step_execution") {
      throw new AgentRunError(
        this.provider,
        "codex_thread_id_missing",
        "Codex event stream completed without thread.started"
      );
    }

    if (finalResponse === undefined) {
      throw new AgentRunError(
        this.provider,
        "codex_final_response_missing",
        "Codex turn completed without an agent message"
      );
    }

    const resolvedSessionId = sessionId ?? "codex-evaluator-turn";

    return {
      provider: this.provider,
      sessionId: resolvedSessionId,
      threadId: resolvedSessionId,
      finalResponse,
      usage: usage as unknown as Record<string, unknown>
    };
  }

  private threadOptionsFor(request: AgentRunRequest) {
    const settings = {
      model: request.model ?? this.settings.model,
      modelReasoningEffort:
        request.modelReasoningEffort ?? this.settings.modelReasoningEffort
    };

    if (request.permissionProfile === "read-only") {
      return buildCodexEvaluatorThreadOptions(request.workingDirectory, settings);
    }

    return buildCodexThreadOptions(request.workingDirectory, settings, {
      additionalDirectories: request.additionalDirectories
    });
  }
}

function withProvider(
  event: Omit<AgentRecordedEvent, "payload"> & { payload: Record<string, unknown> },
  provider: "codex"
): AgentRecordedEvent {
  return {
    ...event,
    payload: {
      agentProvider: provider,
      ...event.payload
    }
  };
}

function failureFromTerminalEvent(event: ThreadEvent): AgentRunError | undefined {
  switch (event.type) {
    case "turn.failed":
      return new AgentRunError("codex", "codex_turn_failed", event.error.message, true);
    case "error":
      return new AgentRunError("codex", "codex_stream_error", event.message, true);
    default:
      return undefined;
  }
}
