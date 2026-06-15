import { describe, expect, it, vi } from "vitest";
import {
  PrismaCodexRunRecorder,
  type PrismaCodexRunRecorderClient
} from "../src/codex/prisma-codex-run-recorder.js";

function clientWithStepRun(decisionEvents: Array<{ verdict: string; comment: string | null }>) {
  return {
    stepRun: {
      findUniqueOrThrow: vi.fn(async () => ({
        stepId: "step-1",
        attempt: 3,
        decisionEvents,
        workflowRun: {
          workflowVersion: {
            yamlSnapshot: "workflow: yaml",
            contentHash: "hash-1"
          }
        }
      })),
      updateMany: vi.fn(),
      update: vi.fn()
    },
    codexInteractionEvent: {
      create: vi.fn()
    }
  } as unknown as PrismaCodexRunRecorderClient;
}

describe("PrismaCodexRunRecorder", () => {
  it("loads the current attempt and latest human revision request comment", async () => {
    const client = clientWithStepRun([
      {
        verdict: "REQUEST_REVISION",
        comment: "Tighten the conclusion before approval."
      }
    ]);
    const recorder = new PrismaCodexRunRecorder(client);

    await expect(recorder.loadSource("step-run-1")).resolves.toMatchObject({
      stepId: "step-1",
      attempt: 3,
      revisionRequestComment: "Tighten the conclusion before approval."
    });
  });

  it("does not reuse stale revision comments after a later human approval", async () => {
    const client = clientWithStepRun([
      {
        verdict: "APPROVE",
        comment: "Looks good."
      }
    ]);
    const recorder = new PrismaCodexRunRecorder(client);

    await expect(recorder.loadSource("step-run-1")).resolves.toMatchObject({
      revisionRequestComment: undefined
    });
  });

  it("stores Codex events under the current attempt", async () => {
    const client = clientWithStepRun([]);
    const recorder = new PrismaCodexRunRecorder(client);

    await recorder.appendEvent("step-run-1", {
      attempt: 3,
      sequence: 1,
      externalItemId: "message-1",
      kind: "item.completed",
      status: "completed",
      payload: { itemType: "agent_message" }
    });

    expect(client.codexInteractionEvent.create).toHaveBeenCalledWith({
      data: {
        stepRunId: "step-run-1",
        attempt: 3,
        sequence: 1,
        externalItemId: "message-1",
        kind: "item.completed",
        status: "completed",
        payload: { itemType: "agent_message" }
      }
    });
  });
});
