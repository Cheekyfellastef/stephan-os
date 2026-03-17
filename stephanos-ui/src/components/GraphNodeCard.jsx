export default function GraphNodeCard({ node }) {
  return (
    <article className="graph-card" key={node.id}>
      <h4>{node.label}</h4>
      <p className="muted">{node.id} • {node.type}</p>
      {node.description && <p>{node.description}</p>}
      {node.tags?.length > 0 && <p className="muted">Tags: {node.tags.join(', ')}</p>}
    </article>
  );
}
