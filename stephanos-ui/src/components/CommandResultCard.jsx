import { formatResultTitle, getResultTone } from '../ai/commandFormatter';
import GraphNodeCard from './GraphNodeCard';
import GraphEdgeCard from './GraphEdgeCard';
import GraphStatsCard from './GraphStatsCard';
import SimulationResultCard from './SimulationResultCard';
import AnswerPaneCopyButton from './AnswerPaneCopyButton';

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
  const executionMetadata = entry.data_payload?.execution_metadata || null;
  const providerExecutionTruth = entry.data_payload?.provider_execution_truth || null;
  const suggestedActions = entry.data_payload?.suggested_actions ?? [];
  const isMockResponse = executionMetadata?.actual_provider_used === 'mock';
  const displayAnswerText = entry.stream_finalized === true
    ? entry.output_text
    : (entry.stream_buffer_text || entry.output_text);

  return (
    <article className={`result-card ${tone} ${entry.response?.type === 'assistant_response' ? 'assistant' : ''}`}>
      <header>
        <strong>{formatResultTitle(entry)}</strong>
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </header>
      <p className="result-input">{entry.raw_input}</p>
      {executionMetadata ? (
        <div className={`api-banner ${executionMetadata.fallback_used ? 'degraded' : 'online'}`}>
          <strong>
            UI requested {executionMetadata.ui_requested_provider || executionMetadata.requested_provider} → backend selected {executionMetadata.selected_provider} → used {executionMetadata.actual_provider_used}
          </strong>
          <span>
            Backend default: {executionMetadata.backend_default_provider || 'n/a'} · Model: {executionMetadata.model_used || 'n/a'} · Response truth: {isMockResponse ? 'mock' : 'live'}
            {executionMetadata.fallback_used ? ` · Fallback reason: ${executionMetadata.fallback_reason || 'unspecified'}` : isMockResponse ? ' · Mock answered directly' : ' · No fallback'}
          </span>
          <span>
            Freshness Need: {executionMetadata.freshness_need || 'low'} · Answer Mode: {executionMetadata.selected_answer_mode || 'local-private'} · Stale Risk: {executionMetadata.stale_risk || 'low'}
            {executionMetadata.freshness_warning ? ` · Warning: ${executionMetadata.freshness_warning}` : ''}
          </span>
        </div>
      ) : null}
      <p className="assistant-answer-text" data-no-drag>{displayAnswerText}</p>
      {providerExecutionTruth?.narration ? <p className="muted">{providerExecutionTruth.narration}</p> : null}
      {entry.error && <p className="error-text">Error [{entry.error_code ?? 'N/A'}]: {entry.error}</p>}
      <p className="muted">Subsystem: {entry.response?.debug?.selected_subsystem ?? entry.route}</p>
      {entry.data_payload?.result && <SimulationResultCard payload={entry.data_payload} />}
      {entry.data_payload && <GraphPayload payload={entry.data_payload} />}
      {suggestedActions.length > 0 && (
        <div className="suggested-actions">
          <strong>Suggested actions</strong>
          <ul className="compact-list">
            {suggestedActions.map((action) => <li key={action.command}><code>{action.command}</code> — {action.label}</li>)}
          </ul>
        </div>
      )}
      {entry.data_payload && Object.keys(entry.data_payload).length > 0 && (
        <details>
          <summary>Structured data</summary>
          <pre>{JSON.stringify(entry.data_payload, null, 2)}</pre>
        </details>
      )}
      {entry.response?.type === 'assistant_response' ? <AnswerPaneCopyButton message={entry} /> : null}
    </article>
  );
}
