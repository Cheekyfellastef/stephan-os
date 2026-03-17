export default function ActivityPanel({ commandHistory }) {
  const events = commandHistory.findLast((entry) => entry.data_payload?.events)?.data_payload?.events ?? [];

  return (
    <section className="panel">
      <h3>Activity Log</h3>
      <ul className="compact-list">
        {events.slice(0, 4).map((event) => <li key={event.id}>{event.type} · {event.summary}</li>)}
        {events.length === 0 && <li className="muted">Run /activity recent</li>}
      </ul>
    </section>
  );
}
