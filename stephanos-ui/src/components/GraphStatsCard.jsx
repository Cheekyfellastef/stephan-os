export default function GraphStatsCard({ stats }) {
  if (!stats) return null;

  return (
    <article className="graph-card">
      <h4>Graph Stats</h4>
      <ul className="compact-list">
        <li>Nodes: {stats.totals?.nodes ?? 0}</li>
        <li>Edges: {stats.totals?.edges ?? 0}</li>
        <li>Tags: {stats.totals?.tags ?? 0}</li>
      </ul>
    </article>
  );
}
