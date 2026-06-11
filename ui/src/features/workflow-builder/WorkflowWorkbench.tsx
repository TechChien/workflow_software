"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider
} from "@xyflow/react";
import { useState } from "react";
import { componentTemplates, type PublishedWorkflow } from "@/mock/workflowWorkbench";
import { ComponentLibrary } from "./ComponentLibrary";
import { DraftInspector } from "./DraftInspector";
import { useDraftView, type DraftViewModel } from "./hooks/useDraftView";
import {
  usePublishedWorkflowsView,
  type PublishedWorkflowsViewModel
} from "./hooks/usePublishedWorkflowsView";
import { useRunHistoryView, type RunHistoryViewModel } from "./hooks/useRunHistoryView";
import { Icon } from "./Icon";
import { PublishedInspector } from "./PublishedInspector";
import { PublishedList } from "./PublishedList";
import { RunHistoryList } from "./RunHistoryList";
import { RunInspector } from "./RunInspector";
import { RunTimeline } from "./RunTimeline";
import { useWorkbenchStore } from "./stores/useWorkbenchStore";
import { TabButton } from "./TabButton";
import { WorkflowTopbar } from "./WorkflowTopbar";
import {
  createEdgesFromSteps,
  createNodes,
  createRunRecord,
  statusByStepId,
  StatusBadge,
  viewModeLabel,
  type LeftTab,
  type WorkbenchView
} from "./workbenchShared";

export function WorkflowWorkbench() {
  return (
    <ReactFlowProvider>
      <WorkflowWorkbenchInner />
    </ReactFlowProvider>
  );
}

function WorkflowWorkbenchInner() {
  const leftTab = useWorkbenchStore((state) => state.leftTab);
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setLeftTab = useWorkbenchStore((state) => state.setLeftTab);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const draftView = useDraftView();
  const publishedView = usePublishedWorkflowsView();
  const runHistoryView = useRunHistoryView();
  const canRun = publishedView.workflows.length > 0;

  const handlePublish = () => {
    const revision = Math.max(0, ...publishedView.workflows.map((workflow) => workflow.revision)) + 1;
    const published = draftView.createPublishedWorkflow(revision);
    publishedView.addPublishedWorkflow(published);
    setLeftTab("published");
    setViewMode("published");
  };

  const handleRun = (workflow = publishedView.selectedWorkflow) => {
    if (!workflow) {
      return;
    }

    const run = createRunRecord(workflow);
    runHistoryView.addRun(run);
    publishedView.updateLastRunStatus(workflow.id, run.status);
    setLeftTab("history");
    setViewMode("run");
  };

  return (
    <main className={`app-shell ${viewMode === "run" ? "" : "timeline-collapsed"}`}>
      <a className="skip-link" href="#workflow-canvas">
        Skip to canvas
      </a>
      <WorkflowTopbar
        canRun={canRun}
        draftView={draftView}
        onPublish={handlePublish}
        onRun={() => handleRun()}
      />

      <section className={`workbench-body ${isLeftCollapsed ? "left-collapsed" : ""}`}>
        <LeftWorkbenchSection
          activeTab={leftTab}
          draftView={draftView}
          isCollapsed={isLeftCollapsed}
          onCollapse={() => setIsLeftCollapsed(true)}
          onExpand={() => setIsLeftCollapsed(false)}
          onRun={handleRun}
          onSelectTab={setLeftTab}
          publishedView={publishedView}
          runHistoryView={runHistoryView}
        />

        <MiddleCanvasSection
          draftView={draftView}
          publishedView={publishedView}
          runHistoryView={runHistoryView}
          viewMode={viewMode}
        />

        <RightInspectorSection
          draftView={draftView}
          onRun={handleRun}
          publishedView={publishedView}
          runHistoryView={runHistoryView}
          viewMode={viewMode}
        />
      </section>

      <RunTimeline
        run={viewMode === "run" ? runHistoryView.selectedRun : undefined}
        selectedStepRunId={runHistoryView.selectedStepRunId}
        onSelectStepRun={runHistoryView.selectStepRun}
        onOpenHistory={() => {
          setLeftTab("history");
          setViewMode("run");
        }}
      />
    </main>
  );
}

function LeftWorkbenchSection({
  activeTab,
  draftView,
  isCollapsed,
  onCollapse,
  onExpand,
  onRun,
  onSelectTab,
  publishedView,
  runHistoryView
}: {
  activeTab: LeftTab;
  draftView: DraftViewModel;
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onRun: (workflow?: PublishedWorkflow) => void;
  onSelectTab: (tab: LeftTab) => void;
  publishedView: PublishedWorkflowsViewModel;
  runHistoryView: RunHistoryViewModel;
}) {
  return (
    <aside className="workbench-left resource-panel" aria-label="Workflow resources">
      {isCollapsed ? (
        <button
          type="button"
          className="panel-rail-button"
          onClick={onExpand}
          aria-label="Expand resource panel"
        >
          <Icon name="panel" />
        </button>
      ) : (
        <div className="left-panel-layout">
          <div className="left-panel-upper">
            <div className="panel-header">
              <div>
                <h1>Builder</h1>
                <p>Drag, publish, inspect runs.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={onCollapse}
                aria-label="Collapse resource panel"
              >
                <Icon name="collapse" />
              </button>
            </div>
            <div className="tab-list" role="tablist" aria-label="Resource tabs">
              <TabButton active={activeTab === "components"} onClick={() => onSelectTab("components")}>
                Components
              </TabButton>
              <TabButton active={activeTab === "published"} onClick={() => onSelectTab("published")}>
                Published
              </TabButton>
              <TabButton active={activeTab === "history"} onClick={() => onSelectTab("history")}>
                History
              </TabButton>
            </div>
          </div>

          <div className="left-panel-content">
            {activeTab === "components" ? (
              <ComponentLibrary templates={componentTemplates} onAdd={draftView.addStepFromTemplate} />
            ) : null}
            {activeTab === "published" ? (
              <PublishedList
                workflows={publishedView.workflows}
                selectedId={publishedView.selectedWorkflowId}
                onSelect={publishedView.selectWorkflow}
                onRun={onRun}
              />
            ) : null}
            {activeTab === "history" ? (
              <RunHistoryList
                runs={runHistoryView.runs}
                selectedId={runHistoryView.selectedRunId}
                onSelect={runHistoryView.selectRun}
              />
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}

function MiddleCanvasSection({
  draftView,
  publishedView,
  runHistoryView,
  viewMode
}: {
  draftView: DraftViewModel;
  publishedView: PublishedWorkflowsViewModel;
  runHistoryView: RunHistoryViewModel;
  viewMode: WorkbenchView;
}) {
  const canvasSteps =
    viewMode === "published"
      ? publishedView.selectedWorkflow?.workflow.steps ?? []
      : viewMode === "run"
        ? runHistoryView.selectedRun?.workflow.steps ?? []
        : draftView.steps;
  const canvasEdges =
    viewMode === "draft"
      ? draftView.edges
      : createEdgesFromSteps(canvasSteps).map((edge) => ({
          ...edge,
          className: "workflow-edge-readonly"
        }));
  const canvasNodes =
    viewMode === "draft"
      ? draftView.nodes
      : createNodes(
          canvasSteps,
          {},
          viewMode === "run" ? statusByStepId(runHistoryView.selectedRun?.stepRuns ?? []) : undefined,
          true
        );

  return (
    <section
      id="workflow-canvas"
      ref={draftView.flowWrapperRef}
      className="workbench-middle canvas-panel"
      aria-label="Workflow canvas"
      onDrop={viewMode === "draft" ? draftView.handleDrop : undefined}
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
        {viewMode === "draft" ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (draftView.selectedStep) {
                draftView.deleteStep(draftView.selectedStep.id);
              }
            }}
            disabled={!draftView.selectedStep}
            aria-label="Delete selected node"
            title="Delete selected node"
          >
            <Icon name="trash" />
          </button>
        ) : (
          <StatusBadge status="readonly" label="Read only snapshot" />
        )}
      </div>
      {canvasSteps.length === 0 ? (
        <div className="canvas-empty" role="status">
          Add a component to start a workflow draft.
        </div>
      ) : (
        <ReactFlow
          nodes={canvasNodes}
          edges={canvasEdges}
          onNodesChange={viewMode === "draft" ? draftView.handleNodesChange : undefined}
          onEdgesChange={viewMode === "draft" ? draftView.handleEdgesChange : undefined}
          onConnect={viewMode === "draft" ? draftView.handleConnect : undefined}
          onNodeClick={(_, node) => {
            if (viewMode === "draft") {
              draftView.selectStep(String(node.data.stepId));
            } else if (viewMode === "run") {
              const stepRun = runHistoryView.selectedRun?.stepRuns.find(
                (item) => item.stepId === node.data.stepId
              );
              if (stepRun) {
                runHistoryView.selectStepRun(stepRun.id);
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
  );
}

function RightInspectorSection({
  draftView,
  onRun,
  publishedView,
  runHistoryView,
  viewMode
}: {
  draftView: DraftViewModel;
  onRun: (workflow?: PublishedWorkflow) => void;
  publishedView: PublishedWorkflowsViewModel;
  runHistoryView: RunHistoryViewModel;
  viewMode: WorkbenchView;
}) {
  const selectedRunStep = runHistoryView.selectedRun?.workflow.steps.find(
    (step) => step.id === runHistoryView.selectedStepRun?.stepId
  );

  return (
    <aside className="workbench-right inspector-panel" aria-label="Metadata inspector">
      {viewMode === "draft" ? (
        <DraftInspector
          step={draftView.selectedStep}
          yaml={draftView.yaml}
          onStepChange={draftView.updateSelectedStep}
        />
      ) : null}
      {viewMode === "published" && publishedView.selectedWorkflow ? (
        <PublishedInspector
          workflow={publishedView.selectedWorkflow}
          onCreateDraft={draftView.loadWorkflowVersion}
          onRun={onRun}
        />
      ) : null}
      {viewMode === "run" && runHistoryView.selectedRun && runHistoryView.selectedStepRun ? (
        <RunInspector
          run={runHistoryView.selectedRun}
          step={selectedRunStep}
          stepRun={runHistoryView.selectedStepRun}
        />
      ) : null}
    </aside>
  );
}
