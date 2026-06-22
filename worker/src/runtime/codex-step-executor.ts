import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  CodexGateway,
  CodexRuntimeSettings
} from "../codex/codex-client.js";
import {
  AgentRunError,
  type AgentRunRequest,
  type AgentRunResult,
  type IAgent
} from "../agents/agent.js";
import { CodexAgent } from "../agents/codex-agent.js";
import type {
  CodexRunFailure,
  CodexRunRecorder,
  CodexStepRunSource
} from "../codex/codex-run-recorder.js";
import type { CodexRuntimePromptContext } from "./artifact-runtime.js";
import { parseVerifiedWorkflowSnapshot } from "./workflow-definition.js";

export type ExecuteStepRunWithCodexInput = {
  stepRunId: string;
  workingDirectory: string;
  runtimeContext?: CodexRuntimePromptContext;
  signal?: AbortSignal;
};

export type CodexExecutorDependencies = {
  gateway: CodexGateway;
  recorder: CodexRunRecorder;
  settings: CodexRuntimeSettings;
};

export type AgentExecutorDependencies = {
  agent: IAgent;
  recorder: CodexRunRecorder;
  timeoutMs: number;
};

export type AgentExecutionResult = AgentRunResult & {
  stepRunId: string;
};

export type CodexExecutionResult = AgentExecutionResult;

export type CodexRuntimePromptOptions = {
  revisionRequestComment?: string;
};

export class CodexExecutionError extends AgentRunError {
  constructor(
    readonly code: string,
    message: string,
    readonly eventRecorded = false,
    options?: ErrorOptions
  ) {
    super("codex", code, message, eventRecorded, options);
    this.name = "CodexExecutionError";
  }
}

export function resolveCodexStepPrompt(source: CodexStepRunSource) {
  const workflow = parseVerifiedWorkflowSnapshot(source.yamlSnapshot, source.contentHash);
  const step = workflow.steps.find((candidate) => candidate.id === source.stepId);

  if (!step) {
    throw new CodexExecutionError(
      "codex_step_missing",
      `Published workflow snapshot does not contain step ${source.stepId}`
    );
  }

  if (step.type !== "agent" && step.type !== "code_agent") {
    throw new CodexExecutionError(
      "codex_step_type_unsupported",
      `Step ${source.stepId} has unsupported Codex step type ${step.type}`
    );
  }

  if (!step.prompt.trim()) {
    throw new CodexExecutionError(
      "codex_prompt_empty",
      `Step ${source.stepId} has an empty Codex prompt`
    );
  }

  return {
    stepType: step.type,
    prompt: step.prompt,
    acceptanceCriteria: step.acceptance.criteria
  };
}

function hasRuntimeContext(context: CodexRuntimePromptContext | undefined) {
  return (
    context !== undefined &&
    (context.contextPaths.length > 0 ||
      context.inputArtifacts.length > 0 ||
      context.outputArtifacts.length > 0)
  );
}

function formatRuntimePromptList(entries: Array<Record<string, unknown>>) {
  return JSON.stringify(entries, null, 2);
}

function formatAcceptanceCriteria(criteria: string[]) {
  return criteria.map((criterion) => `- ${criterion}`).join("\n");
}

export function buildCodexRuntimePrompt(
  prompt: string,
  acceptanceCriteria: string[] = [],
  context: CodexRuntimePromptContext | undefined = undefined,
  options: CodexRuntimePromptOptions = {}
) {
  const hasAcceptanceCriteria = acceptanceCriteria.length > 0;
  const revisionRequestComment = options.revisionRequestComment?.trim();

  if (!hasRuntimeContext(context) && !hasAcceptanceCriteria && !revisionRequestComment) {
    return prompt;
  }

  const sections: string[] = [];

  if (hasRuntimeContext(context)) {
    const runtimeContext = context as CodexRuntimePromptContext;

    sections.push(
      "## Workflow Runtime Contract",
      "",
      "Declared output artifacts are authoritative. If the step prompt mentions another output filename, ignore that filename and produce only the declared artifact files below.",
      "Do not invent additional artifact outputs. Extra files mentioned by the prompt are workspace side effects and will not be accepted as artifacts.",
      "",
      "### Context Paths",
      formatRuntimePromptList(
        runtimeContext.contextPaths.map((contextPath) => ({
          path: contextPath.promptPath,
          type: contextPath.type
        }))
      ),
      "",
      "### Input Artifacts",
      formatRuntimePromptList(
        runtimeContext.inputArtifacts.map((artifact) => ({
          artifact: artifact.artifact,
          version: artifact.version,
          path: artifact.promptPath
        }))
      ),
      "",
      "### Output Artifacts",
      formatRuntimePromptList(
        runtimeContext.outputArtifacts.map((artifact) => ({
          artifact: artifact.artifact,
          filename: artifact.filename,
          path: artifact.promptPath
        }))
      ),
      "",
      "Write every declared output artifact to its exact path before finishing the turn.",
      ""
    );
  }

  if (hasAcceptanceCriteria) {
    sections.push(
      "## Acceptance Criteria",
      "",
      formatAcceptanceCriteria(acceptanceCriteria),
      "",
      "Complete the step so the finished work satisfies every acceptance criterion.",
      ""
    );
  }

  if (revisionRequestComment) {
    sections.push(
      "## Review Feedback",
      "",
      "A reviewer rejected or requested changes to the previous attempt. Address this feedback while still satisfying the original step prompt and acceptance criteria.",
      "",
      revisionRequestComment,
      ""
    );
  }

  sections.push("## Step Prompt", "", prompt);

  return sections.join("\n");
}

export function buildCodexAdditionalDirectories(
  context: CodexRuntimePromptContext | undefined
) {
  if (!context?.contextPaths.length) {
    return [];
  }

  return [
    ...new Set(
      context.contextPaths.map((contextPath) =>
        contextPath.type === "directory"
          ? contextPath.absolutePath
          : path.dirname(contextPath.absolutePath)
      )
    )
  ];
}

async function assertWorkingDirectory(workingDirectory: string) {
  if (!path.isAbsolute(workingDirectory)) {
    throw new CodexExecutionError(
      "codex_working_directory_not_absolute",
      "Codex workingDirectory must be an absolute path"
    );
  }

  try {
    const info = await stat(workingDirectory);
    if (!info.isDirectory()) {
      throw new Error("path is not a directory");
    }
  } catch (error) {
    throw new CodexExecutionError(
      "codex_working_directory_invalid",
      `Codex workingDirectory is missing or is not a directory: ${workingDirectory}`,
      false,
      { cause: error }
    );
  }
}

function createRunAbortState(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Codex turn timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

function failureFromError(
  error: unknown,
  input: ExecuteStepRunWithCodexInput,
  timedOut: boolean,
  agent: IAgent
): AgentRunError {
  if (error instanceof AgentRunError) {
    return error;
  }

  if (timedOut) {
    return new AgentRunError(
      agent.provider,
      `${agent.provider}_turn_timeout`,
      `${agent.provider} turn exceeded the configured timeout`,
      false,
      { cause: error }
    );
  }

  if (input.signal?.aborted) {
    return new AgentRunError(
      agent.provider,
      `${agent.provider}_turn_aborted`,
      `${agent.provider} turn was aborted`,
      false,
      { cause: error }
    );
  }

  return new AgentRunError(
    agent.provider,
    `${agent.provider}_execution_error`,
    error instanceof Error ? error.message : `${agent.provider} execution failed`,
    false,
    { cause: error }
  );
}

async function persistFailure(
  recorder: CodexRunRecorder,
  stepRunId: string,
  attempt: number,
  sequence: number,
  error: AgentRunError
) {
  const failure: CodexRunFailure = {
    code: error.code,
    message: error.message
  };

  try {
    if (!error.eventRecorded) {
      await recorder.appendEvent(stepRunId, {
        attempt,
        sequence,
        kind: "error",
        status: "failed",
        payload: {
          agentProvider: error.provider,
          ...failure
        }
      });
    }
  } finally {
    await recorder.markFailed(stepRunId, failure);
  }
}

export async function executeStepRunWithAgentCore(
  input: ExecuteStepRunWithCodexInput,
  dependencies: AgentExecutorDependencies
): Promise<AgentExecutionResult> {
  console.log("[runtime.agent-executor] start", {
    stepRunId: input.stepRunId,
    provider: dependencies.agent.provider,
    workingDirectory: input.workingDirectory
  });
  await assertWorkingDirectory(input.workingDirectory);
  console.log("[runtime.agent-executor] working_directory.valid", {
    stepRunId: input.stepRunId,
    workingDirectory: input.workingDirectory
  });

  const source = await dependencies.recorder.loadSource(input.stepRunId);
  console.log("[runtime.agent-executor] source.loaded", {
    stepRunId: input.stepRunId,
    workflowStepId: source.stepId,
    contentHash: source.contentHash
  });
  const {
    stepType,
    prompt: workflowPrompt,
    acceptanceCriteria
  } = resolveCodexStepPrompt(source);
  console.log("[runtime.agent-executor] prompt.resolved", {
    stepRunId: input.stepRunId,
    workflowStepId: source.stepId,
    stepType,
    promptLength: workflowPrompt.length,
    acceptanceCriteriaCount: acceptanceCriteria.length,
    runtimeContext: input.runtimeContext
      ? {
          contextPaths: input.runtimeContext.contextPaths.length,
          inputArtifacts: input.runtimeContext.inputArtifacts.length,
          outputArtifacts: input.runtimeContext.outputArtifacts.length
        }
      : undefined
  });
  const prompt = buildCodexRuntimePrompt(
    workflowPrompt,
    acceptanceCriteria,
    input.runtimeContext,
    { revisionRequestComment: source.revisionRequestComment }
  );
  const request: AgentRunRequest = {
    purpose: "step_execution",
    permissionProfile: "workspace-write",
    prompt,
    workingDirectory: input.workingDirectory,
    additionalDirectories: buildCodexAdditionalDirectories(input.runtimeContext),
    timeoutMs: dependencies.timeoutMs
  };

  await dependencies.recorder.markStarted({
    stepRunId: input.stepRunId,
    promptSnapshot: prompt,
    codexOptions: dependencies.agent.optionsSnapshot(request)
  });
  console.log("[runtime.agent-executor] recorder.mark_started", {
    stepRunId: input.stepRunId,
    provider: dependencies.agent.provider,
    promptSnapshotLength: prompt.length,
    timeoutMs: dependencies.timeoutMs,
    additionalDirectories: request.additionalDirectories?.length ?? 0
  });

  const abortState = createRunAbortState(input.signal, dependencies.timeoutMs);
  let sequence = 0;
  let sessionRecorded = false;

  try {
    console.log("[runtime.agent-executor] turn.start", {
      stepRunId: input.stepRunId,
      provider: dependencies.agent.provider,
      timeoutMs: dependencies.timeoutMs
    });
    const result = await dependencies.agent.run(
      {
        ...request,
        signal: abortState.signal
      },
      {
        onSessionStarted: async (sessionId) => {
          if (sessionRecorded) {
            return;
          }

          sessionRecorded = true;
          console.log("[runtime.agent-executor] session.started", {
            stepRunId: input.stepRunId,
            provider: dependencies.agent.provider,
            sessionId
          });
          await dependencies.recorder.recordThreadStarted(input.stepRunId, sessionId);
        },
        onEvent: async (event) => {
          sequence += 1;
          console.log("[runtime.agent-executor] event.record", {
            stepRunId: input.stepRunId,
            sequence,
            provider: dependencies.agent.provider,
            kind: event.kind,
            status: event.status,
            externalItemId: event.externalItemId
          });
          await dependencies.recorder.appendEvent(input.stepRunId, {
            attempt: source.attempt,
            sequence,
            ...event
          });
        }
      }
    );

    if (!sessionRecorded) {
      await dependencies.recorder.recordThreadStarted(input.stepRunId, result.sessionId);
    }

    await dependencies.recorder.markCompleted({
      stepRunId: input.stepRunId,
      finalResponse: result.finalResponse,
      usage: result.usage
    });
    console.log("[runtime.agent-executor] recorder.mark_completed", {
      stepRunId: input.stepRunId,
      provider: dependencies.agent.provider,
      sessionId: result.sessionId,
      finalResponseLength: result.finalResponse.length,
      usage: result.usage
    });

    return {
      stepRunId: input.stepRunId,
      ...result
    };
  } catch (error) {
    const executionError = failureFromError(
      error,
      input,
      abortState.timedOut(),
      dependencies.agent
    );
    console.log("[runtime.agent-executor] failed", {
      stepRunId: input.stepRunId,
      provider: dependencies.agent.provider,
      code: executionError.code,
      message: executionError.message,
      eventRecorded: executionError.eventRecorded
    });
    await persistFailure(
      dependencies.recorder,
      input.stepRunId,
      source.attempt,
      sequence + 1,
      executionError
    );
    throw executionError;
  } finally {
    abortState.dispose();
    console.log("[runtime.agent-executor] cleanup", {
      stepRunId: input.stepRunId,
      provider: dependencies.agent.provider
    });
  }
}

export async function executeStepRunWithCodexCore(
  input: ExecuteStepRunWithCodexInput,
  dependencies: CodexExecutorDependencies
): Promise<CodexExecutionResult> {
  return executeStepRunWithAgentCore(input, {
    agent: new CodexAgent(dependencies.gateway, dependencies.settings),
    recorder: dependencies.recorder,
    timeoutMs: dependencies.settings.timeoutMs
  });
}
