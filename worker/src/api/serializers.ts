import {
  parseWorkflowYaml,
  type ArtifactDefinition,
  type WorkflowYaml
} from "@workflow-software/shared";
import type { Prisma } from "../generated/prisma/client.js";

const FINISHED_STEP_STATUSES = new Set(["ACCEPTED"]);
const WAITING_STEP_STATUSES = new Set([
  "WAITING_FOR_CODEX_PERMISSION",
  "WAITING_FOR_CODEX_QUESTION",
  "WAITING_FOR_HUMAN_REVIEW",
  "WAITING_FOR_EVALUATOR_FEEDBACK"
]);

const stepRunOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const artifactVersionOrder = [
  { artifactKey: "asc" as const },
  { version: "asc" as const },
  { id: "asc" as const }
];
const artifactInputOrder = [
  { artifactKey: "asc" as const },
  { id: "asc" as const }
];
const createdOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];

export const workflowRunDetailInclude = {
  workflowVersion: true,
  stepRuns: {
    orderBy: stepRunOrder,
    include: {
      artifactInputs: {
        orderBy: artifactInputOrder,
        include: {
          artifactVersion: {
            include: {
              producerStepRun: {
                select: {
                  stepId: true
                }
              }
            }
          }
        }
      },
      producedArtifacts: {
        orderBy: artifactVersionOrder,
        include: {
          producerStepRun: {
            select: {
              stepId: true
            }
          }
        }
      },
      decisionEvents: {
        orderBy: createdOrder
      },
      toolInvocations: {
        orderBy: createdOrder
      },
      contextPathEvents: {
        orderBy: createdOrder
      },
      codexInteractions: {
        orderBy: [
          { attempt: "asc" as const },
          { sequence: "asc" as const },
          { id: "asc" as const }
        ]
      },
      codeChangeRecords: {
        orderBy: createdOrder
      }
    }
  },
  artifactVersions: {
    orderBy: artifactVersionOrder,
    include: {
      producerStepRun: {
        select: {
          stepId: true
        }
      }
    }
  },
  decisionEvents: {
    orderBy: createdOrder
  },
  runEvents: {
    orderBy: createdOrder
  },
  codeWorkspaces: {
    orderBy: createdOrder,
    include: {
      changes: {
        orderBy: createdOrder
      }
    }
  }
} satisfies Prisma.WorkflowRunInclude;

export const stepRunDetailInclude = {
  workflowRun: {
    include: {
      workflowVersion: true
    }
  },
  artifactInputs: {
    orderBy: artifactInputOrder,
    include: {
      artifactVersion: {
        include: {
          producerStepRun: {
            select: {
              stepId: true
            }
          }
        }
      }
    }
  },
  producedArtifacts: {
    orderBy: artifactVersionOrder,
    include: {
      producerStepRun: {
        select: {
          stepId: true
        }
      }
    }
  },
  decisionEvents: {
    orderBy: createdOrder
  },
  toolInvocations: {
    orderBy: createdOrder
  },
  contextPathEvents: {
    orderBy: createdOrder
  },
  codexInteractions: {
    orderBy: [
      { attempt: "asc" as const },
      { sequence: "asc" as const },
      { id: "asc" as const }
    ]
  },
  codeChangeRecords: {
    orderBy: createdOrder
  }
} satisfies Prisma.StepRunInclude;

export type WorkflowRunDetailRow = Prisma.WorkflowRunGetPayload<{
  include: typeof workflowRunDetailInclude;
}>;

export type StepRunDetailRow = Prisma.StepRunGetPayload<{
  include: typeof stepRunDetailInclude;
}>;

type StepRunSerializableRow = Omit<StepRunDetailRow, "workflowRun">;

type WorkflowDraftRow = {
  id: string;
  name: string;
  draftYaml: string;
  createdAt: Date;
  updatedAt: Date;
};

type WorkflowVersionSnapshotRow = {
  id: string;
  workflowId: string;
  revision: number;
  yamlSnapshot: string;
  contentHash: string;
  publishedAt: Date;
};

type WorkflowRunBaseRow = {
  id: string;
  workflowVersionId: string;
  status: string;
  triggerType: string;
  inputPayload: unknown;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  stepRuns: Array<{
    id: string;
    status: string;
  }>;
};

type WorkflowRunSummaryRow = WorkflowRunBaseRow & {
  workflowVersion: WorkflowVersionSnapshotRow;
};

type WorkflowVersionSummaryRow = WorkflowVersionSnapshotRow & {
  runs?: WorkflowRunBaseRow[];
};

type ArtifactVersionRow = {
  id: string;
  workflowRunId: string;
  artifactKey: string;
  version: number;
  producerStepRunId: string;
  parentVersionId: string | null;
  status: string;
  contentUri: string;
  contentHash: string;
  createdAt: Date;
  acceptedAt: Date | null;
  producerStepRun?: {
    stepId: string;
  } | null;
};

type ArtifactSerializationContext = {
  workflow: WorkflowYaml;
  stepIdByStepRunId?: Map<string, string>;
};

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : undefined;
}

function apiEnum(value: string) {
  return value.toLowerCase();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function latestRun<TRun extends WorkflowRunBaseRow>(runs: TRun[]) {
  return [...runs].sort((left, right) => {
    const byCreatedAt = right.createdAt.getTime() - left.createdAt.getTime();
    return byCreatedAt || right.id.localeCompare(left.id);
  })[0];
}

function findOutputArtifact(
  workflow: WorkflowYaml,
  stepId: string | undefined,
  artifactKey: string
): ArtifactDefinition | undefined {
  if (stepId) {
    const step = workflow.steps.find((candidate) => candidate.id === stepId);
    const declared = step?.output_artifacts.find(
      (artifact) => artifact.artifact === artifactKey
    );

    if (declared) {
      return declared;
    }
  }

  return workflow.steps
    .flatMap((step) => step.output_artifacts)
    .find((artifact) => artifact.artifact === artifactKey);
}

function artifactStepId(
  artifact: ArtifactVersionRow,
  context: ArtifactSerializationContext
) {
  return (
    artifact.producerStepRun?.stepId ??
    context.stepIdByStepRunId?.get(artifact.producerStepRunId)
  );
}

export function serializeWorkflowDraft(workflow: WorkflowDraftRow) {
  return {
    id: workflow.id,
    name: workflow.name,
    draftYaml: parseWorkflowYaml(workflow.draftYaml),
    createdAt: isoDate(workflow.createdAt),
    updatedAt: isoDate(workflow.updatedAt)
  };
}

export function serializeWorkflowRunSummary(run: WorkflowRunSummaryRow) {
  const workflow = parseWorkflowYaml(run.workflowVersion.yamlSnapshot);
  const waitingStep = run.stepRuns.find((stepRun) =>
    WAITING_STEP_STATUSES.has(stepRun.status)
  );

  return {
    id: run.id,
    workflowVersionId: run.workflowVersionId,
    workflowId: run.workflowVersion.workflowId,
    workflowName: workflow.name,
    revision: run.workflowVersion.revision,
    status: apiEnum(run.status),
    triggerType: run.triggerType,
    inputPayload: jsonObject(run.inputPayload),
    createdAt: isoDate(run.createdAt),
    startedAt: isoDate(run.startedAt),
    completedAt: isoDate(run.completedAt),
    stepCount: run.stepRuns.length,
    completedStepCount: run.stepRuns.filter((stepRun) =>
      FINISHED_STEP_STATUSES.has(stepRun.status)
    ).length,
    waitingStepRunId: waitingStep?.id
  };
}

export function serializeWorkflowVersionSummary(version: WorkflowVersionSummaryRow) {
  const workflow = parseWorkflowYaml(version.yamlSnapshot);
  const lastRun = version.runs ? latestRun(version.runs) : undefined;

  return {
    id: version.id,
    workflowId: version.workflowId,
    revision: version.revision,
    workflowName: workflow.name,
    publishedAt: isoDate(version.publishedAt),
    contentHash: version.contentHash,
    lastRun: lastRun
      ? serializeWorkflowRunSummary({
          ...lastRun,
          workflowVersion: version
        })
      : undefined
  };
}

export function serializeWorkflowVersion(version: WorkflowVersionSummaryRow) {
  const lastRun = version.runs ? latestRun(version.runs) : undefined;

  return {
    id: version.id,
    workflowId: version.workflowId,
    revision: version.revision,
    yamlSnapshot: parseWorkflowYaml(version.yamlSnapshot),
    contentHash: version.contentHash,
    publishedAt: isoDate(version.publishedAt),
    lastRun: lastRun
      ? serializeWorkflowRunSummary({
          ...lastRun,
          workflowVersion: version
        })
      : undefined
  };
}

export function serializeWorkflowSummary(input: {
  workflow: WorkflowDraftRow;
  latestPublishedVersion?: WorkflowVersionSummaryRow;
  lastRun?: WorkflowRunSummaryRow;
}) {
  return {
    ...serializeWorkflowDraft(input.workflow),
    latestPublishedVersion: input.latestPublishedVersion
      ? serializeWorkflowVersionSummary(input.latestPublishedVersion)
      : undefined,
    lastRun: input.lastRun ? serializeWorkflowRunSummary(input.lastRun) : undefined
  };
}

export function serializeWorkflowDetail(input: {
  workflow: WorkflowDraftRow;
  versions: WorkflowVersionSummaryRow[];
  recentRuns: WorkflowRunSummaryRow[];
}) {
  return {
    ...serializeWorkflowDraft(input.workflow),
    versions: input.versions.map(serializeWorkflowVersionSummary),
    recentRuns: input.recentRuns.map(serializeWorkflowRunSummary)
  };
}

export function serializeArtifactVersion(
  artifact: ArtifactVersionRow,
  context: ArtifactSerializationContext
) {
  const declared = findOutputArtifact(
    context.workflow,
    artifactStepId(artifact, context),
    artifact.artifactKey
  );

  return {
    id: artifact.id,
    workflowRunId: artifact.workflowRunId,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    displayVersion: `v${artifact.version}`,
    producerStepRunId: artifact.producerStepRunId,
    parentVersionId: artifact.parentVersionId ?? undefined,
    status: apiEnum(artifact.status),
    contentUri: artifact.contentUri,
    contentHash: artifact.contentHash,
    filename: declared?.filename,
    format: declared?.format,
    createdAt: isoDate(artifact.createdAt),
    acceptedAt: isoDate(artifact.acceptedAt)
  };
}

export function serializeDecisionEvent(event: {
  id: string;
  workflowRunId: string;
  stepRunId: string;
  source: string;
  verdict: string;
  comment: string | null;
  targetStepId: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    workflowRunId: event.workflowRunId,
    stepRunId: event.stepRunId,
    source: apiEnum(event.source),
    verdict: apiEnum(event.verdict),
    comment: event.comment ?? undefined,
    targetStepId: event.targetStepId ?? undefined,
    createdAt: isoDate(event.createdAt)
  };
}

function serializeRunEvent(event: {
  id: string;
  workflowRunId: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}) {
  return {
    id: event.id,
    workflowRunId: event.workflowRunId,
    eventType: event.eventType,
    payload: jsonObject(event.payload),
    createdAt: isoDate(event.createdAt)
  };
}

function serializeToolInvocation(invocation: {
  id: string;
  stepRunId: string;
  toolName: string;
  status: string;
  argumentsRedacted: unknown;
  resultRef: string | null;
  createdAt: Date;
}) {
  return {
    id: invocation.id,
    stepRunId: invocation.stepRunId,
    toolName: invocation.toolName,
    status: invocation.status,
    argumentsRedacted: jsonObject(invocation.argumentsRedacted),
    resultRef: invocation.resultRef ?? undefined,
    createdAt: isoDate(invocation.createdAt)
  };
}

function serializeContextPathEvent(event: {
  id: string;
  stepRunId: string;
  path: string;
  type: string;
  status: string;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    stepRunId: event.stepRunId,
    path: event.path,
    type: event.type,
    status: event.status,
    reason: event.reason ?? undefined,
    createdAt: isoDate(event.createdAt)
  };
}

function serializeCodexInteractionEvent(event: {
  id: string;
  stepRunId: string;
  attempt: number;
  sequence: number;
  externalItemId: string | null;
  kind: string;
  status: string;
  payload: unknown;
  createdAt: Date;
}) {
  return {
    id: event.id,
    stepRunId: event.stepRunId,
    attempt: event.attempt,
    sequence: event.sequence,
    externalItemId: event.externalItemId ?? undefined,
    kind: event.kind,
    status: event.status,
    payload: jsonObject(event.payload),
    createdAt: isoDate(event.createdAt)
  };
}

function serializeCodeChangeRecord(change: {
  id: string;
  stepRunId: string;
  codeWorkspaceId: string;
  beforeCommit: string;
  afterCommit: string | null;
  diffUri: string | null;
  diffHash: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: change.id,
    stepRunId: change.stepRunId,
    codeWorkspaceId: change.codeWorkspaceId,
    beforeCommit: change.beforeCommit,
    afterCommit: change.afterCommit ?? undefined,
    diffUri: change.diffUri ?? undefined,
    diffHash: change.diffHash ?? undefined,
    status: change.status,
    createdAt: isoDate(change.createdAt)
  };
}

function serializeStepRunArtifactInput(
  input: {
    id: string;
    stepRunId: string;
    artifactKey: string;
    artifactVersionId: string;
    artifactVersion: ArtifactVersionRow;
  },
  context: ArtifactSerializationContext
) {
  return {
    id: input.id,
    stepRunId: input.stepRunId,
    artifactKey: input.artifactKey,
    artifactVersionId: input.artifactVersionId,
    artifactVersion: serializeArtifactVersion(input.artifactVersion, context)
  };
}

export function serializeStepRunDetail(
  stepRun: StepRunSerializableRow,
  context: ArtifactSerializationContext
) {
  return {
    id: stepRun.id,
    workflowRunId: stepRun.workflowRunId,
    stepId: stepRun.stepId,
    attempt: stepRun.attempt,
    status: apiEnum(stepRun.status),
    evaluator: apiEnum(stepRun.evaluator),
    upstreamStepRunId: stepRun.upstreamStepRunId ?? undefined,
    downstreamStepRunId: stepRun.downstreamStepRunId ?? undefined,
    codexThreadId: stepRun.codexThreadId ?? undefined,
    promptSnapshot: stepRun.promptSnapshot ?? undefined,
    codexOptions: jsonObject(stepRun.codexOptions),
    codexFinalResponse: stepRun.codexFinalResponse ?? undefined,
    codexUsage: stepRun.codexUsage ? jsonObject(stepRun.codexUsage) : undefined,
    codexError: stepRun.codexError ? jsonObject(stepRun.codexError) : undefined,
    codexCompletedAt: isoDate(stepRun.codexCompletedAt),
    codeWorkspaceId: stepRun.codeWorkspaceId ?? undefined,
    beforeCommit: stepRun.beforeCommit ?? undefined,
    afterCommit: stepRun.afterCommit ?? undefined,
    requiresCodeReview: stepRun.requiresCodeReview,
    staleReason: stepRun.staleReason ?? undefined,
    createdAt: isoDate(stepRun.createdAt),
    startedAt: isoDate(stepRun.startedAt),
    completedAt: isoDate(stepRun.completedAt),
    artifactInputs: stepRun.artifactInputs.map((input) =>
      serializeStepRunArtifactInput(input, context)
    ),
    producedArtifacts: stepRun.producedArtifacts.map((artifact) =>
      serializeArtifactVersion(artifact, context)
    ),
    decisionEvents: stepRun.decisionEvents.map(serializeDecisionEvent),
    toolInvocations: stepRun.toolInvocations.map(serializeToolInvocation),
    contextPathEvents: stepRun.contextPathEvents.map(serializeContextPathEvent),
    codexInteractions: stepRun.codexInteractions.map(
      serializeCodexInteractionEvent
    ),
    codeChangeRecords: stepRun.codeChangeRecords.map(serializeCodeChangeRecord)
  };
}

export function serializeWorkflowRunDetail(run: WorkflowRunDetailRow) {
  const workflow = parseWorkflowYaml(run.workflowVersion.yamlSnapshot);
  const stepIdByStepRunId = new Map(
    run.stepRuns.map((stepRun) => [stepRun.id, stepRun.stepId])
  );
  const context = {
    workflow,
    stepIdByStepRunId
  };

  return {
    ...serializeWorkflowRunSummary(run),
    workflow,
    stepRuns: run.stepRuns.map((stepRun) =>
      serializeStepRunDetail(stepRun, context)
    ),
    artifactVersions: run.artifactVersions.map((artifact) =>
      serializeArtifactVersion(artifact, context)
    ),
    decisionEvents: run.decisionEvents.map(serializeDecisionEvent),
    runEvents: run.runEvents.map(serializeRunEvent),
    codeWorkspaces: run.codeWorkspaces.map((workspace) => ({
      id: workspace.id,
      workflowRunId: workspace.workflowRunId,
      repoPath: workspace.repoPath,
      baseRef: workspace.baseRef,
      worktreePath: workspace.worktreePath,
      baseCommit: workspace.baseCommit,
      createdAt: isoDate(workspace.createdAt),
      changes: workspace.changes.map(serializeCodeChangeRecord)
    }))
  };
}

export function serializeStandaloneStepRunDetail(stepRun: StepRunDetailRow) {
  const workflow = parseWorkflowYaml(stepRun.workflowRun.workflowVersion.yamlSnapshot);
  const context = {
    workflow,
    stepIdByStepRunId: new Map([[stepRun.id, stepRun.stepId]])
  };

  return serializeStepRunDetail(stepRun, context);
}

export function serializeStandaloneRunEvent(event: {
  id: string;
  workflowRunId: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}) {
  return serializeRunEvent(event);
}

export function artifactMimeType(format: string | undefined) {
  return format === "plain_text" ? "text/plain" : "text/markdown";
}
