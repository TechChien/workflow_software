"use client";

import { type StepDefinition } from "@workflow-software/shared";
import { lines, parseContextPaths, StatusBadge } from "./workbenchShared";

export function DraftInspector({
  step,
  yaml,
  onStepChange
}: {
  step?: StepDefinition;
  yaml: string;
  onStepChange: (updater: (step: StepDefinition) => StepDefinition) => void;
}) {
  if (!step) {
    return (
      <div className="inspector-empty" role="status">
        Select a node to edit metadata.
      </div>
    );
  }

  return (
    <div className="inspector-stack">
      <div className="inspector-header">
        <div>
          <h2>Step Metadata</h2>
          <p>{step.id}</p>
        </div>
        <StatusBadge status={step.evaluate.evaluator} label={step.evaluate.evaluator} />
      </div>

      <label className="field">
        <span>Step name</span>
        <input
          value={step.name ?? step.id}
          onChange={(event) => onStepChange((current) => ({ ...current, name: event.target.value }))}
        />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Type</span>
          <select
            value={step.type}
            onChange={(event) =>
              onStepChange((current) => ({ ...current, type: event.target.value as StepDefinition["type"] }))
            }
          >
            <option value="agent">Agent</option>
            <option value="code_agent">Code Agent</option>
          </select>
        </label>
        <label className="field">
          <span>Evaluator</span>
          <select
            value={step.evaluate.evaluator}
            onChange={(event) =>
              onStepChange((current) => ({
                ...current,
                evaluate: {
                  evaluator: event.target.value as StepDefinition["evaluate"]["evaluator"]
                }
              }))
            }
          >
            <option value="mixed">Mixed</option>
            <option value="human_review">Human Review</option>
            <option value="evaluator_review">Evaluator Review</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>Input artifacts</span>
        <textarea
          value={step.input_artifacts.map((artifact) => artifact.artifact).join("\n")}
          onChange={(event) =>
            onStepChange((current) => ({
              ...current,
              input_artifacts: lines(event.target.value).map((artifact) => ({ artifact, required: true }))
            }))
          }
        />
      </label>

      <label className="field">
        <span>Output artifacts</span>
        <textarea
          value={step.output_artifacts
            .map((artifact) => `${artifact.artifact}:${artifact.filename}`)
            .join("\n")}
          onChange={(event) =>
            onStepChange((current) => ({
              ...current,
              output_artifacts: lines(event.target.value).map((line) => {
                const [artifact, filename] = line.split(":");
                return {
                  artifact: artifact?.trim() || "artifact",
                  filename: filename?.trim() || `${artifact?.trim() || "artifact"}.md`,
                  format: "markdown"
                };
              })
            }))
          }
        />
      </label>

      <label className="field">
        <span>Context paths</span>
        <textarea
          value={step.context_paths
            .map((contextPath) => `${contextPath.path}|${contextPath.type}|${contextPath.optional ? "optional" : "required"}`)
            .join("\n")}
          onChange={(event) =>
            onStepChange((current) => ({ ...current, context_paths: parseContextPaths(event.target.value) }))
          }
        />
      </label>

      <label className="field">
        <span>Prompt</span>
        <textarea
          className="large-textarea"
          value={step.prompt}
          onChange={(event) => onStepChange((current) => ({ ...current, prompt: event.target.value }))}
        />
      </label>

      <label className="field">
        <span>Acceptance criteria</span>
        <textarea
          value={step.acceptance.criteria.join("\n")}
          onChange={(event) =>
            onStepChange((current) => ({
              ...current,
              acceptance: { criteria: lines(event.target.value) }
            }))
          }
        />
      </label>

      <section className="yaml-preview" aria-label="Workflow YAML preview">
        <div className="section-heading">
          <h2>workflow.yaml</h2>
          <span>live preview</span>
        </div>
        <pre>{yaml}</pre>
      </section>
    </div>
  );
}
