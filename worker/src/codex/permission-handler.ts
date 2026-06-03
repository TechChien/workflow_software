export async function autoSkipOptionalContextPermission(interactionId: string) {
  return {
    interactionId,
    decision: "deny",
    status: "auto_skipped"
  };
}
