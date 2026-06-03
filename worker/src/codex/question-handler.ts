export async function answerCodexQuestion(interactionId: string, answer: string) {
  return {
    interactionId,
    decision: "answer",
    answer
  };
}
