type CodexThread = {
  run(prompt: string): Promise<unknown>;
};

type CodexClient = {
  startThread(): CodexThread;
  resumeThread(threadId: string): CodexThread;
};

type CodexConstructor = new () => CodexClient;

export async function createCodexClient(): Promise<CodexClient> {
  const mod = (await import("@openai/codex-sdk")) as { Codex?: CodexConstructor };

  if (!mod.Codex) {
    throw new Error("@openai/codex-sdk did not expose Codex constructor");
  }

  return new mod.Codex();
}
