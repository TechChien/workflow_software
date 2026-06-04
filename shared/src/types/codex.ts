export type CodexInteractionKind =
  | "item.completed"
  | "turn.completed"
  | "turn.failed"
  | "error";

export type CodexInteractionEvent = {
  id: string;
  stepRunId: string;
  sequence: number;
  externalItemId?: string;
  kind: CodexInteractionKind;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
};
