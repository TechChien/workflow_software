import {
  addEdge,
  MarkerType,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange
} from "@xyflow/react";
import { stringifyWorkflowYaml, type StepDefinition } from "@workflow-software/shared";
import { useCallback, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import {
  componentTemplates,
  initialNodePositions,
  sampleSteps,
  type ComponentTemplate,
  type PublishedWorkflow
} from "@/mock/workflowWorkbench";
import {
  createEdgesFromSteps,
  createNode,
  createNodes,
  createWorkflowYaml,
  formatDateTime,
  hydrateNodes,
  nextStepId,
  stepsWithConnections,
  validateDraft,
  type CanvasEdge,
  type CanvasNode
} from "../workbenchShared";
import { useWorkbenchStore } from "../stores/useWorkbenchStore";

export type DraftViewModel = {
  flowWrapperRef: RefObject<HTMLDivElement | null>;
  workflowName: string;
  steps: StepDefinition[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedStep?: StepDefinition;
  yaml: string;
  validation: ReturnType<typeof validateDraft>;
  isDirty: boolean;
  renameWorkflow: (name: string) => void;
  saveDraft: () => void;
  createPublishedWorkflow: (revision: number) => PublishedWorkflow;
  loadWorkflowVersion: (workflow: PublishedWorkflow) => void;
  addStepFromTemplate: (template: ComponentTemplate, position?: { x: number; y: number }) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  handleEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  handleConnect: (connection: Connection) => void;
  selectStep: (stepId: string) => void;
  updateSelectedStep: (updater: (step: StepDefinition) => StepDefinition) => void;
};

export function useDraftView(): DraftViewModel {
  const setLeftTab = useWorkbenchStore((state) => state.setLeftTab);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
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
  const [selectedDraftStepId, setSelectedDraftStepId] = useState(sampleSteps[1]?.id ?? "");
  const [isDirty, setIsDirty] = useState(true);

  const draftWorkflow = useMemo(
    () => createWorkflowYaml(draftWorkflowId, draftWorkflowName, stepsWithConnections(draftSteps, draftEdges)),
    [draftEdges, draftSteps, draftWorkflowId, draftWorkflowName]
  );
  const draftYaml = useMemo(() => stringifyWorkflowYaml(draftWorkflow), [draftWorkflow]);
  const validation = useMemo(() => validateDraft(draftSteps, draftEdges), [draftEdges, draftSteps]);
  const selectedDraftStep = draftSteps.find((step) => step.id === selectedDraftStepId) ?? draftSteps[0];
  const canvasNodes = useMemo(() => hydrateNodes(draftNodes, draftSteps), [draftNodes, draftSteps]);

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
    [draftSteps, setDraftNodes, setLeftTab, setViewMode]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
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

  const renameWorkflow = useCallback((name: string) => {
    setDraftWorkflowName(name);
    setIsDirty(true);
  }, []);

  const saveDraft = useCallback(() => {
    setIsDirty(false);
    setViewMode("draft");
  }, [setViewMode]);

  const createPublishedWorkflow = useCallback(
    (revision: number): PublishedWorkflow => {
      setIsDirty(false);
      return {
        id: `version-${draftWorkflow.id}-r${revision}`,
        revision,
        publishedAt: formatDateTime(new Date()),
        workflow: draftWorkflow,
        lastRunStatus: "pending"
      };
    },
    [draftWorkflow]
  );

  const loadWorkflowVersion = useCallback(
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
    [setDraftEdges, setDraftNodes, setLeftTab, setViewMode]
  );

  return {
    flowWrapperRef,
    workflowName: draftWorkflowName,
    steps: draftSteps,
    nodes: canvasNodes,
    edges: draftEdges,
    selectedStep: selectedDraftStep,
    yaml: draftYaml,
    validation,
    isDirty,
    renameWorkflow,
    saveDraft,
    createPublishedWorkflow,
    loadWorkflowVersion,
    addStepFromTemplate,
    handleDrop,
    handleNodesChange,
    handleEdgesChange,
    handleConnect,
    selectStep: setSelectedDraftStepId,
    updateSelectedStep
  };
}
