export function HumanDecisionPanel() {
  return (
    <section className="panel">
      <h2>Human Decision</h2>
      <textarea placeholder="Add steering comment for Codex rerun" />
      <div className="button-row">
        <button type="button">Approve</button>
        <button type="button">Reject with comment</button>
      </div>
    </section>
  );
}
