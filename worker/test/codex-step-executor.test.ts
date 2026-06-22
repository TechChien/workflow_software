import path from "node:path";
import type {
  ThreadEvent,
  ThreadOptions,
  Usage
} from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import type {
  CodexGateway,
  CodexTurnRequest
} from "../src/codex/codex-client.js";
import type {
  CodexRunFailure,
  CodexRunRecorder,
  CodexStepRunSource,
  RecordedCodexEvent
} from "../src/codex/codex-run-recorder.js";
import {
  buildCodexAdditionalDirectories,
  buildCodexRuntimePrompt,
  executeStepRunWithCodexCore,
  type CodexExecutorDependencies
} from "../src/runtime/codex-step-executor.js";
import { canonicalizeWorkflowDefinition } from "../src/runtime/workflow-definition.js";

const usage: Usage = {
  input_tokens: 10,
  cached_input_tokens: 2,
  output_tokens: 5,
  reasoning_output_tokens: 1
};

function sourceFor(
  prompt: string,
  type: "agent" | "code_agent" = "agent",
  acceptanceCriteria: string[] = [],
  revisionRequestComment?: string
) {
  const snapshot = canonicalizeWorkflowDefinition({
    id: "workflow-1",
    name: "Codex test workflow",
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps: [
      {
        id: "step-1",
        type,
        input_artifacts: [],
        output_artifacts: [],
        context_paths: [],
        tool_capabilities: [],
        prompt,
        evaluate: {
          evaluator: "mixed",
          rerun: false
        },
        acceptance: { criteria: acceptanceCriteria }
      }
    ],
    ui: {}
  });

  return {
    stepId: "step-1",
    attempt: revisionRequestComment ? 2 : 1,
    yamlSnapshot: snapshot.yaml,
    contentHash: snapshot.contentHash,
    revisionRequestComment
  };
}

class MemoryRecorder implements CodexRunRecorder {
  started?: {
    stepRunId: string;
    promptSnapshot: string;
    codexOptions: Record<string, unknown>;
  };
  threadId?: string;
  events: RecordedCodexEvent[] = [];
  completed?: { stepRunId: string; finalResponse: string; usage: Usage };
  failed?: { stepRunId: string; failure: CodexRunFailure };

  constructor(readonly source: CodexStepRunSource) {}

  async loadSource() {
    return this.source;
  }

  async markStarted(input: {
    stepRunId: string;
    promptSnapshot: string;
    codexOptions: Record<string, unknown>;
  }) {
    this.started = input;
  }

  async recordThreadStarted(_stepRunId: string, threadId: string) {
    this.threadId = threadId;
  }

  async appendEvent(_stepRunId: string, event: RecordedCodexEvent) {
    this.events.push(event);
  }

  async markCompleted(input: { stepRunId: string; finalResponse: string; usage: Usage }) {
    this.completed = input;
  }

  async markFailed(stepRunId: string, failure: CodexRunFailure) {
    this.failed = { stepRunId, failure };
  }
}

class FakeGateway implements CodexGateway {
  requests: CodexTurnRequest[] = [];

  constructor(private readonly eventFactory: (request: CodexTurnRequest) => AsyncIterable<ThreadEvent>) {}

  async runTurn(request: CodexTurnRequest) {
    this.requests.push(request);
    return this.eventFactory(request);
  }
}

function eventStream(...events: ThreadEvent[]): AsyncIterable<ThreadEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function dependencies(
  recorder: MemoryRecorder,
  gateway: FakeGateway,
  timeoutMs = 1_000
): CodexExecutorDependencies {
  return {
    recorder,
    gateway,
    settings: {
      model: "codex-test-model",
      modelReasoningEffort: "high",
      timeoutMs
    }
  };
}

function successfulEvents(): ThreadEvent[] {
  return [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    {
      type: "item.started",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "not persisted from started",
        status: "in_progress"
      }
    },
    {
      type: "item.completed",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "SECRET_COMMAND_OUTPUT",
        exit_code: 0,
        status: "completed"
      }
    },
    {
      type: "item.completed",
      item: {
        id: "mcp-1",
        type: "mcp_tool_call",
        server: "example",
        tool: "lookup",
        arguments: { token: "SECRET_MCP_ARGUMENT" },
        status: "completed"
      }
    },
    {
      type: "item.completed",
      item: {
        id: "message-1",
        type: "agent_message",
        text: "Completed successfully."
      }
    },
    { type: "turn.completed", usage }
  ];
}

describe("executeStepRunWithCodexCore", () => {
  it.each(["agent", "code_agent"] as const)(
    "uses workspace-write without approval pauses for %s steps",
    async (stepType) => {
      const recorder = new MemoryRecorder(sourceFor("Use workspace-write.", stepType));
      const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

      await executeStepRunWithCodexCore(
        {
          stepRunId: `step-run-${stepType}`,
          workingDirectory: process.cwd()
        },
        dependencies(recorder, gateway)
      );

      expect(gateway.requests[0]?.threadOptions).toMatchObject({
        sandboxMode: "workspace-write",
        approvalPolicy: "never"
      });
    }
  );

  it("runs the immutable workflow prompt with the fixed workspace-write policy", async () => {
    const recorder = new MemoryRecorder(sourceFor("Use the published prompt exactly."));
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    const result = await executeStepRunWithCodexCore(
      {
        stepRunId: "step-run-1",
        workingDirectory: process.cwd()
      },
      dependencies(recorder, gateway)
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]?.prompt).toBe("Use the published prompt exactly.");
    expect(gateway.requests[0]?.threadOptions).toMatchObject({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      model: "codex-test-model",
      modelReasoningEffort: "high"
    } satisfies ThreadOptions);
    expect(recorder.started?.promptSnapshot).toBe("Use the published prompt exactly.");
    expect(recorder.threadId).toBe("thread-1");
    expect(recorder.events.map((event) => event.kind)).toEqual([
      "item.completed",
      "item.completed",
      "item.completed",
      "turn.completed"
    ]);
    expect(JSON.stringify(recorder.events)).not.toContain("SECRET_COMMAND_OUTPUT");
    expect(JSON.stringify(recorder.events)).not.toContain("SECRET_MCP_ARGUMENT");
    expect(recorder.completed).toEqual({
      stepRunId: "step-run-1",
      finalResponse: "Completed successfully.",
      usage
    });
    expect(recorder.failed).toBeUndefined();
    expect(result.threadId).toBe("thread-1");
  });

  it("adds acceptance criteria from the published workflow step", async () => {
    const recorder = new MemoryRecorder(
      sourceFor("Write the release summary.", "agent", [
        "The summary names each shipped feature.",
        "The summary calls out any unresolved risks."
      ])
    );
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    await executeStepRunWithCodexCore(
      {
        stepRunId: "step-run-criteria",
        workingDirectory: process.cwd()
      },
      dependencies(recorder, gateway)
    );

    expect(gateway.requests[0]?.prompt).toContain("## Acceptance Criteria");
    expect(gateway.requests[0]?.prompt).toContain(
      "- The summary names each shipped feature."
    );
    expect(gateway.requests[0]?.prompt).toContain(
      "- The summary calls out any unresolved risks."
    );
    expect(gateway.requests[0]?.prompt).toContain(
      "## Step Prompt\n\nWrite the release summary."
    );
    expect(recorder.started?.promptSnapshot).toBe(gateway.requests[0]?.prompt);
  });

  it("adds the latest human revision request to rerun prompts", async () => {
    const recorder = new MemoryRecorder(
      sourceFor(
        "Write the release summary.",
        "agent",
        ["The summary names shipped features."],
        "Mention the rollback risk before approval."
      )
    );
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    await executeStepRunWithCodexCore(
      {
        stepRunId: "step-run-revision",
        workingDirectory: process.cwd()
      },
      dependencies(recorder, gateway)
    );

    expect(gateway.requests[0]?.prompt).toContain("## Review Feedback");
    expect(gateway.requests[0]?.prompt).toContain(
      "Mention the rollback risk before approval."
    );
    expect(gateway.requests[0]?.prompt).toContain(
      "## Step Prompt\n\nWrite the release summary."
    );
    expect(recorder.events[0]?.attempt).toBe(2);
    expect(recorder.started?.promptSnapshot).toBe(gateway.requests[0]?.prompt);
  });

  it("adds the runtime artifact contract when declared outputs are present", async () => {
    const recorder = new MemoryRecorder(
      sourceFor("Write obsolete.md and extra.md, then finish.")
    );
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    await executeStepRunWithCodexCore(
      {
        stepRunId: "step-run-artifacts",
        workingDirectory: process.cwd(),
        runtimeContext: {
          contextPaths: [],
          inputArtifacts: [],
          outputArtifacts: [
            {
              artifact: "declared_report",
              filename: "declared-report.md",
              absolutePath: path.join(process.cwd(), ".workflow-runtime", "declared-report.md"),
              promptPath: ".workflow-runtime/declared-report.md"
            }
          ]
        }
      },
      dependencies(recorder, gateway)
    );

    expect(gateway.requests[0]?.prompt).toContain(
      "Declared output artifacts are authoritative"
    );
    expect(gateway.requests[0]?.prompt).toContain("declared_report");
    expect(gateway.requests[0]?.prompt).toContain(".workflow-runtime/declared-report.md");
    expect(gateway.requests[0]?.prompt).toContain("obsolete.md");
    expect(recorder.started?.promptSnapshot).toBe(gateway.requests[0]?.prompt);
  });

  it("passes context paths as additional Codex directories", async () => {
    const recorder = new MemoryRecorder(sourceFor("Read the provided context."));
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));
    const notesFile = path.join(process.cwd(), "docs", "notes.md");
    const srcDirectory = path.join(process.cwd(), "src");

    await executeStepRunWithCodexCore(
      {
        stepRunId: "step-run-context",
        workingDirectory: process.cwd(),
        runtimeContext: {
          contextPaths: [
            {
              path: "docs/notes.md",
              type: "file",
              absolutePath: notesFile,
              promptPath: "docs/notes.md"
            },
            {
              path: "src",
              type: "directory",
              absolutePath: srcDirectory,
              promptPath: "src"
            },
            {
              path: "docs/notes-copy.md",
              type: "file",
              absolutePath: path.join(process.cwd(), "docs", "notes-copy.md"),
              promptPath: "docs/notes-copy.md"
            }
          ],
          inputArtifacts: [],
          outputArtifacts: []
        }
      },
      dependencies(recorder, gateway)
    );

    expect(gateway.requests[0]?.threadOptions.additionalDirectories).toEqual([
      path.dirname(notesFile),
      srcDirectory
    ]);
    expect(recorder.started?.codexOptions.additionalDirectories).toEqual([
      path.dirname(notesFile),
      srcDirectory
    ]);
  });

  it("leaves prompts unchanged when the runtime context is empty", () => {
    expect(
      buildCodexRuntimePrompt("Use the plain prompt.", [], {
        contextPaths: [],
        inputArtifacts: [],
        outputArtifacts: []
      })
    ).toBe("Use the plain prompt.");
  });

  it("adds acceptance criteria without requiring runtime artifacts", () => {
    expect(
      buildCodexRuntimePrompt("Use the plain prompt.", [
        "The result includes a short changelog."
      ])
    ).toBe(
      [
        "## Acceptance Criteria",
        "",
        "- The result includes a short changelog.",
        "",
        "Complete the step so the finished work satisfies every acceptance criterion.",
        "",
        "## Step Prompt",
        "",
        "Use the plain prompt."
      ].join("\n")
    );
  });

  it("returns no additional directories when runtime context has no context paths", () => {
    expect(
      buildCodexAdditionalDirectories({
        contextPaths: [],
        inputArtifacts: [],
        outputArtifacts: [
          {
            artifact: "declared_report",
            filename: "declared-report.md",
            absolutePath: path.join(process.cwd(), ".workflow-runtime", "declared-report.md"),
            promptPath: ".workflow-runtime/declared-report.md"
          }
        ]
      })
    ).toEqual([]);
  });

  it("rejects an empty published prompt before starting Codex", async () => {
    const recorder = new MemoryRecorder(sourceFor("   "));
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-1", workingDirectory: process.cwd() },
        dependencies(recorder, gateway)
      )
    ).rejects.toMatchObject({ code: "codex_prompt_empty" });

    expect(gateway.requests).toHaveLength(0);
    expect(recorder.started).toBeUndefined();
  });

  it("rejects a modified workflow snapshot before starting Codex", async () => {
    const source = sourceFor("Original prompt");
    source.yamlSnapshot += "\n# modified after publish\n";
    const recorder = new MemoryRecorder(source);
    const gateway = new FakeGateway(() => eventStream(...successfulEvents()));

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-1", workingDirectory: process.cwd() },
        dependencies(recorder, gateway)
      )
    ).rejects.toThrow("content hash");

    expect(gateway.requests).toHaveLength(0);
    expect(recorder.started).toBeUndefined();
  });

  it("records turn.failed and marks the StepRun failed", async () => {
    const recorder = new MemoryRecorder(sourceFor("Fail this turn."));
    const gateway = new FakeGateway(() =>
      eventStream(
        { type: "thread.started", thread_id: "thread-failed" },
        { type: "turn.failed", error: { message: "model failed" } }
      )
    );

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-failed", workingDirectory: process.cwd() },
        dependencies(recorder, gateway)
      )
    ).rejects.toMatchObject({ code: "codex_turn_failed" });

    expect(recorder.events).toEqual([
      {
        attempt: 1,
        sequence: 1,
        kind: "turn.failed",
        status: "failed",
        payload: { agentProvider: "codex", message: "model failed" }
      }
    ]);
    expect(recorder.failed?.failure).toEqual({
      code: "codex_turn_failed",
      message: "model failed"
    });
  });

  it("records a fatal stream error without duplicating it", async () => {
    const recorder = new MemoryRecorder(sourceFor("Stream error."));
    const gateway = new FakeGateway(() =>
      eventStream(
        { type: "thread.started", thread_id: "thread-error" },
        { type: "error", message: "stream failed" }
      )
    );

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-error", workingDirectory: process.cwd() },
        dependencies(recorder, gateway)
      )
    ).rejects.toMatchObject({ code: "codex_stream_error" });

    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]?.kind).toBe("error");
    expect(recorder.failed?.failure.code).toBe("codex_stream_error");
  });

  it("marks a turn failed when its event stream ends early", async () => {
    const recorder = new MemoryRecorder(sourceFor("End early."));
    const gateway = new FakeGateway(() =>
      eventStream(
        { type: "thread.started", thread_id: "thread-short" },
        {
          type: "item.completed",
          item: { id: "message-short", type: "agent_message", text: "Partial" }
        }
      )
    );

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-short", workingDirectory: process.cwd() },
        dependencies(recorder, gateway)
      )
    ).rejects.toMatchObject({ code: "codex_stream_ended_without_completion" });

    expect(recorder.events.at(-1)).toMatchObject({
      sequence: 2,
      kind: "error",
      payload: { code: "codex_stream_ended_without_completion" }
    });
  });

  it("aborts and records a configured timeout", async () => {
    const recorder = new MemoryRecorder(sourceFor("Wait until timeout."));
    const gateway = new FakeGateway((request) =>
      (async function* () {
        yield { type: "thread.started", thread_id: "thread-timeout" } satisfies ThreadEvent;
        await new Promise<void>((_resolve, reject) => {
          const rejectForAbort = () =>
            reject(request.signal?.reason ?? new Error("aborted without a reason"));

          if (request.signal?.aborted) {
            rejectForAbort();
          } else {
            request.signal?.addEventListener("abort", rejectForAbort, { once: true });
          }
        });
      })()
    );

    await expect(
      executeStepRunWithCodexCore(
        { stepRunId: "step-run-timeout", workingDirectory: process.cwd() },
        dependencies(recorder, gateway, 20)
      )
    ).rejects.toMatchObject({ code: "codex_turn_timeout" });

    expect(recorder.failed?.failure.code).toBe("codex_turn_timeout");
    expect(recorder.events.at(-1)).toMatchObject({
      kind: "error",
      payload: { code: "codex_turn_timeout" }
    });
  });
});
