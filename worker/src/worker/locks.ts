export async function withStepRunLock<T>(stepRunId: string, fn: () => Promise<T>) {
  void stepRunId;
  return fn();
}
