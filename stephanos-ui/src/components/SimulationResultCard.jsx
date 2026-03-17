import SimulationChartView from './SimulationChartView';

export default function SimulationResultCard({ payload }) {
  const result = payload.result ?? {};
  const snapshots = result.yearlySnapshots ?? [];

  return (
    <div className="simulation-result-card">
      <h4>{payload.simulationName ?? payload.simulationId}</h4>
      <p className="muted">Simulation ID: {payload.simulationId}</p>
      {typeof result.finalValue === 'number' && <p>Final Value: ${result.finalValue.toLocaleString()}</p>}
      <SimulationChartView snapshots={snapshots} />
      {snapshots.length > 0 && (
        <details>
          <summary>Yearly Snapshots</summary>
          <pre>{JSON.stringify(snapshots, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
