import { readFile } from "node:fs/promises";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { StepDefinition } from "@workflow-software/shared";
import { z } from "zod";
import {
  buildCodexClientOptions,
  buildCodexEvaluatorThreadOptions,
  createOpenAICodexGateway,
  type CodexGateway,
  type CodexRuntimeSettings
} from "../codex/codex-client.js";
import { env } from "../config/env.js";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../generated/prisma/client.js";
import type {
  CodexRuntimePromptContext,
  PreparedOutputArtifact
} from "./artifact-runtime.js";

const MAX_EVALUATOR_ARTIFACT_CHARS = 20_000;

export const EVALUATOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: [
        DecisionVerdict.APPROVE,
        DecisionVerdict.REJECT,
        DecisionVerdict.REQUEST_REVISION
      ]
    },
    comment: {
      type: "string"
    }
  },
  required: ["verdict", "comment"]
} as const;

const EvaluatorOutputSchema = z
  .object({
    verdict: z.enum([
      DecisionVerdict.APPROVE,
      DecisionVerdict.REJECT,
      DecisionVerdict.REQUEST_REVISION
    ]),
    comment: z.string().min(1)
  })
  .strict();

export type EvaluatorDecision = {
  stepRunId: string;
  source: DecisionSource;
  verdict: DecisionVerdict;
  comment?: string;
};

export type EvaluateStepInput = {
  stepRunId: string;
  evaluator: StepRunEvaluator;
  workflowId: string;
  workflowRunId: string;
  step: StepDefinition;
  workingDirectory: string;
  artifactStoreRoot: string;
  codexFinalResponse?: string;
  runtimeContext?: CodexRuntimePromptContext;
  signal?: AbortSignal;
};

export type EvaluateStepResult = {
  decisions: EvaluatorDecision[];
  finalVerdict: DecisionVerdict;
};

export type EvaluatorRunnerDependencies = {
  gateway?: CodexGateway;
  settings?: CodexRuntimeSettings;
};

type ArtifactSnapshot = {
  artifact: string;
  filename: string;
  path: string;
  content: string;
  truncated: boolean;
};

export class CodexEvaluatorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CodexEvaluatorError";
  }
}

function runtimeSettings(): CodexRuntimeSettings {
  return {
    model: env.CODEX_MODEL,
    modelReasoningEffort: env.CODEX_REASONING_EFFORT,
    timeoutMs: env.CODEX_TURN_TIMEOUT_MS
  };
}

function defaultGateway() {
  return createOpenAICodexGateway(
    buildCodexClientOptions({
      apiKey: env.CODEX_API_KEY,
      baseUrl: env.CODEX_BASE_URL
    })
  );
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
    controller.abort(new Error(`Codex evaluator turn timed out after ${timeoutMs}ms`));
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
  input: EvaluateStepInput,
  timedOut: boolean
): CodexEvaluatorError {
  if (error instanceof CodexEvaluatorError) {
    return error;
  }

  if (timedOut) {
    return new CodexEvaluatorError(
      "evaluator_turn_timeout",
      "Codex evaluator turn exceeded the configured timeout",
      { cause: error }
    );
  }

  if (input.signal?.aborted) {
    return new CodexEvaluatorError(
      "evaluator_turn_aborted",
      "Codex evaluator turn was aborted",
      { cause: error }
    );
  }

  return new CodexEvaluatorError(
    "evaluator_execution_error",
    error instanceof Error ? error.message : "Codex evaluator execution failed",
    { cause: error }
  );
}

function failureFromTerminalEvent(event: ThreadEvent): CodexEvaluatorError | undefined {
  switch (event.type) {
    case "turn.failed":
      return new CodexEvaluatorError("evaluator_turn_failed", event.error.message);
    case "error":
      return new CodexEvaluatorError("evaluator_stream_error", event.message);
    default:
      return undefined;
  }
}

function truncateArtifactContent(content: string) {
  if (content.length <= MAX_EVALUATOR_ARTIFACT_CHARS) {
    return {
      content,
      truncated: false
    };
  }

  return {
    content: content.slice(0, MAX_EVALUATOR_ARTIFACT_CHARS),
    truncated: true
  };
}

async function readOutputArtifactSnapshot(
  outputArtifact: PreparedOutputArtifact
): Promise<ArtifactSnapshot> {
  const { content, truncated } = truncateArtifactContent(
    await readFile(outputArtifact.absolutePath, "utf8")
  );

  return {
    artifact: outputArtifact.artifact,
    filename: outputArtifact.filename,
    path: outputArtifact.promptPath,
    content,
    truncated
  };
}

async function readOutputArtifactSnapshots(
  runtimeContext: CodexRuntimePromptContext | undefined
) {
  if (!runtimeContext?.outputArtifacts.length) {
    console.log("[runtime.evaluator] artifacts.snapshot.skipped", {
      reason: "no_declared_output_artifacts"
    });
    return [];
  }

  console.log("[runtime.evaluator] artifacts.snapshot.start", {
    count: runtimeContext.outputArtifacts.length,
    artifacts: runtimeContext.outputArtifacts.map((artifact) => ({
      artifact: artifact.artifact,
      filename: artifact.filename,
      path: artifact.promptPath
    }))
  });
  const artifacts = await Promise.all(
    runtimeContext.outputArtifacts.map(readOutputArtifactSnapshot)
  );
  console.log("[runtime.evaluator] artifacts.snapshot.complete", {
    count: artifacts.length,
    truncated: artifacts.filter((artifact) => artifact.truncated).length
  });

  return artifacts;
}

function formatCriteria(criteria: string[]) {
  if (criteria.length === 0) {
    return "- No explicit acceptance criteria were declared.";
  }

  return criteria.map((criterion) => `- ${criterion}`).join("\n");
}

function formatArtifacts(artifacts: ArtifactSnapshot[]) {
  if (artifacts.length === 0) {
    return "No declared output artifacts were produced.";
  }

  return artifacts
    .map((artifact) =>
      [
        `### Artifact: ${artifact.artifact}`,
        "",
        JSON.stringify(
          {
            filename: artifact.filename,
            path: artifact.path,
            truncated: artifact.truncated
          },
          null,
          2
        ),
        "",
        "```",
        artifact.content,
        "```"
      ].join("\n")
    )
    .join("\n\n");
}

export function buildEvaluatorPrompt(
  input: EvaluateStepInput,
  artifacts: ArtifactSnapshot[]
) {
  return [
    "You are the evaluator for a completed workflow step.",
    "Review the step prompt, acceptance criteria, Codex final response, and declared artifact contents.",
    "Return JSON only. Use one of these verdict values: APPROVE, REJECT, REQUEST_REVISION.",
    "Use APPROVE only when the completed work satisfies the acceptance criteria.",
    "Use REQUEST_REVISION when the work is close but needs changes. Use REJECT when it should not continue.",
    "",
    "## Workflow",
    "",
    JSON.stringify(
      {
        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
        stepRunId: input.stepRunId,
        stepId: input.step.id,
        stepType: input.step.type,
        artifactStoreRoot: input.artifactStoreRoot
      },
      null,
      2
    ),
    "",
    "## Step Prompt",
    "",
    input.step.prompt,
    "",
    "## Acceptance Criteria",
    "",
    formatCriteria(input.step.acceptance.criteria),
    "",
    "## Codex Final Response",
    "",
    input.codexFinalResponse?.trim() || "(No Codex final response was captured.)",
    "",
    "## Declared Artifact Contents",
    "",
    formatArtifacts(artifacts),
    "",
    "## Required JSON Shape",
    "",
    JSON.stringify(
      {
        verdict: "APPROVE | REJECT | REQUEST_REVISION",
        comment: "Short rationale for the decision."
      },
      null,
      2
    )
  ].join("\n");
}

function parseEvaluatorOutput(finalResponse: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse);
  } catch (error) {
    throw new CodexEvaluatorError(
      "evaluator_invalid_json",
      "Codex evaluator returned invalid JSON",
      { cause: error }
    );
  }

  const result = EvaluatorOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CodexEvaluatorError(
      "evaluator_invalid_json",
      "Codex evaluator returned JSON that does not match the verdict schema",
      { cause: result.error }
    );
  }

  console.log("[runtime.evaluator] output.parsed", {
    verdict: result.data.verdict,
    commentLength: result.data.comment.length
  });

  return result.data;
}

async function runCodexEvaluator(
  input: EvaluateStepInput,
  dependencies: Required<EvaluatorRunnerDependencies>
): Promise<EvaluatorDecision> {
  console.log("[runtime.evaluator] codex_evaluator.start", {
    workflowId: input.workflowId,
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    stepId: input.step.id,
    evaluator: input.evaluator,
    workingDirectory: input.workingDirectory
  });
  const artifacts = await readOutputArtifactSnapshots(input.runtimeContext);
  const prompt = buildEvaluatorPrompt(input, artifacts);
  const threadOptions = buildCodexEvaluatorThreadOptions(
    input.workingDirectory,
    dependencies.settings
  );
  console.log("[runtime.evaluator] codex_evaluator.prompt.ready", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    promptLength: prompt.length,
    artifactCount: artifacts.length,
    model: threadOptions.model,
    modelReasoningEffort: threadOptions.modelReasoningEffort,
    sandboxMode: threadOptions.sandboxMode,
    approvalPolicy: threadOptions.approvalPolicy,
    timeoutMs: dependencies.settings.timeoutMs
  });
  const abortState = createRunAbortState(input.signal, dependencies.settings.timeoutMs);
  let finalResponse: string | undefined;
  let completed = false;
  let terminalFailure: CodexEvaluatorError | undefined;

  try {
    console.log("[runtime.evaluator] codex_evaluator.turn.start", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId
    });
    const events = await dependencies.gateway.runTurn({
      prompt,
      threadOptions,
      outputSchema: EVALUATOR_OUTPUT_SCHEMA,
      signal: abortState.signal
    });

    for await (const event of events) {
      if (event.type === "thread.started") {
        console.log("[runtime.evaluator] codex_evaluator.thread.started", {
          workflowRunId: input.workflowRunId,
          stepRunId: input.stepRunId,
          threadId: event.thread_id
        });
      }

      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
        console.log("[runtime.evaluator] codex_evaluator.agent_message.completed", {
          workflowRunId: input.workflowRunId,
          stepRunId: input.stepRunId,
          messageLength: finalResponse.length
        });
      }

      if (event.type === "turn.completed") {
        completed = true;
        console.log("[runtime.evaluator] codex_evaluator.turn.completed", {
          workflowRunId: input.workflowRunId,
          stepRunId: input.stepRunId,
          usage: event.usage
        });
      }

      terminalFailure ??= failureFromTerminalEvent(event);
      if (terminalFailure) {
        console.log("[runtime.evaluator] codex_evaluator.terminal_failure", {
          workflowRunId: input.workflowRunId,
          stepRunId: input.stepRunId,
          code: terminalFailure.code,
          message: terminalFailure.message
        });
        break;
      }
    }

    if (terminalFailure) {
      throw terminalFailure;
    }

    if (!completed) {
      throw new CodexEvaluatorError(
        "evaluator_stream_ended_without_completion",
        "Codex evaluator event stream ended before turn.completed"
      );
    }

    if (finalResponse === undefined) {
      throw new CodexEvaluatorError(
        "evaluator_final_response_missing",
        "Codex evaluator turn completed without an agent message"
      );
    }

    const output = parseEvaluatorOutput(finalResponse);

    console.log("[runtime.evaluator] codex_evaluator.complete", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      verdict: output.verdict,
      commentLength: output.comment.length
    });

    return {
      stepRunId: input.stepRunId,
      source: DecisionSource.EVALUATOR,
      verdict: output.verdict,
      comment: output.comment
    };
  } catch (error) {
    const evaluatorError = failureFromError(error, input, abortState.timedOut());
    console.log("[runtime.evaluator] codex_evaluator.failed", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      code: evaluatorError.code,
      message: evaluatorError.message
    });
    throw evaluatorError;
  } finally {
    abortState.dispose();
    console.log("[runtime.evaluator] codex_evaluator.cleanup", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId
    });
  }
}

export async function evaluateStepArtifact(
  input: EvaluateStepInput,
  dependencies: EvaluatorRunnerDependencies = {}
): Promise<EvaluateStepResult> {
  console.log("[runtime.evaluator] evaluate.start", {
    workflowId: input.workflowId,
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    stepId: input.step.id,
    evaluator: input.evaluator
  });

  if (input.evaluator === StepRunEvaluator.HUMAN_REVIEW) {
    console.log("[runtime.evaluator] human_review.defer_to_human", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId
    });
    console.log("[runtime.evaluator] evaluate.complete", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      finalVerdict: DecisionVerdict.APPROVE
    });
    return {
      decisions: [],
      finalVerdict: DecisionVerdict.APPROVE
    };
  }

  const resolvedDependencies: Required<EvaluatorRunnerDependencies> = {
    gateway: dependencies.gateway ?? defaultGateway(),
    settings: dependencies.settings ?? runtimeSettings()
  };
  const evaluatorDecision = await runCodexEvaluator(input, resolvedDependencies);
  console.log("[runtime.evaluator] evaluator_decision", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    source: evaluatorDecision.source,
    verdict: evaluatorDecision.verdict
  });

  if (
    input.evaluator === StepRunEvaluator.MIXED &&
    evaluatorDecision.verdict === DecisionVerdict.APPROVE
  ) {
    console.log("[runtime.evaluator] mixed.defer_to_human", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      evaluatorVerdict: evaluatorDecision.verdict,
      finalVerdict: DecisionVerdict.APPROVE
    });
    console.log("[runtime.evaluator] evaluate.complete", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      finalVerdict: DecisionVerdict.APPROVE
    });
    return {
      decisions: [evaluatorDecision],
      finalVerdict: DecisionVerdict.APPROVE
    };
  }

  console.log("[runtime.evaluator] evaluate.complete", {
    workflowRunId: input.workflowRunId,
    stepRunId: input.stepRunId,
    finalVerdict: evaluatorDecision.verdict
  });

  return {
    decisions: [evaluatorDecision],
    finalVerdict: evaluatorDecision.verdict
  };
}
