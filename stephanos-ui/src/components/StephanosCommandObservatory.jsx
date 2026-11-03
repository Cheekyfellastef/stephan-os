import { useEffect, useMemo, useState } from 'react';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import './StephanosCommandObservatory.css';

const WORKSPACES = Object.freeze([
  { id: 'stephanos-ai', label: 'Stephanos AI', emblem: '✦', detail: 'Ask, command, and collaborate' },
  { id: 'agents', label: 'Agent Fleet', emblem: '◈', detail: 'Uplift and capability passports' },
  { id: 'flywheel', label: 'Flywheel', emblem: '◎', detail: 'Seeds, learning and evidence' },
  { id: 'skill-forge', label: 'Skill Forge', emblem: '⚒', detail: 'Conjure, test and share skills' },
  { id: 'goal-dashboard', label: 'Goal Dashboard', emblem: '▥', detail: 'Goals, approvals and blockers' },
  { id: 'openclaw', label: 'OpenClaw', emblem: '⬡', detail: 'Local and Standalone' },
  { id: 'mission-console', label: 'Mission Console', emblem: '⌘', detail: 'Build and repair mission routing' },
  { id: 'vr-research-lab', label: 'VR Research Lab', emblem: '✧', detail: 'Prove immersive systems' },
]);
function usefulText(value, fallback = 'UNKNOWN') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function truthTone(value) {
  const v = usefulText(value).toUpperCase();
  return /READY|ONLINE|RUNNING|CURRENT|LIVE|PASS|HEALTHY|CONNECTED/.test(v) ? 'good'
    : /BLOCK|ERROR|FAILED|OFFLINE|UNAVAILABLE|CRITICAL/.test(v) ? 'bad' : 'neutral';
}
export default function StephanosCommandObservatory({
  runtimeStatus = {}, runtimeStatusModel = null, routeTruthView = null,
  finalAgentView = null, runtimeBuildParity = null, safeApiStatus = null, missionBridgeTruth = null,
}) {
  const [feed, setFeed] = useState(null);
  const [feedState, setFeedState] = useState('CONNECTING');
  const [expanded, setExpanded] = useState(true);
  const ctx = runtimeStatusModel?.runtimeContext || {};
  const transport = ctx.bridgeTransportTruth || {};
  const hosted = String(transport.bridgeHostedExecutionBridgeUrl || transport.bridgeHostedExecutionTarget || '').trim();
  const local = String(transport.bridgeOperatorTransportUrl || ctx.homeNodeBridge?.backendUrl || '').trim();
  const target = useMemo(() => ({
    frontendOrigin: typeof window !== 'undefined' ? window.location?.origin || '' : '',
    baseUrl: typeof window !== 'undefined' && window.location.protocol === 'https:' && hosted ? hosted : '',
    bridgeUrl: local, hostedExecutionBridgeUrl: hosted, homeNodeBridge: ctx.homeNodeBridge || null,
  }), [hosted, local, ctx.homeNodeBridge]);
  useEffect(() => {
    let stopped = false;
    let timer = null;
    async function refresh() {
      try {
        const result = await requestStephanosBackend({
          path: '/api/shared-workspace/dashboard-feed',
          runtimeContext: target, timeoutMs: 9000,
        });
        if (!stopped) { setFeed(result.json || null); setFeedState(result.json?.state || 'NO_RESPONSE'); }
      } catch { if (!stopped) { setFeed(null); setFeedState('OFFLINE'); } }
      finally { if (!stopped && typeof window !== 'undefined') timer = window.setTimeout(refresh, 30000); }
    }
    void refresh();
    return () => { stopped = true; if (timer != null && typeof window !== 'undefined') window.clearTimeout(timer); };
  }, [target]);
  const liveAgents = Array.isArray(finalAgentView?.visibleAgents) ? finalAgentView.visibleAgents : [];
  const acting = liveAgents.filter(agent => agent.acting === true);
  const runtime = runtimeStatus?.runtimeTruth || {};
  const counts = [
    { key:'Local brain route', value: usefulText(routeTruthView?.executedProvider), explanation: 'Provider actually selected, not requested', tone: truthTone(routeTruthView?.backendReachableState) },
    { key:'Backend', value: usefulText(routeTruthView?.backendReachableState || safeApiStatus?.state), explanation: usefulText(safeApiStatus?.detail, 'Current API handshake'), tone: truthTone(routeTruthView?.backendReachableState || safeApiStatus?.state) },
    { key:'Agent registry', value: liveAgents.length ? String(liveAgents.length) : 'UNKNOWN', explanation: acting.length + ' currently marked acting', tone: liveAgents.length ? 'good' : 'neutral' },
    { key:'Open goals', value: Number.isFinite(feed?.goalEstate?.totalOpenGoals) ? String(feed.goalEstate.totalOpenGoals) : 'UNKNOWN', explanation: 'Shared Workspace published goal estate', tone: truthTone(feedState) },
    { key:'Mission', value: usefulText(missionBridgeTruth?.missionPacket?.missionId || missionBridgeTruth?.missionPacket?.goalId), explanation: 'Current mission packet identity', tone: 'neutral' },
    { key:'Build parity', value: usefulText(runtimeBuildParity?.confidence), explanation: 'Source and served build parity confidence', tone: truthTone(runtimeBuildParity?.confidence) },
  ];
  const platformState = usefulText(runtimeStatus?.headline, 'Battle Bridge status unreported');
  const fleetOwners = ['OpenClaw Local', 'Sovereign Commander', 'OpenClaw Standalone'].map(name => {
    const record = liveAgents.find(agent => { const id = usefulText(agent.agentId).toLowerCase(); const label = usefulText(agent.displayName).toLowerCase(); return name === 'OpenClaw Local' ? (id === 'openclaw-local' || id === 'stephanos-scout-coder' || label === 'openclaw local') : name === 'OpenClaw Standalone' ? (id === 'openclaw-standalone' || label === 'openclaw standalone') : (id === 'sovereign-commander' || label === 'sovereign commander'); });
    return { label:name, state: record ? usefulText(record.state) : 'UNKNOWN', reason: record ? usefulText(record.stateReason, 'No reason supplied') : 'Not found in current visible-agent projection' };
  });
  const inspectedAt = useMemo(() => new Date().toLocaleString(), [feed]);
  return <section className="stephanos-ops" aria-label="Stephanos Command Observatory" data-testid="stephanos-command-observatory">
    <header className="stephanos-ops-hero">
      <div>
        <span className="stephanos-ops-kicker">STEPHANOS OS · MISSION CONTROL · SOVEREIGN FABRIC</span>
        <h1>Command Observatory <span className="stephanos-ops-spark">✧</span></h1>
        <p>One cockpit for the entire project. See the difference between a working system, an evidenced capability, and a promising plan.</p>
      </div>
      <div className="stephanos-ops-reality">
        <span>Live evidence route</span>
        <strong className={truthTone(feedState)}>{usefulText(feedState)}</strong>
        <small>{inspectedAt}</small>
      </div>
    </header>
    <div className="stephanos-ops-status-band">
      <span className={'stephanos-ops-dot ' + truthTone(runtimeStatus?.appLaunchState)} aria-hidden="true" />
      <strong>{platformState}</strong>
      <span>{usefulText(runtimeStatus?.dependencySummary)}</span>
      <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? 'Compact view' : 'Expand observatory'}</button>
    </div>
    {expanded && <>
      <div className="stephanos-ops-metrics">
        {counts.map(stat => <article key={stat.key} className={'stephanos-ops-metric ' + stat.tone}>
          <span>{stat.key}</span><strong title={stat.value}>{stat.value}</strong><small>{stat.explanation}</small>
        </article>)}
      </div>
      <div className="stephanos-ops-grid">
        <section className="stephanos-ops-section">
          <div className="stephanos-ops-section-head"><span>01 / THE FLEET</span><h2>What the fleet registry reports</h2></div>
          <div className="stephanos-ops-fleet">
            {fleetOwners.map(agent => <div key={agent.label}><div><b>{agent.label}</b><small>{agent.reason}</small></div><span className={truthTone(agent.state)}>{agent.state}</span></div>)}
          </div>
        </section>
        <section className="stephanos-ops-section">
          <div className="stephanos-ops-section-head"><span>02 / REALITY GATES</span><h2>Evidence before confidence</h2></div>
          <div className="stephanos-ops-gates">
            <div><span>Shared Workspace</span><strong>{usefulText(feed?.state, 'NOT VERIFIED')}</strong></div>
            <div><span>Selected route</span><strong>{usefulText(routeTruthView?.routeKind)}</strong></div>
            <div><span>Source/build parity</span><strong>{runtimeBuildParity?.sourceDistParityOk == null ? 'UNPROVEN' : runtimeBuildParity.sourceDistParityOk ? 'PROVEN' : 'MISMATCH'}</strong></div>
            <div><span>Active mission</span><strong>{usefulText(missionBridgeTruth?.missionPacket?.status, 'UNREPORTED')}</strong></div>
            <div><span>Runtime</span><strong>{usefulText(runtime.runtimeState || runtimeStatus?.appLaunchState)}</strong></div>
          </div>
          <p>Missing proof remains UNKNOWN. An agent marked acting in the registry is not proof of a completed build, repair or successful merge.</p>
        </section>
      </div>
    </>}
    <section className="stephanos-ops-section stephanos-ops-nav">
      <div className="stephanos-ops-section-head"><span>03 / WORKSPACE CONSTELLATION</span><h2>Open the next command deck</h2></div>
      <div className="stephanos-ops-links">
        {WORKSPACES.map(space => <a key={space.id} href={['vr-research-lab', 'stephanos-ai', 'goal-dashboard'].includes(space.id) ? '/apps/' + space.id + '/' : '?surface=' + encodeURIComponent(space.id)} title={'Open ' + space.label}>
          <span className="stephanos-ops-emblem">{space.emblem}</span><b>{space.label}</b><small>{space.detail}</small><span className="stephanos-ops-arrow">↗</span>
        </a>)}
      </div>
    </section>
    <div className="stephanos-ops-footer"><strong>Operator authority remains canonical.</strong> This observatory is read-only. It cannot approve, run commands, grant privileges, or count proposals as completed builds.</div>
  </section>;
}
