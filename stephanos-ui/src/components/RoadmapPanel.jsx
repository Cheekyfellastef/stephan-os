export default function RoadmapPanel({ commandHistory }) {
  const items = commandHistory.findLast((entry) => entry.data_payload?.items)?.data_payload?.items ?? [];
  const summary = commandHistory.findLast((entry) => entry.data_payload?.summary)?.data_payload?.summary;

  return (
    <section className="panel">
      <h3>Roadmap</h3>
      {summary && <p className="muted">Open {summary.open} · Done {summary.done}</p>}
      <ul className="compact-list">
        {items.slice(0, 4).map((item) => <li key={item.id}>{item.status} · {item.text}</li>)}
        {items.length === 0 && <li className="muted">Run /roadmap list</li>}
      </ul>
    </section>
  );
}
