const events = [
  "Run created from published workflow version",
  "g1_intent_freeze accepted",
  "g2_gap_analysis running"
];

export function RunTimeline() {
  return (
    <section className="panel">
      <h2>Run Timeline</h2>
      <ol>
        {events.map((event) => (
          <li key={event}>{event}</li>
        ))}
      </ol>
    </section>
  );
}
