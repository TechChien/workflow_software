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
import { useQueryClient } from "@tanstack/react-query";
import { stringifyWorkflowYaml, type StepDefinition, type WorkflowYaml } from "@workflow-software/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import type { WorkflowSummary } from "@/lib/api/api-contract";
import { workerApiQueryKeys } from "@/lib/api/query-keys";
import { componentTemplates, type ComponentTemplate } from "../ComponentLibrary";
import {
  initialNodePositions,
  type PublishedWorkflow
} from "@/mock/workflowWorkbench";
import { useCreateWorkflow, useUpdateWorkflowDraft, useWorkflows } from "@/services/worker-api-service";
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

export type DraftWorkflowRecord = {
  id: string;
  name: string;
  workflow: WorkflowYaml;
  updatedAt: string;
  hasPublishedVersion: boolean;
  isLocal: boolean;
};

export type DraftViewModel = {
  flowWrapperRef: RefObject<HTMLDivElement | null>;
  workflows: DraftWorkflowRecord[];
  selectedWorkflowId: string;
  isLoading: boolean;
  errorMessage?: string;
  workflowName: string;
  steps: StepDefinition[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedStep?: StepDefinition;
  yaml: string;
  validation: ReturnType<typeof validateDraft>;
  isDirty: boolean;
  isSavingDraft: boolean;
  saveErrorMessage?: string;
  addWorkflow: () => void;
  renameWorkflow: (name: string) => void;
  saveDraft: () => void;
  selectWorkflow: (workflow: DraftWorkflowRecord) => void;
  createPublishedWorkflow: (revision: number) => PublishedWorkflow;
  loadWorkflowVersion: (workflow: PublishedWorkflow) => void;
  addStepFromTemplate: (template: ComponentTemplate, position?: { x: number; y: number }) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  handleEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  handleConnect: (connection: Connection) => void;
  selectStep: (stepId: string) => void;
  deleteStep: (stepId: string) => void;
  updateSelectedStep: (updater: (step: StepDefinition) => StepDefinition) => void;
};

export function useDraftView(): DraftViewModel {
  const setLeftTab = useWorkbenchStore((state) => state.setLeftTab);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const queryClient = useQueryClient();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const localDraftCounterRef = useRef(1);
  const { screenToFlowPosition } = useReactFlow();
  const workflowsQuery = useWorkflows();
  const createWorkflowMutation = useCreateWorkflow();
  const updateWorkflowDraftMutation = useUpdateWorkflowDraft();
  const [draftWorkflowId, setDraftWorkflowId] = useState("untitled-workflow");
  const [draftWorkflowName, setDraftWorkflowName] = useState("Untitled Workflow");
  const [draftSteps, setDraftSteps] = useState<StepDefinition[]>([]);
  const [draftNodes, setDraftNodes, onDraftNodesChange] = useNodesState<CanvasNode>([]);
  const [draftEdges, setDraftEdges, onDraftEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [selectedDraftStepId, setSelectedDraftStepId] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [selectedDraftWorkflowId, setSelectedDraftWorkflowId] = useState("");
  const [persistedWorkflowId, setPersistedWorkflowId] = useState<string>();
  const [localDraftUpdatedAt, setLocalDraftUpdatedAt] = useState(formatDateTime(new Date()));
  const [localDraftWorkflows, setLocalDraftWorkflows] = useState<DraftWorkflowRecord[]>([]);

  const draftWorkflow = useMemo(
    () => createWorkflowYaml(draftWorkflowId, draftWorkflowName, stepsWithConnections(draftSteps, draftEdges)),
    [draftEdges, draftSteps, draftWorkflowId, draftWorkflowName]
  );
  const draftYaml = useMemo(() => stringifyWorkflowYaml(draftWorkflow), [draftWorkflow]);
  const validation = useMemo(() => validateDraft(draftSteps, draftEdges), [draftEdges, draftSteps]);
  const selectedDraftStep = draftSteps.find((step) => step.id === selectedDraftStepId) ?? draftSteps[0];
  const canvasNodes = useMemo(() => hydrateNodes(draftNodes, draftSteps), [draftNodes, draftSteps]);
  const apiDraftWorkflows = useMemo(
    () => workflowsQuery.data?.items.map(toDraftWorkflow) ?? [],
    [workflowsQuery.data?.items]
  );
  const draftWorkflows = useMemo(
    () => [...apiDraftWorkflows, ...localDraftWorkflows],
    [apiDraftWorkflows, localDraftWorkflows]
  );
  const isSavingDraft = createWorkflowMutation.isPending || updateWorkflowDraftMutation.isPending;
  const saveErrorMessage =
    updateWorkflowDraftMutation.error?.message ?? createWorkflowMutation.error?.message;

  useEffect(() => {
    setLocalDraftWorkflows((workflows) => {
      const hasLocalWorkflow = workflows.some((workflow) => workflow.id === draftWorkflow.id);
      const isPersistedWorkflow = Boolean(persistedWorkflowId);

      if (!hasLocalWorkflow && !isPersistedWorkflow && isDirty) {
        return [
          ...workflows,
          {
            id: draftWorkflow.id,
            name: draftWorkflow.name,
            workflow: draftWorkflow,
            updatedAt: "Unsaved changes",
            hasPublishedVersion: false,
            isLocal: true
          }
        ];
      }

      if (!workflows.some((workflow) => workflow.id === draftWorkflow.id)) {
        return workflows;
      }

      return workflows.map((workflow) =>
        workflow.id === draftWorkflow.id
          ? {
              ...workflow,
              name: draftWorkflow.name,
              workflow: draftWorkflow,
              updatedAt: isDirty ? "Unsaved changes" : localDraftUpdatedAt,
              hasPublishedVersion: apiDraftWorkflows.some(
                (apiWorkflow) => apiWorkflow.id === persistedWorkflowId && apiWorkflow.hasPublishedVersion
              )
            }
          : workflow
      );
    });
  }, [apiDraftWorkflows, draftWorkflow, isDirty, localDraftUpdatedAt, persistedWorkflowId]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const addWorkflow = useCallback(() => {
    const draftNumber = localDraftCounterRef.current;
    localDraftCounterRef.current += 1;

    const workflow = createWorkflowYaml(`local-workflow-${Date.now()}-${draftNumber}`, `Untitled Workflow ${draftNumber}`, []);
    const localDraft: DraftWorkflowRecord = {
      id: workflow.id,
      name: workflow.name,
      workflow,
      updatedAt: "Unsaved changes",
      hasPublishedVersion: false,
      isLocal: true
    };

    setLocalDraftWorkflows((workflows) => [...workflows, localDraft]);
    setDraftWorkflowId(workflow.id);
    setDraftWorkflowName(workflow.name);
    setDraftSteps([]);
    setDraftNodes([]);
    setDraftEdges([]);
    setSelectedDraftStepId("");
    setSelectedDraftWorkflowId(workflow.id);
    setPersistedWorkflowId(undefined);
    setLocalDraftUpdatedAt(formatDateTime(new Date()));
    setIsDirty(true);
    setViewMode("draft");
    setLeftTab("draft");
  }, [setDraftEdges, setDraftNodes, setLeftTab, setViewMode]);

  const loadDraftWorkflow = useCallback(
    (workflow: DraftWorkflowRecord) => {
      setDraftWorkflowId(workflow.workflow.id);
      setDraftWorkflowName(workflow.workflow.name);
      setDraftSteps(workflow.workflow.steps);
      setDraftNodes(createNodes(workflow.workflow.steps, initialNodePositions));
      setDraftEdges(createEdgesFromSteps(workflow.workflow.steps));
      setSelectedDraftStepId(workflow.workflow.steps[0]?.id ?? "");
      setSelectedDraftWorkflowId(workflow.id);
      setPersistedWorkflowId(workflow.isLocal ? undefined : workflow.id);
      setIsDirty(workflow.isLocal && workflow.updatedAt === "Unsaved changes");
      setLocalDraftUpdatedAt(workflow.updatedAt);
      setViewMode("draft");
    },
    [setDraftEdges, setDraftNodes, setViewMode]
  );

  const deleteSteps = useCallback(
    (stepIds: string[]) => {
      const idsToDelete = new Set(stepIds);
      const remainingSteps = draftSteps.filter((step) => !idsToDelete.has(step.id));

      if (remainingSteps.length === draftSteps.length) {
        return;
      }

      setDraftSteps(remainingSteps);
      setDraftNodes((nodes) => nodes.filter((node) => !idsToDelete.has(node.id)));
      setDraftEdges((edges) =>
        edges.filter((edge) => !idsToDelete.has(edge.source) && !idsToDelete.has(edge.target))
      );
      if (idsToDelete.has(selectedDraftStepId)) {
        setSelectedDraftStepId(remainingSteps[0]?.id ?? "");
      }
      markDirty();
    },
    [draftSteps, markDirty, selectedDraftStepId, setDraftEdges, setDraftNodes]
  );

  const deleteStep = useCallback((stepId: string) => deleteSteps([stepId]), [deleteSteps]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const removedNodeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      const retainedChanges = changes.filter((change) => change.type !== "remove");

      markDirty();
      if (retainedChanges.length) {
        onDraftNodesChange(retainedChanges);
      }
      if (removedNodeIds.length) {
        deleteSteps(removedNodeIds);
      }
    },
    [deleteSteps, markDirty, onDraftNodesChange]
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
      setSelectedDraftWorkflowId(persistedWorkflowId ?? draftWorkflowId);
      setViewMode("draft");
      setLeftTab("draft");
      setIsDirty(true);
    },
    [draftSteps, draftWorkflowId, persistedWorkflowId, setDraftNodes, setLeftTab, setViewMode]
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
    setSelectedDraftWorkflowId(persistedWorkflowId ?? draftWorkflowId);
    setIsDirty(true);
  }, [draftWorkflowId, persistedWorkflowId]);

  const saveDraft = useCallback(async () => {
    const body = { draftYaml: draftWorkflow };
    const savedWorkflow = persistedWorkflowId
      ? await updateWorkflowDraftMutation.mutateAsync({
          workflowId: persistedWorkflowId,
          body
        })
      : await createWorkflowMutation.mutateAsync(body);

    setIsDirty(false);
    setPersistedWorkflowId(savedWorkflow.id);
    setSelectedDraftWorkflowId(savedWorkflow.id);
    setDraftWorkflowId(savedWorkflow.draftYaml.id);
    setDraftWorkflowName(savedWorkflow.draftYaml.name);
    setDraftSteps(savedWorkflow.draftYaml.steps);
    setDraftNodes(createNodes(savedWorkflow.draftYaml.steps, initialNodePositions));
    setDraftEdges(createEdgesFromSteps(savedWorkflow.draftYaml.steps));
    setSelectedDraftStepId(savedWorkflow.draftYaml.steps[0]?.id ?? "");
    setLocalDraftUpdatedAt(savedWorkflow.updatedAt);
    setLocalDraftWorkflows((workflows) =>
      workflows.filter(
        (workflow) =>
          workflow.id !== draftWorkflow.id &&
          workflow.id !== savedWorkflow.id &&
          workflow.workflow.id !== savedWorkflow.draftYaml.id
      )
    );
    await queryClient.invalidateQueries({ queryKey: workerApiQueryKeys.workflows.all });
    setViewMode("draft");
  }, [
    createWorkflowMutation,
    draftWorkflow,
    persistedWorkflowId,
    queryClient,
    setDraftEdges,
    setDraftNodes,
    setViewMode,
    updateWorkflowDraftMutation
  ]);

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
      const draftNumber = localDraftCounterRef.current;
      localDraftCounterRef.current += 1;

      const draftWorkflow = {
        ...workflow.workflow,
        id: `local-workflow-${Date.now()}-${draftNumber}`,
        name: `${workflow.workflow.name} Draft`
      };
      const localDraft: DraftWorkflowRecord = {
        id: draftWorkflow.id,
        name: draftWorkflow.name,
        workflow: draftWorkflow,
        updatedAt: "Unsaved changes",
        hasPublishedVersion: false,
        isLocal: true
      };

      setLocalDraftWorkflows((workflows) => [...workflows, localDraft]);
      setDraftWorkflowId(draftWorkflow.id);
      setDraftWorkflowName(draftWorkflow.name);
      setDraftSteps(draftWorkflow.steps);
      setDraftNodes(createNodes(draftWorkflow.steps, initialNodePositions));
      setDraftEdges(createEdgesFromSteps(draftWorkflow.steps));
      setSelectedDraftStepId(draftWorkflow.steps[0]?.id ?? "");
      setSelectedDraftWorkflowId(draftWorkflow.id);
      setPersistedWorkflowId(undefined);
      setLocalDraftUpdatedAt(formatDateTime(new Date()));
      setIsDirty(true);
      setViewMode("draft");
      setLeftTab("draft");
    },
    [setDraftEdges, setDraftNodes, setLeftTab, setViewMode]
  );

  return {
    flowWrapperRef,
    workflows: draftWorkflows,
    selectedWorkflowId: selectedDraftWorkflowId,
    isLoading: workflowsQuery.isLoading,
    errorMessage: workflowsQuery.error?.message,
    workflowName: draftWorkflowName,
    steps: draftSteps,
    nodes: canvasNodes,
    edges: draftEdges,
    selectedStep: selectedDraftStep,
    yaml: draftYaml,
    validation,
    isDirty,
    isSavingDraft,
    saveErrorMessage,
    addWorkflow,
    renameWorkflow,
    saveDraft,
    selectWorkflow: loadDraftWorkflow,
    createPublishedWorkflow,
    loadWorkflowVersion,
    addStepFromTemplate,
    handleDrop,
    handleNodesChange,
    handleEdgesChange,
    handleConnect,
    selectStep: setSelectedDraftStepId,
    deleteStep,
    updateSelectedStep
  };
}

function toDraftWorkflow(workflow: WorkflowSummary): DraftWorkflowRecord {
  return {
    id: workflow.id,
    name: workflow.name,
    workflow: workflow.draftYaml,
    updatedAt: workflow.updatedAt,
    hasPublishedVersion: Boolean(workflow.latestPublishedVersion),
    isLocal: false
  };
}
