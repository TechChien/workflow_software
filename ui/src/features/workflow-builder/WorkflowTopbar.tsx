"use client";

import { type PublishedWorkflow } from "@/mock/workflowWorkbench";
import { type DraftViewModel } from "./hooks/useDraftView";
import { Icon } from "./Icon";
import { StatusBadge, type LeftTab } from "./workbenchShared";

export function WorkflowTopbar({
  activeTab,
  draftView,
  isRunningWorkflow,
  onPublish,
  onRun,
  runErrorMessage,
  selectedPublishedWorkflow
}: {
  activeTab: LeftTab;
  draftView: DraftViewModel;
  isRunningWorkflow?: boolean;
  onPublish: () => void | Promise<void>;
  onRun: () => void | Promise<void>;
  runErrorMessage?: string;
  selectedPublishedWorkflow?: PublishedWorkflow;
}) {
  const statusMessage = draftView.publishErrorMessage ?? draftView.saveErrorMessage;
  const hasDraftCanvasNode = draftView.nodes.length > 0;
  const isDraftTab = activeTab === "draft";
  const isPublishedTab = activeTab === "published";
  const canSaveDraft =
    isDraftTab && hasDraftCanvasNode && !draftView.isSavingDraft && !draftView.isPublishingDraft;
  const canPublishDraft =
    isDraftTab && hasDraftCanvasNode && !draftView.isSavingDraft && !draftView.isPublishingDraft;
  const canRun = isPublishedTab && Boolean(selectedPublishedWorkflow) && !isRunningWorkflow;
  const draftActionTitle =
    !isDraftTab
      ? "Open the Draft tab to use draft actions"
      : !hasDraftCanvasNode
        ? "Add a node to the draft canvas first"
        : undefined;
  const runActionTitle = runErrorMessage
    ? `Run failed: ${runErrorMessage}`
    : canRun
    ? "Run selected published workflow"
    : isPublishedTab
      ? isRunningWorkflow
        ? "Starting workflow run"
        : "Select a published workflow before running"
      : "Open the Published tab to run a workflow";

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
      <div
        className="topbar-status"
        role={draftView.validation.kind === "error" || statusMessage ? "alert" : "status"}
      >
        <StatusBadge
          status={
            statusMessage
              ? "error"
              : draftView.isPublishingDraft
                ? "running"
              : draftView.isSavingDraft
                ? "running"
                : draftView.isDirty
                  ? "draft"
                  : "saved"
          }
          label={
            statusMessage
              ? draftView.publishErrorMessage
                ? "Publish failed"
                : "Save failed"
              : draftView.isPublishingDraft
                ? "Publishing draft"
              : draftView.isSavingDraft
                ? "Saving draft"
                : draftView.isDirty
                  ? "Draft changes"
                  : "Draft saved"
          }
        />
        <StatusBadge
          status={draftView.validation.kind}
          label={`${draftView.validation.summary} / ${draftView.steps.length} steps`}
        />
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void draftView.saveDraft()}
          disabled={!canSaveDraft}
          title={draftView.saveErrorMessage ?? draftActionTitle}
        >
          <Icon name="save" />
          {draftView.isSavingDraft ? "Saving" : "Save Draft"}
        </button>
        <button
          type="button"
          className="toolbar-button publish-button"
          onClick={() => void onPublish()}
          disabled={!canPublishDraft}
          title={draftView.publishErrorMessage ?? draftActionTitle}
        >
          <Icon name="upload" />
          {draftView.isPublishingDraft ? "Publishing" : "Publish"}
        </button>
        <button
          type="button"
          className="toolbar-button primary"
          onClick={() => void onRun()}
          disabled={!canRun}
          title={runActionTitle}
        >
          <Icon name="play" />
          {isRunningWorkflow ? "Starting" : "Run"}
        </button>
      </div>
    </header>
  );
}
