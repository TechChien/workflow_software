"use client";

import { type PublishedWorkflow } from "@/mock/workflowWorkbench";
import { StatusBadge } from "./workbenchShared";

export function PublishedList({
  errorMessage,
  isLoading,
  workflows,
  selectedId,
  onSelect,
  onRun
}: {
  errorMessage?: string;
  isLoading: boolean;
  workflows: PublishedWorkflow[];
  selectedId: string;
  onSelect: (workflow: PublishedWorkflow) => void;
  onRun: (workflow: PublishedWorkflow) => void | Promise<void>;
}) {
  return (
    <div className="panel-section" role="tabpanel">
      <div className="section-heading">
        <h2>Published Workflows</h2>
        <span>{workflows.length} versions</span>
      </div>
      {isLoading ? (
        <div className="empty-state" role="status">
          Loading published workflows...
        </div>
      ) : null}
      {errorMessage ? (
        <div className="empty-state" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {!isLoading && !errorMessage && workflows.length === 0 ? (
        <div className="empty-state" role="status">
          No published workflows yet.
        </div>
      ) : null}
      <div className="record-list">
        {workflows.map((workflow) => (
          <article
            key={workflow.id}
            className={`record-row ${selectedId === workflow.id ? "active" : ""}`}
          >
            <button type="button" className="record-main" onClick={() => onSelect(workflow)}>
              <span className="record-title">{workflow.workflow.name}</span>
              <span>r{workflow.revision} / {workflow.workflow.steps.length} steps</span>
              <span>{workflow.publishedAt}</span>
            </button>
            <span className="record-footer">
              <StatusBadge status={workflow.lastRunStatus} label={workflow.lastRunStatus} />
              <button type="button" className="inline-action" onClick={() => void onRun(workflow)}>
                Run
              </button>
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}
