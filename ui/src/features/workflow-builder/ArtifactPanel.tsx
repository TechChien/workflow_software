const artifacts = [
  { key: "g1_requirements", version: "v1", status: "accepted" },
  { key: "g2_gap_summary", version: "v1", status: "candidate" }
];

export function ArtifactPanel() {
  return (
    <section className="panel">
      <h2>Artifact Versions</h2>
      <ul>
        {artifacts.map((artifact) => (
          <li key={artifact.key}>
            <strong>{artifact.key}</strong>
            <span>
              {artifact.version} / {artifact.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
