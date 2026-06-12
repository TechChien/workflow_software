import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import type { StepDefinition } from "@workflow-software/shared";
import { describe, expect, it } from "vitest";
import type { CodexGateway, CodexTurnRequest } from "../src/codex/codex-client.js";
import {
  DecisionSource,
  DecisionVerdict,
  StepRunEvaluator
} from "../src/generated/prisma/client.js";
import {
  EVALUATOR_OUTPUT_SCHEMA,
  evaluateStepArtifact,
  type EvaluateStepInput
} from "../src/runtime/evaluator-runner.js";

const usage: Usage = {
  input_tokens: 10,
  cached_input_tokens: 0,
  output_tokens: 4,
  reasoning_output_tokens: 1
};

const settings = {
  model: "codex-evaluator-test",
  modelReasoningEffort: "medium" as const,
  timeoutMs: 1_000
};

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

function agentMessage(text: string): ThreadEvent {
  return {
    type: "item.completed",
    item: {
      id: "message-1",
      type: "agent_message",
      text
    }
  };
}

async function makeTempDirectory(prefix: string) {
  const root = path.resolve(process.cwd(), "..", "data", "test-temp");
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}

function baseStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    id: "step-1",
    type: "agent",
    depends_on: [],
    input_artifacts: [],
    output_artifacts: [],
    context_paths: [],
    tool_capabilities: [],
    evaluate: { evaluator: "mixed" },
    prompt: "Write the release summary.",
    acceptance: {
      criteria: ["The summary mentions shipped features."]
    },
    ...overrides
  };
}

function baseInput(
  evaluator: StepRunEvaluator,
  overrides: Partial<EvaluateStepInput> = {}
): EvaluateStepInput {
  return {
    stepRunId: "step-run-1",
    evaluator,
    workflowId: "workflow-1",
    workflowRunId: "workflow-run-1",
    step: baseStep(),
    workingDirectory: process.cwd(),
    artifactStoreRoot: path.join(process.cwd(), "data", "artifacts"),
    codexFinalResponse: "Codex wrote the release summary.",
    ...overrides
  };
}

describe("evaluateStepArtifact", () => {
  it("auto-approves human_review without starting a Codex evaluator turn", async () => {
    const gateway = new FakeGateway(() => {
      throw new Error("Codex evaluator should not run for human_review");
    });

    const result = await evaluateStepArtifact(baseInput(StepRunEvaluator.HUMAN_REVIEW), {
      gateway,
      settings
    });

    expect(gateway.requests).toHaveLength(0);
    expect(result).toEqual({
      decisions: [
        {
          stepRunId: "step-run-1",
          source: DecisionSource.HUMAN,
          verdict: DecisionVerdict.APPROVE,
          comment: "Auto-approved by the v1 human review gate."
        }
      ],
      finalVerdict: DecisionVerdict.APPROVE
    });
  });

  it("runs evaluator_review with read-only Codex options, schema output, and artifact context", async () => {
    const workingDirectory = await makeTempDirectory("evaluator-worktree-");
    const artifactPath = path.join(
      workingDirectory,
      ".workflow-runtime",
      "artifacts",
      "step-run-1",
      "outputs",
      "summary.md"
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "Final report content.", "utf8");

    const gateway = new FakeGateway(() =>
      eventStream(
        { type: "thread.started", thread_id: "evaluator-thread-1" },
        agentMessage(
          JSON.stringify({
            verdict: DecisionVerdict.APPROVE,
            comment: "The summary satisfies the criteria."
          })
        ),
        { type: "turn.completed", usage }
      )
    );

    const result = await evaluateStepArtifact(
      baseInput(StepRunEvaluator.EVALUATOR_REVIEW, {
        workingDirectory,
        runtimeContext: {
          contextPaths: [],
          inputArtifacts: [],
          outputArtifacts: [
            {
              artifact: "summary",
              filename: "summary.md",
              absolutePath: artifactPath,
              promptPath: ".workflow-runtime/artifacts/step-run-1/outputs/summary.md"
            }
          ]
        }
      }),
      { gateway, settings }
    );

    expect(result).toEqual({
      decisions: [
        {
          stepRunId: "step-run-1",
          source: DecisionSource.EVALUATOR,
          verdict: DecisionVerdict.APPROVE,
          comment: "The summary satisfies the criteria."
        }
      ],
      finalVerdict: DecisionVerdict.APPROVE
    });
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]?.threadOptions).toMatchObject({
      workingDirectory,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      model: "codex-evaluator-test",
      modelReasoningEffort: "medium"
    });
    expect(gateway.requests[0]?.outputSchema).toEqual(EVALUATOR_OUTPUT_SCHEMA);
    expect(gateway.requests[0]?.prompt).toContain("Write the release summary.");
    expect(gateway.requests[0]?.prompt).toContain("The summary mentions shipped features.");
    expect(gateway.requests[0]?.prompt).toContain("Codex wrote the release summary.");
    expect(gateway.requests[0]?.prompt).toContain("Final report content.");
  });

  it("adds the auto human approval after a mixed evaluator approval", async () => {
    const gateway = new FakeGateway(() =>
      eventStream(
        agentMessage(
          JSON.stringify({
            verdict: DecisionVerdict.APPROVE,
            comment: "Evaluator approves."
          })
        ),
        { type: "turn.completed", usage }
      )
    );

    const result = await evaluateStepArtifact(baseInput(StepRunEvaluator.MIXED), {
      gateway,
      settings
    });

    expect(result.finalVerdict).toBe(DecisionVerdict.APPROVE);
    expect(result.decisions.map((decision) => decision.source)).toEqual([
      DecisionSource.EVALUATOR,
      DecisionSource.HUMAN
    ]);
  });

  it("does not add a human approval when a mixed evaluator rejects the step", async () => {
    const gateway = new FakeGateway(() =>
      eventStream(
        agentMessage(
          JSON.stringify({
            verdict: DecisionVerdict.REQUEST_REVISION,
            comment: "Needs changes."
          })
        ),
        { type: "turn.completed", usage }
      )
    );

    const result = await evaluateStepArtifact(baseInput(StepRunEvaluator.MIXED), {
      gateway,
      settings
    });

    expect(result).toEqual({
      decisions: [
        {
          stepRunId: "step-run-1",
          source: DecisionSource.EVALUATOR,
          verdict: DecisionVerdict.REQUEST_REVISION,
          comment: "Needs changes."
        }
      ],
      finalVerdict: DecisionVerdict.REQUEST_REVISION
    });
  });

  it("fails when the evaluator returns invalid JSON", async () => {
    const gateway = new FakeGateway(() =>
      eventStream(agentMessage("not-json"), { type: "turn.completed", usage })
    );

    await expect(
      evaluateStepArtifact(baseInput(StepRunEvaluator.EVALUATOR_REVIEW), {
        gateway,
        settings
      })
    ).rejects.toMatchObject({ code: "evaluator_invalid_json" });
  });

  it("fails when the evaluator turn fails", async () => {
    const gateway = new FakeGateway(() =>
      eventStream({ type: "turn.failed", error: { message: "model failed" } })
    );

    await expect(
      evaluateStepArtifact(baseInput(StepRunEvaluator.EVALUATOR_REVIEW), {
        gateway,
        settings
      })
    ).rejects.toMatchObject({ code: "evaluator_turn_failed" });
  });
});
