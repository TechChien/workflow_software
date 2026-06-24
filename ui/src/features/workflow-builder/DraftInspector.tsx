"use client";

import {
  AGENT_PROVIDERS,
  CLAUDE_EFFORTS,
  CODEX_REASONING_EFFORTS,
  type StepAgentOptions,
  type StepDefinition
} from "@workflow-software/shared";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { lines, StatusBadge } from "./workbenchShared";

export function DraftInspector({
  step,
  yaml,
  onStepChange
}: {
  step?: StepDefinition;
  yaml: string;
  onStepChange: (updater: (step: StepDefinition) => StepDefinition) => void;
}) {
  const externalInputArtifactsText = step?.input_artifacts.map((artifact) => artifact.artifact).join("\n") ?? "";
  const externalOutputArtifactsText =
    step?.output_artifacts
      .map((artifact) => `${artifact.artifact}:${artifact.filename ?? `${artifact.artifact}.md`}`)
      .join("\n") ?? "";
  const externalCriteriaText = step?.acceptance.criteria.join("\n") ?? "";
  const externalContextPathsText = formatContextPaths(step?.context_paths ?? []);
  const [inputArtifactsText, setInputArtifactsText] = useState(externalInputArtifactsText);
  const [outputArtifactsText, setOutputArtifactsText] = useState(externalOutputArtifactsText);
  const [criteriaText, setCriteriaText] = useState(externalCriteriaText);
  const [contextPathsText, setContextPathsText] = useState(externalContextPathsText);
  const [isEditingInputArtifacts, setIsEditingInputArtifacts] = useState(false);
  const [isEditingOutputArtifacts, setIsEditingOutputArtifacts] = useState(false);
  const [isEditingCriteria, setIsEditingCriteria] = useState(false);
  const [isEditingContextPaths, setIsEditingContextPaths] = useState(false);
  const previousStepId = useRef(step?.id);
  const inputArtifactsValidation = validateInputArtifacts(inputArtifactsText);
  const outputArtifactsValidation = validateOutputArtifacts(outputArtifactsText);
  const contextPathsValidation = validateContextPaths(contextPathsText);

  useEffect(() => {
    if (previousStepId.current !== step?.id) {
      previousStepId.current = step?.id;
      setInputArtifactsText(externalInputArtifactsText);
      setOutputArtifactsText(externalOutputArtifactsText);
      setCriteriaText(externalCriteriaText);
      setContextPathsText(externalContextPathsText);
      return;
    }

    if (
      !isEditingInputArtifacts &&
      !inputArtifactsValidation.warning &&
      inputArtifactsText !== externalInputArtifactsText
    ) {
      setInputArtifactsText(externalInputArtifactsText);
    }

    if (
      !isEditingOutputArtifacts &&
      !outputArtifactsValidation.warning &&
      outputArtifactsText !== externalOutputArtifactsText
    ) {
      setOutputArtifactsText(externalOutputArtifactsText);
    }

    if (!isEditingCriteria && criteriaText !== externalCriteriaText) {
      setCriteriaText(externalCriteriaText);
    }

    if (
      !isEditingContextPaths &&
      !contextPathsValidation.warning &&
      contextPathsText !== externalContextPathsText
    ) {
      setContextPathsText(externalContextPathsText);
    }
  }, [
    contextPathsText,
    criteriaText,
    externalInputArtifactsText,
    externalOutputArtifactsText,
    externalContextPathsText,
    externalCriteriaText,
    inputArtifactsValidation.warning,
    inputArtifactsText,
    contextPathsValidation.warning,
    isEditingContextPaths,
    isEditingCriteria,
    isEditingInputArtifacts,
    isEditingOutputArtifacts,
    outputArtifactsValidation.warning,
    outputArtifactsText,
    step?.id
  ]);

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
                  ...current.evaluate,
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
        <label className="field checkbox-field">
          <span>Rerun on reject</span>
          <input
            checked={step.evaluate.rerun}
            type="checkbox"
            onChange={(event) =>
              onStepChange((current) => ({
                ...current,
                evaluate: {
                  ...current.evaluate,
                  rerun: event.target.checked
                }
              }))
            }
          />
        </label>
      </div>

      <section className="metadata-card">
        <div className="section-heading">
          <h2>Agent</h2>
          <span>{step.agent?.options?.provider ?? "default"}</span>
        </div>
        <div className="field-grid">
          <label className="field">
            <FieldLabel tip={"Repository id resolved by the worker.\nLeave empty to inherit from the previous step."}>
              Repository
            </FieldLabel>
            <input
              value={step.agent?.repository_id ?? ""}
              placeholder="default"
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgent(current, (agent) => ({
                    ...agent,
                    repository_id: optionalText(event.target.value)
                  }))
                )
              }
            />
          </label>
          <label className="field">
            <FieldLabel tip={"Git ref for this step workspace.\nLeave empty to use the repository default or inherited ref."}>
              Base ref
            </FieldLabel>
            <input
              value={step.agent?.base_ref ?? ""}
              placeholder="HEAD"
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgent(current, (agent) => ({
                    ...agent,
                    base_ref: optionalText(event.target.value)
                  }))
                )
              }
            />
          </label>
          <label className="field">
            <span>Provider</span>
            <select
              value={step.agent?.options?.provider ?? ""}
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgentOption(
                    current,
                    "provider",
                    optionalText(event.target.value) as StepAgentOptions["provider"] | undefined
                  )
                )
              }
            >
              <option value="">Default</option>
              {AGENT_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={step.agent?.options?.model ?? ""}
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgentOption(current, "model", optionalText(event.target.value))
                )
              }
            />
          </label>
          <label className="field">
            <span>Codex effort</span>
            <select
              value={step.agent?.options?.reasoning_effort ?? ""}
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgentOption(
                    current,
                    "reasoning_effort",
                    optionalText(event.target.value) as
                      | StepAgentOptions["reasoning_effort"]
                      | undefined
                  )
                )
              }
            >
              <option value="">Default</option>
              {CODEX_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Claude effort</span>
            <select
              value={step.agent?.options?.effort ?? ""}
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgentOption(
                    current,
                    "effort",
                    optionalText(event.target.value) as StepAgentOptions["effort"] | undefined
                  )
                )
              }
            >
              <option value="">Default</option>
              {CLAUDE_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Timeout ms</span>
            <input
              min={1}
              type="number"
              value={step.agent?.options?.timeout_ms ?? ""}
              onChange={(event) =>
                onStepChange((current) =>
                  updateStepAgentOption(
                    current,
                    "timeout_ms",
                    optionalPositiveInteger(event.target.value)
                  )
                )
              }
            />
          </label>
        </div>
      </section>

      <label className="field">
        <FieldLabel tip={"One artifact key per line.\nExample: requirements_doc"}>
          Input artifacts
        </FieldLabel>
        <textarea
          aria-invalid={Boolean(inputArtifactsValidation.warning)}
          value={inputArtifactsText}
          onBlur={() => setIsEditingInputArtifacts(false)}
          onChange={(event) => {
            const nextInputArtifactsText = event.target.value;
            const nextValidation = validateInputArtifacts(nextInputArtifactsText);

            setInputArtifactsText(nextInputArtifactsText);
            if (!nextValidation.warning) {
              onStepChange((current) => ({
                ...current,
                input_artifacts: nextValidation.value.map((artifact) => ({ artifact, required: true }))
              }));
            }
          }}
          onFocus={() => setIsEditingInputArtifacts(true)}
        />
        <FieldWarning message={inputArtifactsValidation.warning} />
      </label>

      <label className="field">
        <FieldLabel tip={"One artifact per line as artifact:filename.\nExample: summary:summary.md"}>
          Output artifacts
        </FieldLabel>
        <textarea
          aria-invalid={Boolean(outputArtifactsValidation.warning)}
          value={outputArtifactsText}
          onBlur={() => setIsEditingOutputArtifacts(false)}
          onChange={(event) => {
            const nextOutputArtifactsText = event.target.value;
            const nextValidation = validateOutputArtifacts(nextOutputArtifactsText);

            setOutputArtifactsText(nextOutputArtifactsText);
            if (!nextValidation.warning) {
              onStepChange((current) => ({
                ...current,
                output_artifacts: nextValidation.value.map(({ artifact, filename }) => ({
                  artifact,
                  filename,
                  format: "markdown"
                }))
              }));
            }
          }}
          onFocus={() => setIsEditingOutputArtifacts(true)}
        />
        <FieldWarning message={outputArtifactsValidation.warning} />
      </label>

      <label className="field">
        <FieldLabel tip={"One path per line as path|type|requiredness.\nType: file or directory.\nRequiredness: required or optional.\nExample: src|directory|required"}>
          Context paths
        </FieldLabel>
        <textarea
          aria-invalid={Boolean(contextPathsValidation.warning)}
          value={contextPathsText}
          onBlur={() => {
            setIsEditingContextPaths(false);
            if (!contextPathsValidation.warning) {
              setContextPathsText(formatContextPaths(contextPathsValidation.value));
            }
          }}
          onChange={(event) => {
            const nextContextPathsText = event.target.value;
            const nextValidation = validateContextPaths(nextContextPathsText);

            setContextPathsText(nextContextPathsText);
            if (!nextValidation.warning) {
              onStepChange((current) => ({
                ...current,
                context_paths: nextValidation.value
              }));
            }
          }}
          onFocus={() => setIsEditingContextPaths(true)}
        />
        <FieldWarning message={contextPathsValidation.warning} />
      </label>

      <label className="field">
        <FieldLabel tip={"Write plain text instructions for this step.\nMention the artifacts or context paths the agent should use."}>
          Prompt
        </FieldLabel>
        <textarea
          className="large-textarea"
          value={step.prompt}
          onChange={(event) => onStepChange((current) => ({ ...current, prompt: event.target.value }))}
        />
      </label>

      <label className="field">
        <FieldLabel tip={"One acceptance criterion per line.\nExample: Includes a concise implementation summary."}>
          Acceptance criteria
        </FieldLabel>
        <textarea
          value={criteriaText}
          onBlur={() => {
            setIsEditingCriteria(false);
            setCriteriaText(lines(criteriaText).join("\n"));
          }}
          onChange={(event) => {
            const nextCriteriaText = event.target.value;

            setCriteriaText(nextCriteriaText);
            onStepChange((current) => ({
              ...current,
              acceptance: { criteria: lines(nextCriteriaText) }
            }));
          }}
          onFocus={() => setIsEditingCriteria(true)}
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

function FieldLabel({ children, tip }: { children: string; tip: string }) {
  return (
    <span className="field-label">
      <span>{children}</span>
      <span className="field-help" tabIndex={0} aria-label={`${children} format help`}>
        <Icon name="help" />
        <span className="field-tip" role="tooltip">
          {tip}
        </span>
      </span>
    </span>
  );
}

function FieldWarning({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <span className="field-warning" role="alert">
      {message}
    </span>
  );
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPositiveInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function compactAgentSettings(agent: StepDefinition["agent"]) {
  const options = compactAgentOptions(agent?.options);
  const repositoryId = optionalText(agent?.repository_id ?? "");
  const baseRef = optionalText(agent?.base_ref ?? "");
  const compacted = {
    ...(repositoryId ? { repository_id: repositoryId } : {}),
    ...(baseRef ? { base_ref: baseRef } : {}),
    ...(options ? { options } : {})
  };

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function compactAgentOptions(options: StepAgentOptions | undefined) {
  if (!options) {
    return undefined;
  }

  const model = optionalText(options.model ?? "");
  const compacted = {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(model ? { model } : {}),
    ...(options.reasoning_effort ? { reasoning_effort: options.reasoning_effort } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.timeout_ms ? { timeout_ms: options.timeout_ms } : {})
  };

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function updateStepAgent(
  step: StepDefinition,
  updater: (agent: NonNullable<StepDefinition["agent"]>) => StepDefinition["agent"]
): StepDefinition {
  const nextAgent = compactAgentSettings(updater(step.agent ?? {}));
  const { agent: _agent, ...stepWithoutAgent } = step;

  return nextAgent ? { ...stepWithoutAgent, agent: nextAgent } : stepWithoutAgent;
}

function updateStepAgentOption<
  TKey extends keyof StepAgentOptions
>(
  step: StepDefinition,
  key: TKey,
  value: StepAgentOptions[TKey] | undefined
) {
  return updateStepAgent(step, (agent) => ({
    ...agent,
    options: {
      ...agent.options,
      [key]: value
    }
  }));
}

function formatContextPaths(contextPaths: StepDefinition["context_paths"]) {
  return contextPaths
    .map((contextPath) => `${contextPath.path}|${contextPath.type}|${contextPath.optional ? "optional" : "required"}`)
    .join("\n");
}

function validateInputArtifacts(value: string) {
  const artifactLines = lines(value);
  const invalidLine = artifactLines.find((line) => !isArtifactKey(line));

  return invalidLine
    ? { warning: `Ignored invalid artifact key: "${invalidLine}". Use letters, numbers, _, -, or . only.`, value: [] }
    : { value: artifactLines };
}

function validateOutputArtifacts(value: string) {
  const artifactLines = lines(value);
  const outputArtifacts: Array<{ artifact: string; filename: string }> = [];

  for (const line of artifactLines) {
    const parts = line.split(":").map((part) => part.trim());
    const [artifact, filename] = parts;

    if (parts.length !== 2 || !artifact || !filename || !isArtifactKey(artifact)) {
      return {
        warning: `Ignored invalid output artifact: "${line}". Use artifact:filename.`,
        value: []
      };
    }

    outputArtifacts.push({ artifact, filename });
  }

  return { value: outputArtifacts };
}

function validateContextPaths(value: string) {
  const pathLines = lines(value);
  const contextPaths: StepDefinition["context_paths"] = [];

  for (const line of pathLines) {
    const parts = line.split("|").map((part) => part.trim());
    const [path, type, requiredness] = parts;

    if (
      parts.length !== 3 ||
      !path ||
      !["file", "directory"].includes(type) ||
      !["required", "optional"].includes(requiredness)
    ) {
      return {
        warning: `Ignored invalid context path: "${line}". Use path|file or directory|required or optional.`,
        value: []
      };
    }

    contextPaths.push({
      path,
      type: type as StepDefinition["context_paths"][number]["type"],
      optional: requiredness === "optional"
    });
  }

  return { value: contextPaths };
}

function isArtifactKey(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}
