import { ArtifactPanel } from "@/features/workflow-builder/ArtifactPanel";
import { RunTimeline } from "@/features/workflow-builder/RunTimeline";
import { StepInspector } from "@/features/workflow-builder/StepInspector";
import { WorkflowCanvas } from "@/features/workflow-builder/WorkflowCanvas";
import { YamlPanel } from "@/features/workflow-builder/YamlPanel";

const sampleYaml = `id: requirement-analysis-flow
name: Requirement Analysis Flow
version: 0.1.0
steps:
  - id: g1_intent_freeze
    type: agent
    evaluate:
      evaluator: mixed
    downstream: g2_gap_analysis
    output_artifacts:
      - artifact: g1_requirements
        filename: requirements.md
    acceptance:
      criteria:
        - No implementation-layer details.
        - Every requirement is traceable to the original request.
  - id: g2_gap_analysis
    type: code_agent
    evaluate:
      evaluator: human_review
    upstream: g1_intent_freeze
    output_artifacts:
      - artifact: g2_gap_summary
        filename: g2-gap-summary.md
    acceptance:
      criteria:
        - Every codebase claim must cite file and line evidence.
        - Each identified gap explains its impact.
`;

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <strong>Workflow Builder</strong>
          <span>Draft YAML to published Codex runtime</span>
        </div>
        <div className="topbar-actions">
          <button type="button">Publish</button>
          <button type="button" className="primary">
            Run
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <h2>Steps</h2>
          <p>Linear chain, multiple artifacts per step.</p>
          <RunTimeline />
          <ArtifactPanel />
        </aside>

        <WorkflowCanvas />

        <aside className="inspector">
          <StepInspector />
          <YamlPanel yaml={sampleYaml} />
        </aside>
      </section>
    </main>
  );
}
