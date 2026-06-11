"use client";

import type { StepDefinition } from "@workflow-software/shared";

export type ComponentTemplate = {
  id: string;
  idPrefix: string;
  name: string;
  purpose: string;
  meta: string;
  defaults: Omit<StepDefinition, "id" | "upstream" | "downstream">;
};

export const componentTemplates: ComponentTemplate[] = [
  {
    id: "agent-step",
    idPrefix: "agent_step",
    name: "Agent Step",
    purpose: "General Codex reasoning step that writes text artifacts.",
    meta: "agent / mixed evaluator",
    defaults: {
      name: "Agent Step",
      type: "agent",
      input_artifacts: [],
      output_artifacts: [],
      context_paths: [],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "mixed" },
      prompt: "Describe the task this agent should complete.",
      acceptance: { criteria: [] }
    }
  },
  {
    id: "code-agent-step",
    idPrefix: "code_agent_step",
    name: "Code Agent Step",
    purpose: "Code-aware step that can inspect workspace context.",
    meta: "code_agent / mixed evaluator",
    defaults: {
      name: "Code Agent Step",
      type: "code_agent",
      input_artifacts: [],
      output_artifacts: [],
      context_paths: [],
      tool_capabilities: ["*"],
      evaluate: { evaluator: "mixed" },
      prompt: "Inspect the workspace context and produce the requested code change summary.",
      acceptance: { criteria: [] }
    }
  }
];


export function ComponentLibrary({
  templates,
  onAdd,
  className
}: {
  templates: ComponentTemplate[];
  onAdd: (template: ComponentTemplate) => void;
  className?: string;
}) {
  return (
    <div className={`panel-section component-library${className ? ` ${className}` : ""}`}>
      <div className="section-heading">
        <h2>Component Library</h2>
        <span>{templates.length} templates</span>
      </div>
      <div className="template-list">
        {templates.map((template) => (
          <article
            key={template.id}
            className="template-card"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/workflow-step", template.id);
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            <div>
              <strong>{template.name}</strong>
              <p>{template.purpose}</p>
            </div>
            <div className="template-meta">
              {/* <span>{template.meta}</span> */}
              <button type="button" onClick={() => onAdd(template)}>
                Add
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

