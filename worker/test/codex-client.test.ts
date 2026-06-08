import type { Codex, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import { OpenAICodexGateway } from "../src/codex/codex-client.js";

describe("OpenAICodexGateway", () => {
  it("forwards outputSchema to runStreamed", async () => {
    const outputSchema = {
      type: "object",
      properties: {
        verdict: { type: "string" }
      },
      required: ["verdict"]
    };
    const captured: {
      threadOptions?: ThreadOptions;
      input?: string;
      turnOptions?: TurnOptions;
    } = {};
    const fakeThread = {
      runStreamed: async (input: string, turnOptions?: TurnOptions) => {
        captured.input = input;
        captured.turnOptions = turnOptions;
        return {
          events: (async function* () {})()
        };
      }
    };
    const fakeCodex = {
      startThread: (threadOptions?: ThreadOptions) => {
        captured.threadOptions = threadOptions;
        return fakeThread;
      }
    };
    const gateway = new OpenAICodexGateway(fakeCodex as unknown as Codex);

    await gateway.runTurn({
      prompt: "Evaluate this step.",
      threadOptions: {
        workingDirectory: process.cwd(),
        sandboxMode: "read-only",
        approvalPolicy: "never"
      },
      outputSchema
    });

    expect(captured.input).toBe("Evaluate this step.");
    expect(captured.threadOptions).toMatchObject({
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });
    expect(captured.turnOptions?.outputSchema).toBe(outputSchema);
  });
});
