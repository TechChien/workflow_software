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
