export default function SimulationListPanel({ commandHistory }) {
  const latest = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.simulations));

  const simulations = latest?.response?.data?.simulations ?? [];

  return (
    <section>
      <h3>Available Simulations</h3>
      {simulations.length === 0 ? (
        <p className="muted">Run /simulate list to inspect the simulation registry.</p>
      ) : (
        <ul className="compact-list">
          {simulations.map((simulation) => (
            <li key={simulation.id}>{simulation.id} ({simulation.state})</li>
          ))}
        </ul>
      )}
    </section>
  );
}
