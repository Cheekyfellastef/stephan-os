import { formatResultTitle, getResultTone } from '../ai/commandFormatter';
import GraphNodeCard from './GraphNodeCard';
import GraphEdgeCard from './GraphEdgeCard';
import GraphStatsCard from './GraphStatsCard';

function GraphPayload({ payload }) {
  const stats = payload.stats;
  const node = payload.node;
  const edge = payload.edge;
  const nodes = payload.nodes || payload.node_matches || [];
  const edges = payload.edges || payload.edge_matches || [];

  if (!stats && !node && !edge && nodes.length === 0 && edges.length === 0 && !payload.related) {
    return null;
  }

  return (
    <div className="graph-structured">
      <GraphStatsCard stats={stats} />
      {node && <GraphNodeCard node={node} />}
      {edge && <GraphEdgeCard edge={edge} />}
      {payload.related?.length > 0 && (
        <div>
          <h4>Related Nodes</h4>
          {payload.related.slice(0, 5).map((entry) => <GraphNodeCard key={entry.node.id} node={entry.node} />)}
        </div>
      )}
      {nodes.length > 0 && (
        <div>
          <h4>Nodes</h4>
          {nodes.slice(0, 3).map((item) => <GraphNodeCard key={item.id} node={item} />)}
        </div>
      )}
      {edges.length > 0 && (
        <div>
          <h4>Edges</h4>
          {edges.slice(0, 3).map((item) => <GraphEdgeCard key={item.id} edge={item} />)}
        </div>
      )}
    </div>
  );
}

export default function CommandResultCard({ entry }) {
  const tone = getResultTone(entry.response?.type);

  return (
    <article className={`result-card ${tone}`}>
      <header>
        <strong>{formatResultTitle(entry)}</strong>
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </header>
      <p className="result-input">{entry.raw_input}</p>
      <p>{entry.output_text}</p>
      {entry.error && <p className="error-text">Error: {entry.error}</p>}
      {entry.data_payload && <GraphPayload payload={entry.data_payload} />}
      {entry.data_payload && Object.keys(entry.data_payload).length > 0 && (
        <details>
          <summary>Structured data</summary>
          <pre>{JSON.stringify(entry.data_payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
