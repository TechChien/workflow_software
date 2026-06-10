"use client";

import { type DraftViewModel } from "./DraftView";
import { Icon } from "./Icon";
import { StatusBadge } from "./workbenchShared";

export function WorkflowTopbar({
  canRun,
  draftView,
  onPublish,
  onRun
}: {
  canRun: boolean;
  draftView: DraftViewModel;
  onPublish: () => void;
  onRun: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <label htmlFor="workflow-name">Workflow</label>
        <input
          id="workflow-name"
          value={draftView.workflowName}
          onChange={(event) => draftView.renameWorkflow(event.target.value)}
          aria-label="Workflow name"
        />
      </div>
      <div className="topbar-status" role={draftView.validation.kind === "error" ? "alert" : "status"}>
        <StatusBadge
          status={draftView.isDirty ? "draft" : "saved"}
          label={draftView.isDirty ? "Draft changes" : "Draft saved"}
        />
        <StatusBadge
          status={draftView.validation.kind}
          label={`${draftView.validation.summary} / ${draftView.steps.length} steps`}
        />
      </div>
      <div className="topbar-actions">
        <button type="button" className="toolbar-button" onClick={draftView.saveDraft}>
          <Icon name="save" />
          Save Draft
        </button>
        <button
          type="button"
          className="toolbar-button publish-button"
          onClick={onPublish}
          disabled={draftView.validation.kind === "error"}
        >
          <Icon name="upload" />
          Publish
        </button>
        <button
          type="button"
          className="toolbar-button primary"
          onClick={onRun}
          disabled={!canRun}
          title={canRun ? "Run latest selected published workflow" : "Publish a workflow before running"}
        >
          <Icon name="play" />
          Run
        </button>
      </div>
    </header>
  );
}
