(() => {
  'use strict';

  const REPOSITORY = 'Cheekyfellastef/stephan-os';
  const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
  const BEACON_ISSUE = 1889;
  const BEACON_MARKER = '<!-- stephanos-battle-bridge-outbound-health-beacon -->';
  const BEACON_SCHEMA = 'stephanos.battle-bridge-outbound-health-beacon.v1';
  const REFRESH_MS = 5 * 60 * 1000;
  const MAX_BEACON_AGE_MS = 3 * 60 * 1000;
  const SHA = /^[0-9a-f]{40}$/;
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
  const AUTONOMY_GATES = ['SYNC', 'CONTROL_PLANE', 'HEARTBEAT', 'ELIGIBLE_GOAL', 'SELECT', 'CLAIM', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT', 'REVIEW_HANDOFF', 'RELEASE', 'SELECT_NEXT'];
  const ESTATE_BUCKETS = [
    ['eligible', 'Eligible'],
    ['active', 'Building'],
    ['parked', 'Parked'],
    ['waitingDependency', 'Dependencies'],
    ['operatorReady', 'Operator-ready'],
    ['unknown', 'Unknown'],
  ];

  function isLocalHost() { return LOCAL_HOSTS.has(String(window.location?.hostname || '').toLowerCase()); }
  function safeSha(value) { const sha = String(value || '').trim().toLowerCase(); return SHA.test(sha) ? sha : ''; }
  function observedMs(value) { const ms = Date.parse(String(value || '')); return Number.isFinite(ms) ? ms : NaN; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

  function parseBeaconComment(comment) {
    const body = String(comment?.body || '');
    if (!body.includes(BEACON_MARKER)) return null;
    const match = body.match(/```json\s*([\s\S]*?)```/i);
    if (!match) return null;
    try {
      const record = JSON.parse(match[1]);
      if (record?.schemaVersion !== BEACON_SCHEMA) return null;
      if (record?.repository !== REPOSITORY || Number(record?.issueNumber) !== BEACON_ISSUE) return null;
      if (!safeSha(record?.sourceHead)) return null;
      if (!Number.isFinite(observedMs(record?.observedAtUtc))) return null;
      return record;
    } catch { return null; }
  }

  function latestBeacon(comments) {
    return (Array.isArray(comments) ? comments : []).map(parseBeaconComment).filter(Boolean)
      .sort((left, right) => observedMs(left.observedAtUtc) - observedMs(right.observedAtUtc)).at(-1) || null;
  }

  function issueGoal(issue) {
    const number = Number(issue?.number || 0);
    return {
      issue: number > 0 ? `#${number}` : 'GitHub issue', title: String(issue?.title || 'Untitled durable work item'),
      statusTruth: 'CURRENT', proofTruth: 'UNKNOWN', source: 'github-public-issue', exactHead: 'UNKNOWN',
      summary: 'Current open GitHub work item. Runtime/proof state is shown separately and is not inferred from issue presence.',
      blockers: [], exactNextAction: 'Use canonical project evidence to determine the next safe build step.', updatedAtUtc: String(issue?.updated_at || ''),
    };
  }

  function surface(beacon, id) { return (Array.isArray(beacon?.surfaces) ? beacon.surfaces : []).find((item) => item?.id === id) || null; }
  function gate(id, state, reason = '') { return { id, state, reason: String(reason || '') }; }

  function remoteAutonomyBuildTrack(beacon) {
    const sync = surface(beacon, 'githubSync');
    const refresh = surface(beacon, 'postSyncRefresh');
    const worker = surface(beacon, 'missionWorker');
    const syncState = String(sync?.state || sync?.rawState || 'UNKNOWN').toUpperCase();
    const refreshBlocker = String(refresh?.blocker || '');
    const syncGate = syncState.startsWith('SYNC_') && !syncState.includes('BLOCK') ? gate('SYNC', 'PASS')
      : syncState.includes('BLOCK') ? gate('SYNC', 'BLOCKED', syncState) : gate('SYNC', 'UNKNOWN', syncState);
    const controlPlaneGate = refreshBlocker.startsWith('CONTROL_PLANE_') ? gate('CONTROL_PLANE', 'BLOCKED', refreshBlocker)
      : gate('CONTROL_PLANE', 'UNKNOWN', refreshBlocker || 'CONTROL_PLANE_SIGNAL_NOT_PUBLISHED');
    const stoppedBeforeHeartbeat = controlPlaneGate.state === 'BLOCKED' || syncGate.state === 'BLOCKED';
    const downstream = AUTONOMY_GATES.slice(2).map((id) => gate(id, stoppedBeforeHeartbeat ? 'NOT_REACHED' : 'UNKNOWN'));
    if (!stoppedBeforeHeartbeat && worker) {
      const heartbeat = downstream.find((item) => item.id === 'HEARTBEAT');
      const workerState = String(worker.state || '').toUpperCase();
      if (heartbeat && workerState !== 'STALE' && String(worker.rawState || '').includes('TICK_PASS')) heartbeat.state = 'PASS';
    }
    const gates = [syncGate, controlPlaneGate, ...downstream];
    const first = gates.find((item) => item.state === 'BLOCKED') || gates.find((item) => item.state === 'WAITING')
      || gates.find((item) => item.state === 'NOT_REACHED') || gates.find((item) => item.state === 'UNKNOWN') || null;
    return {
      schemaVersion: 'stephanos.autonomy-build-track.remote.v1', timestampUtc: String(beacon?.observedAtUtc || ''),
      sourceHead: safeSha(beacon?.sourceHead), gates, currentGate: first?.id || 'COMPLETE', currentState: first?.state || 'PASS',
      blocker: first?.state === 'BLOCKED' ? first.reason : '',
    };
  }

  function glyph(state) { if (state === 'PASS') return '✓'; if (state === 'BLOCKED') return '✕'; if (state === 'WAITING') return '…'; if (state === 'NOT_REACHED') return '○'; return '?'; }
  function formatAutonomyBuildTrack(track) {
    if (!track || !Array.isArray(track.gates)) return '';
    const compact = track.gates.filter((item) => AUTONOMY_GATES.includes(String(item?.id || '')))
      .map((item) => `${String(item.id).replaceAll('_', ' ')} ${glyph(String(item.state || 'UNKNOWN'))}`).join('  →  ');
    return track.blocker ? `${compact}  ·  ${track.blocker}` : compact;
  }

  function stateBucket(value) {
    const state = String(value || 'UNKNOWN').toUpperCase();
    if (['OPERATOR_READY_PARKED', 'APPROVAL_REQUIRED', 'AWAITING_OPERATOR_APPROVAL', 'WAITING_FOR_OPERATOR_APPROVAL'].includes(state)) return 'operatorReady';
    if (['PARKED', 'PARKED_EXACT_BLOCKER', 'BLOCKED', 'SAFE_HOLD', 'SURFACE_BLOCKED_FOR_RUN'].includes(state)) return 'parked';
    if (['WAITING', 'WAITING_DEPENDENCY', 'DEPENDENCY_BLOCKED', 'WAITING_PREREQUISITE'].includes(state)) return 'waitingDependency';
    if (['ACTIVE', 'BUILDING', 'RUNNING', 'SELECTED', 'CLAIMED', 'SOURCE_CHANGED', 'TESTED', 'VERIFYING', 'CHECKS_RUNNING', 'REVIEW_REQUIRED', 'REVIEWING'].includes(state)) return 'active';
    if (['ELIGIBLE', 'READY', 'DISCOVERED', 'SELECTABLE', 'QUEUED'].includes(state)) return 'eligible';
    return 'unknown';
  }

  function summarizeProgrammeEstate(projection = {}) {
    const published = projection?.goalEstate;
    if (published?.schemaVersion === 'stephanos.goal-dashboard-estate-summary.v1' && Number.isFinite(Number(published.totalOpenGoals))) {
      return published;
    }
    const goals = (Array.isArray(projection?.goals) ? projection.goals : []).filter((goal) => !/^PR\s*#/i.test(String(goal?.issue || '')));
    const stateCounts = { eligible: 0, active: 0, parked: 0, waitingDependency: 0, operatorReady: 0, unknown: 0 };
    const proofCounts = { current: 0, stale: 0, unknown: 0 };
    for (const goal of goals) {
      stateCounts[stateBucket(goal?.state || goal?.status)] += 1;
      const proof = String(goal?.proofTruth || goal?.proofState || 'UNKNOWN').toUpperCase();
      if (proof === 'CURRENT') proofCounts.current += 1;
      else if (proof === 'STALE') proofCounts.stale += 1;
      else proofCounts.unknown += 1;
    }
    return {
      schemaVersion: 'stephanos.goal-dashboard-estate-summary.browser-fallback.v1', source: 'DASHBOARD_PROJECTION_FALLBACK',
      totalOpenGoals: goals.length, stateCounts, proofCounts,
      goals: goals.map((goal) => ({ goalId: goal.issue || goal.goalId || 'goal', title: goal.title || 'Untitled durable goal', state: String(goal.state || goal.status || 'UNKNOWN').toUpperCase(), bucket: stateBucket(goal?.state || goal?.status), proofTruth: String(goal.proofTruth || 'UNKNOWN').toUpperCase() })),
      truthBoundary: 'Fallback summary uses only the currently rendered projection. Local Shared Workspace estate summary is preferred when published.',
    };
  }

  function estateGradient(summary) {
    const total = Number(summary?.totalOpenGoals || 0);
    if (!total) return 'conic-gradient(rgba(118,137,165,.35) 0 100%)';
    const colors = ['var(--cyan)', 'var(--green)', 'var(--orange)', 'var(--gold)', 'var(--purple)', 'var(--unknown)'];
    let cursor = 0;
    const stops = ESTATE_BUCKETS.map(([key], index) => {
      const start = cursor;
      cursor += (Number(summary?.stateCounts?.[key] || 0) / total) * 100;
      return `${colors[index]} ${start}% ${cursor}%`;
    });
    if (cursor < 100) stops.push(`var(--unknown) ${cursor}% 100%`);
    return `conic-gradient(${stops.join(',')})`;
  }

  function ensureEstateStyles() {
    if (!document?.createElement || !document?.head || document.getElementById?.('goal-estate-graphics-style')) return;
    const style = document.createElement('style');
    style.id = 'goal-estate-graphics-style';
    style.textContent = `
      .goal-estate-command{margin-top:14px;display:grid;grid-template-columns:minmax(250px,.75fr) minmax(0,1.55fr);gap:14px}
      .goal-estate-panel{border:1px solid var(--line);background:linear-gradient(150deg,rgba(10,25,44,.96),rgba(5,14,27,.9));border-radius:22px;box-shadow:var(--shadow);padding:18px;min-width:0}
      .goal-estate-ring-wrap{display:grid;grid-template-columns:160px 1fr;gap:18px;align-items:center}
      .goal-estate-ring{width:150px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;position:relative;box-shadow:0 0 50px rgba(103,232,249,.08)}
      .goal-estate-ring::after{content:"";position:absolute;inset:18px;border-radius:50%;background:linear-gradient(145deg,#071322,#040a14);border:1px solid var(--line)}
      .goal-estate-ring strong{position:relative;z-index:1;font-size:2.25rem;letter-spacing:-.04em}.goal-estate-ring span{position:absolute;z-index:1;margin-top:47px;color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.08em}
      .goal-estate-legend{display:grid;gap:7px}.goal-estate-legend-row{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;color:var(--muted);font-size:.72rem}.goal-estate-legend-row i{width:8px;height:8px;border-radius:99px;background:var(--unknown)}
      .goal-estate-bars{display:grid;gap:9px}.goal-estate-bar{display:grid;grid-template-columns:118px 1fr 42px;gap:9px;align-items:center;font-size:.7rem;color:var(--muted)}.goal-estate-bar-track{height:10px;border:1px solid rgba(255,255,255,.05);border-radius:99px;background:rgba(255,255,255,.035);overflow:hidden}.goal-estate-bar-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cyan),var(--green));min-width:0}.goal-estate-bar:nth-child(3) .goal-estate-bar-fill{background:linear-gradient(90deg,var(--orange),var(--red))}.goal-estate-bar:nth-child(4) .goal-estate-bar-fill{background:linear-gradient(90deg,var(--gold),var(--orange))}.goal-estate-bar:nth-child(5) .goal-estate-bar-fill{background:linear-gradient(90deg,var(--purple),var(--cyan))}.goal-estate-bar:nth-child(6) .goal-estate-bar-fill{background:var(--unknown)}
      .goal-estate-pulse{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px}.goal-estate-pulse div{border:1px solid var(--line);border-radius:13px;padding:11px;background:rgba(255,255,255,.02)}.goal-estate-pulse label{display:block;color:var(--muted);font-size:.6rem;letter-spacing:.08em;text-transform:uppercase}.goal-estate-pulse strong{display:block;margin-top:5px;font-size:1.25rem}
      .autonomy-gate-strip{display:flex;gap:6px;flex-wrap:wrap}.autonomy-gate{border:1px solid var(--line);border-radius:999px;padding:6px 8px;font-size:.62rem;color:var(--muted);background:rgba(255,255,255,.02)}.autonomy-gate[data-state="PASS"]{color:var(--green);border-color:rgba(105,240,174,.35)}.autonomy-gate[data-state="BLOCKED"]{color:var(--red);border-color:rgba(255,107,122,.38)}.autonomy-gate[data-state="WAITING"],.autonomy-gate[data-state="NOT_REACHED"]{color:var(--gold)}
      .goal-estate-mini{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:7px}.goal-estate-mini div{border:1px solid rgba(110,210,255,.12);border-radius:10px;padding:8px 9px;color:var(--muted);font-size:.65rem;overflow:hidden}.goal-estate-mini strong{display:block;color:var(--text);font-size:.68rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.goal-estate-mini span{display:block;margin-top:4px}
      .goal-estate-truth{margin-top:10px;color:var(--muted);font-size:.64rem;line-height:1.45}
      @media(max-width:980px){.goal-estate-command{grid-template-columns:1fr}.goal-estate-pulse{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:560px){.goal-estate-ring-wrap{grid-template-columns:1fr;justify-items:center}.goal-estate-legend{width:100%}.goal-estate-pulse{grid-template-columns:1fr 1fr}.goal-estate-bar{grid-template-columns:90px 1fr 34px}}
    `;
    document.head.appendChild(style);
  }

  function ensureEstatePanel() {
    if (!document?.createElement) return null;
    const existing = document.getElementById?.('goal-estate-command');
    if (existing) return existing;
    const section = document.createElement('section');
    section.id = 'goal-estate-command';
    section.className = 'goal-estate-command';
    section.setAttribute('data-dashboard-page', 'overview');
    const anchor = document.querySelector?.('.kpis');
    if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(section, anchor.nextSibling);
    else document.querySelector?.('main')?.appendChild?.(section);
    return section;
  }

  function renderProgrammeMissionControl(projection = {}) {
    const summary = summarizeProgrammeEstate(projection);
    if (!document?.createElement) return summary;
    ensureEstateStyles();
    const root = ensureEstatePanel();
    if (!root) return summary;
    const total = Number(summary.totalOpenGoals || 0);
    const stateCounts = summary.stateCounts || {};
    const proofCounts = summary.proofCounts || {};
    const percent = (count) => total > 0 ? Math.max(0, Math.min(100, Number(count || 0) / total * 100)) : 0;
    const blockers = Array.isArray(projection?.operatorAttention?.blockers) ? projection.operatorAttention.blockers.length : 0;
    const approvals = (Array.isArray(projection?.operatorAttention?.approvals) ? projection.operatorAttention.approvals : []).filter((item) => item?.requiresOperator === true).length;
    const openPrs = Number(projection?.liveGithubPrCount || 0);
    const queueDepth = projection?.queueDispatcher?.queueDepth;
    const track = projection?.autonomyBuildTrack;
    const gates = Array.isArray(track?.gates) ? track.gates : [];
    const ringLegendColors = ['var(--cyan)', 'var(--green)', 'var(--orange)', 'var(--gold)', 'var(--purple)', 'var(--unknown)'];
    const legend = ESTATE_BUCKETS.map(([key, label], index) => `<div class="goal-estate-legend-row"><i style="background:${ringLegendColors[index]}"></i><span>${escapeHtml(label)}</span><b>${Number(stateCounts[key] || 0)}</b></div>`).join('');
    const bars = ESTATE_BUCKETS.map(([key, label]) => `<div class="goal-estate-bar"><span>${escapeHtml(label)}</span><div class="goal-estate-bar-track"><div class="goal-estate-bar-fill" style="width:${percent(stateCounts[key]).toFixed(1)}%"></div></div><b>${Number(stateCounts[key] || 0)}</b></div>`).join('');
    const gateStrip = gates.length ? gates.map((item) => `<span class="autonomy-gate" data-state="${escapeHtml(String(item.state || 'UNKNOWN').toUpperCase())}" title="${escapeHtml(item.reason || '')}">${escapeHtml(String(item.id || '').replaceAll('_', ' '))} ${glyph(String(item.state || 'UNKNOWN').toUpperCase())}</span>`).join('') : '<span class="autonomy-gate">Native autonomy chain not published</span>';
    const miniGoals = (Array.isArray(summary.goals) ? summary.goals : []).slice(0, 12).map((goal) => `<div><strong>${escapeHtml((goal.goalId || goal.issue || 'Goal') + ' · ' + (goal.title || 'Untitled durable goal'))}</strong><span>${escapeHtml(goal.state || goal.bucket || 'UNKNOWN')} · proof ${escapeHtml(goal.proofTruth || 'UNKNOWN')}</span></div>`).join('');
    root.innerHTML = `
      <article class="goal-estate-panel">
        <div class="panel-title"><strong>Whole goal estate</strong><span>Shared Workspace · no 24/32-card truncation</span></div>
        <div class="goal-estate-ring-wrap">
          <div class="goal-estate-ring" style="background:${estateGradient(summary)}"><strong>${total}</strong><span>open goals</span></div>
          <div class="goal-estate-legend">${legend}</div>
        </div>
        <div class="goal-estate-truth">${escapeHtml(summary.truthBoundary || 'Goal-estate truth comes from the current dashboard projection.')}</div>
      </article>
      <article class="goal-estate-panel">
        <div class="panel-title"><strong>Autonomy build pulse</strong><span>${escapeHtml(track?.currentGate || 'CHAIN UNKNOWN')} · ${escapeHtml(track?.currentState || 'UNKNOWN')}</span></div>
        <div class="goal-estate-pulse">
          <div><label>Open goals</label><strong>${total}</strong></div>
          <div><label>Open PRs</label><strong>${Number.isFinite(openPrs) ? openPrs : '?'}</strong></div>
          <div><label>Queued work</label><strong>${queueDepth ?? '?'}</strong></div>
          <div><label>Blockers / decisions</label><strong>${blockers} / ${approvals}</strong></div>
        </div>
        <div class="autonomy-gate-strip">${gateStrip}</div>
        <div class="goal-estate-bars" style="margin-top:14px">${bars}</div>
        <div class="goal-estate-truth">Proof coverage: CURRENT ${Number(proofCounts.current || 0)} · STALE ${Number(proofCounts.stale || 0)} · UNKNOWN ${Number(proofCounts.unknown || 0)}. Multiplexer/native-autonomy proof remains separate from whether the estate itself is visible.</div>
        <div class="goal-estate-mini">${miniGoals}</div>
      </article>`;
    return summary;
  }

  function setTelemetry(key, value) {
    if (typeof window.setField === 'function') { window.setField(key, value); return; }
    const target = document.querySelector?.(`[data-live-telemetry-field="${key}"]`);
    if (target) target.textContent = String(value ?? '');
  }
  function renderAutonomyBuildTrack(track) {
    const rendered = formatAutonomyBuildTrack(track);
    if (!rendered) return;
    setTelemetry('automation-state', rendered);
    if (track.blocker) setTelemetry('telemetry-blocker', track.blocker);
  }

  function buildProjection({ beacon, ref, issues, nowMs = Date.now() }) {
    const githubHead = safeSha(ref?.object?.sha); const battleBridgeHead = safeSha(beacon?.sourceHead);
    const beaconAgeMs = nowMs - observedMs(beacon?.observedAtUtc);
    const beaconFresh = Number.isFinite(beaconAgeMs) && beaconAgeMs >= 0 && beaconAgeMs <= MAX_BEACON_AGE_MS;
    const exactHeadMatch = Boolean(githubHead && battleBridgeHead && githubHead === battleBridgeHead);
    const complete = beacon?.completeStateAnswerable === true && beacon?.telemetryCompleteness === 'COMPLETE';
    const sourceTruth = exactHeadMatch && beaconFresh && complete ? 'CURRENT' : exactHeadMatch ? 'STALE' : 'CONFLICTING';
    return { sourceTruth, exactHead: githubHead || battleBridgeHead || 'UNKNOWN',
      goals: (Array.isArray(issues) ? issues : []).filter((issue) => !issue?.pull_request).map(issueGoal),
      autonomyBuildTrack: remoteAutonomyBuildTrack(beacon), remoteProjection: { githubHead, battleBridgeHead, exactHeadMatch, beaconFresh, complete } };
  }

  async function fetchJson(url) { const response = await window.fetch(url, { headers: { Accept: 'application/vnd.github+json' } }); if (!response.ok) throw new Error(`REMOTE_GITHUB_HTTP_${response.status}`); return response.json(); }
  async function refreshRemote() {
    if (isLocalHost()) return { skipped: true, reason: 'LOCAL_BACKEND_REMAINS_CANONICAL' };
    const [ref, comments, issues] = await Promise.all([fetchJson(`${API_ROOT}/git/ref/heads/main`), fetchJson(`${API_ROOT}/issues/${BEACON_ISSUE}/comments?per_page=100`), fetchJson(`${API_ROOT}/issues?state=open&per_page=100&sort=updated&direction=desc`)]);
    const beacon = latestBeacon(comments); if (!beacon) throw new Error('REMOTE_BATTLE_BRIDGE_BEACON_MISSING');
    const projection = buildProjection({ beacon, ref, issues });
    if (typeof window.applyProjection === 'function') window.applyProjection(projection, 'remote-github', 'ready');
    if (typeof window.setSourceBadge === 'function') window.setSourceBadge('REMOTE LIVE', projection.sourceTruth);
    setTelemetry('goal-data-source', 'REMOTE GitHub + Battle Bridge health beacon'); setTelemetry('workspace-root', 'local workspace path intentionally private');
    renderAutonomyBuildTrack(projection.autonomyBuildTrack);
    renderProgrammeMissionControl(projection);
    const grid = document.getElementById?.('goal-grid'); if (grid) { grid.setAttribute('data-goal-dashboard-source-state', 'remote-github'); grid.setAttribute('data-goal-dashboard-feed-state', 'ready'); }
    return projection;
  }

  const canonicalApplyProjection = typeof window.applyProjection === 'function' ? window.applyProjection : null;
  if (canonicalApplyProjection) {
    window.applyProjection = function applyProjectionWithAutonomyTrack(projection, ...args) {
      const result = canonicalApplyProjection.call(this, projection, ...args);
      renderAutonomyBuildTrack(projection?.autonomyBuildTrack);
      renderProgrammeMissionControl(projection);
      return result;
    };
  }

  window.__stephanosRemoteGoalDashboardV1 = {
    parseBeaconComment, latestBeacon, remoteAutonomyBuildTrack, formatAutonomyBuildTrack,
    summarizeProgrammeEstate, renderProgrammeMissionControl, buildProjection, refreshRemote,
  };
  if (!isLocalHost()) { window.setTimeout(() => refreshRemote().catch(() => {}), 0); window.setInterval(() => refreshRemote().catch(() => {}), REFRESH_MS); }
})();
