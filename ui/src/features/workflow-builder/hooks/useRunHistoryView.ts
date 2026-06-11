import { useCallback, useState } from "react";
import {
  initialRuns,
  type RunRecord,
  type StepRunRecord
} from "@/mock/workflowWorkbench";
import { useWorkbenchStore } from "../stores/useWorkbenchStore";

export type RunHistoryViewModel = {
  runs: RunRecord[];
  selectedRunId: string;
  selectedStepRunId: string;
  selectedRun?: RunRecord;
  selectedStepRun?: StepRunRecord;
  addRun: (run: RunRecord) => void;
  selectRun: (run: RunRecord) => void;
  selectStepRun: (stepRunId: string) => void;
};

export function useRunHistoryView(): RunHistoryViewModel {
  const setLeftTab = useWorkbenchStore((state) => state.setLeftTab);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const [runHistory, setRunHistory] = useState<RunRecord[]>(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState(initialRuns[0]?.id ?? "");
  const [selectedStepRunId, setSelectedStepRunId] = useState(initialRuns[0]?.stepRuns[1]?.id ?? "");
  const selectedRun = runHistory.find((run) => run.id === selectedRunId) ?? runHistory[0];
  const selectedStepRun =
    selectedRun?.stepRuns.find((stepRun) => stepRun.id === selectedStepRunId) ?? selectedRun?.stepRuns[0];

  const addRun = useCallback((run: RunRecord) => {
    setRunHistory((runs) => [run, ...runs]);
    setSelectedRunId(run.id);
    setSelectedStepRunId(run.stepRuns[0]?.id ?? "");
  }, []);

  const selectRun = useCallback(
    (run: RunRecord) => {
      setSelectedRunId(run.id);
      setSelectedStepRunId(run.stepRuns[0]?.id ?? "");
      setLeftTab("history");
      setViewMode("run");
    },
    [setLeftTab, setViewMode]
  );

  return {
    runs: runHistory,
    selectedRunId,
    selectedStepRunId,
    selectedRun,
    selectedStepRun,
    addRun,
    selectRun,
    selectStepRun: setSelectedStepRunId
  };
}
