import {
  query,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type SDKMessage,
  type SDKResultError,
  type SDKResultSuccess
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentRunError,
  safeUrlOrigin,
  type AgentRecordedEvent,
  type AgentRunObserver,
  type AgentRunRequest,
  type AgentRunResult,
  type IAgent
} from "./agent.js";

export const DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "Bash"
] as const;

export const DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS = [
  "WebFetch",
  "WebSearch"
] as const;

export const CLAUDE_EVALUATOR_ALLOWED_TOOLS = ["Read", "Glob", "Grep"] as const;

export type ClaudeQuery = typeof query;

export type ClaudeCodeAgentSettings = {
  model?: string;
  effort?: EffortLevel;
  permissionMode: PermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
  anthropicBaseUrl?: string;
  envOverrides?: Record<string, string | undefined>;
};

export class ClaudeCodeAgent implements IAgent {
  readonly provider = "claude" as const;

  constructor(
    private readonly settings: ClaudeCodeAgentSettings,
    private readonly queryFn: ClaudeQuery = query
  ) {}

  optionsSnapshot(request: AgentRunRequest): Record<string, unknown> {
    const options = this.optionsFor(request);

    return {
      agentProvider: this.provider,
      workingDirectory: request.workingDirectory,
      permissionProfile: request.permissionProfile,
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      ...(request.additionalDirectories?.length
        ? { additionalDirectories: request.additionalDirectories }
        : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      anthropicBaseUrlConfigured: Boolean(this.settings.anthropicBaseUrl),
      ...(safeUrlOrigin(this.settings.anthropicBaseUrl)
        ? { anthropicBaseUrlOrigin: safeUrlOrigin(this.settings.anthropicBaseUrl) }
        : {})
    };
  }

  async run(
    request: AgentRunRequest,
    observer: AgentRunObserver = {}
  ): Promise<AgentRunResult> {
    const abortController = new AbortController();
    const abortFromRequest = () => abortController.abort(request.signal?.reason);
    if (request.signal?.aborted) {
      abortFromRequest();
    } else {
      request.signal?.addEventListener("abort", abortFromRequest, { once: true });
    }

    const queryHandle = this.queryFn({
      prompt: request.prompt,
      options: {
        ...this.optionsFor(request),
        abortController
      }
    });

    let sessionId: string | undefined;
    let finalResponse: string | undefined;
    let usage: Record<string, unknown> | undefined;
    let structuredOutput: unknown;
    let completed = false;

    try {
      for await (const message of queryHandle) {
        if (isInitMessage(message)) {
          sessionId = message.session_id;
          await observer.onSessionStarted?.(message.session_id);
          await observer.onEvent?.({
            externalItemId: message.uuid,
            kind: "item.completed",
            status: "completed",
            payload: {
              agentProvider: this.provider,
              itemType: "system_init",
              model: message.model,
              permissionMode: message.permissionMode,
              tools: message.tools
            }
          });
          continue;
        }

        const normalized = normalizeClaudeMessage(message);
        if (normalized) {
          await observer.onEvent?.(normalized);
        }

        if (message.type !== "result") {
          continue;
        }

        sessionId = message.session_id;

        if (message.subtype !== "success") {
          throw resultError(message);
        }

        completed = true;
        finalResponse = message.result;
        usage = sanitizeClaudeUsage(message);
        structuredOutput = message.structured_output;
      }
    } finally {
      request.signal?.removeEventListener("abort", abortFromRequest);
      if (!completed && typeof queryHandle.close === "function") {
        queryHandle.close();
      }
    }

    if (!completed || !usage) {
      throw new AgentRunError(
        this.provider,
        "claude_stream_ended_without_completion",
        "Claude event stream ended before a successful result message"
      );
    }

    if (!sessionId) {
      throw new AgentRunError(
        this.provider,
        "claude_session_id_missing",
        "Claude result completed without a session id"
      );
    }

    if (finalResponse === undefined) {
      throw new AgentRunError(
        this.provider,
        "claude_final_response_missing",
        "Claude result completed without a final response"
      );
    }

    return {
      provider: this.provider,
      sessionId,
      threadId: sessionId,
      finalResponse,
      usage,
      ...(structuredOutput === undefined ? {} : { structuredOutput })
    };
  }

  private optionsFor(request: AgentRunRequest): Options {
    const readOnly = request.permissionProfile === "read-only";
    const env = this.processEnv();
    const model = request.model ?? this.settings.model;
    const effort = request.effort ?? this.settings.effort;

    return {
      cwd: request.workingDirectory,
      ...(request.additionalDirectories?.length
        ? { additionalDirectories: request.additionalDirectories }
        : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      allowedTools: readOnly
        ? [...CLAUDE_EVALUATOR_ALLOWED_TOOLS]
        : this.settings.allowedTools,
      disallowedTools: readOnly
        ? uniqueTools([...this.settings.disallowedTools, "Write", "Edit", "MultiEdit", "Bash"])
        : this.settings.disallowedTools,
      permissionMode: readOnly ? "dontAsk" : this.settings.permissionMode,
      ...(request.outputSchema
        ? { outputFormat: { type: "json_schema", schema: request.outputSchema } }
        : {}),
      ...(env ? { env } : {})
    };
  }

  private processEnv() {
    const overrides: Record<string, string | undefined> = {
      ...this.settings.envOverrides,
      ...(this.settings.anthropicBaseUrl
        ? { ANTHROPIC_BASE_URL: this.settings.anthropicBaseUrl }
        : {})
    };

    const defined = Object.fromEntries(
      Object.entries(overrides).filter((entry): entry is [string, string] => {
        return typeof entry[1] === "string" && entry[1].length > 0;
      })
    );

    if (Object.keys(defined).length === 0) {
      return undefined;
    }

    return {
      ...process.env,
      ...defined
    };
  }
}

function uniqueTools(values: string[]) {
  return [...new Set(values)];
}

function isInitMessage(message: SDKMessage): message is Extract<SDKMessage, { type: "system"; subtype: "init" }> {
  return message.type === "system" && message.subtype === "init";
}

function normalizeClaudeMessage(message: SDKMessage): AgentRecordedEvent | undefined {
  switch (message.type) {
    case "assistant":
      return {
        externalItemId: message.uuid,
        kind: "item.completed",
        status: message.error ? "failed" : "completed",
        payload: {
          agentProvider: "claude",
          itemType: "assistant_message",
          messageId: message.message.id,
          model: message.message.model,
          content: summarizeContentBlocks(message.message.content),
          usage: message.message.usage
        }
      };
    case "result":
      return {
        externalItemId: message.uuid,
        kind: message.subtype === "success" ? "turn.completed" : "turn.failed",
        status: message.subtype === "success" ? "completed" : "failed",
        payload:
          message.subtype === "success"
            ? {
                agentProvider: "claude",
                usage: sanitizeClaudeUsage(message),
                stopReason: message.stop_reason,
                totalCostUsd: message.total_cost_usd,
                terminalReason: message.terminal_reason
              }
            : {
                agentProvider: "claude",
                subtype: message.subtype,
                errors: message.errors,
                stopReason: message.stop_reason,
                terminalReason: message.terminal_reason,
                permissionDenials: message.permission_denials
              }
      };
    case "system":
      if (message.subtype === "permission_denied") {
        return {
          externalItemId: message.uuid,
          kind: "item.completed",
          status: "failed",
          payload: {
            agentProvider: "claude",
            itemType: "permission_denied",
            toolName: message.tool_name,
            toolUseId: message.tool_use_id,
            message: message.message,
            decisionReason: message.decision_reason
          }
        };
      }
      return undefined;
    case "tool_progress":
      return {
        externalItemId: message.uuid,
        kind: "item.completed",
        status: "completed",
        payload: {
          agentProvider: "claude",
          itemType: "tool_progress",
          toolUseId: message.tool_use_id,
          toolName: message.tool_name,
          elapsedTimeSeconds: message.elapsed_time_seconds
        }
      };
    case "tool_use_summary":
      return {
        externalItemId: message.uuid,
        kind: "item.completed",
        status: "completed",
        payload: {
          agentProvider: "claude",
          itemType: "tool_use_summary",
          summary: message.summary,
          precedingToolUseIds: message.preceding_tool_use_ids
        }
      };
    default:
      return undefined;
  }
}

function summarizeContentBlocks(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.map((block) => {
    if (!block || typeof block !== "object") {
      return { type: "unknown" };
    }

    const candidate = block as Record<string, unknown>;
    if (candidate.type === "text") {
      return { type: "text", text: candidate.text };
    }

    if (candidate.type === "tool_use") {
      return {
        type: "tool_use",
        id: candidate.id,
        name: candidate.name
      };
    }

    return { type: candidate.type ?? "unknown" };
  });
}

function sanitizeClaudeUsage(message: SDKResultSuccess | SDKResultError) {
  return {
    usage: message.usage,
    modelUsage: message.modelUsage,
    totalCostUsd: message.total_cost_usd,
    durationMs: message.duration_ms,
    durationApiMs: message.duration_api_ms,
    numTurns: message.num_turns,
    permissionDenials: message.permission_denials
  };
}

function resultError(message: SDKResultError) {
  const messageText =
    message.errors.length > 0
      ? message.errors.join("; ")
      : `Claude result failed with subtype ${message.subtype}`;

  return new AgentRunError("claude", "claude_turn_failed", messageText, true);
}
