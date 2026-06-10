"use client";

import { type StepDefinition } from "@workflow-software/shared";
import { type RunRecord, type StepRunRecord } from "@/mock/workflowWorkbench";
import { StatusBadge } from "./workbenchShared";

export function RunInspector({
  run,
  step,
  stepRun
}: {
  run: RunRecord;
  step?: StepDefinition;
  stepRun: StepRunRecord;
}) {
  return (
    <div className="inspector-stack">
      <div className="inspector-header">
        <div>
          <h2>Run Metadata</h2>
          <p>{run.id}</p>
        </div>
        <StatusBadge status={stepRun.status} label={stepRun.status} />
      </div>
      <dl className="metadata-list">
        <div>
          <dt>Step</dt>
          <dd>{step?.name ?? stepRun.stepId}</dd>
        </div>
        <div>
          <dt>Attempt</dt>
          <dd>{stepRun.attempt}</dd>
        </div>
        <div>
          <dt>Evaluator</dt>
          <dd>{stepRun.evaluator}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{run.startedAt}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{run.completedAt ?? "Still running"}</dd>
        </div>
      </dl>
      <section className="artifact-table">
        <div className="section-heading">
          <h2>Artifacts</h2>
          <span>{stepRun.artifacts.length}</span>
        </div>
        {stepRun.artifacts.length ? (
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stepRun.artifacts.map((artifact) => (
                <tr key={`${artifact.key}-${artifact.version}`}>
                  <td>{artifact.key}</td>
                  <td>{artifact.version}</td>
                  <td>{artifact.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No artifacts recorded for this step yet.</p>
        )}
      </section>
      <section className="metadata-card">
        <h2>Codex metadata</h2>
        {stepRun.codexUsage ? (
          <p>
            {stepRun.codexUsage.inputTokens.toLocaleString()} input tokens /{" "}
            {stepRun.codexUsage.outputTokens.toLocaleString()} output tokens
          </p>
        ) : (
          <p>No usage reported yet.</p>
        )}
        {stepRun.codexError ? <p role="alert">{stepRun.codexError}</p> : null}
        {stepRun.staleReason ? <p>{stepRun.staleReason}</p> : null}
      </section>
    </div>
  );
}
