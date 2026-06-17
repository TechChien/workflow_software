import { describe, expect, it, vi } from "vitest";
import { PrismaStepRunnerRepository } from "../src/runtime/step-runner-repository.js";
import type { StepRunnerRepositoryClient } from "../src/runtime/step-runner-repository.js";

function client(overrides: Partial<StepRunnerRepositoryClient> = {}) {
  return {
    stepRun: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ status: "CODEX_COMPLETED", codexError: null })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    workflowRun: {
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    decisionEvent: {
      create: vi.fn(async () => ({}))
    },
    ...overrides
  } as unknown as StepRunnerRepositoryClient;
}

describe("PrismaStepRunnerRepository", () => {
  it("finds the oldest READY step whose workflow run can execute", async () => {
    const db = client();
    const repository = new PrismaStepRunnerRepository(db);

    await repository.findNextReadyStep();

    expect(db.stepRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "READY",
          workflowRun: {
            status: {
              in: ["PENDING", "RUNNING"]
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    );
  });

  it("accepts a step only from CODEX_COMPLETED", async () => {
    const db = client();
    const repository = new PrismaStepRunnerRepository(db);
    const now = new Date(Date.UTC(2026, 0, 2));

    await repository.markStepRunAccepted("step-run-1", now);

    expect(db.stepRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "step-run-1",
        status: "CODEX_COMPLETED"
      },
      data: {
        status: "ACCEPTED",
        completedAt: now
      }
    });
  });

  it("throws when a conditional step transition updates no rows", async () => {
    const db = client({
      stepRun: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 }))
      }
    } as Partial<StepRunnerRepositoryClient>);
    const repository = new PrismaStepRunnerRepository(db);

    await expect(
      repository.markStepRunAccepted("step-run-1", new Date(Date.UTC(2026, 0, 2)))
    ).rejects.toThrow("StepRun step-run-1 was not CODEX_COMPLETED");
  });
});
