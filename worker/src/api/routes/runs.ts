import type { FastifyInstance } from "fastify";
import { CreateRunRequestSchema, WORKFLOW_RUN_STATUSES } from "@workflow-software/shared";
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { createWorkflowRun } from "../../runtime/run-service.js";
import { badRequest, notFound } from "../errors.js";
import { cursorArgs, pageItems, parsePaginationQuery } from "../pagination.js";
import {
  serializeStandaloneRunEvent,
  serializeWorkflowRunDetail,
  serializeWorkflowRunSummary,
  workflowRunDetailInclude
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

function dbWorkflowRunStatus(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !WORKFLOW_RUN_STATUSES.includes(
      value as (typeof WORKFLOW_RUN_STATUSES)[number]
    )
  ) {
    throw badRequest("Invalid workflow run status", {
      status: value
    });
  }

  return value.toUpperCase();
}

async function loadWorkflowRunDetail(runId: string) {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: workflowRunDetailInclude
  });

  if (!run) {
    throw notFound(`WorkflowRun ${runId} was not found`);
  }

  return run;
}

export async function registerRunRoutes(app: FastifyInstance) {
  app.get("/", async (request) => {
    const query = request.query as {
      workflowId?: string;
      workflowVersionId?: string;
      status?: string;
    };
    const { limit, cursor } = parsePaginationQuery(request.query);
    const where: Prisma.WorkflowRunWhereInput = {};
    const status = dbWorkflowRunStatus(query.status);

    if (query.workflowId) {
      where.workflowVersion = {
        workflowId: query.workflowId
      };
    }

    if (query.workflowVersionId) {
      where.workflowVersionId = query.workflowVersionId;
    }

    if (status) {
      where.status = status as Prisma.WorkflowRunWhereInput["status"];
    }

    const runs = await prisma.workflowRun.findMany({
      where,
      ...cursorArgs(cursor),
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: runSummaryInclude
    });
    const page = pageItems(runs, limit);

    return {
      items: page.items.map(serializeWorkflowRunSummary),
      nextCursor: page.nextCursor
    };
  });

  app.post("/workflow-versions/:workflowVersionId", async (request, reply) => {
    const { workflowVersionId } = request.params as { workflowVersionId: string };
    const body = CreateRunRequestSchema.parse(request.body ?? {});
    const version = await prisma.workflowVersion.findUnique({
      where: { id: workflowVersionId },
      select: { id: true }
    });

    if (!version) {
      throw notFound(`WorkflowVersion ${workflowVersionId} was not found`);
    }

    const created = await createWorkflowRun(workflowVersionId, body.inputPayload);
    const runId = (created as { id?: unknown }).id;

    if (typeof runId !== "string") {
      throw new Error("createWorkflowRun did not return an id");
    }

    const run = await loadWorkflowRunDetail(runId);
    return reply.code(201).send(serializeWorkflowRunDetail(run));
  });

  app.get("/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    const run = await loadWorkflowRunDetail(runId);
    return serializeWorkflowRunDetail(run);
  });

  app.get("/:runId/events", async (request) => {
    const { runId } = request.params as { runId: string };
    const { limit } = parsePaginationQuery(request.query);
    const after = (request.query as { after?: string }).after;
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { id: true }
    });

    if (!run) {
      throw notFound(`WorkflowRun ${runId} was not found`);
    }

    const events = await prisma.runEvent.findMany({
      where: { workflowRunId: runId },
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      take: limit + 1,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const page = pageItems(events, limit);

    return {
      items: page.items.map(serializeStandaloneRunEvent),
      nextCursor: page.nextCursor
    };
  });
}
