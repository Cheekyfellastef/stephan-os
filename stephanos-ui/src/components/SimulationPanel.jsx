import SimulationListPanel from './SimulationListPanel';
import SimulationResultCard from './SimulationResultCard';

export default function SimulationPanel({ commandHistory }) {
  const latestResult = [...commandHistory]
    .reverse()
    .find((entry) => entry.route === 'simulation' && entry.response?.data?.result);

  return (
    <section className="panel">
      <h2>Simulation Core</h2>
      <SimulationListPanel commandHistory={commandHistory} />
      <div>
        <h3>Latest Result</h3>
        {!latestResult ? (
          <p className="muted">Run /simulate run trajectory-demo --start 1000 --monthly 100 --rate 0.05 --years 10</p>
        ) : (
          <SimulationResultCard payload={latestResult.response.data} />
        )}
      </div>
    </section>
  );
}
