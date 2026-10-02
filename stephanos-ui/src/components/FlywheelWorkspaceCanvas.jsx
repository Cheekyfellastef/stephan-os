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
  if (['CURRENT', 'EVIDENCED'].includes(normalized)) return 'current';
  if (['STALE'].includes(normalized)) return 'stale';
  if (['CONFLICTING', 'NEEDS_UPLIFT'].includes(normalized)) return 'attention';
  return 'unknown';
}

function HeatCell({ dimension }) {
  if (!dimension) return <td className="uplift-heat-cell unknown">UNKNOWN</td>;
  return (
    <td
      className={`uplift-heat-cell ${truthClass(dimension.status)}`}
      title={dimension.detail || dimension.status}
      data-uplift-status={dimension.status}
    >
      {dimension.status === 'EVIDENCED' ? '◆' : dimension.status === 'NEEDS_UPLIFT' ? '▲' : '·'}
    </td>
  );
}

export default function FlywheelWorkspaceCanvas({ view }) {
  const participants = Array.isArray(view?.participants) ? view.participants : [];
  const timeline = Array.isArray(view?.timeline) ? view.timeline : [];
  const stats = view?.stats || {};
  const brain = view?.brainBay || {};

  return (
    <section className="uplift-workspace uplift-workspace--flywheel" data-testid="flywheel-uplift-workspace">
      <header className="uplift-workspace__hero">
        <div>
          <span className="uplift-kicker">SHARED WORKSPACE · LIVE LEARNING FABRIC</span>
          <h3>Flywheel Uplift Workspace</h3>
          <p>Watch real missions turn into stronger agents. Every light is evidence-backed. Missing evidence stays UNKNOWN.</p>
        </div>
        <div className={`uplift-truth-orb ${truthClass(view?.sourceTruth)}`}>
          <span>Workspace truth</span>
          <strong>{view?.sourceTruth || 'UNKNOWN'}</strong>
        </div>
      </header>

      <div className="uplift-stat-deck" aria-label="Flywheel uplift summary">
        <article><span>Agents observed</span><strong>{stats.observedAgents ?? 0}</strong><small>Shared Workspace identities</small></article>
        <article><span>Need uplift</span><strong>{stats.agentsNeedingUplift ?? 0}</strong><small>Evidence-backed gaps</small></article>
        <article><span>Lessons</span><strong>{stats.lessons ?? 0}</strong><small>Durable learning records</small></article>
        <article><span>Learning events</span><strong>{stats.timelineEvents ?? 0}</strong><small>Recent receipts + events</small></article>
      </div>

      <div className="uplift-workspace__split">
        <section className="uplift-deck-card uplift-brain-bay" data-testid="flywheel-brain-bay">
          <div className="uplift-section-heading">
            <div><span className="uplift-kicker">COGNITION</span><h4>Brain Bay</h4></div>
            <span className={`uplift-status-chip ${truthClass(brain.state)}`}>{brain.state || 'UNKNOWN'}</span>
          </div>
          <div className="uplift-brain-core" aria-hidden="true"><span>Ψ</span></div>
          <dl className="uplift-definition-grid">
            <div><dt>Mode</dt><dd>{brain.mode || 'UNKNOWN'}</dd></div>
            <div><dt>Model</dt><dd>{brain.model || 'UNKNOWN'}</dd></div>
            <div className="wide"><dt>Why awake?</dt><dd>{brain.reason || 'No current brain-use receipt.'}</dd></div>
          </dl>
          <p className="muted">Deterministic Flywheel turns do not need a model. Difficult diagnosis/design can wake the Stephanos model router without gaining mutation authority.</p>
        </section>

        <section className="uplift-deck-card" data-testid="flywheel-agent-constellation">
          <div className="uplift-section-heading">
            <div><span className="uplift-kicker">CONSTELLATION</span><h4>Agent Uplift Field</h4></div>
            <span>{participants.length} observed</span>
          </div>
          <div className="uplift-constellation">
            {participants.length ? participants.slice(0, 18).map((agent) => (
              <article className={`uplift-agent-node ${truthClass(agent.truth)}`} key={agent.participantId}>
                <div className="uplift-node-core">{String(agent.participantId || '?').slice(0, 2).toUpperCase()}</div>
                <div>
                  <strong>{agent.participantId}</strong>
                  <span>{agent.latestMissionId || 'No mission identity'}</span>
                  <small>{agent.upliftNeedCount || agent.capabilityGapCount ? `${agent.upliftNeedCount || 0} uplift signal(s) · ${agent.capabilityGapCount || 0} gap(s)` : 'No uplift gap evidenced'}</small>
                </div>
              </article>
            )) : (
              <p className="muted">No agent evidence is currently published. The workspace will not invent a constellation.</p>
            )}
          </div>
        </section>
      </div>

      <section className="uplift-deck-card uplift-heatmap" data-testid="flywheel-uplift-heatmap">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">CAPABILITY FIELD</span><h4>Uplift Heatmap</h4></div>
          <span>◆ evidenced · ▲ uplift needed · · unknown</span>
        </div>
        <div className="uplift-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                {Object.values(DIMENSION_LABELS).map((label) => <th key={label}>{label}</th>)}
                <th>Proof</th>
              </tr>
            </thead>
            <tbody>
              {participants.slice(0, 20).map((agent) => {
                const byId = new Map((agent.dimensions || []).map((dimension) => [dimension.id, dimension]));
                return (
                  <tr key={agent.participantId}>
                    <th>{agent.participantId}</th>
                    {Object.keys(DIMENSION_LABELS).map((id) => <HeatCell key={id} dimension={byId.get(id)} />)}
                    <td>{agent.proofCount ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="uplift-deck-card" data-testid="flywheel-learning-timeline">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">MISSION REPLAY</span><h4>Learning Timeline</h4></div>
          <span>{timeline.length} recent records</span>
        </div>
        <ol className="uplift-timeline">
          {timeline.length ? timeline.map((entry, index) => (
            <li key={`${entry.at}-${entry.participantId}-${index}`} className={truthClass(entry.truth)}>
              <span className="uplift-timeline-marker" aria-hidden="true" />
              <div>
                <div className="uplift-timeline-meta"><strong>{entry.type}</strong><span>{entry.participantId}</span><span>{entry.at || 'time unknown'}</span></div>
                <p>{entry.summary}</p>
                <small>{entry.missionId || 'mission unknown'} · proofs {entry.proofCount ?? 0}</small>
              </div>
            </li>
          )) : <li><div><p>No historical learning records are available.</p></div></li>}
        </ol>
      </section>

      <div className="uplift-next-action">
        <span>Canonical next move</span>
        <strong>{view?.exactNextAction || 'No next action published.'}</strong>
      </div>
    </section>
  );
}
