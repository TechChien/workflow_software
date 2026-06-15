"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type StepDefinition } from "@workflow-software/shared";
import { useEffect, useState } from "react";
import type { HumanDecisionRequest } from "@/lib/api/api-contract";
import { workerApiQueryKeys } from "@/lib/api/query-keys";
import { type RunRecord, type StepRunRecord } from "@/mock/workflowWorkbench";
import { useArtifactVersion, useCreateHumanDecision } from "@/services/worker-api-service";
import { Icon } from "./Icon";
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
      {stepRun.status === "waiting_for_human_review" ? (
        <HumanReviewPanel run={run} step={step} stepRun={stepRun} />
      ) : null}
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
      {stepRun.decisionEvents.length ? (
        <section className="metadata-card decision-card">
          <h2>Decision events</h2>
          <div className="decision-list">
            {stepRun.decisionEvents.map((decision) => (
              <div key={decision.id} className="decision-row">
                <StatusBadge status={decision.verdict} label={`${decision.source} / ${decision.verdict}`} />
                <span>{formatDateTime(decision.createdAt)}</span>
                {decision.comment ? <p>{decision.comment}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
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

function HumanReviewPanel({
  run,
  step,
  stepRun
}: {
  run: RunRecord;
  step?: StepDefinition;
  stepRun: StepRunRecord;
}) {
  const queryClient = useQueryClient();
  const createDecisionMutation = useCreateHumanDecision();
  const firstArtifactId = stepRun.artifacts.find((artifact) => artifact.id)?.id ?? "";
  const [selectedArtifactId, setSelectedArtifactId] = useState(firstArtifactId);
  const [comment, setComment] = useState("");
  const selectedArtifact =
    stepRun.artifacts.find((artifact) => artifact.id === selectedArtifactId) ??
    stepRun.artifacts.find((artifact) => artifact.id);
  const artifactQuery = useArtifactVersion(
    selectedArtifact?.id,
    { includeContent: true },
    { enabled: Boolean(selectedArtifact?.id) }
  );
  const trimmedComment = comment.trim();
  const requiresCommentDisabled = !trimmedComment || createDecisionMutation.isPending;

  useEffect(() => {
    setSelectedArtifactId(firstArtifactId);
    setComment("");
  }, [firstArtifactId, stepRun.id]);

  const submitDecision = async (verdict: HumanDecisionRequest["verdict"]) => {
    const body: HumanDecisionRequest = {
      verdict,
      ...(trimmedComment ? { comment: trimmedComment } : {})
    };

    await createDecisionMutation.mutateAsync({
      stepRunId: stepRun.id,
      body
    });
    setComment("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workerApiQueryKeys.runs.detail(run.id) }),
      queryClient.invalidateQueries({ queryKey: workerApiQueryKeys.runs.all }),
      queryClient.invalidateQueries({ queryKey: workerApiQueryKeys.workflows.all }),
      queryClient.invalidateQueries({ queryKey: workerApiQueryKeys.workflowVersions.all })
    ]);
  };

  return (
    <section className="metadata-card review-card" aria-label="Human review">
      <div className="section-heading">
        <h2>Human Review</h2>
        <span>{step?.acceptance.criteria.length ?? 0} criteria</span>
      </div>
      {step?.acceptance.criteria.length ? (
        <ul className="criteria-list">
          {step.acceptance.criteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      ) : null}
      {stepRun.artifacts.length ? (
        <div className="review-artifacts">
          <div className="review-artifact-tabs" aria-label="Artifact previews">
            {stepRun.artifacts.map((artifact) => (
              <button
                key={`${artifact.key}-${artifact.version}`}
                type="button"
                className={artifact.id === selectedArtifact?.id ? "active" : ""}
                disabled={!artifact.id}
                onClick={() => {
                  if (artifact.id) {
                    setSelectedArtifactId(artifact.id);
                  }
                }}
              >
                {artifact.key}
              </button>
            ))}
          </div>
          <pre className="review-artifact-content">
            {artifactQuery.isLoading
              ? "Loading artifact..."
              : artifactQuery.error
                ? `Unable to load artifact: ${artifactQuery.error.message}`
                : artifactQuery.data?.content ?? "No artifact content available."}
          </pre>
        </div>
      ) : (
        <p className="muted">No artifacts recorded for this step yet.</p>
      )}
      <label className="field">
        <span>Review comment</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Required for revision or rejection"
        />
      </label>
      {createDecisionMutation.error ? (
        <p className="field-warning" role="alert">
          {createDecisionMutation.error.message}
        </p>
      ) : null}
      <div className="button-row review-actions">
        <button
          type="button"
          className="primary"
          disabled={createDecisionMutation.isPending}
          onClick={() => void submitDecision("approve")}
        >
          <Icon name="check" />
          Approve
        </button>
        <button
          type="button"
          disabled={requiresCommentDisabled}
          onClick={() => void submitDecision("request_revision")}
        >
          <Icon name="revision" />
          Request Revision
        </button>
        <button
          type="button"
          className="danger"
          disabled={requiresCommentDisabled}
          onClick={() => void submitDecision("reject")}
        >
          <Icon name="reject" />
          Reject
        </button>
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
