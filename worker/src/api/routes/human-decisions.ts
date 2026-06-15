import type { FastifyInstance } from "fastify";
import {
  directDependentStepIds,
  HumanDecisionRequestSchema,
  parseWorkflowYaml,
  transitiveDependentStepIds,
  workflowStepIds,
  type WorkflowYaml
} from "@workflow-software/shared";
import { resetToCommit } from "../../code-workspace/git-checkpoints.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { badRequest, notFound } from "../errors.js";
import {
  serializeDecisionEvent,
  serializeStandaloneStepRunDetail,
  serializeWorkflowRunSummary,
  stepRunDetailInclude
} from "../serializers.js";

const runSummaryInclude = {
  workflowVersion: true,
  stepRuns: {
    select: {
      id: true,
      status: true
    }
  }
} as const;

const DECISION_VERDICT_TO_DB = {
  approve: "APPROVE",
  reject: "REJECT",
  request_revision: "REQUEST_REVISION"
} as const;

const REQUIRED_COMMENT_VERDICTS = new Set(["reject", "request_revision"]);

function workflowForStep(workflowYaml: string, stepId: string) {
  const workflow = parseWorkflowYaml(workflowYaml);

  if (!workflowStepIds(workflow).has(stepId)) {
    throw badRequest("StepRun stepId was not found in its workflow snapshot", {
      stepId
    });
  }

  return workflow;
}

function statusByStepId(stepRuns: Array<{ stepId: string; status: string }>) {
  return new Map(stepRuns.map((stepRun) => [stepRun.stepId, stepRun.status]));
}

function dependenciesAccepted(
  workflow: WorkflowYaml,
  stepId: string,
  statuses: Map<string, string>
) {
  const step = workflow.steps.find((candidate) => candidate.id === stepId);

  return Boolean(
    step &&
      step.depends_on.every(
        (dependencyId) => statuses.get(dependencyId) === "ACCEPTED"
      )
  );
}

function readyEligibleDependentStepIds(
  workflow: WorkflowYaml,
  completedStepId: string,
  statuses: Map<string, string>
) {
  return directDependentStepIds(workflow, completedStepId).filter(
    (dependentStepId) =>
      statuses.get(dependentStepId) === "PENDING" &&
      dependenciesAccepted(workflow, dependentStepId, statuses)
  );
}

function allWorkflowStepsAccepted(
  workflow: WorkflowYaml,
  statuses: Map<string, string>
) {
  return workflow.steps.every((step) => statuses.get(step.id) === "ACCEPTED");
}

function downstreamStepIds(workflow: WorkflowYaml, stepId: string) {
  return transitiveDependentStepIds(workflow, stepId);
}

export async function registerHumanDecisionRoutes(app: FastifyInstance) {
  app.post("/:stepRunId", async (request, reply) => {
    const { stepRunId } = request.params as { stepRunId: string };
    const body = HumanDecisionRequestSchema.parse(request.body);
    const comment = body.comment?.trim() || undefined;
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

    if (stepRun.status !== "WAITING_FOR_HUMAN_REVIEW") {
      throw badRequest("StepRun is not waiting for human review", {
        stepRunId,
        status: stepRun.status
      });
    }

    if (REQUIRED_COMMENT_VERDICTS.has(body.verdict) && !comment) {
      throw badRequest("A comment is required for this human decision", {
        verdict: body.verdict
      });
    }

    const now = new Date();
    const verdict = DECISION_VERDICT_TO_DB[body.verdict];
    const workflow = workflowForStep(
      stepRun.workflowRun.workflowVersion.yamlSnapshot,
      stepRun.stepId
    );
    const downstream = downstreamStepIds(workflow, stepRun.stepId);
    let resetToBeforeCommit = false;

    if (body.verdict === "request_revision" && stepRun.beforeCommit && stepRun.codeWorkspaceId) {
      const workspace = await prisma.codeWorkspace.findUnique({
        where: { id: stepRun.codeWorkspaceId },
        select: { worktreePath: true }
      });

      if (workspace) {
        await resetToCommit(workspace.worktreePath, stepRun.beforeCommit);
        resetToBeforeCommit = true;
      }
    }

    const decisionEvent = await prisma.$transaction(async (tx) => {
      const db = tx as typeof prisma;
      const createdDecision = await db.decisionEvent.create({
        data: {
          workflowRunId: stepRun.workflowRunId,
          stepRunId,
          source: "HUMAN",
          verdict,
          comment,
          targetStepId: body.targetStepId
        }
      });

      await db.runEvent.create({
        data: {
          workflowRunId: stepRun.workflowRunId,
          eventType: "human_decision.created",
          payload: {
            stepRunId,
            verdict: body.verdict,
            comment,
            targetStepId: body.targetStepId
          }
        }
      });

      if (body.verdict === "approve") {
        await db.artifactVersion.updateMany({
          where: {
            producerStepRunId: stepRunId,
            status: "CANDIDATE"
          },
          data: {
            status: "ACCEPTED",
            acceptedAt: now
          }
        });
        await db.stepRun.update({
          where: { id: stepRunId },
          data: {
            status: "ACCEPTED",
            completedAt: now
          }
        });

        const statuses = statusByStepId(
          await db.stepRun.findMany({
            where: {
              workflowRunId: stepRun.workflowRunId
            },
            select: {
              stepId: true,
              status: true
            }
          })
        );

        const readyStepIds = readyEligibleDependentStepIds(
          workflow,
          stepRun.stepId,
          statuses
        );

        if (readyStepIds.length > 0) {
          await db.stepRun.updateMany({
            where: {
              workflowRunId: stepRun.workflowRunId,
              stepId: {
                in: readyStepIds
              },
              status: "PENDING"
            },
            data: {
              status: "READY"
            }
          });
        }

        if (allWorkflowStepsAccepted(workflow, statuses)) {
          await db.workflowRun.update({
            where: { id: stepRun.workflowRunId },
            data: {
              status: "COMPLETED",
              startedAt: stepRun.workflowRun.startedAt ?? now,
              completedAt: now
            }
          });
        } else {
          await db.workflowRun.update({
            where: { id: stepRun.workflowRunId },
            data: {
              status: "RUNNING",
              startedAt: stepRun.workflowRun.startedAt ?? now,
              completedAt: null
            }
          });
        }
      } else if (body.verdict === "request_revision") {
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
              staleReason: comment,
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
              reason: "revision_requested",
              comment,
              resetToBeforeCommit
            }
          }
        });
      } else {
        await db.artifactVersion.updateMany({
          where: {
            producerStepRunId: stepRunId,
            status: "CANDIDATE"
          },
          data: {
            status: "REJECTED"
          }
        });
        await db.stepRun.update({
          where: { id: stepRunId },
          data: {
            status: "REJECTED",
            completedAt: now
          }
        });
        await db.workflowRun.update({
          where: { id: stepRun.workflowRunId },
          data: {
            status: "FAILED",
            completedAt: now
          }
        });
      }

      return createdDecision;
    });
    const [updatedStepRun, workflowRun] = await Promise.all([
      prisma.stepRun.findUnique({
        where: { id: stepRunId },
        include: stepRunDetailInclude
      }),
      prisma.workflowRun.findUnique({
        where: { id: stepRun.workflowRunId },
        include: runSummaryInclude
      })
    ]);

    if (!updatedStepRun || !workflowRun) {
      throw notFound("Updated human decision state was not found");
    }

    return reply.code(201).send({
      decisionEvent: serializeDecisionEvent(decisionEvent),
      stepRun: serializeStandaloneStepRunDetail(updatedStepRun),
      workflowRun: serializeWorkflowRunSummary(workflowRun)
    });
  });
}
