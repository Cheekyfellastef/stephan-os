export default function GraphEdgeCard({ edge }) {
  return (
    <article className="graph-card" key={edge.id}>
      <h4>{edge.label || edge.type}</h4>
      <p className="muted">{edge.id}</p>
      <p>{edge.from} → {edge.to}</p>
      <p className="muted">Type: {edge.type} • Weight: {edge.weight}</p>
    </article>
  );
}
