import type { FastifyInstance } from "fastify";
import {
  CreateWorkflowRequestSchema,
  UpdateDraftWorkflowRequestSchema
} from "@workflow-software/shared";
import { prisma } from "../../db/prisma.js";
import { canonicalizeWorkflowDefinition } from "../../runtime/workflow-definition.js";
import { notFound } from "../errors.js";
import { cursorArgs, pageItems, parsePaginationQuery } from "../pagination.js";
import {
  serializeWorkflowDetail,
  serializeWorkflowDraft,
  serializeWorkflowSummary,
  serializeWorkflowVersion
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

const versionSummaryInclude = {
  runs: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    include: {
      stepRuns: {
        select: {
          id: true,
          status: true
        }
      }
    }
  }
};

async function workflowSummaryData(workflowId: string) {
  const [latestPublishedVersion, lastRun] = await Promise.all([
    prisma.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: [{ revision: "desc" }, { id: "desc" }],
      include: versionSummaryInclude
    }),
    prisma.workflowRun.findFirst({
      where: {
        workflowVersion: {
          workflowId
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: runSummaryInclude
    })
  ]);

  return {
    latestPublishedVersion: latestPublishedVersion ?? undefined,
    lastRun: lastRun ?? undefined
  };
}

export async function registerWorkflowRoutes(app: FastifyInstance) {
  app.get("/", async (request) => {
    const { limit, cursor } = parsePaginationQuery(request.query);
    const workflows = await prisma.workflow.findMany({
      ...cursorArgs(cursor),
      take: limit + 1,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    const page = pageItems(workflows, limit);
    const items = await Promise.all(
      page.items.map(async (workflow) =>
        serializeWorkflowSummary({
          workflow,
          ...(await workflowSummaryData(workflow.id))
        })
      )
    );

    return {
      items,
      nextCursor: page.nextCursor
    };
  });

  app.post("/", async (request, reply) => {
    const body = CreateWorkflowRequestSchema.parse(request.body);
    const draft = canonicalizeWorkflowDefinition(body.draftYaml);
    const workflow = await prisma.workflow.create({
      data: {
        name: draft.definition.name,
        draftYaml: draft.yaml
      }
    });

    return reply.code(201).send({
      ...serializeWorkflowDraft(workflow),
      draftYaml: draft.definition
    });
  });

  app.get("/:workflowId", async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw notFound(`Workflow ${workflowId} was not found`);
    }

    const [versions, recentRuns] = await Promise.all([
      prisma.workflowVersion.findMany({
        where: { workflowId },
        orderBy: [{ revision: "desc" }, { id: "desc" }],
        include: versionSummaryInclude
      }),
      prisma.workflowRun.findMany({
        where: {
          workflowVersion: {
            workflowId
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        include: runSummaryInclude
      })
    ]);

    return serializeWorkflowDetail({
      workflow,
      versions,
      recentRuns
    });
  });

  app.patch("/:workflowId/draft", async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const body = UpdateDraftWorkflowRequestSchema.parse(request.body);
    const draft = canonicalizeWorkflowDefinition(body.draftYaml);
    const existing = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true }
    });

    if (!existing) {
      throw notFound(`Workflow ${workflowId} was not found`);
    }

    const workflow = await prisma.workflow.update({
      where: {
        id: workflowId
      },
      data: {
        name: draft.definition.name,
        draftYaml: draft.yaml
      }
    });

    return {
      ...serializeWorkflowDraft(workflow),
      draftYaml: draft.definition
    };
  });

  app.get("/:workflowId/versions", async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const { limit, cursor } = parsePaginationQuery(request.query);
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true }
    });

    if (!workflow) {
      throw notFound(`Workflow ${workflowId} was not found`);
    }

    const versions = await prisma.workflowVersion.findMany({
      where: { workflowId },
      ...cursorArgs(cursor),
      take: limit + 1,
      orderBy: [{ revision: "desc" }, { id: "desc" }],
      include: versionSummaryInclude
    });
    const page = pageItems(versions, limit);

    return {
      items: page.items.map(serializeWorkflowVersion),
      nextCursor: page.nextCursor
    };
  });
}
