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

function sourceFor(prompt: string, type: "agent" | "code_agent" = "agent") {
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
        },
        acceptance: { criteria: [] }
      }
    ],
    ui: {}
  });

  return {
    stepId: "step-1",
    yamlSnapshot: snapshot.yaml,
    contentHash: snapshot.contentHash
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
        sequence: 1,
        kind: "turn.failed",
        status: "failed",
        payload: { message: "model failed" }
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
