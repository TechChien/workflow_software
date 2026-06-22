import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS,
  DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS
} from "../src/agents/claude-code-agent.js";
import { parseWorkerEnv } from "../src/config/env.js";

describe("parseWorkerEnv", () => {
  it("defaults executor and evaluator strategies to Claude", () => {
    const parsed = parseWorkerEnv({});

    expect(parsed.AGENT_EXECUTOR).toBe("claude");
    expect(parsed.AGENT_EVALUATOR).toBe("claude");
    expect(parsed.AGENT_TURN_TIMEOUT_MS).toBe(1_800_000);
    expect(parsed.CLAUDE_PERMISSION_MODE).toBe("acceptEdits");
    expect(parsed.CLAUDE_ALLOWED_TOOLS).toEqual([
      ...DEFAULT_CLAUDE_EXECUTOR_ALLOWED_TOOLS
    ]);
    expect(parsed.CLAUDE_DISALLOWED_TOOLS).toEqual([
      ...DEFAULT_CLAUDE_EXECUTOR_DISALLOWED_TOOLS
    ]);
  });

  it("parses strategy, gateway, Claude tools, and gateway knobs", () => {
    const parsed = parseWorkerEnv({
      AGENT_EXECUTOR: "codex",
      AGENT_EVALUATOR: "codex",
      ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
      CLAUDE_MODEL: "claude-test",
      CLAUDE_EFFORT: "high",
      CLAUDE_PERMISSION_MODE: "auto",
      CLAUDE_ALLOWED_TOOLS: "Read, Grep",
      CLAUDE_DISALLOWED_TOOLS: "WebFetch, WebSearch",
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "true",
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      CLAUDE_CODE_DISABLE_THINKING: "true",
      CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: "true",
      API_TIMEOUT_MS: "120000"
    });

    expect(parsed.AGENT_EXECUTOR).toBe("codex");
    expect(parsed.AGENT_EVALUATOR).toBe("codex");
    expect(parsed.ANTHROPIC_BASE_URL).toBe("https://gateway.example.test/v1");
    expect(parsed.CLAUDE_MODEL).toBe("claude-test");
    expect(parsed.CLAUDE_EFFORT).toBe("high");
    expect(parsed.CLAUDE_PERMISSION_MODE).toBe("auto");
    expect(parsed.CLAUDE_ALLOWED_TOOLS).toEqual(["Read", "Grep"]);
    expect(parsed.CLAUDE_DISALLOWED_TOOLS).toEqual(["WebFetch", "WebSearch"]);
    expect(parsed.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe("true");
    expect(parsed.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe("1");
    expect(parsed.CLAUDE_CODE_DISABLE_THINKING).toBe("true");
    expect(parsed.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT).toBe("true");
    expect(parsed.API_TIMEOUT_MS).toBe("120000");
  });
});
