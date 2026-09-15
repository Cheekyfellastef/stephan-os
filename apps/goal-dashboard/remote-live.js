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

  function isLocalHost() {
    return LOCAL_HOSTS.has(String(window.location?.hostname || '').toLowerCase());
  }

  function safeSha(value) {
    const sha = String(value || '').trim().toLowerCase();
    return SHA.test(sha) ? sha : '';
  }

  function observedMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : NaN;
  }

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
    } catch {
      return null;
    }
  }

  function latestBeacon(comments) {
    return (Array.isArray(comments) ? comments : [])
      .map(parseBeaconComment)
      .filter(Boolean)
      .sort((left, right) => observedMs(left.observedAtUtc) - observedMs(right.observedAtUtc))
      .at(-1) || null;
  }

  function issueGoal(issue) {
    const number = Number(issue?.number || 0);
    return {
      issue: number > 0 ? `#${number}` : 'GitHub issue',
      title: String(issue?.title || 'Untitled durable work item'),
      statusTruth: 'CURRENT',
      proofTruth: 'UNKNOWN',
      source: 'github-public-issue',
      exactHead: 'UNKNOWN',
      summary: 'Current open GitHub work item. Runtime/proof state is shown separately and is not inferred from issue presence.',
      blockers: [],
      exactNextAction: 'Use canonical project evidence to determine the next safe build step.',
      updatedAtUtc: String(issue?.updated_at || ''),
    };
  }

  function surface(beacon, id) {
    return (Array.isArray(beacon?.surfaces) ? beacon.surfaces : []).find((item) => item?.id === id) || null;
  }

  function gate(id, state, reason = '') {
    return { id, state, reason: String(reason || '') };
  }

  function remoteAutonomyBuildTrack(beacon) {
    const sync = surface(beacon, 'githubSync');
    const refresh = surface(beacon, 'postSyncRefresh');
    const worker = surface(beacon, 'missionWorker');
    const syncState = String(sync?.state || sync?.rawState || 'UNKNOWN').toUpperCase();
    const refreshBlocker = String(refresh?.blocker || '');
    const syncGate = syncState.startsWith('SYNC_') && !syncState.includes('BLOCK')
      ? gate('SYNC', 'PASS')
      : syncState.includes('BLOCK')
        ? gate('SYNC', 'BLOCKED', syncState)
        : gate('SYNC', 'UNKNOWN', syncState);
    const controlPlaneGate = refreshBlocker.startsWith('CONTROL_PLANE_')
      ? gate('CONTROL_PLANE', 'BLOCKED', refreshBlocker)
      : gate('CONTROL_PLANE', 'UNKNOWN', refreshBlocker || 'CONTROL_PLANE_SIGNAL_NOT_PUBLISHED');
    const stoppedBeforeHeartbeat = controlPlaneGate.state === 'BLOCKED' || syncGate.state === 'BLOCKED';
    const downstream = AUTONOMY_GATES.slice(2).map((id) => gate(id, stoppedBeforeHeartbeat ? 'NOT_REACHED' : 'UNKNOWN'));
    if (!stoppedBeforeHeartbeat && worker) {
      const heartbeat = downstream.find((item) => item.id === 'HEARTBEAT');
      const workerState = String(worker.state || '').toUpperCase();
      if (heartbeat && workerState !== 'STALE' && String(worker.rawState || '').includes('TICK_PASS')) heartbeat.state = 'PASS';
    }
    const gates = [syncGate, controlPlaneGate, ...downstream];
    const first = gates.find((item) => item.state === 'BLOCKED')
      || gates.find((item) => item.state === 'WAITING')
      || gates.find((item) => item.state === 'NOT_REACHED')
      || gates.find((item) => item.state === 'UNKNOWN')
      || null;
    return {
      schemaVersion: 'stephanos.autonomy-build-track.remote.v1',
      timestampUtc: String(beacon?.observedAtUtc || ''),
      sourceHead: safeSha(beacon?.sourceHead),
      gates,
      currentGate: first?.id || 'COMPLETE',
      currentState: first?.state || 'PASS',
      blocker: first?.state === 'BLOCKED' ? first.reason : '',
    };
  }

  function glyph(state) {
    if (state === 'PASS') return '✓';
    if (state === 'BLOCKED') return '✕';
    if (state === 'WAITING') return '…';
    if (state === 'NOT_REACHED') return '○';
    return '?';
  }

  function formatAutonomyBuildTrack(track) {
    if (!track || !Array.isArray(track.gates)) return '';
    const compact = track.gates
      .filter((item) => AUTONOMY_GATES.includes(String(item?.id || '')))
      .map((item) => `${String(item.id).replaceAll('_', ' ')} ${glyph(String(item.state || 'UNKNOWN'))}`)
      .join('  →  ');
    return track.blocker ? `${compact}  ·  ${track.blocker}` : compact;
  }

  function setTelemetry(key, value) {
    if (typeof window.setField === 'function') {
      window.setField(key, value);
      return;
    }
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
    const githubHead = safeSha(ref?.object?.sha);
    const battleBridgeHead = safeSha(beacon?.sourceHead);
    const beaconAgeMs = nowMs - observedMs(beacon?.observedAtUtc);
    const beaconFresh = Number.isFinite(beaconAgeMs) && beaconAgeMs >= 0 && beaconAgeMs <= MAX_BEACON_AGE_MS;
    const exactHeadMatch = Boolean(githubHead && battleBridgeHead && githubHead === battleBridgeHead);
    const complete = beacon?.completeStateAnswerable === true && beacon?.telemetryCompleteness === 'COMPLETE';
    const sourceTruth = exactHeadMatch && beaconFresh && complete ? 'CURRENT' : exactHeadMatch ? 'STALE' : 'CONFLICTING';
    return {
      sourceTruth,
      exactHead: githubHead || battleBridgeHead || 'UNKNOWN',
      goals: (Array.isArray(issues) ? issues : []).filter((issue) => !issue?.pull_request).map(issueGoal),
      autonomyBuildTrack: remoteAutonomyBuildTrack(beacon),
      remoteProjection: { githubHead, battleBridgeHead, exactHeadMatch, beaconFresh, complete },
    };
  }

  async function fetchJson(url) {
    const response = await window.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`REMOTE_GITHUB_HTTP_${response.status}`);
    return response.json();
  }

  async function refreshRemote() {
    if (isLocalHost()) return { skipped: true, reason: 'LOCAL_BACKEND_REMAINS_CANONICAL' };
    const [ref, comments, issues] = await Promise.all([
      fetchJson(`${API_ROOT}/git/ref/heads/main`),
      fetchJson(`${API_ROOT}/issues/${BEACON_ISSUE}/comments?per_page=100`),
      fetchJson(`${API_ROOT}/issues?state=open&per_page=100&sort=updated&direction=desc`),
    ]);
    const beacon = latestBeacon(comments);
    if (!beacon) throw new Error('REMOTE_BATTLE_BRIDGE_BEACON_MISSING');
    const projection = buildProjection({ beacon, ref, issues });
    if (typeof window.applyProjection === 'function') window.applyProjection(projection, 'remote-github', 'ready');
    if (typeof window.setSourceBadge === 'function') window.setSourceBadge('REMOTE LIVE', projection.sourceTruth);
    setTelemetry('goal-data-source', 'REMOTE GitHub + Battle Bridge health beacon');
    setTelemetry('workspace-root', 'local workspace path intentionally private');
    renderAutonomyBuildTrack(projection.autonomyBuildTrack);
    const grid = document.getElementById?.('goal-grid');
    if (grid) {
      grid.setAttribute('data-goal-dashboard-source-state', 'remote-github');
      grid.setAttribute('data-goal-dashboard-feed-state', 'ready');
    }
    return projection;
  }

  window.__stephanosRemoteGoalDashboardV1 = {
    parseBeaconComment,
    latestBeacon,
    remoteAutonomyBuildTrack,
    formatAutonomyBuildTrack,
    buildProjection,
    refreshRemote,
  };

  if (!isLocalHost()) {
    window.setTimeout(() => refreshRemote().catch(() => {}), 0);
    window.setInterval(() => refreshRemote().catch(() => {}), REFRESH_MS);
  }
})();
