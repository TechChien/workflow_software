"use client";

import { type RunRecord } from "@/mock/workflowWorkbench";
import { StatusBadge } from "./workbenchShared";

export function RunHistoryList({
  runs,
  selectedId,
  onSelect
}: {
  runs: RunRecord[];
  selectedId: string;
  onSelect: (run: RunRecord) => void;
}) {
  return (
    <div className="panel-section" role="tabpanel">
      <div className="section-heading">
        <h2>Run History</h2>
        <span>{runs.length} runs</span>
      </div>
      <div className="record-list">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={`record-row ${selectedId === run.id ? "active" : ""}`}
            onClick={() => onSelect(run)}
          >
            <span className="record-title">{run.id}</span>
            <span>{run.workflowName} / r{run.revision}</span>
            <span>{run.startedAt}{run.completedAt ? ` - ${run.completedAt}` : ""}</span>
            <StatusBadge status={run.status} label={run.status} />
          </button>
        ))}
      </div>
    </div>
  );
}
