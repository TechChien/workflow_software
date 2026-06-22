import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { AgentRunError } from "../src/agents/agent.js";
import {
  CLAUDE_EVALUATOR_ALLOWED_TOOLS,
  ClaudeCodeAgent,
  DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS,
  DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS,
  type ClaudeCodeAgentSettings,
  type ClaudeQuery
} from "../src/agents/claude-code-agent.js";

type ClaudeQueryRequest = Parameters<ClaudeQuery>[0];

function baseSettings(
  overrides: Partial<ClaudeCodeAgentSettings> = {}
): ClaudeCodeAgentSettings {
  return {
    permissionMode: "acceptEdits",
    allowedTools: [...DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS],
    disallowedTools: [...DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS],
    ...overrides
  };
}

function queryFrom(messages: SDKMessage[], onClose = vi.fn()) {
  const generator = (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();

  return Object.assign(generator, {
    close: onClose
  }) as ReturnType<ClaudeQuery>;
}

function initMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "test",
    cwd: process.cwd(),
    tools: ["Read", "Grep"],
    mcp_servers: [],
    model: "claude-test",
    permissionMode: "dontAsk",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "init-1",
    session_id: "session-1",
    ...overrides
  } as SDKMessage;
}

function successMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 10,
    duration_api_ms: 5,
    is_error: false,
    num_turns: 1,
    result: "done",
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 3
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "result-1",
    session_id: "session-1",
    ...overrides
  } as SDKMessage;
}

function errorMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 10,
    duration_api_ms: 5,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 0
    },
    modelUsage: {},
    permission_denials: [],
    errors: ["model failed"],
    uuid: "result-error-1",
    session_id: "session-1",
    ...overrides
  } as SDKMessage;
}

describe("ClaudeCodeAgent", () => {
  it("passes ANTHROPIC_BASE_URL and gateway env overrides to query options", async () => {
    const previousSentinel = process.env.WORKFLOW_TEST_SENTINEL;
    process.env.WORKFLOW_TEST_SENTINEL = "present";
    const captured: { request?: ClaudeQueryRequest } = {};
    const queryFn = ((request: ClaudeQueryRequest) => {
      captured.request = request;
      return queryFrom([successMessage()]);
    }) as ClaudeQuery;

    try {
      const agent = new ClaudeCodeAgent(
        baseSettings({
          anthropicBaseUrl: "https://gateway.example.test/v1",
          envOverrides: {
            CLAUDE_CODE_DISABLE_THINKING: "true",
            API_TIMEOUT_MS: "120000"
          }
        }),
        queryFn
      );

      await agent.run({
        purpose: "step_execution",
        permissionProfile: "workspace-write",
        prompt: "Implement the step.",
        workingDirectory: process.cwd(),
        timeoutMs: 1_000
      });

      expect(captured.request?.options?.env).toMatchObject({
        ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
        CLAUDE_CODE_DISABLE_THINKING: "true",
        API_TIMEOUT_MS: "120000",
        WORKFLOW_TEST_SENTINEL: "present"
      });
    } finally {
      if (previousSentinel === undefined) {
        delete process.env.WORKFLOW_TEST_SENTINEL;
      } else {
        process.env.WORKFLOW_TEST_SENTINEL = previousSentinel;
      }
    }
  });

  it("uses read-only evaluator options and returns structured output", async () => {
    const schema = {
      type: "object",
      properties: { verdict: { type: "string" } },
      required: ["verdict"]
    };
    const structuredOutput = {
      verdict: "APPROVE",
      comment: "Looks good."
    };
    const captured: { request?: ClaudeQueryRequest } = {};
    const sessions: string[] = [];
    const events: unknown[] = [];
    const queryFn = ((request: ClaudeQueryRequest) => {
      captured.request = request;
      return queryFrom([
        initMessage(),
        successMessage({
          result: JSON.stringify(structuredOutput),
          structured_output: structuredOutput
        })
      ]);
    }) as ClaudeQuery;
    const agent = new ClaudeCodeAgent(baseSettings(), queryFn);

    const result = await agent.run(
      {
        purpose: "step_evaluation",
        permissionProfile: "read-only",
        prompt: "Evaluate the step.",
        workingDirectory: process.cwd(),
        outputSchema: schema,
        timeoutMs: 1_000
      },
      {
        onSessionStarted: (sessionId) => {
          sessions.push(sessionId);
        },
        onEvent: (event) => {
          events.push(event);
        }
      }
    );

    expect(captured.request?.options).toMatchObject({
      cwd: process.cwd(),
      permissionMode: "dontAsk",
      allowedTools: [...CLAUDE_EVALUATOR_ALLOWED_TOOLS],
      outputFormat: {
        type: "json_schema",
        schema
      }
    });
    expect(captured.request?.options?.disallowedTools).toEqual(
      expect.arrayContaining(["Write", "Edit", "MultiEdit", "Bash"])
    );
    expect(sessions).toEqual(["session-1"]);
    expect(events).toHaveLength(2);
    expect(result).toMatchObject({
      provider: "claude",
      sessionId: "session-1",
      threadId: "session-1",
      finalResponse: JSON.stringify(structuredOutput),
      structuredOutput
    });
    expect(result.usage).toMatchObject({
      usage: {
        input_tokens: 10,
        output_tokens: 3
      }
    });
  });

  it("throws AgentRunError on result errors and records turn.failed", async () => {
    const close = vi.fn();
    const events: Array<{ kind: string; status: string }> = [];
    const queryFn = (() => queryFrom([errorMessage()], close)) as ClaudeQuery;
    const agent = new ClaudeCodeAgent(baseSettings(), queryFn);

    let thrown: unknown;
    try {
      await agent.run(
        {
          purpose: "step_execution",
          permissionProfile: "workspace-write",
          prompt: "Implement the step.",
          workingDirectory: process.cwd(),
          timeoutMs: 1_000
        },
        {
          onEvent: (event) => {
            events.push({ kind: event.kind, status: event.status });
          }
        }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentRunError);
    expect(thrown).toMatchObject({
      provider: "claude",
      code: "claude_turn_failed",
      eventRecorded: true
    });
    expect(events).toEqual([{ kind: "turn.failed", status: "failed" }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("records permission denial events", async () => {
    const events: Array<{ status: string; payload: Record<string, unknown> }> = [];
    const queryFn = (() =>
      queryFrom([
        {
          type: "system",
          subtype: "permission_denied",
          tool_name: "Write",
          tool_use_id: "toolu-1",
          decision_reason: "read-only",
          message: "Write is not allowed.",
          uuid: "deny-1",
          session_id: "session-1"
        } as SDKMessage,
        successMessage()
      ])) as ClaudeQuery;
    const agent = new ClaudeCodeAgent(baseSettings(), queryFn);

    await agent.run(
      {
        purpose: "step_evaluation",
        permissionProfile: "read-only",
        prompt: "Evaluate the step.",
        workingDirectory: process.cwd(),
        timeoutMs: 1_000
      },
      {
        onEvent: (event) => {
          events.push({ status: event.status, payload: event.payload });
        }
      }
    );

    expect(events).toEqual([
      {
        status: "failed",
        payload: {
          agentProvider: "claude",
          itemType: "permission_denied",
          toolName: "Write",
          toolUseId: "toolu-1",
          message: "Write is not allowed.",
          decisionReason: "read-only"
        }
      },
      expect.objectContaining({
        status: "completed",
        payload: expect.objectContaining({
          agentProvider: "claude"
        })
      })
    ]);
  });
});
