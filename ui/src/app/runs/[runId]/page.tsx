import { CodexPausePanel } from "@/features/workflow-runs/CodexPausePanel";
import { HumanDecisionPanel } from "@/features/workflow-runs/HumanDecisionPanel";
import { RunStatusView } from "@/features/workflow-runs/RunStatusView";
import { StaleStepPanel } from "@/features/workflow-runs/StaleStepPanel";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  return (
    <main className="detail-page">
      <h1>Run {runId}</h1>
      <RunStatusView />
      <CodexPausePanel />
      <HumanDecisionPanel />
      <StaleStepPanel />
    </main>
  );
}
