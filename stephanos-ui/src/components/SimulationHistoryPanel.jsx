export default function SimulationHistoryPanel({ commandHistory }) {
  const runs = commandHistory.findLast((entry) => entry.data_payload?.runs)?.data_payload?.runs ?? [];
  return (
    <section className="panel">
      <h3>Simulation History</h3>
      <ul className="compact-list">
        {runs.slice(0, 4).map((run) => <li key={run.run_id}>{run.simulation_id} · {run.output_summary?.headline ?? 'run'} </li>)}
        {runs.length === 0 && <li className="muted">Run /simulate history list</li>}
      </ul>
    </section>
  );
}
