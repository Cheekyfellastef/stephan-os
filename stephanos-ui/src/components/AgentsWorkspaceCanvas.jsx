const DIMENSION_LABELS = Object.freeze({
  'reasoning-quality': 'Reasoning quality',
  'execution-reliability': 'Execution reliability',
  'proof-quality': 'Proof quality',
  'recovery-ability': 'Recovery ability',
  'tool-coverage': 'Tool coverage',
  'operator-intervention': 'Operator independence',
  'calibration-readiness': 'Calibration readiness',
});

function truthClass(value = '') {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  if (['CURRENT', 'EVIDENCED', 'ACTING', 'ACTIVE', 'READY'].includes(normalized)) return 'current';
  if (normalized === 'STALE' || normalized === 'WATCH') return 'stale';
  if (['CONFLICTING', 'NEEDS_UPLIFT', 'BLOCKED', 'FAILED', 'CRITICAL', 'HIGH', 'MEDIUM'].includes(normalized)) return 'attention';
  return 'unknown';
}

function display(value, fallback = 'UNKNOWN') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function agentInitials(agent) {
  return String(agent?.displayName || agent?.agentId || '?')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('');
}

function DimensionChips({ values = [], tone = 'unknown' }) {
  if (!values.length) return <span className="agent-empty-copy">None evidenced.</span>;
  return (
    <div className="agent-dimension-chips">
      {values.map((value) => <span className={tone} key={value}>{DIMENSION_LABELS[value] || value}</span>)}
    </div>
  );
}

export default function AgentsWorkspaceCanvas({ view, selectedAgentId = '', onSelectAgent }) {
  const agents = Array.isArray(view?.agents) ? view.agents : [];
  const upliftQueue = Array.isArray(view?.upliftQueue) ? view.upliftQueue : [];
  const selected = agents.find((agent) => agent.agentId === selectedAgentId)
    || agents.find((agent) => agent.acting)
    || upliftQueue[0]
    || agents[0]
    || null;
  const stats = view?.stats || {};
  const selectedTimeline = selected?.evidenceTimeline || [];

  return (
    <section className="uplift-workspace uplift-workspace--agents agents-intelligence-observatory" data-testid="agents-uplift-workspace">
      <header className="uplift-workspace__hero agents-observatory-hero">
        <div>
          <span className="uplift-kicker">AGENT FABRIC · FLYWHEEL · SHARED WORKSPACE</span>
          <h3>Agents Intelligence Observatory</h3>
          <p>See who every evidence-bearing agent is, what it can currently do, why the Flywheel wants to lift it, who owns the gap, and what capability frontier comes next.</p>
        </div>
        <div className={'uplift-truth-orb ' + truthClass(view?.sourceTruth)}>
          <span>Evidence fabric</span>
          <strong>{view?.sourceTruth || 'UNKNOWN'}</strong>
        </div>
      </header>

      <div className="uplift-stat-deck agent-stat-deck">
        <article><span>Runtime agents</span><strong>{stats.runtimeVisibleAgents ?? 0}</strong><small>Visible to Stephanos now</small></article>
        <article className={stats.agentsNeedingUplift ? 'attention' : ''}><span>Need uplift</span><strong>{stats.agentsNeedingUplift ?? 0}</strong><small>Current Flywheel red set</small></article>
        <article><span>Current gaps</span><strong>{stats.currentGapSignals ?? 0}</strong><small>Unresolved capability signals</small></article>
        <article><span>Resolved history</span><strong>{stats.resolvedHistoricalGaps ?? 0}</strong><small>Still visible, no false red</small></article>
        <article><span>Evidence-backed</span><strong>{stats.evidencedAgents ?? 0}</strong><small>No current uplift signal</small></article>
        <article><span>Unknown</span><strong>{stats.unknownAgents ?? 0}</strong><small>Needs measurement, not guessing</small></article>
      </div>

      <section className="uplift-deck-card agent-uplift-queue" data-testid="agents-uplift-queue">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">FLYWHEEL UPLIFT QUEUE</span><h4>Who needs help, and why?</h4></div>
          <span>{upliftQueue.length} current participant(s)</span>
        </div>
        {upliftQueue.length ? (
          <div className="agent-uplift-queue-grid">
            {upliftQueue.map((agent) => (
              <button
                type="button"
                key={agent.agentId}
                className={'agent-uplift-queue-card ' + truthClass(agent.upliftPriority) + (agent.agentId === selected?.agentId ? ' selected' : '')}
                onClick={() => onSelectAgent?.(agent.agentId)}
              >
                <div className="agent-uplift-queue-head">
                  <span className="agent-constellation-avatar">{agentInitials(agent)}</span>
                  <div>
                    <strong>{agent.displayName}</strong>
                    <small>{display(agent.role)} · {display(agent.state)}</small>
                  </div>
                  <b className={'agent-priority-pill ' + truthClass(agent.upliftPriority)}>{display(agent.upliftPriority)}</b>
                </div>
                <div className="agent-uplift-queue-metrics">
                  <span>{agent.upliftNeedCount ?? 0} weak dimension(s)</span>
                  <span>{agent.capabilityGapCount ?? 0} current gap(s)</span>
                  <span>{agent.proofCount ?? 0} proof ref(s)</span>
                </div>
                <p><b>Why uplift?</b> {agent.currentGaps?.[0]?.summary || agent.latestSummary || 'The scorecard contains an unresolved uplift signal.'}</p>
                <small className="agent-uplift-next">{display(agent.nextUpliftAction, 'No next uplift action published.')}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="agent-empty-state">
            <strong>No current Flywheel uplift queue.</strong>
            <span>Historical failures remain visible below, but none are allowed to pin a false red state without a current unresolved signal.</span>
          </div>
        )}
      </section>

      <section className="uplift-deck-card" data-testid="agents-constellation">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">WHO IS HERE?</span><h4>Agent Constellation</h4></div>
          <span>Acting: {view?.actingAgentId || 'UNKNOWN'}</span>
        </div>
        <div className="agent-constellation-grid">
          {agents.map((agent) => (
            <button
              type="button"
              key={agent.agentId}
              onClick={() => onSelectAgent?.(agent.agentId)}
              className={'agent-constellation-card ' + truthClass(agent.sharedWorkspaceTruth) + (agent.agentId === selected?.agentId ? ' selected' : '') + (agent.acting ? ' acting' : '')}
              data-agent-id={agent.agentId}
            >
              <span className="agent-constellation-avatar">{agentInitials(agent)}</span>
              <span className="agent-constellation-copy">
                <strong>{agent.displayName}</strong>
                <small>{agent.role} · {agent.state}</small>
                <em>{agent.latestMissionId && agent.latestMissionId !== 'UNKNOWN' ? agent.latestMissionId : 'No current mission receipt'}</em>
              </span>
              <span className="agent-constellation-badges">
                <b className={truthClass(agent.upliftState)}>{display(agent.upliftState)}</b>
                <b>{agent.proofCount ?? 0} proof</b>
                <b>{agent.capabilityGapCount ?? 0} live gaps</b>
                <b>{agent.resolvedGapCount ?? 0} resolved</b>
              </span>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <>
          <section className="uplift-deck-card agent-passport" data-testid="agents-selected-evidence">
            <div className="uplift-section-heading">
              <div>
                <span className="uplift-kicker">AGENT PASSPORT</span>
                <h4>{selected.displayName}</h4>
              </div>
              <div className="agent-passport-status">
                <span className={'uplift-status-chip ' + truthClass(selected.sharedWorkspaceTruth)}>{selected.sharedWorkspaceTruth}</span>
                <span className={'uplift-status-chip ' + truthClass(selected.upliftPriority)}>{display(selected.upliftPriority)}</span>
              </div>
            </div>
            <div className="agent-passport-grid">
              <article><span>Identity</span><strong>{selected.agentId}</strong><small>{selected.role}</small></article>
              <article><span>Runtime state</span><strong>{selected.state}</strong><small>{selected.stateReason}</small></article>
              <article><span>Current mission</span><strong>{selected.latestMissionId || 'UNKNOWN'}</strong><small>{selected.acting ? 'ACTING NOW' : 'Not current actor'}</small></article>
              <article><span>Flywheel verdict</span><strong>{display(selected.upliftState)}</strong><small>{selected.upliftNeedCount ?? 0} weak dimension(s)</small></article>
              <article><span>Evidence</span><strong>{selected.evidenceCount ?? 0} records</strong><small>{selected.proofCount ?? 0} proof refs · {selected.calibrationVerdict || 'UNKNOWN'} calibration</small></article>
              <article><span>Gap history</span><strong>{selected.capabilityGapCount ?? 0} live</strong><small>{selected.resolvedGapCount ?? 0} resolved of {selected.historicalGapCount ?? 0} historical</small></article>
            </div>

            <div className="agent-passport-band">
              <div>
                <span className="uplift-kicker">WHAT CAN THIS AGENT DO NOW?</span>
                {selected.capabilities?.length ? (
                  <div className="agent-capability-pills">{selected.capabilities.map((capability) => <b key={capability}>{capability}</b>)}</div>
                ) : <span className="agent-empty-copy">No runtime capabilities are published for this identity. Stephanos will not invent them.</span>}
              </div>
              <div>
                <span className="uplift-kicker">LATEST EVIDENCE</span>
                <p>{selected.latestSummary}</p>
                <small>{selected.latestEvidenceAt || 'Evidence time unknown'}</small>
              </div>
            </div>
          </section>

          <div className="uplift-workspace__split agent-analysis-split">
            <section className="uplift-deck-card" data-testid="agents-selected-uplift-profile">
              <div className="uplift-section-heading">
                <div><span className="uplift-kicker">AGENT SCORECARD</span><h4>Capability Vector · what the Flywheel can prove</h4></div>
                <span>{selected.upliftNeedCount ?? 0} uplift signal(s)</span>
              </div>
              <div className="agent-capability-vector agent-capability-vector--detailed">
                {Object.entries(DIMENSION_LABELS).map(([id, label]) => {
                  const dimension = (selected.dimensions || []).find((entry) => entry.id === id);
                  return (
                    <div className="agent-vector-row agent-vector-row--detailed" key={id}>
                      <span>{label}</span>
                      <div className={'agent-vector-track ' + truthClass(dimension?.status)}><i /></div>
                      <strong>{dimension?.status || 'UNKNOWN'}</strong>
                      <small>{dimension?.detail || 'No evidence-backed dimension detail is published.'}</small>
                      <em>+{dimension?.positiveSignals ?? 0} / -{dimension?.negativeSignals ?? 0}</em>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="uplift-deck-card agent-growth-frontier" data-testid="agents-growth-frontier">
              <div className="uplift-section-heading">
                <div><span className="uplift-kicker">GROWTH FRONTIER</span><h4>Who this agent can become next</h4></div>
                <span>Evidence-bound, not authority expansion</span>
              </div>
              <div className="agent-frontier-grid">
                <div>
                  <span className="uplift-kicker">EVIDENCED STRENGTHS</span>
                  <DimensionChips values={selected.evidencedDimensions} tone="current" />
                </div>
                <div>
                  <span className="uplift-kicker">NEEDS UPLIFT</span>
                  <DimensionChips values={selected.dimensionsNeedingUplift} tone="attention" />
                </div>
                <div>
                  <span className="uplift-kicker">UNKNOWN / UNMEASURED</span>
                  <DimensionChips values={selected.unknownDimensions} tone="unknown" />
                </div>
              </div>
              <div className="uplift-next-action agent-next-uplift">
                <span>Next capability move</span>
                <strong>{display(selected.nextUpliftAction)}</strong>
              </div>
              <p className="agent-frontier-note">The frontier describes the next evidence-backed capability to teach or prove. It never grants new authority by itself.</p>
            </section>
          </div>

          <section className="uplift-deck-card agent-flywheel-diagnosis" data-testid="agents-flywheel-diagnosis">
            <div className="uplift-section-heading">
              <div><span className="uplift-kicker">FLYWHEEL DIAGNOSIS</span><h4>Current gaps vs resolved history</h4></div>
              <span>{selected.capabilityGapCount ?? 0} current · {selected.resolvedGapCount ?? 0} resolved</span>
            </div>
            <div className="agent-gap-columns">
              <div>
                <span className="uplift-kicker">CURRENT GAPS · WHY UPLIFT?</span>
                {selected.currentGaps?.length ? (
                  <div className="agent-gap-list">
                    {selected.currentGaps.map((gap) => (
                      <article className="agent-gap-card attention" key={gap.gapId}>
                        <div><strong>{gap.capabilityId}</strong><span>{display(gap.state, 'OPEN')}</span></div>
                        <p>{gap.summary}</p>
                        <small>Owner: {gap.owner} · observed {gap.observedAtUtc || 'time unknown'} · proof {gap.proofRefs?.length ?? 0}</small>
                      </article>
                    ))}
                  </div>
                ) : <span className="agent-empty-copy">No unresolved capability gap is currently evidenced.</span>}
              </div>
              <div>
                <span className="uplift-kicker">RESOLVED HISTORY · STILL REMEMBERED</span>
                {selected.resolvedGaps?.length ? (
                  <div className="agent-gap-list">
                    {selected.resolvedGaps.slice(0, 8).map((gap) => (
                      <article className="agent-gap-card current" key={gap.gapId}>
                        <div><strong>{gap.capabilityId}</strong><span>RESOLVED</span></div>
                        <p>{gap.summary}</p>
                        <small>Recovered {gap.resolvedAtUtc || 'time unknown'} · recovery proof {gap.resolvedByProofRefs?.length ?? 0}</small>
                      </article>
                    ))}
                  </div>
                ) : <span className="agent-empty-copy">No superseded historical gap is published for this agent.</span>}
              </div>
            </div>
          </section>

          <section className="uplift-deck-card agent-evidence-timeline" data-testid="agents-evidence-timeline">
            <div className="uplift-section-heading">
              <div><span className="uplift-kicker">EVIDENCE TIMELINE</span><h4>What has actually happened to this agent</h4></div>
              <span>{selectedTimeline.length} recent matching record(s)</span>
            </div>
            {selectedTimeline.length ? (
              <ol className="uplift-timeline">
                {selectedTimeline.map((entry, index) => (
                  <li className={truthClass(entry.truth)} key={(entry.at || 'unknown') + '-' + index}>
                    <span className="uplift-timeline-marker" aria-hidden="true" />
                    <div>
                      <div className="uplift-timeline-meta"><strong>{entry.type}</strong><span>{entry.missionId || 'mission unknown'}</span><span>{entry.at || 'time unknown'}</span></div>
                      <p>{entry.summary}</p>
                      <small>{entry.proofCount ?? 0} proof ref(s)</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <span className="agent-empty-copy">No recent matching timeline record is present in the current projection.</span>}
          </section>
        </>
      ) : null}

      <div className="uplift-next-action">
        <span>Fleet next move</span>
        <strong>{view?.exactNextAction || 'No next action published.'}</strong>
      </div>
    </section>
  );
}
