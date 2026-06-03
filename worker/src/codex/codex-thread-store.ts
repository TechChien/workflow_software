export type CodexThreadRecord = {
  stepRunId: string;
  codexThreadId: string;
};

export async function rememberCodexThread(record: CodexThreadRecord) {
  return record;
}
