"use client";

import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange
} from "@xyflow/react";
import {
  stringifyWorkflowYaml,
  type ContextPath,
  type StepDefinition,
  type WorkflowYaml
} from "@workflow-software/shared";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  componentTemplates,
  initialNodePositions,
  initialPublished,
  initialRuns,
  sampleSteps,
  type ComponentTemplate,
  type PublishedWorkflow,
  type RunRecord,
  type StepRunRecord,
  type StepRunStatus
} from "@/mock/workflowWorkbench";

type WorkbenchView = "draft" | "published" | "run";
type LeftTab = "components" | "published" | "history";

type CanvasNodeData = Record<string, unknown> & {
  label: ReactNode;
  stepId: string;
};
type CanvasNode = Node<CanvasNodeData>;
type CanvasEdge = Edge;

export function WorkflowWorkbench() {
  return (
    <ReactFlowProvider>
      <WorkflowWorkbenchInner />
    </ReactFlowProvider>
  );
}

function WorkflowWorkbenchInner() {
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [draftWorkflowId, setDraftWorkflowId] = useState("requirement-analysis-flow");
  const [draftWorkflowName, setDraftWorkflowName] = useState("Requirement Analysis Flow");
  const [draftSteps, setDraftSteps] = useState<StepDefinition[]>(sampleSteps);
  const [draftNodes, setDraftNodes, onDraftNodesChange] = useNodesState<CanvasNode>(
    createNodes(sampleSteps, initialNodePositions)
  );
  const [draftEdges, setDraftEdges, onDraftEdgesChange] = useEdgesState<CanvasEdge>(
    createEdgesFromSteps(sampleSteps)
  );
  const [publishedWorkflows, setPublishedWorkflows] = useState<PublishedWorkflow[]>(initialPublished);
  const [runHistory, setRunHistory] = useState<RunRecord[]>(initialRuns);
  const [leftTab, setLeftTab] = useState<LeftTab>("components");
  const [viewMode, setViewMode] = useState<WorkbenchView>("draft");
  const [selectedDraftStepId, setSelectedDraftStepId] = useState(sampleSteps[1]?.id ?? "");
  const [selectedPublishedWorkflowVersionId, setSelectedPublishedWorkflowVersionId] = useState(
    initialPublished[0]?.id ?? ""
  );
  const [selectedRunId, setSelectedRunId] = useState(initialRuns[0]?.id ?? "");
  const [selectedStepRunId, setSelectedStepRunId] = useState(initialRuns[0]?.stepRuns[1]?.id ?? "");
  const [isDirty, setIsDirty] = useState(true);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);

  const draftWorkflow = useMemo(
    () => createWorkflowYaml(draftWorkflowId, draftWorkflowName, stepsWithConnections(draftSteps, draftEdges)),
    [draftEdges, draftSteps, draftWorkflowId, draftWorkflowName]
  );
  const draftYaml = useMemo(() => stringifyWorkflowYaml(draftWorkflow), [draftWorkflow]);
  const validation = useMemo(() => validateDraft(draftSteps, draftEdges), [draftEdges, draftSteps]);
  const selectedDraftStep = draftSteps.find((step) => step.id === selectedDraftStepId) ?? draftSteps[0];
  const selectedPublishedWorkflow =
    publishedWorkflows.find((workflow) => workflow.id === selectedPublishedWorkflowVersionId) ??
    publishedWorkflows[0];
  const selectedRun = runHistory.find((run) => run.id === selectedRunId) ?? runHistory[0];
  const selectedStepRun =
    selectedRun?.stepRuns.find((stepRun) => stepRun.id === selectedStepRunId) ?? selectedRun?.stepRuns[0];
  const selectedRunStep = selectedRun?.workflow.steps.find((step) => step.id === selectedStepRun?.stepId);

  const canvasSteps =
    viewMode === "published"
      ? selectedPublishedWorkflow?.workflow.steps ?? []
      : viewMode === "run"
        ? selectedRun?.workflow.steps ?? []
        : draftSteps;
  const canvasEdges =
    viewMode === "draft"
      ? draftEdges
      : createEdgesFromSteps(canvasSteps).map((edge) => ({ ...edge, className: "workflow-edge-readonly" }));
  const canvasNodes =
    viewMode === "draft"
      ? hydrateNodes(draftNodes, draftSteps)
      : createNodes(
          canvasSteps,
          {},
          viewMode === "run" ? statusByStepId(selectedRun?.stepRuns ?? []) : undefined,
          true
        );
  const canRun = publishedWorkflows.length > 0;

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      markDirty();
      onDraftNodesChange(changes);
    },
    [markDirty, onDraftNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      markDirty();
      onDraftEdgesChange(changes);
    },
    [markDirty, onDraftEdgesChange]
  );

  const updateSelectedStep = useCallback(
    (updater: (step: StepDefinition) => StepDefinition) => {
      if (!selectedDraftStep) {
        return;
      }

      setDraftSteps((steps) =>
        steps.map((step) => (step.id === selectedDraftStep.id ? updater(step) : step))
      );
      markDirty();
    },
    [markDirty, selectedDraftStep]
  );

  const addStepFromTemplate = useCallback(
    (template: ComponentTemplate, position?: { x: number; y: number }) => {
      const id = nextStepId(template.idPrefix, draftSteps);
      const step: StepDefinition = {
        id,
        ...template.defaults,
        name: template.defaults.name ?? template.name
      };
      const nextPosition = position ?? { x: 120 + draftSteps.length * 48, y: 180 + draftSteps.length * 36 };

      setDraftSteps((steps) => [...steps, step]);
      setDraftNodes((nodes) => [...nodes, createNode(step, nextPosition)]);
      setSelectedDraftStepId(id);
      setViewMode("draft");
      setLeftTab("components");
      setIsDirty(true);
    },
    [draftSteps, setDraftNodes]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const templateId = event.dataTransfer.getData("application/workflow-step");
      const template = componentTemplates.find((item) => item.id === templateId);

      if (!template) {
        return;
      }

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addStepFromTemplate(template, position);
    },
    [addStepFromTemplate, screenToFlowPosition]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return;
      }

      setDraftEdges((edges) => {
        const prunedEdges = edges.filter(
          (edge) => edge.source !== connection.source && edge.target !== connection.target
        );
        return addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}`,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed }
          },
          prunedEdges
        );
      });
      setIsDirty(true);
    },
    [setDraftEdges]
  );

  const handleSaveDraft = useCallback(() => {
    setIsDirty(false);
    setViewMode("draft");
  }, []);

  const handlePublish = useCallback(() => {
    const revision = Math.max(0, ...publishedWorkflows.map((workflow) => workflow.revision)) + 1;
    const published: PublishedWorkflow = {
      id: `version-${draftWorkflow.id}-r${revision}`,
      revision,
      publishedAt: formatDateTime(new Date()),
      workflow: draftWorkflow,
      lastRunStatus: "pending"
    };

    setPublishedWorkflows((workflows) => [published, ...workflows]);
    setSelectedPublishedWorkflowVersionId(published.id);
    setLeftTab("published");
    setViewMode("published");
    setIsDirty(false);
  }, [draftWorkflow, publishedWorkflows]);

  const handleRun = useCallback(
    (workflow = selectedPublishedWorkflow) => {
      if (!workflow) {
        return;
      }

      const run = createRunRecord(workflow);
      setRunHistory((runs) => [run, ...runs]);
      setPublishedWorkflows((workflows) =>
        workflows.map((item) => (item.id === workflow.id ? { ...item, lastRunStatus: run.status } : item))
      );
      setSelectedRunId(run.id);
      setSelectedStepRunId(run.stepRuns[0]?.id ?? "");
      setLeftTab("history");
      setViewMode("run");
    },
    [selectedPublishedWorkflow]
  );

  const handleCreateDraftFromVersion = useCallback(
    (workflow: PublishedWorkflow) => {
      setDraftWorkflowId(workflow.workflow.id);
      setDraftWorkflowName(`${workflow.workflow.name} Draft`);
      setDraftSteps(workflow.workflow.steps);
      setDraftNodes(createNodes(workflow.workflow.steps, initialNodePositions));
      setDraftEdges(createEdgesFromSteps(workflow.workflow.steps));
      setSelectedDraftStepId(workflow.workflow.steps[0]?.id ?? "");
      setIsDirty(true);
      setViewMode("draft");
      setLeftTab("components");
    },
    [setDraftEdges, setDraftNodes]
  );

  return (
    <main className={`app-shell ${viewMode === "run" ? "" : "timeline-collapsed"}`}>
      <a className="skip-link" href="#workflow-canvas">
        Skip to canvas
      </a>
      <header className="topbar">
        <div className="topbar-title">
          <label htmlFor="workflow-name">Workflow</label>
          <input
            id="workflow-name"
            value={draftWorkflowName}
            onChange={(event) => {
              setDraftWorkflowName(event.target.value);
              setIsDirty(true);
            }}
            aria-label="Workflow name"
          />
        </div>
        <div className="topbar-status" role={validation.kind === "error" ? "alert" : "status"}>
          <StatusBadge status={isDirty ? "draft" : "saved"} label={isDirty ? "Draft changes" : "Draft saved"} />
          <StatusBadge
            status={validation.kind}
            label={`${validation.summary} / ${draftSteps.length} steps`}
          />
        </div>
        <div className="topbar-actions">
          <button type="button" className="toolbar-button" onClick={handleSaveDraft}>
            <Icon name="save" />
            Save Draft
          </button>
          <button
            type="button"
            className="toolbar-button publish-button"
            onClick={handlePublish}
            disabled={validation.kind === "error"}
          >
            <Icon name="upload" />
            Publish
          </button>
          <button
            type="button"
            className="toolbar-button primary"
            onClick={() => handleRun()}
            disabled={!canRun}
            title={canRun ? "Run latest selected published workflow" : "Publish a workflow before running"}
          >
            <Icon name="play" />
            Run
          </button>
        </div>
      </header>

      <section className={`workbench-body ${isLeftCollapsed ? "left-collapsed" : ""}`}>
        <aside className="resource-panel" aria-label="Workflow resources">
          {isLeftCollapsed ? (
            <button
              type="button"
              className="panel-rail-button"
              onClick={() => setIsLeftCollapsed(false)}
              aria-label="Expand resource panel"
            >
              <Icon name="panel" />
            </button>
          ) : (
            <>
              <div className="panel-header">
                <div>
                  <h1>Builder</h1>
                  <p>Drag, publish, inspect runs.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setIsLeftCollapsed(true)}
                  aria-label="Collapse resource panel"
                >
                  <Icon name="collapse" />
                </button>
              </div>
              <div className="tab-list" role="tablist" aria-label="Resource tabs">
                <TabButton active={leftTab === "components"} onClick={() => setLeftTab("components")}>
                  Components
                </TabButton>
                <TabButton active={leftTab === "published"} onClick={() => setLeftTab("published")}>
                  Published
                </TabButton>
                <TabButton active={leftTab === "history"} onClick={() => setLeftTab("history")}>
                  History
                </TabButton>
              </div>
              {leftTab === "components" ? (
                <ComponentLibrary templates={componentTemplates} onAdd={addStepFromTemplate} />
              ) : null}
              {leftTab === "published" ? (
                <PublishedList
                  workflows={publishedWorkflows}
                  selectedId={selectedPublishedWorkflowVersionId}
                  onSelect={(workflow) => {
                    setSelectedPublishedWorkflowVersionId(workflow.id);
                    setViewMode("published");
                  }}
                  onRun={handleRun}
                />
              ) : null}
              {leftTab === "history" ? (
                <RunHistoryList
                  runs={runHistory}
                  selectedId={selectedRunId}
                  onSelect={(run) => {
                    setSelectedRunId(run.id);
                    setSelectedStepRunId(run.stepRuns[0]?.id ?? "");
                    setViewMode("run");
                  }}
                />
              ) : null}
            </>
          )}
        </aside>

        <section
          id="workflow-canvas"
          ref={flowWrapperRef}
          className="canvas-panel"
          aria-label="Workflow canvas"
          onDrop={viewMode === "draft" ? handleDrop : undefined}
          onDragOver={(event) => {
            if (viewMode === "draft") {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
        >
          <div className="canvas-toolbar">
            <div>
              <strong>{viewModeLabel(viewMode)}</strong>
              <span>{canvasSteps.length} steps / {canvasEdges.length} links</span>
            </div>
            {viewMode !== "draft" ? <StatusBadge status="readonly" label="Read only snapshot" /> : null}
          </div>
          {canvasSteps.length === 0 ? (
            <div className="canvas-empty" role="status">
              Add a component to start a workflow draft.
            </div>
          ) : (
            <ReactFlow
              nodes={canvasNodes}
              edges={canvasEdges}
              onNodesChange={viewMode === "draft" ? handleNodesChange : undefined}
              onEdgesChange={viewMode === "draft" ? handleEdgesChange : undefined}
              onConnect={viewMode === "draft" ? handleConnect : undefined}
              onNodeClick={(_, node) => {
                if (viewMode === "draft") {
                  setSelectedDraftStepId(String(node.data.stepId));
                } else if (viewMode === "run") {
                  const stepRun = selectedRun?.stepRuns.find((item) => item.stepId === node.data.stepId);
                  if (stepRun) {
                    setSelectedStepRunId(stepRun.id);
                  }
                }
              }}
              nodesDraggable={viewMode === "draft"}
              nodesConnectable={viewMode === "draft"}
              edgesFocusable
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </section>

        <aside className="inspector-panel" aria-label="Metadata inspector">
          {viewMode === "draft" ? (
            <DraftInspector
              step={selectedDraftStep}
              yaml={draftYaml}
              onStepChange={updateSelectedStep}
            />
          ) : null}
          {viewMode === "published" && selectedPublishedWorkflow ? (
            <PublishedInspector
              workflow={selectedPublishedWorkflow}
              onCreateDraft={handleCreateDraftFromVersion}
              onRun={handleRun}
            />
          ) : null}
          {viewMode === "run" && selectedRun && selectedStepRun ? (
            <RunInspector
              run={selectedRun}
              step={selectedRunStep}
              stepRun={selectedStepRun}
            />
          ) : null}
        </aside>
      </section>

      <RunTimeline
        run={viewMode === "run" ? selectedRun : undefined}
        selectedStepRunId={selectedStepRunId}
        onSelectStepRun={setSelectedStepRunId}
        onOpenHistory={() => {
          setLeftTab("history");
          setViewMode("run");
        }}
      />
    </main>
  );
}

function ComponentLibrary({
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

function PublishedList({
  workflows,
  selectedId,
  onSelect,
  onRun
}: {
  workflows: PublishedWorkflow[];
  selectedId: string;
  onSelect: (workflow: PublishedWorkflow) => void;
  onRun: (workflow: PublishedWorkflow) => void;
}) {
  return (
    <div className="panel-section" role="tabpanel">
      <div className="section-heading">
        <h2>Published Workflows</h2>
        <span>{workflows.length} versions</span>
      </div>
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
              <button type="button" className="inline-action" onClick={() => onRun(workflow)}>
                Run
              </button>
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

function RunHistoryList({
  runs,
  selectedId,
  onSelect
}: {
  runs: RunRecord[];
  selectedId: string;
  onSelect: (run: RunRecord) => void;
}) {
  return (
    <div className="panel-section" role="tabpanel">
      <div className="section-heading">
        <h2>Run History</h2>
        <span>{runs.length} runs</span>
      </div>
      <div className="record-list">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={`record-row ${selectedId === run.id ? "active" : ""}`}
            onClick={() => onSelect(run)}
          >
            <span className="record-title">{run.id}</span>
            <span>{run.workflowName} / r{run.revision}</span>
            <span>{run.startedAt}{run.completedAt ? ` - ${run.completedAt}` : ""}</span>
            <StatusBadge status={run.status} label={run.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function DraftInspector({
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

function PublishedInspector({
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
          <dd><StatusBadge status={workflow.lastRunStatus} label={workflow.lastRunStatus} /></dd>
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

function RunInspector({
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

function RunTimeline({
  run,
  selectedStepRunId,
  onSelectStepRun,
  onOpenHistory
}: {
  run?: RunRecord;
  selectedStepRunId: string;
  onSelectStepRun: (stepRunId: string) => void;
  onOpenHistory: () => void;
}) {
  if (!run) {
    return (
      <section className="timeline-panel collapsed" role="status">
        <span>No run selected. Publish a version to enable runtime tracking.</span>
      </section>
    );
  }

  return (
    <section className="timeline-panel" aria-label="Run timeline">
      <div className="timeline-header">
        <div>
          <strong>{run.workflowName}</strong>
          <span>{run.id} / revision {run.revision}</span>
        </div>
        <button type="button" onClick={onOpenHistory}>
          Open History
        </button>
      </div>
      <ol className="timeline-steps">
        {run.stepRuns.map((stepRun, index) => {
          const step = run.workflow.steps.find((item) => item.id === stepRun.stepId);
          return (
            <li key={stepRun.id}>
              <button
                type="button"
                className={`timeline-step ${selectedStepRunId === stepRun.id ? "active" : ""}`}
                onClick={() => onSelectStepRun(stepRun.id)}
              >
                <span className="timeline-index">{index + 1}</span>
                <span className="timeline-copy">
                  <strong>{step?.name ?? stepRun.stepId}</strong>
                  <StatusBadge status={stepRun.status} label={stepRun.status} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>
      {children}
    </button>
  );
}

function StepNodeLabel({
  step,
  status,
  readOnly
}: {
  step: StepDefinition;
  status?: StepRunStatus;
  readOnly?: boolean;
}) {
  return (
    <div className="step-node-label">
      <div>
        <strong>{step.name ?? step.id}</strong>
        <span>{step.type} / {step.evaluate.evaluator}</span>
      </div>
      <StatusBadge status={status ?? (readOnly ? "published" : "draft")} label={status ?? (readOnly ? "snapshot" : "draft")} />
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`status-badge ${statusTone(status)}`}>
      <span className="status-glyph" aria-hidden="true" />
      {label}
    </span>
  );
}

function Icon({ name }: { name: "save" | "upload" | "play" | "panel" | "collapse" }) {
  const paths = {
    save: "M5 3h11l3 3v15H5V3Zm3 0v6h8V3M8 21v-7h8v7",
    upload: "M12 4v12m0-12 5 5m-5-5-5 5M5 20h14",
    play: "M8 5v14l11-7L8 5Z",
    panel: "M4 5h16v14H4V5Zm5 0v14",
    collapse: "M6 6h12v12H6V6Zm5 0v12M15 9l-3 3 3 3"
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function createWorkflowYaml(id: string, name: string, steps: StepDefinition[]): WorkflowYaml {
  return {
    id,
    name,
    version: "0.1.0",
    inputs: {},
    artifacts: {},
    steps,
    ui: {}
  };
}

function createNode(
  step: StepDefinition,
  position: { x: number; y: number },
  status?: StepRunStatus,
  readOnly = false
): CanvasNode {
  return {
    id: step.id,
    position,
    type: "default",
    className: `workflow-node ${statusTone(status ?? (readOnly ? "published" : "draft"))}`,
    data: {
      stepId: step.id,
      label: <StepNodeLabel step={step} status={status} readOnly={readOnly} />
    }
  };
}

function createNodes(
  steps: StepDefinition[],
  positions: Record<string, { x: number; y: number }> = {},
  statuses?: Record<string, StepRunStatus>,
  readOnly = false
) {
  return steps.map((step, index) =>
    createNode(
      step,
      positions[step.id] ?? { x: 80 + index * 300, y: 120 + (index % 2) * 96 },
      statuses?.[step.id],
      readOnly
    )
  );
}

function hydrateNodes(nodes: CanvasNode[], steps: StepDefinition[]) {
  return nodes.map((node, index) => {
    const step = steps.find((item) => item.id === node.data.stepId) ?? steps[index];
    if (!step) {
      return node;
    }
    return {
      ...node,
      className: `workflow-node ${statusTone("draft")}`,
      data: {
        ...node.data,
        label: <StepNodeLabel step={step} />
      }
    };
  });
}

function createEdgesFromSteps(steps: StepDefinition[]): CanvasEdge[] {
  return steps
    .filter((step) => step.downstream)
    .map((step) => ({
      id: `${step.id}-${step.downstream}`,
      source: step.id,
      target: step.downstream as string,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed }
    }));
}

function stepsWithConnections(steps: StepDefinition[], edges: CanvasEdge[]): StepDefinition[] {
  return steps.map((step) => {
    const incoming = edges.find((edge) => edge.target === step.id);
    const outgoing = edges.find((edge) => edge.source === step.id);
    return {
      ...step,
      upstream: incoming?.source,
      downstream: outgoing?.target
    };
  });
}

function statusByStepId(stepRuns: StepRunRecord[]) {
  return stepRuns.reduce<Record<string, StepRunStatus>>((accumulator, stepRun) => {
    accumulator[stepRun.stepId] = stepRun.status;
    return accumulator;
  }, {});
}

function nextStepId(prefix: string, steps: StepDefinition[]) {
  let counter = steps.length + 1;
  let candidate = `${prefix}_${counter}`;
  const existingIds = new Set(steps.map((step) => step.id));

  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${prefix}_${counter}`;
  }

  return candidate;
}

function validateDraft(steps: StepDefinition[], edges: CanvasEdge[]) {
  const emptyPrompts = steps.filter((step) => !step.prompt.trim()).length;
  const duplicateIds = steps.length - new Set(steps.map((step) => step.id)).size;
  const invalidEdges = edges.filter(
    (edge) => !steps.some((step) => step.id === edge.source) || !steps.some((step) => step.id === edge.target)
  ).length;

  if (!steps.length) {
    return { kind: "error", summary: "No steps" };
  }

  if (duplicateIds || invalidEdges) {
    return { kind: "error", summary: "Invalid graph" };
  }

  if (emptyPrompts) {
    return { kind: "waiting", summary: `${emptyPrompts} prompt gaps` };
  }

  return { kind: "ready", summary: "Ready to publish" };
}

function createRunRecord(workflow: PublishedWorkflow): RunRecord {
  const stepRuns = workflow.workflow.steps.map<StepRunRecord>((step, index) => {
    const status: StepRunStatus = index === 0 ? "accepted" : index === 1 ? "running" : "pending";
    return {
      id: `step-run-${step.id}-${Date.now()}-${index}`,
      stepId: step.id,
      status,
      attempt: 1,
      evaluator: step.evaluate.evaluator,
      artifacts: step.output_artifacts.map((artifact) => ({
        key: artifact.artifact,
        version: status === "pending" ? "queued" : "v1",
        status: status === "accepted" ? "accepted" : status
      })),
      codexUsage: status === "accepted" ? { inputTokens: 2400 + index * 860, outputTokens: 720 + index * 210 } : undefined
    };
  });

  return {
    id: `run-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`,
    workflowVersionId: workflow.id,
    workflowName: workflow.workflow.name,
    revision: workflow.revision,
    status: "running",
    startedAt: formatDateTime(new Date()),
    workflow: workflow.workflow,
    stepRuns
  };
}

function formatDateTime(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseContextPaths(value: string): ContextPath[] {
  return lines(value).map((line) => {
    const [path, type, optional] = line.split("|").map((part) => part.trim());
    return {
      path: path || "src",
      type: type === "file" ? "file" : "directory",
      optional: optional !== "required"
    };
  });
}

function statusTone(status: string) {
  if (["running", "ready"].includes(status)) {
    return "tone-blue";
  }
  if (status.startsWith("waiting") || ["draft", "pending", "mixed", "human_review", "evaluator_review"].includes(status)) {
    return "tone-amber";
  }
  if (["accepted", "completed", "published", "saved"].includes(status)) {
    return "tone-green";
  }
  if (["rejected", "failed", "stale", "error"].includes(status)) {
    return "tone-red";
  }
  if (status === "readonly") {
    return "tone-neutral";
  }
  return "tone-neutral";
}

function viewModeLabel(viewMode: WorkbenchView) {
  if (viewMode === "published") {
    return "Published workflow snapshot";
  }
  if (viewMode === "run") {
    return "Run status snapshot";
  }
  return "Editable draft canvas";
}
