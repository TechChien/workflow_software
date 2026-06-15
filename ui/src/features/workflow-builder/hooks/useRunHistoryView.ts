import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowRunDetail, WorkflowRunSummary } from "@/lib/api/api-contract";
import {
  type RunRecord,
  type StepRunRecord
} from "@/mock/workflowWorkbench";
import { useRunHistory, useWorkflowRun } from "@/services/worker-api-service";
import { useWorkbenchStore } from "../stores/useWorkbenchStore";
import { createWorkflowYaml, formatDateTime } from "../workbenchShared";

export type RunHistoryViewModel = {
  runs: RunRecord[];
  selectedRunId: string;
  selectedStepRunId: string;
  selectedRun?: RunRecord;
  selectedStepRun?: StepRunRecord;
  errorMessage?: string;
  isLoading: boolean;
  addRun: (run: RunRecord) => void;
  selectRun: (run: RunRecord) => void;
  selectStepRun: (stepRunId: string) => void;
};

export function useRunHistoryView(): RunHistoryViewModel {
  const setLeftTab = useWorkbenchStore((state) => state.setLeftTab);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const [localRuns, setLocalRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedStepRunId, setSelectedStepRunId] = useState("");
  const runHistoryQuery = useRunHistory({ limit: 50 }, { refetchInterval: 5_000 });
  const localSelectedRun = localRuns.find((run) => run.id === selectedRunId);
  const selectedRunQuery = useWorkflowRun(selectedRunId, {
    enabled: Boolean(selectedRunId),
    refetchInterval: 2_500
  });
  const apiRuns = useMemo(
    () => (runHistoryQuery.data?.items ?? []).map(toRunRecord),
    [runHistoryQuery.data?.items]
  );
  const runs = useMemo(() => {
    const localIds = new Set(localRuns.map((run) => run.id));
    return [...localRuns, ...apiRuns.filter((run) => !localIds.has(run.id))];
  }, [apiRuns, localRuns]);
  const apiSelectedRun = selectedRunQuery.data
    ? toRunRecord(selectedRunQuery.data)
    : runs.find((run) => run.id === selectedRunId);
  const selectedRun = apiSelectedRun ?? localSelectedRun ?? runs[0];
  const selectedStepRun =
    selectedRun?.stepRuns.find((stepRun) => stepRun.id === selectedStepRunId) ?? selectedRun?.stepRuns[0];

  useEffect(() => {
    if (!runs.length) {
      setSelectedRunId("");
      setSelectedStepRunId("");
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRun) {
      return;
    }

    if (
      selectedRun.waitingStepRunId &&
      selectedRun.stepRuns.some((stepRun) => stepRun.id === selectedRun.waitingStepRunId) &&
      selectedStepRunId !== selectedRun.waitingStepRunId
    ) {
      setSelectedStepRunId(selectedRun.waitingStepRunId);
      return;
    }

    if (!selectedStepRunId || !selectedRun.stepRuns.some((stepRun) => stepRun.id === selectedStepRunId)) {
      setSelectedStepRunId(selectedRun.stepRuns[0]?.id ?? "");
    }
  }, [selectedRun, selectedStepRunId]);

  const addRun = useCallback((run: RunRecord) => {
    setLocalRuns((runs) => [run, ...runs]);
    setSelectedRunId(run.id);
    setSelectedStepRunId(run.waitingStepRunId ?? run.stepRuns[0]?.id ?? "");
  }, []);

  const selectRun = useCallback(
    (run: RunRecord) => {
      setSelectedRunId(run.id);
      setSelectedStepRunId(run.waitingStepRunId ?? run.stepRuns[0]?.id ?? "");
      setLeftTab("history");
      setViewMode("run");
    },
    [setLeftTab, setViewMode]
  );

  return {
    runs,
    selectedRunId,
    selectedStepRunId,
    selectedRun,
    selectedStepRun,
    errorMessage: runHistoryQuery.error?.message ?? selectedRunQuery.error?.message,
    isLoading: runHistoryQuery.isLoading,
    addRun,
    selectRun,
    selectStepRun: setSelectedStepRunId
  };
}

export function toRunRecord(run: WorkflowRunSummary | WorkflowRunDetail): RunRecord {
  return {
    id: run.id,
    workflowVersionId: run.workflowVersionId,
    workflowName: run.workflowName,
    revision: run.revision,
    status: run.status,
    startedAt: formatApiDate(run.startedAt ?? run.createdAt),
    completedAt: run.completedAt ? formatApiDate(run.completedAt) : undefined,
    workflow: "workflow" in run ? run.workflow : createWorkflowYaml(run.workflowId, run.workflowName, []),
    stepRuns: "stepRuns" in run ? run.stepRuns.map(toStepRunRecord) : [],
    waitingStepRunId: run.waitingStepRunId
  };
}

function toStepRunRecord(stepRun: WorkflowRunDetail["stepRuns"][number]): StepRunRecord {
  return {
    id: stepRun.id,
    stepId: stepRun.stepId,
    status: stepRun.status,
    attempt: stepRun.attempt,
    evaluator: stepRun.evaluator,
    artifacts: stepRun.producedArtifacts.map((artifact) => ({
      id: artifact.id,
      key: artifact.artifactKey,
      version: artifact.displayVersion ?? `v${artifact.version}`,
      status: artifact.status,
      filename: artifact.filename,
      format: artifact.format
    })),
    decisionEvents: stepRun.decisionEvents,
    codexUsage: parseCodexUsage(stepRun.codexUsage),
    codexError: parseCodexError(stepRun.codexError),
    staleReason: stepRun.staleReason
  };
}

function formatApiDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date);
}

function parseCodexUsage(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as { inputTokens?: unknown; outputTokens?: unknown };
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  };
}

function parseCodexError(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }

  return "Codex run failed.";
}
