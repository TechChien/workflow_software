import { stat } from "node:fs/promises";
import path from "node:path";
import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import {
  buildCodexOptionsSnapshot,
  buildCodexThreadOptions,
  type CodexGateway,
  type CodexRuntimeSettings
} from "../codex/codex-client.js";
import { normalizeCodexEvent } from "../codex/codex-event-normalizer.js";
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

export type CodexExecutionResult = {
  stepRunId: string;
  threadId: string;
  finalResponse: string;
  usage: Usage;
};

export type CodexRuntimePromptOptions = {
  revisionRequestComment?: string;
};

export class CodexExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly eventRecorded = false,
    options?: ErrorOptions
  ) {
    super(message, options);
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
  timedOut: boolean
): CodexExecutionError {
  if (error instanceof CodexExecutionError) {
    return error;
  }

  if (timedOut) {
    return new CodexExecutionError(
      "codex_turn_timeout",
      "Codex turn exceeded the configured timeout",
      false,
      { cause: error }
    );
  }

  if (input.signal?.aborted) {
    return new CodexExecutionError("codex_turn_aborted", "Codex turn was aborted", false, {
      cause: error
    });
  }

  return new CodexExecutionError(
    "codex_execution_error",
    error instanceof Error ? error.message : "Codex execution failed",
    false,
    { cause: error }
  );
}

function failureFromTerminalEvent(event: ThreadEvent): CodexExecutionError | undefined {
  switch (event.type) {
    case "turn.failed":
      return new CodexExecutionError("codex_turn_failed", event.error.message, true);
    case "error":
      return new CodexExecutionError("codex_stream_error", event.message, true);
    default:
      return undefined;
  }
}

async function persistFailure(
  recorder: CodexRunRecorder,
  stepRunId: string,
  attempt: number,
  sequence: number,
  error: CodexExecutionError
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
        payload: failure
      });
    }
  } finally {
    await recorder.markFailed(stepRunId, failure);
  }
}

export async function executeStepRunWithCodexCore(
  input: ExecuteStepRunWithCodexInput,
  dependencies: CodexExecutorDependencies
): Promise<CodexExecutionResult> {
  console.log("[runtime.codex-executor] start", {
    stepRunId: input.stepRunId,
    workingDirectory: input.workingDirectory,
  });
  await assertWorkingDirectory(input.workingDirectory);
  console.log("[runtime.codex-executor] working_directory.valid", {
    stepRunId: input.stepRunId,
    workingDirectory: input.workingDirectory,
  });

  const source = await dependencies.recorder.loadSource(input.stepRunId);
  console.log("[runtime.codex-executor] source.loaded", {
    stepRunId: input.stepRunId,
    workflowStepId: source.stepId,
    contentHash: source.contentHash,
  });
  const {
    stepType,
    prompt: workflowPrompt,
    acceptanceCriteria,
  } = resolveCodexStepPrompt(source);
  console.log("[runtime.codex-executor] prompt.resolved", {
    stepRunId: input.stepRunId,
    workflowStepId: source.stepId,
    stepType,
    promptLength: workflowPrompt.length,
    acceptanceCriteriaCount: acceptanceCriteria.length,
    runtimeContext: input.runtimeContext
      ? {
          contextPaths: input.runtimeContext.contextPaths.length,
          inputArtifacts: input.runtimeContext.inputArtifacts.length,
          outputArtifacts: input.runtimeContext.outputArtifacts.length,
        }
      : undefined,
  });
  const prompt = buildCodexRuntimePrompt(
    workflowPrompt,
    acceptanceCriteria,
    input.runtimeContext,
    { revisionRequestComment: source.revisionRequestComment }
  );
  const threadOptions = buildCodexThreadOptions(input.workingDirectory, dependencies.settings, {
    additionalDirectories: buildCodexAdditionalDirectories(input.runtimeContext)
  });

  await dependencies.recorder.markStarted({
    stepRunId: input.stepRunId,
    promptSnapshot: prompt,
    codexOptions: buildCodexOptionsSnapshot(threadOptions)
  });
  console.log("[runtime.codex-executor] recorder.mark_started", {
    stepRunId: input.stepRunId,
    promptSnapshotLength: prompt.length,
    model: threadOptions.model,
    modelReasoningEffort: threadOptions.modelReasoningEffort,
    sandboxMode: threadOptions.sandboxMode,
    approvalPolicy: threadOptions.approvalPolicy,
    additionalDirectories:
      "additionalDirectories" in threadOptions &&
      Array.isArray(threadOptions.additionalDirectories)
        ? threadOptions.additionalDirectories.length
        : 0,
  });

  const abortState = createRunAbortState(input.signal, dependencies.settings.timeoutMs);
  let sequence = 0;
  let threadId: string | undefined;
  let finalResponse: string | undefined;
  let usage: Usage | undefined;
  let completed = false;
  let terminalFailure: CodexExecutionError | undefined;

  try {
    console.log("[runtime.codex-executor] turn.start", {
      stepRunId: input.stepRunId,
      timeoutMs: dependencies.settings.timeoutMs,
    });
    const events = await dependencies.gateway.runTurn({
      prompt,
      threadOptions,
      signal: abortState.signal
    });

    for await (const event of events) {
      if (event.type === "thread.started") {
        threadId = event.thread_id;
        console.log("[runtime.codex-executor] thread.started", {
          stepRunId: input.stepRunId,
          threadId,
        });
        await dependencies.recorder.recordThreadStarted(input.stepRunId, event.thread_id);
        continue;
      }

      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
        console.log("[runtime.codex-executor] agent_message.completed", {
          stepRunId: input.stepRunId,
          messageLength: finalResponse.length,
        });
      }

      const normalized = normalizeCodexEvent(event);
      if (normalized) {
        sequence += 1;
        console.log("[runtime.codex-executor] event.record", {
          stepRunId: input.stepRunId,
          sequence,
          eventType: event.type,
          kind: normalized.kind,
          status: normalized.status,
          externalItemId: normalized.externalItemId,
        });
        await dependencies.recorder.appendEvent(input.stepRunId, {
          attempt: source.attempt,
          sequence,
          ...normalized
        });
      }

      if (event.type === "turn.completed") {
        usage = event.usage;
        completed = true;
        console.log("[runtime.codex-executor] turn.completed", {
          stepRunId: input.stepRunId,
          usage,
        });
      }

      terminalFailure ??= failureFromTerminalEvent(event);
      if (terminalFailure) {
        console.log("[runtime.codex-executor] terminal_failure", {
          stepRunId: input.stepRunId,
          code: terminalFailure.code,
          message: terminalFailure.message,
        });
        break;
      }
    }

    if (terminalFailure) {
      throw terminalFailure;
    }

    if (!completed || !usage) {
      throw new CodexExecutionError(
        "codex_stream_ended_without_completion",
        "Codex event stream ended before turn.completed"
      );
    }

    if (!threadId) {
      throw new CodexExecutionError(
        "codex_thread_id_missing",
        "Codex event stream completed without thread.started"
      );
    }

    if (finalResponse === undefined) {
      throw new CodexExecutionError(
        "codex_final_response_missing",
        "Codex turn completed without an agent message"
      );
    }

    await dependencies.recorder.markCompleted({
      stepRunId: input.stepRunId,
      finalResponse,
      usage
    });
    console.log("[runtime.codex-executor] recorder.mark_completed", {
      stepRunId: input.stepRunId,
      threadId,
      finalResponseLength: finalResponse.length,
      usage,
    });

    return {
      stepRunId: input.stepRunId,
      threadId,
      finalResponse,
      usage
    };
  } catch (error) {
    const executionError = failureFromError(error, input, abortState.timedOut());
    console.log("[runtime.codex-executor] failed", {
      stepRunId: input.stepRunId,
      code: executionError.code,
      message: executionError.message,
      eventRecorded: executionError.eventRecorded,
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
    console.log("[runtime.codex-executor] cleanup", {
      stepRunId: input.stepRunId,
    });
  }
}
