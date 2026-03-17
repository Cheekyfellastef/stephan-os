import GraphNodeCard from './GraphNodeCard';
import GraphEdgeCard from './GraphEdgeCard';
import GraphStatsCard from './GraphStatsCard';

export default function KnowledgeGraphPanel({ commandHistory }) {
  const latestGraphEntry = [...commandHistory]
    .reverse()
    .find((entry) => entry.route === 'kg' || entry.tool_used?.startsWith('kg'));

  const graphData = latestGraphEntry?.response?.data ?? {};
  const stats = graphData.stats ?? graphData.status?.stats ? { totals: graphData.status.stats } : null;
  const nodes = graphData.nodes ?? graphData.node_matches ?? graphData.stats?.recent_nodes ?? [];
  const edges = graphData.edges ?? graphData.edge_matches ?? graphData.stats?.recent_edges ?? [];

  return (
    <section className="panel">
      <h2>Knowledge Graph</h2>
      {!latestGraphEntry ? (
        <p className="muted">Run /kg help to get started.</p>
      ) : (
        <>
          <p className="muted">Latest command: {latestGraphEntry.raw_input}</p>
          <GraphStatsCard stats={stats || graphData.stats} />
          <div className="graph-grid">
            <div>
              <h3>Nodes</h3>
              {nodes.length === 0 ? <p className="muted">No nodes in this view.</p> : nodes.slice(0, 5).map((node) => <GraphNodeCard key={node.id} node={node} />)}
            </div>
            <div>
              <h3>Edges</h3>
              {edges.length === 0 ? <p className="muted">No edges in this view.</p> : edges.slice(0, 5).map((edge) => <GraphEdgeCard key={edge.id} edge={edge} />)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
