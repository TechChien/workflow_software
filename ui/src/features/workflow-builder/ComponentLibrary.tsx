"use client";

import { type ComponentTemplate } from "@/mock/workflowWorkbench";

export function ComponentLibrary({
  templates,
  onAdd
}: {
  templates: ComponentTemplate[];
  onAdd: (template: ComponentTemplate) => void;
}) {
  return (
    <div className="panel-section" role="tabpanel">
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
              <span>{template.meta}</span>
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
