export function YamlPanel({ yaml }: { yaml: string }) {
  return (
    <section className="panel yaml-panel">
      <h2>workflow.yaml</h2>
      <pre>{yaml}</pre>
    </section>
  );
}
