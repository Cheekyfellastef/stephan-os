import { useEffect, useMemo, useRef, useState } from 'react';
import { requestStephanosBackend } from '../../../shared/runtime/backendClient.mjs';
import { deriveAgentsWorkspaceView } from '../../../shared/runtime/upliftWorkspaceProjectionV1.mjs';
import {
  STEPHANOS_UI_BUILD_TIMESTAMP,
  STEPHANOS_UI_GIT_COMMIT,
  STEPHANOS_UI_RUNTIME_MARKER,
  STEPHANOS_UI_SOURCE_FINGERPRINT,
} from '../runtimeInfo';
import './cockpitFleetCommand.css';

const BACKEND_POLL_MS = 5000;
const WORKSPACE_POLL_MS = 15000;
const BUILD_POLL_MS = 5000;

function asText(value, fallback = 'UNKNOWN') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function shortId(value = '') {
  const text = String(value || '').trim();
  return text ? text.slice(0, 10) : 'unknown';
}

function isDistRuntime() {
  return typeof window !== 'undefined'
    && String(window.location?.pathname || '').includes('/apps/stephanos/dist/');
}

function buildMetadataUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return '/apps/stephanos/dist/stephanos-build.json';
  }
  if (isDistRuntime()) {
    return new URL('./stephanos-build.json', window.location.href).toString();
  }
  return new URL('/apps/stephanos/dist/stephanos-build.json', window.location.origin).toString();
}

function agentLamp(agent = {}) {
  const state = String(agent.state || '').trim().toLowerCase();
  if (agent.enabled === false || state === 'disabled') return { tone: 'white', label: 'disabled' };
  if (['failed', 'failure', 'error', 'blocked', 'offline', 'unreachable'].includes(state)) return { tone: 'red', label: state || 'blocked' };
  if (['degraded', 'waiting', 'preparing', 'starting', 'recovering', 'pending'].includes(state)) return { tone: 'amber', label: state };
  if (agent.acting === true || ['acting', 'active', 'ready', 'watching', 'running', 'idle'].includes(state)) return { tone: 'green', label: agent.acting ? 'acting' : state };
  return { tone: 'white', label: state || 'unknown' };
}

function controlLamp(state = '') {
  const normalized = String(state || '').trim().toLowerCase();
  if (['alive', 'current', 'ready', 'healthy', 'backend'].includes(normalized)) return 'green';
  if (['degraded', 'stale', 'hydrating', 'recovering', 'pending', 'unknown'].includes(normalized)) return 'amber';
  if (['dead', 'failed', 'blocked', 'unavailable', 'error'].includes(normalized)) return 'red';
  return 'white';
}

function TrafficLamp({ tone = 'white', label = '' }) {
  return <span className={`cockpit-traffic-lamp lamp-${tone}`} aria-label={label || tone} title={label || tone} />;
}

function ControlCard({ title, state, detail, tone }) {
  return (
    <article className={`cockpit-control-card tone-${tone}`}>
      <div className="cockpit-control-card-head">
        <TrafficLamp tone={tone} label={`${title}: ${state}`} />
        <span>{title}</span>
      </div>
      <strong>{state}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function CockpitFleetCommand({
  finalAgentView = null,
  runtimeStatus = null,
  routeTruthView = null,
  onBackendProof = null,
} = {}) {
  const [backendProof, setBackendProof] = useState({
    state: 'unknown',
    reachable: null,
    checkedAt: '',
    endpoint: '',
    httpStatus: null,
    source: 'cockpit-canonical-health-probe',
  });
  const [workspaceFeed, setWorkspaceFeed] = useState(null);
  const [buildTruth, setBuildTruth] = useState({
    state: 'unknown',
    servedMarker: '',
    servedCommit: '',
    servedBuildTimestamp: '',
    observedAt: '',
    reloadPending: false,
  });
  const backendFailureCountRef = useRef(0);
  const pendingBuildRef = useRef({ marker: '', count: 0 });

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const refresh = async () => {
      const checkedAt = new Date().toISOString();
      try {
        const result = await requestStephanosBackend({
          path: '/api/health',
          timeoutMs: 3500,
        });
        backendFailureCountRef.current = 0;
        const next = {
          state: 'alive',
          reachable: true,
          checkedAt,
          endpoint: result.url || 'http://127.0.0.1:8787/api/health',
          httpStatus: result.status || 200,
          service: result.json?.service || 'stephanos-server',
          source: 'cockpit-canonical-health-probe',
        };
        if (!cancelled) {
          setBackendProof(next);
          onBackendProof?.(next);
        }
      } catch (error) {
        backendFailureCountRef.current += 1;
        const provenDead = backendFailureCountRef.current >= 2;
        const next = {
          state: provenDead ? 'dead' : 'degraded',
          reachable: provenDead ? false : null,
          checkedAt,
          endpoint: error?.url || 'http://127.0.0.1:8787/api/health',
          httpStatus: error?.status || null,
          service: 'stephanos-server',
          source: 'cockpit-canonical-health-probe',
          reason: error?.code || error?.message || 'health-probe-failed',
        };
        if (!cancelled) {
          setBackendProof(next);
          onBackendProof?.(next);
        }
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          timer = window.setTimeout(refresh, BACKEND_POLL_MS);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer);
    };
  }, [onBackendProof]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const refresh = async () => {
      try {
        const result = await requestStephanosBackend({
          path: '/api/shared-workspace/dashboard-feed?scope=full-history',
          timeoutMs: 6000,
        });
        if (!cancelled) setWorkspaceFeed(result.json || null);
      } catch (_error) {
        if (!cancelled) setWorkspaceFeed(null);
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          timer = window.setTimeout(refresh, WORKSPACE_POLL_MS);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof fetch !== 'function') return undefined;
    let cancelled = false;
    let timer = null;
    const refresh = async () => {
      try {
        const response = await fetch(buildMetadataUrl(), { cache: 'no-store' });
        if (!response.ok) throw new Error(`build metadata HTTP ${response.status}`);
        const metadata = await response.json();
        const servedMarker = String(metadata?.runtimeMarker || '').trim();
        const mismatch = Boolean(servedMarker && servedMarker !== STEPHANOS_UI_RUNTIME_MARKER);
        let reloadPending = false;
        if (mismatch) {
          const previous = pendingBuildRef.current;
          const count = previous.marker === servedMarker ? previous.count + 1 : 1;
          pendingBuildRef.current = { marker: servedMarker, count };
          reloadPending = isDistRuntime() && count >= 1;
          if (!cancelled) {
            setBuildTruth({
              state: 'stale',
              servedMarker,
              servedCommit: metadata?.gitCommit || '',
              servedBuildTimestamp: metadata?.buildTimestamp || '',
              observedAt: new Date().toISOString(),
              reloadPending,
            });
          }
          if (isDistRuntime() && count >= 2 && !cancelled) {
            window.location.reload();
            return;
          }
        } else {
          pendingBuildRef.current = { marker: '', count: 0 };
          if (!cancelled) {
            setBuildTruth({
              state: servedMarker ? 'current' : 'unknown',
              servedMarker,
              servedCommit: metadata?.gitCommit || '',
              servedBuildTimestamp: metadata?.buildTimestamp || '',
              observedAt: new Date().toISOString(),
              reloadPending: false,
            });
          }
        }
      } catch (_error) {
        if (!cancelled) {
          setBuildTruth((previous) => ({ ...previous, state: 'unknown', observedAt: new Date().toISOString() }));
        }
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          timer = window.setTimeout(refresh, BUILD_POLL_MS);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer);
    };
  }, []);

  const agentsWorkspaceView = useMemo(
    () => deriveAgentsWorkspaceView({
      payload: workspaceFeed || {},
      finalAgentView: finalAgentView || {},
    }),
    [workspaceFeed, finalAgentView],
  );

  const agents = Array.isArray(agentsWorkspaceView?.agents) ? agentsWorkspaceView.agents : [];
  const handoffChain = Array.isArray(finalAgentView?.visibleHandoffChain) ? finalAgentView.visibleHandoffChain : [];
  const recentTransitions = Array.isArray(finalAgentView?.recentTransitions) ? finalAgentView.recentTransitions.slice(0, 5) : [];
  const lampCounts = agents.reduce((acc, agent) => {
    const tone = agentLamp(agent).tone;
    acc[tone] = (acc[tone] || 0) + 1;
    return acc;
  }, { green: 0, amber: 0, red: 0, white: 0 });

  const workspaceState = String(agentsWorkspaceView?.sourceTruth || 'UNKNOWN').toUpperCase();
  const memoryState = finalAgentView?.memoryCapability?.ready === true
    ? 'ready'
    : asText(finalAgentView?.memoryCapability?.state, 'unknown').toLowerCase();
  const routeState = asText(routeTruthView?.routeKind, 'unknown');
  const buildStateLabel = buildTruth.state === 'stale'
    ? 'STALE BUILD'
    : buildTruth.state === 'current'
      ? 'CURRENT'
      : 'UNKNOWN';

  return (
    <section className="cockpit-fleet-command" data-testid="cockpit-fleet-command" data-cockpit-deluxe="v2">
      <header className="cockpit-fleet-hero">
        <div>
          <span className="cockpit-fleet-kicker">FLEET COMMAND · LIVE CANONICAL TRUTH</span>
          <h2>Stephanos Cockpit Deluxe</h2>
          <p>One bridge view for runtime truth, registered agents, handoffs, recovery and build freshness. Unknown stays amber, failure needs fresh proof.</p>
        </div>
        <div className="cockpit-fleet-orb" data-state={backendProof.state}>
          <span>FOREMAN</span>
          <strong>{finalAgentView?.actingAgentId || 'WATCHING'}</strong>
          <small>{finalAgentView?.globalAutonomyStatus || 'manual'} · safe mode {finalAgentView?.safeModeStatus || 'unknown'}</small>
        </div>
      </header>

      <div className="cockpit-control-deck">
        <ControlCard
          title="Backend 8787"
          state={backendProof.state.toUpperCase()}
          detail={backendProof.checkedAt ? `fresh ${backendProof.checkedAt}` : 'awaiting canonical probe'}
          tone={controlLamp(backendProof.state)}
        />
        <ControlCard
          title="Shared Workspace"
          state={workspaceState}
          detail={agentsWorkspaceView?.sourceFreshness?.observedAtUtc || 'awaiting feed'}
          tone={controlLamp(workspaceState)}
        />
        <ControlCard
          title="Build / DOM"
          state={buildStateLabel}
          detail={buildTruth.reloadPending ? 'new served build detected · auto-refresh armed' : `bundle ${shortId(STEPHANOS_UI_GIT_COMMIT)} · served ${shortId(buildTruth.servedCommit)}`}
          tone={controlLamp(buildTruth.state === 'current' ? 'current' : buildTruth.state === 'stale' ? 'stale' : 'unknown')}
        />
        <ControlCard
          title="Memory"
          state={memoryState.toUpperCase()}
          detail={finalAgentView?.memoryCapability?.reason || 'memory capability proof pending'}
          tone={controlLamp(memoryState)}
        />
      </div>

      <div className="cockpit-fleet-statline">
        <span><b>{agents.length}</b> registered agents</span>
        <span className="fleet-green"><b>{lampCounts.green}</b> green</span>
        <span className="fleet-amber"><b>{lampCounts.amber}</b> amber</span>
        <span className="fleet-red"><b>{lampCounts.red}</b> red</span>
        <span><b>{lampCounts.white}</b> unknown/disabled</span>
        <span><b>{routeState}</b> route</span>
      </div>

      <section className="cockpit-agent-constellation" aria-label="Registered Stephanos agent fleet">
        <div className="cockpit-fleet-section-heading">
          <div>
            <span className="cockpit-fleet-kicker">AGENT CONSTELLATION</span>
            <h3>Every registered agent, one glance</h3>
          </div>
          <span>health/status lamp · activity · current evidence</span>
        </div>
        <div className="cockpit-agent-grid">
          {agents.map((agent) => {
            const lamp = agentLamp(agent);
            const acting = agent.acting === true || agent.agentId === finalAgentView?.actingAgentId;
            return (
              <article
                key={agent.agentId}
                className={`cockpit-agent-card lamp-${lamp.tone} ${acting ? 'is-acting' : ''}`}
                data-agent-id={agent.agentId}
                data-agent-status={lamp.tone}
                data-agent-activity={lamp.label}
              >
                <div className="cockpit-agent-card-head">
                  <TrafficLamp tone={lamp.tone} label={`${agent.displayName}: ${lamp.label}`} />
                  <div>
                    <strong>{agent.displayName}</strong>
                    <small>{agent.role || 'agent'} · {lamp.label}</small>
                  </div>
                  {acting ? <span className="cockpit-acting-badge">ACTING</span> : null}
                </div>
                <p>{agent.stateReason || agent.latestSummary || 'No current state reason published.'}</p>
                <div className="cockpit-agent-card-meta">
                  <span>{agent.latestMissionId && agent.latestMissionId !== 'UNKNOWN' ? agent.latestMissionId : 'no mission receipt'}</span>
                  <span>{agent.proofCount ?? 0} proof</span>
                  <span>{agent.capabilityGapCount ?? 0} gaps</span>
                </div>
                <div className="cockpit-agent-evidence-bar">
                  <span className={`truth-${String(agent.sharedWorkspaceTruth || 'unknown').toLowerCase()}`}>
                    {agent.sharedWorkspaceTruth || 'UNKNOWN'}
                  </span>
                  <span>{Array.isArray(agent.capabilities) ? agent.capabilities.length : 0} capabilities</span>
                </div>
              </article>
            );
          })}
          {!agents.length ? (
            <div className="cockpit-fleet-empty">
              <strong>Agent registry projection unavailable.</strong>
              <span>The Cockpit will not invent agents. It will populate automatically when canonical runtime truth arrives.</span>
            </div>
          ) : null}
        </div>
      </section>

      <div className="cockpit-fleet-lower-grid">
        <section className="cockpit-fleet-glass-card">
          <span className="cockpit-fleet-kicker">HANDOFF FABRIC</span>
          <h3>Who is passing work to whom</h3>
          <p className="cockpit-handoff-chain">{handoffChain.length ? handoffChain.join(' → ') : 'No active handoff chain.'}</p>
          <div className="cockpit-transition-list">
            {recentTransitions.map((entry, index) => (
              <div key={`${entry.agentId || 'agent'}-${entry.at || index}`}>
                <TrafficLamp tone={controlLamp(entry.state)} label={entry.state || 'unknown'} />
                <span><strong>{entry.displayName || entry.agentId}</strong>{entry.reason || entry.type || 'transition'}</span>
                <small>{entry.at || 'time unknown'}</small>
              </div>
            ))}
            {!recentTransitions.length ? <span className="cockpit-fleet-muted">No recent transition evidence.</span> : null}
          </div>
        </section>

        <section className="cockpit-fleet-glass-card cockpit-build-proof-card">
          <span className="cockpit-fleet-kicker">RUNTIME IDENTITY</span>
          <h3>Loaded DOM vs served build</h3>
          <dl>
            <div><dt>Loaded commit</dt><dd>{STEPHANOS_UI_GIT_COMMIT}</dd></div>
            <div><dt>Served commit</dt><dd>{buildTruth.servedCommit || 'unknown'}</dd></div>
            <div><dt>Loaded build</dt><dd>{STEPHANOS_UI_BUILD_TIMESTAMP || 'unknown'}</dd></div>
            <div><dt>Served build</dt><dd>{buildTruth.servedBuildTimestamp || 'unknown'}</dd></div>
            <div><dt>Fingerprint</dt><dd>{shortId(STEPHANOS_UI_SOURCE_FINGERPRINT)}</dd></div>
          </dl>
          <p className="cockpit-fleet-muted">
            {buildTruth.state === 'stale'
              ? 'The server has a newer runtime than this DOM. Two matching observations trigger an automatic reload.'
              : 'Loaded runtime is aligned with the currently served build marker.'}
          </p>
        </section>
      </div>
    </section>
  );
}
