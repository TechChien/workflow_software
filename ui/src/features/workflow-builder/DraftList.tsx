"use client";

import { type StepDefinition } from "@workflow-software/shared";
import { type DraftWorkflowRecord } from "./hooks/useDraftView";
import { Icon } from "./Icon";
import { StatusBadge } from "./workbenchShared";

export function DraftList({
  errorMessage,
  isLoading,
  workflows,
  selectedId,
  selectedDraftStep,
  onAddWorkflow,
  onSelect
}: {
  errorMessage?: string;
  isLoading: boolean;
  workflows: DraftWorkflowRecord[];
  selectedId: string;
  selectedDraftStep?: StepDefinition;
  onAddWorkflow: () => void;
  onSelect: (workflow: DraftWorkflowRecord) => void;
}) {
  return (
    <div className="panel-section draft-list-section">
      <div className="section-heading">
        <h2>Draft Workflows</h2>
        <button type="button" className="toolbar-button draft-add-button" onClick={onAddWorkflow}>
          <Icon name="plus" />
          Add Workflow
        </button>
      </div>
      <span className="draft-count">{workflows.length} drafts</span>
      {isLoading ? (
        <div className="empty-state" role="status">
          Loading draft workflows...
        </div>
      ) : null}
      {errorMessage ? (
        <div className="empty-state" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {!isLoading && !errorMessage && workflows.length === 0 ? (
        <div className="empty-state" role="status">
          No draft workflows yet.
        </div>
      ) : null}
      <div className="record-list">
        {workflows.map((workflow) => {
          const isSelectedWorkflow = selectedId === workflow.id;
          const hasSelectedStep = workflow.workflow.steps.some(
            (step) => step.id === selectedDraftStep?.id
          );
          const isCurrent = selectedDraftStep ? hasSelectedStep : isSelectedWorkflow;

          return (
            <article
              key={workflow.id}
              className={`record-row ${isSelectedWorkflow ? "active" : ""}`}
            >
              <button type="button" className="record-main" onClick={() => onSelect(workflow)}>
                <span className="record-title">{workflow.name}</span>
                <span>{workflow.workflow.steps.length} steps</span>
                <span>{workflow.updatedAt}</span>
              </button>
              <span className="record-footer">
                <StatusBadge
                  status={workflow.hasPublishedVersion ? "published" : "draft"}
                  label={workflow.hasPublishedVersion ? "Published" : "Draft"}
                />
                {isCurrent ? <span>Current</span> : null}
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
