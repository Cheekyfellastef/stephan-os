export default function SimulationChartView({ snapshots = [] }) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;

  const maxValue = Math.max(...snapshots.map((entry) => entry.value || 0), 1);

  return (
    <div className="simulation-chart">
      {snapshots.map((entry) => (
        <div key={entry.year} className="chart-row">
          <span>Y{entry.year}</span>
          <div className="chart-bar-wrap">
            <div
              className="chart-bar"
              style={{ width: `${Math.max((entry.value / maxValue) * 100, 2)}%` }}
              title={`$${entry.value.toLocaleString()}`}
            />
          </div>
          <span>${entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
