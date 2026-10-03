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
  if (['CURRENT', 'EVIDENCED', 'SOURCE_PROVEN'].includes(normalized)) return 'current';
  if (['STALE'].includes(normalized)) return 'stale';
  if (['CONFLICTING', 'NEEDS_UPLIFT'].includes(normalized)) return 'attention';
  return 'unknown';
}

function formatEvidenceAge(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return 'age unknown';
  if (age < 60_000) return '<1m old';
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m old` : `${hours}h old`;
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
  const seed = view?.outcomeSeedGrowth || {};
  const wholeSeed = view?.wholeSystemSeedGrowth || {};
  const routes = Array.isArray(seed.preservedRoutes) ? seed.preservedRoutes : [];
  const operatingLoop = Array.isArray(seed.operatingLoop) ? seed.operatingLoop : [];
  const qualityDimensions = Array.isArray(seed.qualityDimensions) ? seed.qualityDimensions : [];
  const feedState = String(view?.liveFeedState || 'unknown').toUpperCase();
  const seedStatus = seed.planted
    ? `LIVE · ${seed.stage || 'UNKNOWN'}`
    : seed.declared
      ? 'CONTRACT READY · LIVE UNPROVEN'
      : 'UNDECLARED';
  const wholeSeedStatus = wholeSeed.planted
    ? `LIVE · ${wholeSeed.healthState || wholeSeed.stage || 'UNKNOWN'}`
    : wholeSeed.declared
      ? 'CONTRACT READY · LIVE UNPROVEN'
      : 'UNDECLARED';

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
          <small>
            {view?.sourceFreshness?.observedAtUtc
              ? `source evidence ${formatEvidenceAge(view.sourceFreshness.ageMs)}`
              : 'source evidence age unknown'}
          </small>
        </div>
      </header>

      <div className="uplift-stat-deck" aria-label="Flywheel uplift summary">
        <article><span>Agents observed</span><strong>{stats.observedAgents ?? 0}</strong><small>Shared Workspace identities</small></article>
        <article><span>Need uplift</span><strong>{stats.agentsNeedingUplift ?? 0}</strong><small>Evidence-backed gaps</small></article>
        <article><span>Lessons</span><strong>{stats.lessons ?? 0}</strong><small>Durable learning records</small></article>
        <article>
          <span>Learning history</span>
          <strong>{stats.timelineEvents ?? 0} recent / {stats.learningRecordsTotal ?? stats.timelineEvents ?? 0} total</strong>
          <small>{stats.actionableLearningEvents ?? 0} actionable gap event(s) · history is not a 1:1 goal count</small>
        </article>
      </div>

      <section className="uplift-deck-card outcome-seed-observatory" data-testid="flywheel-outcome-seed-growth">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">OUTCOME OWNERSHIP · FIRST LIVE SPECIMEN</span><h4>Starfield VR Outcome Ownership Seed</h4></div>
          <span className={`uplift-status-chip ${seed.planted ? truthClass(seed.sourceTruth) : 'unknown'}`}>{seedStatus}</span>
        </div>

        <div className="outcome-seed-truth-grid" aria-label="Starfield seed truth layers">
          <article className="current">
            <span>Mission contract</span>
            <strong>{seed.contractTruth || (seed.declared ? 'SOURCE_PROVEN' : 'UNKNOWN')}</strong>
            <small>What Stephanos is trying to become for this mission.</small>
          </article>
          <article className={truthClass(seed.sourceTruth)}>
            <span>Live growth evidence</span>
            <strong>{seed.sourceTruth || 'UNKNOWN'}</strong>
            <small>{feedState} · {view?.liveFeedReason || 'Shared Workspace evidence has not arrived yet.'}</small>
          </article>
        </div>

        <div className="outcome-seed-north-star">
          <span className="uplift-kicker">NORTH STAR</span>
          <strong>{seed.northStar || 'Starfield VR Outcome Ownership contract unavailable.'}</strong>
          <small>Operator role: {seed.operatorRole || 'intent-judgment-protected-approval'}</small>
        </div>

        <div className="outcome-seed-contract-grid">
          <div>
            <span className="uplift-kicker">PRESERVED ROUTES</span>
            <div className="outcome-seed-chip-row">
              {routes.length ? routes.map((route) => <b key={route}>{route}</b>) : <b>UNKNOWN</b>}
            </div>
          </div>
          <div>
            <span className="uplift-kicker">QUALITY FIELD</span>
            <div className="outcome-seed-chip-row subdued">
              {qualityDimensions.length ? qualityDimensions.map((dimension) => <b key={dimension}>{dimension}</b>) : <b>UNKNOWN</b>}
            </div>
          </div>
        </div>

        <div className="outcome-seed-loop" aria-label="Outcome ownership operating loop">
          <span className="uplift-kicker">OPERATING LOOP</span>
          <div>
            {operatingLoop.length
              ? operatingLoop.map((step, index) => (
                <span key={step}><b>{step}</b>{index < operatingLoop.length - 1 ? <i>›</i> : null}</span>
              ))
              : <span><b>UNKNOWN</b></span>}
          </div>
        </div>

        <div className="outcome-seed-growth-grid" aria-label="Starfield seed growth telemetry">
          <article><span>Playtests</span><strong>{seed.planted ? (seed.playtestEvidenceCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Hypotheses</span><strong>{seed.planted ? (seed.hypothesisCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Experiments</span><strong>{seed.planted ? (seed.experimentCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Operator observations</span><strong>{seed.planted ? (seed.operatorObservationCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Capability gaps</span><strong>{seed.planted ? (seed.capabilityGapCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Teaching loops</span><strong>{seed.planted ? (seed.teachingLoopCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Retry ready</span><strong>{seed.planted ? (seed.retryReadyCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Retained lessons</span><strong>{seed.planted ? (seed.retainedLessonCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Promoted VR</span><strong>{seed.planted ? (seed.promotedVrLessonCount ?? 0) : 'UNKNOWN'}</strong></article>
          <article><span>Proof refs</span><strong>{seed.planted ? (seed.proofCount ?? 0) : 'UNKNOWN'}</strong></article>
        </div>

        <div className="outcome-seed-evidence-row">
          <span>Latest live evidence</span>
          <strong>{seed.planted ? (seed.latestEvidenceAt || 'UNKNOWN') : 'UNKNOWN · waiting for Shared Workspace publication'}</strong>
        </div>

        {(seed.currentGaps || []).length ? (
          <div className="outcome-seed-gap-list">
            <span className="uplift-kicker">CURRENT GROWTH GAPS</span>
            <ul>
              {seed.currentGaps.map((gap, index) => (
                <li key={`${gap.capabilityId || 'gap'}-${index}`}>
                  <strong>{gap.capabilityId || 'capability-gap'}</strong>
                  <span>{gap.state || 'OPEN'} · teacher {gap.teacherId || 'UNKNOWN'}</span>
                  <small>{gap.summary}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="muted">No unresolved Starfield capability gap is currently evidenced. UNKNOWN remains UNKNOWN until the live feed says otherwise.</p>}
        <div className="uplift-next-action">
          <span>Seed next move</span>
          <strong>{seed.nextBestAction || 'Establish the live Shared Workspace feed and begin evidence-backed growth.'}</strong>
        </div>
      </section>

      <section className="uplift-deck-card outcome-seed-observatory" data-testid="flywheel-whole-system-capability-seed">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">OUTCOME OWNERSHIP · PERSISTENT SELF-IMPROVEMENT</span><h4>{wholeSeed.title || 'Stephanos Whole-System Capability Closure'}</h4></div>
          <span className={`uplift-status-chip ${wholeSeed.planted ? truthClass(wholeSeed.sourceTruth) : 'unknown'}`}>{wholeSeedStatus}</span>
        </div>

        <div className="outcome-seed-truth-grid" aria-label="Whole-system capability closure truth layers">
          <article className="current">
            <span>Mission contract</span>
            <strong>{wholeSeed.contractTruth || (wholeSeed.declared ? 'SOURCE_PROVEN' : 'UNKNOWN')}</strong>
            <small>{wholeSeed.issueRef || '#2670'} · persistent mission · zero known gaps is healthy, not terminal.</small>
          </article>
          <article className={truthClass(wholeSeed.sourceTruth)}>
            <span>Live growth evidence</span>
            <strong>{wholeSeed.sourceTruth || 'UNKNOWN'}</strong>
            <small>{feedState} · {view?.liveFeedReason || 'Shared Workspace evidence has not arrived yet.'}</small>
          </article>
        </div>

        <div className="outcome-seed-north-star">
          <span className="uplift-kicker">NORTH STAR</span>
          <strong>{wholeSeed.northStar || 'Whole-system capability closure contract unavailable.'}</strong>
          <small>Operator role: {wholeSeed.operatorRole || 'intent-judgment-protected-approval'}</small>
        </div>

        <div className="outcome-seed-loop" aria-label="Whole-system capability closure operating loop">
          <span className="uplift-kicker">OPERATING LOOP</span>
          <div>
            {(wholeSeed.operatingLoop || []).length
              ? wholeSeed.operatingLoop.map((step, index) => (
                <span key={step}><b>{step}</b>{index < wholeSeed.operatingLoop.length - 1 ? <i>›</i> : null}</span>
              ))
              : <span><b>UNKNOWN</b></span>}
          </div>
        </div>

        <div className="outcome-seed-growth-grid" aria-label="Whole-system capability closure telemetry">
          <article><span>Material gaps</span><strong>{wholeSeed.planted ? (wholeSeed.knownMaterialGapCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Unknowns</span><strong>{wholeSeed.planted ? (wholeSeed.unknownCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Regressions</span><strong>{wholeSeed.planted ? (wholeSeed.regressionCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Active goals</span><strong>{wholeSeed.planted ? (wholeSeed.activeGoalCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Learning events</span><strong>{wholeSeed.planted ? (wholeSeed.learningEventCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Retained lessons</span><strong>{wholeSeed.planted ? (wholeSeed.retainedLessonCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Proof refs</span><strong>{wholeSeed.planted ? (wholeSeed.proofCount ?? 'UNKNOWN') : 'UNKNOWN'}</strong></article>
          <article><span>Health</span><strong>{wholeSeed.healthState || wholeSeed.stage || 'UNKNOWN'}</strong></article>
        </div>

        <div className="outcome-seed-evidence-row">
          <span>Latest live evidence</span>
          <strong>{wholeSeed.planted ? (wholeSeed.latestEvidenceAt || 'UNKNOWN') : 'UNKNOWN · waiting for Shared Workspace publication'}</strong>
        </div>

        {(wholeSeed.currentGaps || []).length ? (
          <div className="outcome-seed-gap-list">
            <span className="uplift-kicker">CURRENT WHOLE-SYSTEM GAPS</span>
            <ul>
              {wholeSeed.currentGaps.map((gap, index) => (
                <li key={`${gap.capabilityId || 'gap'}-${index}`}>
                  <strong>{gap.capabilityId || 'material-gap'}</strong>
                  <span>{gap.state || 'OPEN'} · owner {gap.owner || 'UNKNOWN'}</span>
                  <small>{gap.summary}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="muted">No live #2670 gap record is currently evidenced. The source-proven mission remains visible and UNKNOWN stays UNKNOWN until Shared Workspace publishes growth.</p>}
        <div className="uplift-next-action">
          <span>Seed next move</span>
          <strong>{wholeSeed.nextBestAction || 'Publish the #2670 mission heartbeat into Shared Workspace.'}</strong>
        </div>
      </section>

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
          <span>{timeline.length} recent · {stats.learningRecordsTotal ?? timeline.length} total</span>
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
