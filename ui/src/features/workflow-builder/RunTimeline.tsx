import { type RunRecord } from "@/mock/workflowWorkbench";
import { StatusBadge } from "./workbenchShared";

export function RunTimeline({
  run,
  selectedStepRunId,
  onSelectStepRun,
  onOpenHistory
}: {
  run?: RunRecord;
  selectedStepRunId: string;
  onSelectStepRun: (stepRunId: string) => void;
  onOpenHistory: () => void;
}) {
  if (!run) {
    return (
      <section className="timeline-panel collapsed" role="status">
        <span>No run selected. Publish a version to enable runtime tracking.</span>
      </section>
    );
  }

  return (
    <section className="timeline-panel" aria-label="Run timeline">
      <div className="timeline-header">
        <div>
          <strong>{run.workflowName}</strong>
          <span>{run.id} / revision {run.revision}</span>
        </div>
        <button type="button" onClick={onOpenHistory}>
          Open History
        </button>
      </div>
      <ol className="timeline-steps">
        {run.stepRuns.map((stepRun, index) => {
          const step = run.workflow.steps.find((item) => item.id === stepRun.stepId);
          return (
            <li key={stepRun.id}>
              <button
                type="button"
                className={`timeline-step ${selectedStepRunId === stepRun.id ? "active" : ""}`}
                onClick={() => onSelectStepRun(stepRun.id)}
              >
                <span className="timeline-index">{index + 1}</span>
                <span className="timeline-copy">
                  <strong>{step?.name ?? stepRun.stepId}</strong>
                  <StatusBadge status={stepRun.status} label={stepRun.status} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
