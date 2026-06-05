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
        </select>
      </label>
      <label>
        Evaluator
        <select defaultValue="mixed">
          <option value="mixed">Mixed</option>
          <option value="human_review">Human Review</option>
          <option value="evaluator_review">Evaluator Review</option>
        </select>
      </label>
      <label>
        Context paths
        <textarea value={"src\ndocs/domain-rules.md"} readOnly />
      </label>
      <fieldset>
        <legend>Acceptance criteria</legend>
        <label>
          Criterion 1
          <textarea value="Every codebase claim must cite file and line evidence." readOnly />
        </label>
        <label>
          Criterion 2
          <textarea value="Each identified gap explains its impact." readOnly />
        </label>
      </fieldset>
    </section>
  );
}
