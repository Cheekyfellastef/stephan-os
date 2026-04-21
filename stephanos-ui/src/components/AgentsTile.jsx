import CollapsiblePanel from './CollapsiblePanel';

function formatList(list = []) {
  return Array.isArray(list) && list.length > 0 ? list.join(', ') : 'none';
}

export default function AgentsTile({ finalAgentView, onSelectAgent, selectedAgentId, isOpen = true, onToggle = () => {}, debugVisibility = false } = {}) {
  const view = finalAgentView || {};
  const visibleAgents = Array.isArray(view.visibleAgents) ? view.visibleAgents : [];
  const selected = visibleAgents.find((entry) => entry.agentId === selectedAgentId) || visibleAgents[0] || null;

  return (
    <CollapsiblePanel
      panelId="agentsPanel"
      title="Agents Tile"
      description="Canonical fleet projection from runtime agent truth."
      className="agents-tile"
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <p className="muted">{view.operatorSummary || 'No agent projection available.'}</p>
      <div className="agents-fleet-strip" role="list" aria-label="Agent fleet strip">
        {visibleAgents.map((agent) => (
          <button
            type="button"
            key={agent.agentId}
            className={`agent-pill ${agent.pulseToken} ${agent.agentId === view.actingAgentId ? 'acting' : ''} ${agent.agentId === selected?.agentId ? 'selected' : ''}`}
            onClick={() => onSelectAgent?.(agent.agentId)}
          >
            <strong>{agent.displayName}</strong>
            <span>{agent.state}</span>
            <small>{agent.stateReason}</small>
          </button>
        ))}
      </div>

      <section className="agents-region">
        <h4>Active Handoff Chain</h4>
        <p>{(view.visibleHandoffChain || []).join(' → ') || 'No active handoff chain.'}</p>
      </section>

      {selected ? (
        <section className="agents-region">
          <h4>Agent Detail</h4>
          <ul>
            <li><strong>Role:</strong> {selected.kind}</li>
            <li><strong>Description:</strong> {selected.description}</li>
            <li><strong>State:</strong> {selected.state} · {selected.stateReason}</li>
            <li><strong>Capabilities:</strong> {formatList(selected.capabilities)}</li>
            <li><strong>Dependencies:</strong> {formatList(selected.dependencies)}</li>
            <li><strong>Autonomy:</strong> {selected.autonomyLevel}</li>
            <li><strong>Allowed surfaces:</strong> {formatList(selected.allowedSurfaces)}</li>
            <li><strong>Allowed sessions:</strong> {formatList(selected.allowedSessionKinds)}</li>
            <li><strong>Current task:</strong> {selected.currentTaskSummary || 'none'}</li>
            <li><strong>Last action:</strong> {selected.actionAgeLabel}</li>
            <li><strong>Last success:</strong> {selected.successAgeLabel}</li>
            <li><strong>Last failure:</strong> {selected.failureAgeLabel}</li>
            <li><strong>Blockers:</strong> {formatList(selected.blockers)}</li>
          </ul>
        </section>
      ) : null}

      <section className="agents-region">
        <h4>Event Stream</h4>
        <ul className="agents-event-stream">
          {(view.recentTransitions || []).slice(0, 10).map((event, index) => (
            <li key={`${event.agentId}-${event.at}-${index}`}>
              <strong>{event.displayName}</strong> · {event.type} · {event.reason || event.state} {event.at ? `(${event.at})` : ''}
            </li>
          ))}
        </ul>
      </section>

      {debugVisibility ? (
        <section className="agents-region">
          <h4>Suppression Reasons</h4>
          <ul>
            {(view.suppressionReasons || []).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>
      ) : null}
    </CollapsiblePanel>
  );
}
