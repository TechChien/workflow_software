"use client";

import { stringifyWorkflowYaml } from "@workflow-software/shared";
import { type PublishedWorkflow } from "@/mock/workflowWorkbench";
import { StatusBadge } from "./workbenchShared";

export function PublishedInspector({
  workflow,
  onCreateDraft,
  onRun
}: {
  workflow: PublishedWorkflow;
  onCreateDraft: (workflow: PublishedWorkflow) => void;
  onRun: (workflow: PublishedWorkflow) => void;
}) {
  const yaml = stringifyWorkflowYaml(workflow.workflow);

  return (
    <div className="inspector-stack">
      <div className="inspector-header">
        <div>
          <h2>Published Version</h2>
          <p>{workflow.id}</p>
        </div>
        <StatusBadge status="published" label={`r${workflow.revision}`} />
      </div>
      <dl className="metadata-list">
        <div>
          <dt>Name</dt>
          <dd>{workflow.workflow.name}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{workflow.publishedAt}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{workflow.workflow.steps.length}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>
            <StatusBadge status={workflow.lastRunStatus} label={workflow.lastRunStatus} />
          </dd>
        </div>
      </dl>
      <div className="button-row">
        <button type="button" onClick={() => onCreateDraft(workflow)}>
          Create Draft from Version
        </button>
        <button type="button" className="primary" onClick={() => onRun(workflow)}>
          Run
        </button>
      </div>
      <section className="yaml-preview" aria-label="Published YAML snapshot">
        <div className="section-heading">
          <h2>YAML Snapshot</h2>
          <span>immutable</span>
        </div>
        <pre>{yaml}</pre>
      </section>
    </div>
  );
}
