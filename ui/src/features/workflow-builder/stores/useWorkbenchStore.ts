import { create } from "zustand";
import { type LeftTab, type WorkbenchView } from "../workbenchShared";

type WorkbenchState = {
  leftTab: LeftTab;
  viewMode: WorkbenchView;
  setLeftTab: (tab: LeftTab) => void;
  setViewMode: (viewMode: WorkbenchView) => void;
};

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  leftTab: "draft",
  viewMode: "draft",
  setLeftTab: (leftTab) => set({ leftTab }),
  setViewMode: (viewMode) => set({ viewMode })
}));
