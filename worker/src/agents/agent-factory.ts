import {
  buildCodexClientOptions,
  createOpenAICodexGateway,
  type CodexRuntimeSettings
} from "../codex/codex-client.js";
import { env } from "../config/env.js";
import { ClaudeCodeAgent, type ClaudeCodeAgentSettings } from "./claude-code-agent.js";
import { CodexAgent } from "./codex-agent.js";
import type { AgentProvider, IAgent } from "./agent.js";

export type AgentRuntime = {
  agent: IAgent;
  timeoutMs: number;
};

export function createExecutorAgentRuntime(): AgentRuntime {
  return createAgentRuntime(env.AGENT_EXECUTOR);
}

export function createEvaluatorAgentRuntime(): AgentRuntime {
  return createAgentRuntime(env.AGENT_EVALUATOR);
}

export function createAgentRuntime(provider: AgentProvider): AgentRuntime {
  if (provider === "codex") {
    const settings = codexRuntimeSettings();
    return {
      agent: new CodexAgent(
        createOpenAICodexGateway(
          buildCodexClientOptions({
            apiKey: env.CODEX_API_KEY,
            baseUrl: env.CODEX_BASE_URL
          })
        ),
        settings
      ),
      timeoutMs: settings.timeoutMs
    };
  }

  return {
    agent: new ClaudeCodeAgent(claudeCodeAgentSettings()),
    timeoutMs: env.AGENT_TURN_TIMEOUT_MS
  };
}

export function codexRuntimeSettings(): CodexRuntimeSettings {
  return {
    model: env.CODEX_MODEL,
    modelReasoningEffort: env.CODEX_REASONING_EFFORT,
    timeoutMs: env.CODEX_TURN_TIMEOUT_MS
  };
}

export function claudeCodeAgentSettings(): ClaudeCodeAgentSettings {
  return {
    model: env.CLAUDE_MODEL,
    effort: env.CLAUDE_EFFORT,
    permissionMode: env.CLAUDE_PERMISSION_MODE,
    allowedTools: env.CLAUDE_ALLOWED_TOOLS,
    disallowedTools: env.CLAUDE_DISALLOWED_TOOLS,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
    envOverrides: claudeEnvOverrides()
  };
}

function claudeEnvOverrides() {
  return {
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:
      env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:
      env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS,
    CLAUDE_CODE_DISABLE_THINKING: env.CLAUDE_CODE_DISABLE_THINKING,
    CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT,
    API_TIMEOUT_MS: env.API_TIMEOUT_MS
  };
}
