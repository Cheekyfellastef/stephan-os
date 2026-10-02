const DIMENSION_LABELS = Object.freeze({
  'reasoning-quality': 'Reason',
  'execution-reliability': 'Execute',
  'proof-quality': 'Proof',
  'recovery-ability': 'Recover',
  'tool-coverage': 'Tools',
  'operator-intervention': 'Operator',
  'calibration-readiness': 'Calibrate',
});

function truthClass(value = '') {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  if (['CURRENT', 'EVIDENCED', 'ACTING', 'ACTIVE', 'READY'].includes(normalized)) return 'current';
  if (normalized === 'STALE') return 'stale';
  if (['CONFLICTING', 'NEEDS_UPLIFT', 'BLOCKED', 'FAILED'].includes(normalized)) return 'attention';
  return 'unknown';
}

export default function AgentsWorkspaceCanvas({ view, selectedAgentId = '', onSelectAgent }) {
  const agents = Array.isArray(view?.agents) ? view.agents : [];
  const selected = agents.find((agent) => agent.agentId === selectedAgentId)
    || agents.find((agent) => agent.acting)
    || agents[0]
    || null;
  const stats = view?.stats || {};

  return (
    <section className="uplift-workspace uplift-workspace--agents" data-testid="agents-uplift-workspace">
      <header className="uplift-workspace__hero">
        <div>
          <span className="uplift-kicker">AGENT FABRIC · SHARED WORKSPACE</span>
          <h3>Agents Command Constellation</h3>
          <p>Who is here, what they can do, what they are carrying, what is blocked, and how the Flywheel is lifting them.</p>
        </div>
        <div className={`uplift-truth-orb ${truthClass(view?.sourceTruth)}`}>
          <span>Evidence fabric</span>
          <strong>{view?.sourceTruth || 'UNKNOWN'}</strong>
        </div>
      </header>

      <div className="uplift-stat-deck">
        <article><span>Runtime agents</span><strong>{stats.runtimeVisibleAgents ?? 0}</strong><small>Visible to Stephanos</small></article>
        <article><span>Workspace identities</span><strong>{stats.sharedWorkspaceParticipants ?? 0}</strong><small>Evidence-bearing participants</small></article>
        <article><span>Acting now</span><strong>{stats.actingAgents ?? 0}</strong><small>Current runtime actor(s)</small></article>
        <article><span>Need uplift</span><strong>{stats.agentsNeedingUplift ?? 0}</strong><small>Gaps or weak evidence</small></article>
      </div>

      <section className="uplift-deck-card" data-testid="agents-constellation">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">FLEET</span><h4>Agent Constellation</h4></div>
          <span>Acting: {view?.actingAgentId || 'UNKNOWN'}</span>
        </div>
        <div className="agent-constellation-grid">
          {agents.map((agent) => (
            <button
              type="button"
              key={agent.agentId}
              onClick={() => onSelectAgent?.(agent.agentId)}
              className={`agent-constellation-card ${truthClass(agent.sharedWorkspaceTruth)} ${agent.agentId === selected?.agentId ? 'selected' : ''} ${agent.acting ? 'acting' : ''}`}
              data-agent-id={agent.agentId}
            >
              <span className="agent-constellation-avatar">{String(agent.displayName || agent.agentId).slice(0, 2).toUpperCase()}</span>
              <span className="agent-constellation-copy">
                <strong>{agent.displayName}</strong>
                <small>{agent.role} · {agent.state}</small>
                <em>{agent.latestMissionId && agent.latestMissionId !== 'UNKNOWN' ? agent.latestMissionId : 'No mission receipt'}</em>
              </span>
              <span className="agent-constellation-badges">
                <b>{agent.proofCount ?? 0} proof</b>
                <b>{agent.capabilityGapCount ?? 0} gaps</b>
              </span>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <div className="uplift-workspace__split">
          <section className="uplift-deck-card agent-evidence-deck" data-testid="agents-selected-evidence">
            <div className="uplift-section-heading">
              <div><span className="uplift-kicker">SELECTED ENTITY</span><h4>{selected.displayName}</h4></div>
              <span className={`uplift-status-chip ${truthClass(selected.sharedWorkspaceTruth)}`}>{selected.sharedWorkspaceTruth}</span>
            </div>
            <dl className="uplift-definition-grid">
              <div><dt>Role</dt><dd>{selected.role}</dd></div>
              <div><dt>Runtime</dt><dd>{selected.state}</dd></div>
              <div><dt>Mission</dt><dd>{selected.latestMissionId || 'UNKNOWN'}</dd></div>
              <div><dt>Proof refs</dt><dd>{selected.proofCount ?? 0}</dd></div>
              <div><dt>Capability gaps</dt><dd>{selected.capabilityGapCount ?? 0}</dd></div>
              <div><dt>Operator interventions</dt><dd>{selected.operatorInterventionCount ?? 0}</dd></div>
              <div className="wide"><dt>Latest evidence</dt><dd>{selected.latestSummary}</dd></div>
              <div className="wide"><dt>Runtime reason</dt><dd>{selected.stateReason}</dd></div>
            </dl>
          </section>

          <section className="uplift-deck-card" data-testid="agents-selected-uplift-profile">
            <div className="uplift-section-heading">
              <div><span className="uplift-kicker">UPLIFT PROFILE</span><h4>Capability Vector</h4></div>
              <span>{selected.upliftNeedCount ?? 0} uplift signal(s)</span>
            </div>
            <div className="agent-capability-vector">
              {Object.entries(DIMENSION_LABELS).map(([id, label]) => {
                const dimension = (selected.dimensions || []).find((entry) => entry.id === id);
                return (
                  <div className="agent-vector-row" key={id}>
                    <span>{label}</span>
                    <div className={`agent-vector-track ${truthClass(dimension?.status)}`}><i /></div>
                    <strong>{dimension?.status || 'UNKNOWN'}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      <div className="uplift-next-action">
        <span>Fleet next move</span>
        <strong>{view?.exactNextAction || 'No next action published.'}</strong>
      </div>
    </section>
  );
}
