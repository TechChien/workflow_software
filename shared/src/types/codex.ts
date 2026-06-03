export type CodexPauseKind = "permission" | "question";

export type CodexInteractionEvent = {
  id: string;
  stepRunId: string;
  kind: CodexPauseKind;
  prompt: string;
  status: "pending" | "answered" | "auto_skipped";
};
