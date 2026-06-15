"use client";

import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { type ContextPath, type StepDefinition, type WorkflowYaml } from "@workflow-software/shared";
import { type ReactNode } from "react";
import {
  type PublishedWorkflow,
  type StepRunRecord,
  type StepRunStatus
} from "@/mock/workflowWorkbench";

export type WorkbenchView = "draft" | "published" | "run";
export type LeftTab = "draft" | "published" | "history";

export type CanvasNodeData = Record<string, unknown> & {
  label: ReactNode;
  stepId: string;
};
export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`status-badge ${statusTone(status)}`}>
      <span className="status-glyph" aria-hidden="true" />
      {label}
    </span>
  );
}

function StepNodeLabel({
  step,
  status,
  readOnly
}: {
  step: StepDefinition;
  status?: StepRunStatus;
  readOnly?: boolean;
}) {
  return (
    <div className="step-node-label">
      <div>
        <strong>{step.name ?? step.id}</strong>
        <span>{step.type} / {step.evaluate.evaluator}</span>
      </div>
      <StatusBadge status={status ?? (readOnly ? "published" : "draft")} label={status ?? (readOnly ? "snapshot" : "draft")} />
    </div>
  );
}

export function createWorkflowYaml(id: string, name: string, steps: StepDefinition[]): WorkflowYaml {
  return {
    id,
    name,
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps,
    ui: {}
  };
}

export function createNode(
  step: StepDefinition,
  position: { x: number; y: number },
  status?: StepRunStatus,
  readOnly = false
): CanvasNode {
  return {
    id: step.id,
    position,
    type: "default",
    className: `workflow-node ${statusTone(status ?? (readOnly ? "published" : "draft"))}`,
    data: {
      stepId: step.id,
      label: <StepNodeLabel step={step} status={status} readOnly={readOnly} />
    }
  };
}

export function createNodes(
  steps: StepDefinition[],
  positions: Record<string, { x: number; y: number }> = {},
  statuses?: Record<string, StepRunStatus>,
  readOnly = false
) {
  return steps.map((step, index) =>
    createNode(
      step,
      positions[step.id] ?? { x: 80 + index * 300, y: 120 + (index % 2) * 96 },
      statuses?.[step.id],
      readOnly
    )
  );
}

export function hydrateNodes(nodes: CanvasNode[], steps: StepDefinition[]) {
  return nodes.map((node, index) => {
    const step = steps.find((item) => item.id === node.data.stepId) ?? steps[index];
    if (!step) {
      return node;
    }
    return {
      ...node,
      className: `workflow-node ${statusTone("draft")}`,
      data: {
        ...node.data,
        label: <StepNodeLabel step={step} />
      }
    };
  });
}

export function createEdgesFromSteps(steps: StepDefinition[]): CanvasEdge[] {
  return steps.flatMap((step) =>
    step.depends_on
      .filter((dependencyId) => dependencyId !== step.id)
      .map((dependencyId) => ({
        id: `${dependencyId}-${step.id}`,
        source: dependencyId,
        target: step.id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed }
      }))
  );
}

export function stepsWithConnections(steps: StepDefinition[], edges: CanvasEdge[]): StepDefinition[] {
  const stepsById = new Map(steps.map((step) => [step.id, step]));

  return steps.map((step) => {
    const { upstream: _upstream, downstream: _downstream, ...stepWithoutLegacy } =
      step as StepDefinition & { upstream?: string; downstream?: string };
    const incoming = edges.filter((edge) => edge.target === step.id);
    const depends_on = Array.from(
      new Set(incoming.map((edge) => edge.source).filter((source) => source !== step.id))
    );
    const dependencyOutputArtifacts = depends_on.flatMap(
      (dependencyId) => stepsById.get(dependencyId)?.output_artifacts.map((artifact) => artifact.artifact) ?? []
    );

    return {
      ...stepWithoutLegacy,
      depends_on,
      input_artifacts: appendMissingInputArtifacts(stepWithoutLegacy.input_artifacts, dependencyOutputArtifacts)
    };
  });
}

function appendMissingInputArtifacts(
  inputArtifacts: StepDefinition["input_artifacts"],
  dependencyOutputArtifacts: string[]
) {
  const existingArtifacts = new Set(inputArtifacts.map((artifact) => artifact.artifact));
  const appendedArtifacts = dependencyOutputArtifacts.flatMap((artifact) => {
    if (existingArtifacts.has(artifact)) {
      return [];
    }

    existingArtifacts.add(artifact);
    return [{ artifact, required: true }];
  });

  return [...inputArtifacts, ...appendedArtifacts];
}

export function statusByStepId(stepRuns: StepRunRecord[]) {
  return stepRuns.reduce<Record<string, StepRunStatus>>((accumulator, stepRun) => {
    accumulator[stepRun.stepId] = stepRun.status;
    return accumulator;
  }, {});
}

export function nextStepId(prefix: string, steps: StepDefinition[]) {
  let counter = steps.length + 1;
  let candidate = `${prefix}_${counter}`;
  const existingIds = new Set(steps.map((step) => step.id));

  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${prefix}_${counter}`;
  }

  return candidate;
}

export function validateDraft(steps: StepDefinition[], edges: CanvasEdge[]) {
  const emptyPrompts = steps.filter((step) => !step.prompt.trim()).length;
  const duplicateIds = steps.length - new Set(steps.map((step) => step.id)).size;
  const selfEdges = edges.filter((edge) => edge.source === edge.target).length;
  const invalidEdges = edges.filter(
    (edge) => !steps.some((step) => step.id === edge.source) || !steps.some((step) => step.id === edge.target)
  ).length;

  if (!steps.length) {
    return { kind: "error", summary: "No steps" };
  }

  if (duplicateIds || invalidEdges || selfEdges) {
    return { kind: "error", summary: "Invalid graph" };
  }

  if (emptyPrompts) {
    return { kind: "waiting", summary: `${emptyPrompts} prompt gaps` };
  }

  return { kind: "ready", summary: "Ready to publish" };
}

export function createRunRecord(workflow: PublishedWorkflow) {
  const stepRuns = workflow.workflow.steps.map<StepRunRecord>((step, index) => {
    const status: StepRunStatus = index === 0 ? "accepted" : index === 1 ? "running" : "pending";
    return {
      id: `step-run-${step.id}-${Date.now()}-${index}`,
      stepId: step.id,
      status,
      attempt: 1,
      evaluator: step.evaluate.evaluator,
      artifacts: step.output_artifacts.map((artifact) => ({
        key: artifact.artifact,
        version: status === "pending" ? "queued" : "v1",
        status: status === "accepted" ? "accepted" : status
      })),
      decisionEvents: [],
      codexUsage: status === "accepted" ? { inputTokens: 2400 + index * 860, outputTokens: 720 + index * 210 } : undefined
    };
  });

  return {
    id: `run-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`,
    workflowVersionId: workflow.id,
    workflowName: workflow.workflow.name,
    revision: workflow.revision,
    status: "running" as const,
    startedAt: formatDateTime(new Date()),
    workflow: workflow.workflow,
    stepRuns
  };
}

export function formatDateTime(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseContextPaths(value: string): ContextPath[] {
  return lines(value).map((line) => {
    const [path, type, optional] = line.split("|").map((part) => part.trim());
    return {
      path: path || "src",
      type: type === "file" ? "file" : "directory",
      optional: optional !== "required"
    };
  });
}

export function statusTone(status: string) {
  if (["running", "ready"].includes(status)) {
    return "tone-blue";
  }
  if (
    status.startsWith("waiting") ||
    ["draft", "pending", "mixed", "human_review", "evaluator_review", "request_revision"].includes(status)
  ) {
    return "tone-amber";
  }
  if (["accepted", "completed", "published", "saved", "approve"].includes(status)) {
    return "tone-green";
  }
  if (["rejected", "reject", "failed", "stale", "error"].includes(status)) {
    return "tone-red";
  }
  if (status === "readonly") {
    return "tone-neutral";
  }
  return "tone-neutral";
}

export function viewModeLabel(viewMode: WorkbenchView) {
  if (viewMode === "published") {
    return "Published workflow snapshot";
  }
  if (viewMode === "run") {
    return "Run status snapshot";
  }
  return "Editable draft canvas";
}
