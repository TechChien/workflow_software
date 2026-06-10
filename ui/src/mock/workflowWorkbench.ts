import type { StepDefinition, WorkflowYaml } from "@workflow-software/shared";

export type StepRunStatus =
  | "pending"
  | "ready"
  | "running"
  | "codex_completed"
  | "waiting_for_codex_permission"
  | "waiting_for_codex_question"
  | "waiting_for_human_review"
  | "waiting_for_evaluator_feedback"
  | "accepted"
  | "rejected"
  | "failed"
  | "stale";

export type WorkflowRunStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type ComponentTemplate = {
  id: string;
  idPrefix: string;
  name: string;
  purpose: string;
  meta: string;
  defaults: Omit<StepDefinition, "id" | "upstream" | "downstream">;
};

export type PublishedWorkflow = {
  id: string;
  revision: number;
  publishedAt: string;
  workflow: WorkflowYaml;
  lastRunStatus: WorkflowRunStatus;
};

export type StepRunRecord = {
  id: string;
  stepId: string;
  status: StepRunStatus;
  attempt: number;
  evaluator: StepDefinition["evaluate"]["evaluator"];
  artifacts: Array<{ key: string; version: string; status: string }>;
  codexUsage?: { inputTokens: number; outputTokens: number };
  codexError?: string;
  staleReason?: string;
};

export type RunRecord = {
  id: string;
  workflowVersionId: string;
  workflowName: string;
  revision: number;
  status: WorkflowRunStatus;
  startedAt: string;
  completedAt?: string;
  workflow: WorkflowYaml;
  stepRuns: StepRunRecord[];
};

export const sampleSteps: StepDefinition[] = [
  {
    id: "g1_intent_freeze",
    name: "G1 Intent Freeze",
    type: "agent",
    downstream: "g2_gap_analysis",
    input_artifacts: [],
    output_artifacts: [{ artifact: "g1_requirements", filename: "requirements.md", format: "markdown" }],
    context_paths: [],
    tool_capabilities: ["*"],
    evaluate: { evaluator: "mixed" },
    prompt: "Convert the original request into intent-layer requirements.",
    acceptance: {
      criteria: [
        "No implementation-layer details.",
        "Every requirement is traceable to the original request."
      ]
    }
  },
  {
    id: "g2_gap_analysis",
    name: "G2 Gap Analysis",
    type: "code_agent",
    upstream: "g1_intent_freeze",
    downstream: "g3_decision_split",
    input_artifacts: [{ artifact: "g1_requirements", required: true }],
    output_artifacts: [
      { artifact: "g2_gap_summary", filename: "g2-gap-summary.md", format: "markdown" },
      { artifact: "g2_evidence_index", filename: "g2-evidence-index.md", format: "markdown" }
    ],
    context_paths: [{ path: "src", type: "directory", optional: true }],
    tool_capabilities: ["*"],
    evaluate: { evaluator: "human_review" },
    prompt: "Inspect the accepted artifact inputs and optional worktree-relative context.",
    acceptance: {
      criteria: [
        "Every codebase claim must cite file and line evidence.",
        "Each identified gap explains its impact."
      ]
    }
  },
  {
    id: "g3_decision_split",
    name: "G3 Decision Split",
    type: "agent",
    upstream: "g2_gap_analysis",
    input_artifacts: [
      { artifact: "g2_gap_summary", required: true },
      { artifact: "g2_evidence_index", required: true }
    ],
    output_artifacts: [{ artifact: "g3_plan", filename: "implementation-plan.md", format: "markdown" }],
    context_paths: [],
    tool_capabilities: ["*"],
    evaluate: { evaluator: "mixed" },
    prompt: "Turn the accepted gap analysis into an implementation-ready plan.",
    acceptance: {
      criteria: ["The plan is decision-complete.", "Risks and test scenarios are explicit."]
    }
  }
];

export const componentTemplates: ComponentTemplate[] = [
  {
    id: "agent-step",
    idPrefix: "agent_step",
    name: "Agent Step",
    purpose: "General Codex reasoning step that writes text artifacts.",
    meta: "agent / mixed evaluator",
    defaults: {
      name: "Agent Step",
      type: "agent",
      input_artifacts: [],
      output_artifacts: [{ artifact: "agent_output", filename: "agent-output.md", format: "markdown" }],
      context_paths: [],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "mixed" },
      prompt: "Describe the task this agent should complete.",
      acceptance: { criteria: ["Output matches the requested scope."] }
    }
  },
  {
    id: "code-agent-step",
    idPrefix: "code_agent_step",
    name: "Code Agent Step",
    purpose: "Code-aware step that can inspect workspace context.",
    meta: "code_agent / human review",
    defaults: {
      name: "Code Agent Step",
      type: "code_agent",
      input_artifacts: [],
      output_artifacts: [{ artifact: "code_change_summary", filename: "change-summary.md", format: "markdown" }],
      context_paths: [{ path: "src", type: "directory", optional: true }],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "human_review" },
      prompt: "Inspect the workspace context and produce the requested code change summary.",
      acceptance: { criteria: ["Every codebase claim cites file evidence."] }
    }
  },
  {
    id: "human-review-gate",
    idPrefix: "human_review_gate",
    name: "Human Review Gate",
    purpose: "Pause the workflow for approval or steering feedback.",
    meta: "agent / human_review evaluator",
    defaults: {
      name: "Human Review Gate",
      type: "agent",
      input_artifacts: [],
      output_artifacts: [{ artifact: "review_decision", filename: "review-decision.md", format: "markdown" }],
      context_paths: [],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "human_review" },
      prompt: "Summarize the decision needed from the reviewer.",
      acceptance: { criteria: ["The decision request is clear and actionable."] }
    }
  },
  {
    id: "artifact-output",
    idPrefix: "artifact_output",
    name: "Artifact Output",
    purpose: "Produce a named formal artifact for downstream steps.",
    meta: "agent / declared output",
    defaults: {
      name: "Artifact Output",
      type: "agent",
      input_artifacts: [],
      output_artifacts: [{ artifact: "formal_artifact", filename: "artifact.md", format: "markdown" }],
      context_paths: [],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "mixed" },
      prompt: "Create the formal artifact exactly as declared.",
      acceptance: { criteria: ["The declared artifact file is complete."] }
    }
  }
];

export const initialNodePositions: Record<string, { x: number; y: number }> = {
  g1_intent_freeze: { x: 80, y: 120 },
  g2_gap_analysis: { x: 390, y: 120 },
  g3_decision_split: { x: 700, y: 120 }
};

export const initialPublished: PublishedWorkflow[] = [
  {
    id: "version-requirement-analysis-r2",
    revision: 2,
    publishedAt: "2026-06-09 21:20",
    lastRunStatus: "completed",
    workflow: createMockWorkflowYaml("requirement-analysis-flow", "Requirement Analysis Flow", sampleSteps)
  }
];

export const initialRuns: RunRecord[] = [
  {
    id: "run-20260609-1027",
    workflowVersionId: "version-requirement-analysis-r2",
    workflowName: "Requirement Analysis Flow",
    revision: 2,
    status: "completed",
    startedAt: "2026-06-09 21:32",
    completedAt: "2026-06-09 21:38",
    workflow: createMockWorkflowYaml("requirement-analysis-flow", "Requirement Analysis Flow", sampleSteps),
    stepRuns: [
      {
        id: "step-run-g1-r2",
        stepId: "g1_intent_freeze",
        status: "accepted",
        attempt: 1,
        evaluator: "mixed",
        artifacts: [{ key: "g1_requirements", version: "v2", status: "accepted" }],
        codexUsage: { inputTokens: 3182, outputTokens: 928 }
      },
      {
        id: "step-run-g2-r2",
        stepId: "g2_gap_analysis",
        status: "accepted",
        attempt: 2,
        evaluator: "human_review",
        artifacts: [
          { key: "g2_gap_summary", version: "v2", status: "accepted" },
          { key: "g2_evidence_index", version: "v2", status: "accepted" }
        ],
        codexUsage: { inputTokens: 8194, outputTokens: 2142 }
      },
      {
        id: "step-run-g3-r2",
        stepId: "g3_decision_split",
        status: "accepted",
        attempt: 1,
        evaluator: "mixed",
        artifacts: [{ key: "g3_plan", version: "v1", status: "accepted" }],
        codexUsage: { inputTokens: 4440, outputTokens: 1375 }
      }
    ]
  }
];

function createMockWorkflowYaml(id: string, name: string, steps: StepDefinition[]): WorkflowYaml {
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
