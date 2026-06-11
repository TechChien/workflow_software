import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseWorkflowYaml } from "@workflow-software/shared";
import { resetToCommit } from "../../code-workspace/git-checkpoints.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { badRequest, notFound } from "../errors.js";
import {
  serializeStandaloneStepRunDetail,
  stepRunDetailInclude
} from "../serializers.js";

const RerunStepRequestSchema = z.object({
  reason: z.enum([
    "human_rejected",
    "revision_requested",
    "stale_artifact",
    "manual_retry"
  ]),
  comment: z.string().optional(),
  resetToBeforeCommit: z.boolean().default(true)
});

function downstreamStepIds(workflowYaml: string, stepId: string) {
  const workflow = parseWorkflowYaml(workflowYaml);
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const start = byId.get(stepId);

  if (!start) {
    throw badRequest("StepRun stepId was not found in its workflow snapshot", {
      stepId
    });
  }

  const downstream: string[] = [];
  const seen = new Set<string>([stepId]);
  let nextStepId = start.downstream;

  while (nextStepId) {
    if (seen.has(nextStepId)) {
      throw badRequest("Workflow snapshot contains a downstream cycle", {
        stepId,
        downstreamStepId: nextStepId
      });
    }

    seen.add(nextStepId);
    downstream.push(nextStepId);
    nextStepId = byId.get(nextStepId)?.downstream;
  }

  return downstream;
}

export async function registerStepRunRoutes(app: FastifyInstance) {
  app.post("/:stepRunId/rerun", async (request, reply) => {
    const { stepRunId } = request.params as { stepRunId: string };
    const body = RerunStepRequestSchema.parse(request.body);
    const stepRun = await prisma.stepRun.findUnique({
      where: { id: stepRunId },
      include: {
        workflowRun: {
          include: {
            workflowVersion: true
          }
        }
      }
    });

    if (!stepRun) {
      throw notFound(`StepRun ${stepRunId} was not found`);
    }

    if (body.resetToBeforeCommit && stepRun.beforeCommit && stepRun.codeWorkspaceId) {
      const workspace = await prisma.codeWorkspace.findUnique({
        where: { id: stepRun.codeWorkspaceId },
        select: { worktreePath: true }
      });

      if (workspace) {
        await resetToCommit(workspace.worktreePath, stepRun.beforeCommit);
      }
    }

    const now = new Date();
    const staleReason = body.comment ?? body.reason;
    const downstream = downstreamStepIds(
      stepRun.workflowRun.workflowVersion.yamlSnapshot,
      stepRun.stepId
    );
    const affectedStepRunIds = await prisma.$transaction(async (tx) => {
      const db = tx as typeof prisma;
      const affectedStepRuns =
        downstream.length > 0
          ? await db.stepRun.findMany({
              where: {
                workflowRunId: stepRun.workflowRunId,
                stepId: {
                  in: downstream
                },
                status: {
                  not: "PENDING"
                }
              },
              select: {
                id: true
              }
            })
          : [];

      await db.artifactVersion.updateMany({
        where: {
          producerStepRunId: stepRunId,
          status: "CANDIDATE"
        },
        data: {
          status: "SUPERSEDED"
        }
      });
      await db.stepRun.update({
        where: { id: stepRunId },
        data: {
          attempt: {
            increment: 1
          },
          status: "READY",
          startedAt: null,
          completedAt: null,
          codexFinalResponse: null,
          codexUsage: Prisma.DbNull,
          codexError: Prisma.DbNull,
          codexCompletedAt: null,
          staleReason: null
        }
      });

      if (affectedStepRuns.length > 0) {
        await db.stepRun.updateMany({
          where: {
            id: {
              in: affectedStepRuns.map((affected) => affected.id)
            }
          },
          data: {
            status: "STALE",
            staleReason,
            startedAt: null,
            completedAt: null
          }
        });
      }

      await db.workflowRun.update({
        where: { id: stepRun.workflowRunId },
        data: {
          status: "RUNNING",
          startedAt: stepRun.workflowRun.startedAt ?? now,
          completedAt: null
        }
      });
      await db.runEvent.create({
        data: {
          workflowRunId: stepRun.workflowRunId,
          eventType: "step_run.rerun_requested",
          payload: {
            stepRunId,
            reason: body.reason,
            comment: body.comment,
            resetToBeforeCommit: body.resetToBeforeCommit
          }
        }
      });

      return affectedStepRuns.map((affected) => affected.id);
    });
    const [queuedStepRun, affectedStepRuns] = await Promise.all([
      prisma.stepRun.findUnique({
        where: { id: stepRunId },
        include: stepRunDetailInclude
      }),
      prisma.stepRun.findMany({
        where: {
          id: {
            in: affectedStepRunIds
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: stepRunDetailInclude
      })
    ]);

    if (!queuedStepRun) {
      throw notFound(`StepRun ${stepRunId} was not found after rerun`);
    }

    return reply.code(202).send({
      queuedStepRun: serializeStandaloneStepRunDetail(queuedStepRun),
      affectedStepRuns: affectedStepRuns.map(serializeStandaloneStepRunDetail)
    });
  });
}
