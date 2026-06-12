import type { FastifyInstance } from "fastify";
import {
  directDependentStepIds,
  HumanDecisionRequestSchema,
  parseWorkflowYaml,
  workflowStepIds,
  type WorkflowYaml
} from "@workflow-software/shared";
import { prisma } from "../../db/prisma.js";
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

export async function registerHumanDecisionRoutes(app: FastifyInstance) {
  app.post("/:stepRunId", async (request, reply) => {
    const { stepRunId } = request.params as { stepRunId: string };
    const body = HumanDecisionRequestSchema.parse(request.body);
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

    const now = new Date();
    const verdict = DECISION_VERDICT_TO_DB[body.verdict];
    const workflow = workflowForStep(
      stepRun.workflowRun.workflowVersion.yamlSnapshot,
      stepRun.stepId
    );
    const decisionEvent = await prisma.$transaction(async (tx) => {
      const db = tx as typeof prisma;
      const createdDecision = await db.decisionEvent.create({
        data: {
          workflowRunId: stepRun.workflowRunId,
          stepRunId,
          source: "HUMAN",
          verdict,
          comment: body.comment,
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
