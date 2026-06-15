import { describe, expect, it } from "vitest";
import { stringifyWorkflowYaml } from "@workflow-software/shared";
import {
  serializeWorkflowRunDetail,
  type WorkflowRunDetailRow
} from "../src/api/serializers.js";

describe("API serializers", () => {
  it("normalizes Prisma rows to the OpenAPI response shape", () => {
    const now = new Date("2026-06-11T01:00:00.000Z");
    const workflow = {
      id: "workflow-yaml-1",
      name: "Serializer Contract Workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: [
        {
          id: "step-1",
          type: "agent" as const,
          input_artifacts: [],
          output_artifacts: [
            {
              artifact: "summary",
              filename: "summary.md",
              format: "markdown" as const
            }
          ],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" as const },
          prompt: "Write a summary.",
          acceptance: { criteria: [] }
        }
      ],
      ui: {}
    };
    const artifact = {
      id: "artifact-version-1",
      workflowRunId: "run-1",
      artifactKey: "summary",
      version: 1,
      producerStepRunId: "step-run-1",
      parentVersionId: null,
      status: "ACCEPTED",
      contentUri: "artifact://workflows/workflow-db-1/runs/run-1/summary/v1",
      contentHash: "hash-1",
      createdAt: now,
      acceptedAt: now,
      producerStepRun: {
        stepId: "step-1"
      }
    };
    const row = {
      id: "run-1",
      workflowVersionId: "version-1",
      status: "COMPLETED",
      triggerType: "run_button",
      inputPayload: { issue: "123" },
      createdAt: now,
      startedAt: now,
      completedAt: now,
      workflowVersion: {
        id: "version-1",
        workflowId: "workflow-db-1",
        revision: 2,
        yamlSnapshot: stringifyWorkflowYaml(workflow),
        contentHash: "workflow-hash",
        publishedAt: now
      },
      stepRuns: [
        {
          id: "step-run-1",
          workflowRunId: "run-1",
          stepId: "step-1",
          attempt: 1,
          status: "ACCEPTED",
          evaluator: "HUMAN_REVIEW",
          upstreamStepRunId: null,
          downstreamStepRunId: null,
          codexThreadId: null,
          promptSnapshot: null,
          codexOptions: {},
          codexFinalResponse: null,
          codexUsage: null,
          codexError: null,
          codexCompletedAt: null,
          codeWorkspaceId: null,
          beforeCommit: null,
          afterCommit: null,
          requiresCodeReview: false,
          staleReason: null,
          createdAt: now,
          startedAt: now,
          completedAt: now,
          artifactInputs: [],
          producedArtifacts: [artifact],
          decisionEvents: [],
          toolInvocations: [],
          contextPathEvents: [],
          codexInteractions: [
            {
              id: "interaction-1",
              stepRunId: "step-run-1",
              attempt: 2,
              sequence: 1,
              externalItemId: "message-1",
              kind: "item.completed",
              status: "completed",
              payload: { itemType: "agent_message" },
              createdAt: now
            }
          ],
          codeChangeRecords: []
        }
      ],
      artifactVersions: [artifact],
      decisionEvents: [
        {
          id: "decision-1",
          workflowRunId: "run-1",
          stepRunId: "step-run-1",
          source: "HUMAN",
          verdict: "APPROVE",
          comment: "Looks good.",
          targetStepId: null,
          createdAt: now
        }
      ],
      runEvents: [],
      codeWorkspaces: []
    } as unknown as WorkflowRunDetailRow;

    const serialized = serializeWorkflowRunDetail(row);

    expect(serialized).toMatchObject({
      id: "run-1",
      workflowId: "workflow-db-1",
      workflowName: "Serializer Contract Workflow",
      revision: 2,
      status: "completed",
      stepCount: 1,
      completedStepCount: 1,
      workflow: {
        name: "Serializer Contract Workflow"
      }
    });
    expect(serialized.stepRuns[0]).toMatchObject({
      status: "accepted",
      evaluator: "human_review",
      producedArtifacts: [
        {
          displayVersion: "v1",
          status: "accepted",
          filename: "summary.md",
          format: "markdown"
        }
      ]
    });
    expect(serialized.artifactVersions[0]).toMatchObject({
      displayVersion: "v1",
      status: "accepted",
      filename: "summary.md",
      format: "markdown"
    });
    expect(serialized.decisionEvents[0]).toMatchObject({
      source: "human",
      verdict: "approve"
    });
    expect(serialized.stepRuns[0]?.codexInteractions[0]).toMatchObject({
      attempt: 2,
      sequence: 1
    });
  });

  it("exposes the waiting step run id for human review gates", () => {
    const now = new Date("2026-06-11T01:00:00.000Z");
    const workflow = {
      id: "workflow-yaml-1",
      name: "Waiting Workflow",
      version: "0.1.0",
      inputs: {},
      artifacts: {},
      steps: [
        {
          id: "step-1",
          type: "agent" as const,
          input_artifacts: [],
          output_artifacts: [],
          context_paths: [],
          tool_capabilities: [],
          evaluate: { evaluator: "human_review" as const },
          prompt: "Write a summary.",
          acceptance: { criteria: [] }
        }
      ],
      ui: {}
    };
    const row = {
      id: "run-1",
      workflowVersionId: "version-1",
      status: "WAITING",
      triggerType: "run_button",
      inputPayload: {},
      createdAt: now,
      startedAt: now,
      completedAt: null,
      workflowVersion: {
        id: "version-1",
        workflowId: "workflow-db-1",
        revision: 1,
        yamlSnapshot: stringifyWorkflowYaml(workflow),
        contentHash: "workflow-hash",
        publishedAt: now
      },
      stepRuns: [
        {
          id: "step-run-1",
          status: "WAITING_FOR_HUMAN_REVIEW"
        }
      ]
    } as unknown as WorkflowRunDetailRow;

    const serialized = serializeWorkflowRunDetail({
      ...row,
      stepRuns: [
        {
          id: "step-run-1",
          workflowRunId: "run-1",
          stepId: "step-1",
          attempt: 1,
          status: "WAITING_FOR_HUMAN_REVIEW",
          evaluator: "HUMAN_REVIEW",
          upstreamStepRunId: null,
          downstreamStepRunId: null,
          codexThreadId: null,
          promptSnapshot: null,
          codexOptions: {},
          codexFinalResponse: null,
          codexUsage: null,
          codexError: null,
          codexCompletedAt: now,
          codeWorkspaceId: null,
          beforeCommit: null,
          afterCommit: null,
          requiresCodeReview: false,
          staleReason: null,
          createdAt: now,
          startedAt: now,
          completedAt: null,
          artifactInputs: [],
          producedArtifacts: [],
          decisionEvents: [],
          toolInvocations: [],
          contextPathEvents: [],
          codexInteractions: [],
          codeChangeRecords: []
        }
      ],
      artifactVersions: [],
      decisionEvents: [],
      runEvents: [],
      codeWorkspaces: []
    } as unknown as WorkflowRunDetailRow);

    expect(serialized).toMatchObject({
      status: "waiting",
      waitingStepRunId: "step-run-1",
      completedStepCount: 0
    });
  });
});
