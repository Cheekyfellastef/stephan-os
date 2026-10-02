const DIMENSION_LABELS = Object.freeze({
  'reasoning-quality': 'Reason',
  'execution-reliability': 'Execute',
  'proof-quality': 'Proof',
  'recovery-ability': 'Recover',
  'tool-coverage': 'Tools',
  'operator-intervention': 'Operator',
  'calibration-readiness': 'Calibrate',
});

const DEFAULT_OPERATION_CARDS = Object.freeze([
  { id: 'goal-conveyor', label: 'Goal Conveyor', source: 'queueDispatcher' },
  { id: 'current-build', label: 'Current Build', source: 'captainsBridge.buildOrchestration' },
  { id: 'merge-pipeline', label: 'Merge Pipeline', source: 'captainsBridge.mergePipeline' },
  { id: 'runtime-health', label: 'Runtime Health', source: 'captainsBridge.runtimeHealth' },
  { id: 'openclaw-capacity', label: 'Agent Capacity', source: 'openClawCapabilityLadder' },
  { id: 'next-action', label: 'Next Action', source: 'operatorAttention' },
]);

function truthClass(value = '') {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  if (['CURRENT', 'EVIDENCED', 'LIVE', 'READY', 'PASS', 'HEALTHY'].includes(normalized)) return 'current';
  if (['STALE', 'CONNECTING', 'PENDING', 'WAITING'].includes(normalized)) return 'stale';
  if (['CONFLICTING', 'NEEDS_UPLIFT', 'FAILED', 'BLOCKED', 'UNREACHABLE', 'ERROR'].includes(normalized)) return 'attention';
  return 'unknown';
}

function display(value, fallback = 'UNKNOWN') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function HeatCell({ dimension }) {
  if (!dimension) return <td className="uplift-heat-cell unknown">·</td>;
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

function MiniRecordList({ records = [], empty, testId }) {
  return (
    <div className="flywheel-record-list" data-testid={testId}>
      {records.length ? records.slice(0, 6).map((entry, index) => (
        <article className={`flywheel-record-row ${truthClass(entry.truth)}`} key={`${entry.at || index}-${entry.participantId || entry.kind || index}`}>
          <div className="flywheel-record-row__meta">
            <strong>{display(entry.participantId || entry.kind || entry.type)}</strong>
            <span>{display(entry.missionId, 'NO MISSION')}</span>
          </div>
          <p>{display(entry.summary, 'No summary published.')}</p>
          <small>{display(entry.at, 'TIME UNKNOWN')} · {entry.proofCount ?? entry.proofRefs?.length ?? 0} proof ref(s)</small>
        </article>
      )) : <p className="flywheel-empty-state">{empty}</p>}
    </div>
  );
}

function StatCard({ label, value, detail, tone = 'unknown' }) {
  return (
    <article className={`flywheel-stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PipelineStage({ index, label, active, detail }) {
  return (
    <div className={`flywheel-pipeline-stage ${active ? 'active' : 'unknown'}`}>
      <span className="flywheel-pipeline-index">{String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export default function FlywheelWorkspaceCanvas({
  view,
  telemetryView = {},
  connection = {},
}) {
  const participants = Array.isArray(view?.participants) ? view.participants : [];
  const timeline = Array.isArray(view?.timeline) ? view.timeline : [];
  const stats = view?.stats || {};
  const brain = view?.brainBay || {};
  const capabilityGaps = Array.isArray(view?.capabilityGaps) ? view.capabilityGaps : [];
  const experiments = Array.isArray(view?.experiments) ? view.experiments : [];
  const interventions = Array.isArray(view?.operatorInterventions) ? view.operatorInterventions : [];
  const lessons = Array.isArray(view?.lessons) ? view.lessons : [];
  const receipts = Array.isArray(view?.receipts) ? view.receipts : [];
  const proofs = Array.isArray(view?.proofs) ? view.proofs : [];
  const sourceMesh = view?.sourceMesh || {};
  const operationCards = Array.isArray(telemetryView?.stateItems) && telemetryView.stateItems.length
    ? telemetryView.stateItems
    : DEFAULT_OPERATION_CARDS.map((entry) => ({
      ...entry,
      value: 'UNKNOWN',
      summary: 'No current Shared Workspace projection is available for this instrument.',
    }));
  const metrics = Array.isArray(telemetryView?.metrics) ? telemetryView.metrics : [];

  const pipelineStages = [
    { label: 'Evidence', active: (sourceMesh.recordCount || 0) > 0, detail: `${sourceMesh.recordCount || 0} canonical records` },
    { label: 'Detect', active: capabilityGaps.length > 0, detail: `${capabilityGaps.length} gap signal(s)` },
    { label: 'Diagnose', active: brain.state && brain.state !== 'UNKNOWN', detail: brain.state && brain.state !== 'UNKNOWN' ? display(brain.mode) : 'No cognition receipt' },
    { label: 'Propose', active: experiments.length > 0, detail: `${experiments.length} uplift candidate record(s)` },
    { label: 'Test / Replay', active: receipts.length > 0, detail: `${receipts.length} execution receipt(s)` },
    { label: 'Promote', active: proofs.length > 0, detail: `${proofs.length} proof record(s)` },
  ];

  return (
    <section className="uplift-workspace uplift-workspace--flywheel flywheel-observatory" data-testid="flywheel-uplift-workspace">
      <header className="flywheel-observatory__hero">
        <div className="flywheel-observatory__title">
          <span className="uplift-kicker">STEPHANOS INTELLIGENCE GROWTH · SHARED WORKSPACE</span>
          <h2>Flywheel Intelligence Observatory</h2>
          <p>
            One living view of how missions expose weaknesses, how the system learns, and how agents are lifted up the stack.
            Every instrument is evidence-backed. Missing evidence stays UNKNOWN.
          </p>
        </div>
        <div className="flywheel-hero-orbs">
          <div className={`flywheel-orb ${truthClass(view?.sourceTruth)}`}>
            <span>Workspace</span><strong>{view?.sourceTruth || 'UNKNOWN'}</strong>
          </div>
          <div className={`flywheel-orb ${truthClass(connection.state)}`}>
            <span>Feed</span><strong>{display(connection.label || connection.state)}</strong>
          </div>
          <div className={`flywheel-orb ${truthClass(brain.state)}`}>
            <span>Brain</span><strong>{display(brain.state)}</strong>
          </div>
        </div>
      </header>

      <section className="flywheel-pulse-band" data-testid="flywheel-uplift-pulse">
        <div className="flywheel-pulse-signal" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
        <div>
          <span className="uplift-kicker">Uplift Pulse</span>
          <strong>{stats.experiments ?? 0} improvement record(s) · {stats.capabilityGaps ?? 0} gap signal(s) · {stats.proofs ?? 0} proof record(s)</strong>
          <small>{connection.refreshedAt ? `Last feed attempt ${new Date(connection.refreshedAt).toLocaleTimeString()}` : 'Waiting for first feed sample'} · endpoint {display(connection.endpoint, 'UNKNOWN')}</small>
        </div>
      </section>

      <div className="flywheel-stat-deck flywheel-stat-deck--wide" aria-label="Flywheel uplift summary">
        <StatCard label="Agents observed" value={stats.observedAgents ?? 0} detail="Evidence-bearing identities" tone={stats.observedAgents ? 'current' : 'unknown'} />
        <StatCard label="Need uplift" value={stats.agentsNeedingUplift ?? 0} detail="Agents with evidenced gaps" tone={stats.agentsNeedingUplift ? 'attention' : 'unknown'} />
        <StatCard label="Capability gaps" value={stats.capabilityGaps ?? 0} detail="Buildable weakness signals" tone={stats.capabilityGaps ? 'attention' : 'unknown'} />
        <StatCard label="Experiments" value={stats.experiments ?? 0} detail="Uplift / replay / calibration" tone={stats.experiments ? 'current' : 'unknown'} />
        <StatCard label="Lessons" value={stats.lessons ?? 0} detail="Durable learning records" tone={stats.lessons ? 'current' : 'unknown'} />
        <StatCard label="Receipts" value={stats.receipts ?? 0} detail="Execution evidence" tone={stats.receipts ? 'current' : 'unknown'} />
        <StatCard label="Proof vault" value={stats.proofs ?? 0} detail="Explicit proof records" tone={stats.proofs ? 'current' : 'unknown'} />
        <StatCard label="Operator rescues" value={stats.operatorInterventions ?? 0} detail="Intervention debt observed" tone={stats.operatorInterventions ? 'attention' : 'unknown'} />
      </div>

      <section className="uplift-deck-card flywheel-operations-deck" data-testid="flywheel-operations-deck">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">OPERATIONS</span><h3>What the Flywheel is touching right now</h3></div>
          <span>{telemetryView?.statusLabel || 'UNKNOWN'} · {telemetryView?.feedState || 'unavailable'}</span>
        </div>
        <div className="flywheel-operation-grid">
          {operationCards.map((item) => (
            <article key={item.id} className="flywheel-operation-card">
              <div><span>{item.label}</span><small>{item.source}</small></div>
              <strong>{display(item.value)}</strong>
              <p>{display(item.summary, 'No current projection published.')}</p>
            </article>
          ))}
        </div>
        {metrics.length ? (
          <div className="flywheel-metric-ribbon">
            {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}
          </div>
        ) : null}
      </section>

      <div className="flywheel-observatory__primary-grid">
        <section className="uplift-deck-card uplift-brain-bay flywheel-brain-bay--large" data-testid="flywheel-brain-bay">
          <div className="uplift-section-heading">
            <div><span className="uplift-kicker">COGNITION</span><h3>Brain Bay</h3></div>
            <span className={`uplift-status-chip ${truthClass(brain.state)}`}>{display(brain.state)}</span>
          </div>
          <div className="flywheel-brain-visual" aria-hidden="true">
            <span className="flywheel-brain-ring ring-a" />
            <span className="flywheel-brain-ring ring-b" />
            <span className="flywheel-brain-ring ring-c" />
            <div className="uplift-brain-core"><span>Ψ</span></div>
          </div>
          <dl className="uplift-definition-grid">
            <div><dt>Mode</dt><dd>{display(brain.mode)}</dd></div>
            <div><dt>Model</dt><dd>{display(brain.model)}</dd></div>
            <div><dt>Proof refs</dt><dd>{brain.proofRefs?.length ?? 0}</dd></div>
            <div><dt>Authority</dt><dd>DIAGNOSE / DESIGN ONLY</dd></div>
            <div className="wide"><dt>Why awake?</dt><dd>{display(brain.reason, 'No current brain-use receipt.')}</dd></div>
          </dl>
        </section>

        <section className="uplift-deck-card flywheel-learning-pipeline" data-testid="flywheel-learning-pipeline">
          <div className="uplift-section-heading">
            <div><span className="uplift-kicker">RECURSIVE LIFT</span><h3>Learning Pipeline</h3></div>
            <span>Evidence → stronger agent</span>
          </div>
          <div className="flywheel-pipeline">
            {pipelineStages.map((stage, index) => <PipelineStage key={stage.label} index={index} {...stage} />)}
          </div>
          <p className="muted">A lit stage means canonical evidence exists for that stage. It is not a claim that promotion is complete.</p>
        </section>
      </div>

      <section className="uplift-deck-card" data-testid="flywheel-agent-constellation">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">CONSTELLATION</span><h3>Agent Uplift Field</h3></div>
          <span>{participants.length} evidence-bearing participant(s)</span>
        </div>
        <div className="uplift-constellation flywheel-constellation--large">
          {participants.length ? participants.slice(0, 24).map((agent) => (
            <article className={`uplift-agent-node ${truthClass(agent.truth)}`} key={agent.participantId}>
              <div className="uplift-node-core">{String(agent.participantId || '?').slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{agent.participantId}</strong>
                <span>{agent.latestMissionId || 'No mission identity'}</span>
                <small>{agent.upliftNeedCount || agent.capabilityGapCount ? `${agent.upliftNeedCount || 0} uplift signal(s) · ${agent.capabilityGapCount || 0} gap(s) · ${agent.proofCount || 0} proof` : `No uplift gap evidenced · ${agent.proofCount || 0} proof`}</small>
              </div>
            </article>
          )) : (
            <p className="flywheel-empty-state">No agent evidence is currently published. The constellation remains visible but empty rather than inventing agents.</p>
          )}
        </div>
      </section>

      <section className="uplift-deck-card uplift-heatmap" data-testid="flywheel-uplift-heatmap">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">CAPABILITY FIELD</span><h3>Uplift Heatmap</h3></div>
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
              {participants.length ? participants.slice(0, 24).map((agent) => {
                const byId = new Map((agent.dimensions || []).map((dimension) => [dimension.id, dimension]));
                return (
                  <tr key={agent.participantId}>
                    <th>{agent.participantId}</th>
                    {Object.keys(DIMENSION_LABELS).map((id) => <HeatCell key={id} dimension={byId.get(id)} />)}
                    <td>{agent.proofCount ?? 0}</td>
                  </tr>
                );
              }) : (
                <tr><th>NO EVIDENCE</th>{Object.keys(DIMENSION_LABELS).map((id) => <td key={id} className="uplift-heat-cell unknown">·</td>)}<td>0</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flywheel-observatory__tri-grid">
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">WEAKNESSES</span><h3>Capability Gaps</h3></div><span>{capabilityGaps.length}</span></div>
          <MiniRecordList records={capabilityGaps} empty="No capability gap evidence is currently published." testId="flywheel-capability-gaps" />
        </section>
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">LAB</span><h3>Uplift Experiments</h3></div><span>{experiments.length}</span></div>
          <MiniRecordList records={experiments} empty="No current uplift experiment or replay evidence is published." testId="flywheel-experiments" />
        </section>
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">HUMAN LOAD</span><h3>Operator Intervention</h3></div><span>{interventions.length}</span></div>
          <MiniRecordList records={interventions} empty="No operator-intervention evidence is currently published." testId="flywheel-operator-interventions" />
        </section>
      </div>

      <section className="uplift-deck-card" data-testid="flywheel-learning-timeline">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">MISSION REPLAY</span><h3>Learning Timeline</h3></div>
          <span>{timeline.length} recent record(s)</span>
        </div>
        <ol className="uplift-timeline flywheel-timeline--large">
          {timeline.length ? timeline.map((entry, index) => (
            <li key={`${entry.at}-${entry.participantId}-${index}`} className={truthClass(entry.truth)}>
              <span className="uplift-timeline-marker" aria-hidden="true" />
              <div>
                <div className="uplift-timeline-meta"><strong>{entry.type}</strong><span>{entry.participantId}</span><span>{entry.at || 'time unknown'}</span></div>
                <p>{entry.summary}</p>
                <small>{entry.missionId || 'mission unknown'} · proofs {entry.proofCount ?? 0} · {entry.state || 'UNKNOWN'}</small>
              </div>
            </li>
          )) : <li className="unknown"><span className="uplift-timeline-marker" /><div><p>No historical learning records are available yet.</p><small>UNKNOWN remains UNKNOWN.</small></div></li>}
        </ol>
      </section>

      <div className="flywheel-observatory__tri-grid">
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">MEMORY</span><h3>Lessons</h3></div><span>{lessons.length}</span></div>
          <MiniRecordList records={lessons} empty="No durable lessons are present in the current feed." testId="flywheel-lessons" />
        </section>
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">EXECUTION</span><h3>Receipt Stream</h3></div><span>{receipts.length}</span></div>
          <MiniRecordList records={receipts} empty="No execution receipts are present in the current feed." testId="flywheel-receipts" />
        </section>
        <section className="uplift-deck-card">
          <div className="uplift-section-heading"><div><span className="uplift-kicker">EVIDENCE</span><h3>Proof Vault</h3></div><span>{proofs.length}</span></div>
          <MiniRecordList records={proofs} empty="No explicit proof records are present in the current feed." testId="flywheel-proof-vault" />
        </section>
      </div>

      <section className="uplift-deck-card flywheel-source-mesh" data-testid="flywheel-source-mesh">
        <div className="uplift-section-heading">
          <div><span className="uplift-kicker">TRUTH FABRIC</span><h3>Shared Workspace Source Mesh</h3></div>
          <span>{sourceMesh.recordCount || 0} total record(s)</span>
        </div>
        <div className="flywheel-source-mesh__grid">
          {[
            ['Status', sourceMesh.statusRecords],
            ['Capability', sourceMesh.capabilityRecords],
            ['Receipts', sourceMesh.receiptRecords],
            ['Events', sourceMesh.eventRecords],
            ['Lessons', sourceMesh.lessonRecords],
            ['Proof', sourceMesh.proofRecords],
          ].map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{value ?? 0}</strong><small>{view?.valid ? 'Shared Workspace' : 'UNKNOWN / unavailable'}</small></div>
          ))}
        </div>
        {connection.error ? <p className="flywheel-source-warning" role="status">{connection.error}</p> : null}
      </section>

      <div className="uplift-next-action flywheel-next-command">
        <span>Canonical next move</span>
        <strong>{view?.exactNextAction || telemetryView?.exactNextAction || 'No next action published.'}</strong>
      </div>
    </section>
  );
}
