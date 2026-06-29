import type { AgentPermissionProfile, AgentRunRequest } from "../agents/agent.js";
import { claudeCodeAgentSettings } from "../agents/agent-factory.js";
import { ClaudeCodeAgent } from "../agents/claude-code-agent.js";
import { env } from "../config/env.js";

const SMOKE_MARKER = "CLAUDE_SMOKE_DONE";

type SmokeArgs = {
  permissionProfile: AgentPermissionProfile;
  prompt: string;
  timeoutMs: number;
};

function parseArgs(args: string[]): SmokeArgs {
  let permissionProfile: AgentPermissionProfile = "read-only";
  let timeoutMs = env.AGENT_TURN_TIMEOUT_MS;
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--workspace-write") {
      permissionProfile = "workspace-write";
      continue;
    }

    if (arg === "--read-only") {
      permissionProfile = "read-only";
      continue;
    }

    if (arg === "--timeout-ms") {
      const next = args[index + 1];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms requires a positive integer value");
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }

    promptParts.push(arg);
  }

  const customPrompt = promptParts.join(" ").trim();
  const prompt =
    customPrompt.length > 0
      ? `${customPrompt}\n\nFinish the final response with ${SMOKE_MARKER}.`
      : [
          "Inspect the current workspace using read-only tools.",
          "Reply with one short sentence describing the project.",
          "Do not modify files.",
          `Finish the final response with ${SMOKE_MARKER}.`
        ].join("\n");

  return {
    permissionProfile,
    prompt,
    timeoutMs
  };
}

const args = parseArgs(process.argv.slice(2));
const workingDirectory = process.cwd();
const agent = new ClaudeCodeAgent(claudeCodeAgentSettings());
const controller = new AbortController();
const request: AgentRunRequest = {
  purpose:
    args.permissionProfile === "read-only" ? "step_evaluation" : "step_execution",
  permissionProfile: args.permissionProfile,
  prompt: args.prompt,
  workingDirectory,
  timeoutMs: args.timeoutMs,
  signal: controller.signal
};
const timer = setTimeout(
  () =>
    controller.abort(
      new Error(`Claude smoke turn timed out after ${args.timeoutMs}ms`)
    ),
  args.timeoutMs
);

try {
  console.log(
    JSON.stringify({
      type: "claude.smoke.options",
      ...agent.optionsSnapshot(request)
    })
  );

  const result = await agent.run(request, {
    onSessionStarted: (sessionId) => {
      console.log(JSON.stringify({ type: "claude.smoke.session", sessionId }));
    },
    onEvent: (event) => {
      console.log(JSON.stringify(event));
    }
  });

  console.log(
    JSON.stringify({
      type: "claude.smoke.result",
      provider: result.provider,
      sessionId: result.sessionId,
      threadId: result.threadId,
      finalResponse: result.finalResponse,
      usage: result.usage
    })
  );

  if (!result.finalResponse.includes(SMOKE_MARKER)) {
    throw new Error(`Claude smoke response did not include ${SMOKE_MARKER}`);
  }
} finally {
  clearTimeout(timer);
}
