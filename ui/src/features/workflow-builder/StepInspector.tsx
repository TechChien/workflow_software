export function StepInspector() {
  return (
    <section className="panel">
      <h2>Step Inspector</h2>
      <label>
        Step name
        <input value="g2_gap_analysis" readOnly />
      </label>
      <label>
        Type
        <select defaultValue="code_agent">
          <option value="agent">Agent</option>
          <option value="code_agent">Code Agent</option>
          <option value="human_review">Human Review</option>
        </select>
      </label>
      <label>
        Context paths
        <textarea value={"src\ndocs/domain-rules.md"} readOnly />
      </label>
      <label>
        Acceptance criteria
        <textarea value="Every codebase claim must cite file and line evidence." readOnly />
      </label>
    </section>
  );
}
