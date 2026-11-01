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

  function isLocalHost() {
    return LOCAL_HOSTS.has(String(window.location?.hostname || '').toLowerCase());
  }

  function canonicalHostedBackendRoute() {
    if (isLocalHost() || typeof window.backendBase !== 'function') return '';
    try {
      const candidate = String(window.backendBase() || '').trim();
      const parsed = candidate ? new URL(candidate) : null;
      const hostname = String(parsed?.hostname || '').toLowerCase();
      if (!parsed || parsed.protocol !== 'https:' || LOCAL_HOSTS.has(hostname)) return '';
      return parsed.origin;
    } catch {
      return '';
    }
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
      return { ...record, ownerCommentAuthenticated:
        comment?.user?.login === 'Cheekyfellastef' && comment?.user?.id === 267490109 };
    } catch {
      return null;
    }
  }

  function latestBeacon(comments) {
    return (Array.isArray(comments) ? comments : [])
      .map(parseBeaconComment)
      // Only GitHub-authenticated owner comments may determine hosted status.
      // A copied public comment, even with a future embedded timestamp, is inert.
      .filter(record => record?.ownerCommentAuthenticated === true)
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

  // Purely informational public health beacon. Never treat remote gate
  // statuses as authorisation for a local worker, source lease or merge.
  function projectRemoteGateLedger(beacon, { head, exactHeadMatch, beaconFresh } = {}) {
    const raw = beacon?.goalBuildGateObservatory;
    if (raw?.schemaVersion !== 'stephanos.public-goal-build-gate-observatory.v1'
      || raw.sourceHead !== head || !Array.isArray(raw.gates) || raw.gates.length !== 23
      || raw.gates.some((g, i) => g?.id !== i + 1)) return null;
    const current = beacon?.ownerCommentAuthenticated === true
      && exactHeadMatch && beaconFresh && raw.observationStatus === 'EVIDENCE_AVAILABLE';
    const gates = raw.gates.map(g => {
      const status = current && ['PASS', 'FAIL', 'WAITING_FOR_PREREQUISITE', 'UNVERIFIED', 'STALE'].includes(g.status)
        ? g.status : g.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'STALE';
      return {
        id: g.id,
        title: String(g.title || '').slice(0, 120),
        owner: String(g.owner || '').slice(0, 110),
        status,
        typedBlocker: status === 'FAIL' ? String(g.typedBlocker || '').slice(0, 160) : '',
        waitingOnGate: Number.isInteger(g.waitingOnGate) ? g.waitingOnGate : null,
        proofRef: /^(?:workspace:status\/(?:stephanos-core-daemon-current|stephanos-native-capacity-current)\.json|workspace:proof\/goal-gate-(?:[1-9]|1[0-9]|2[0-3]))$/.test(String(g.proofRef || ''))
          ? g.proofRef : '',
      };
    });
    const names = ['PASS', 'FAIL', 'WAITING_FOR_PREREQUISITE', 'UNVERIFIED', 'STALE'];
    const counts = Object.fromEntries(names.map(key => [key, gates.filter(g => g.status === key).length]));
    return {
      schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
      diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
      sourceHead: head, observedAtUtc: String(raw.observedAtUtc || ''),
      observationStatus: current ? 'EVIDENCE_AVAILABLE' : raw.observationStatus === 'UNVERIFIED' ? 'UNVERIFIED' : 'STALE',
      gates, counts,
      firstActionableGate: current ? gates.find(g => g.status === 'FAIL')?.id || null : null,
      simultaneousVetoes: current ? gates.filter(g => g.status === 'FAIL').map(g => g.id) : [],
    };
  }

  function buildProjection({ beacon, ref, issues, nowMs = Date.now() }) {
    const githubHead = safeSha(ref?.object?.sha);
    const battleBridgeHead = safeSha(beacon?.sourceHead);
    const ageMs = Math.max(0, nowMs - observedMs(beacon?.observedAtUtc));
    const beaconFresh = Number.isFinite(ageMs) && ageMs <= MAX_BEACON_AGE_MS;
    const exactHeadMatch = Boolean(githubHead && battleBridgeHead && githubHead === battleBridgeHead);
    const complete = beacon?.completeStateAnswerable === true && String(beacon?.freshness || '').toUpperCase() === 'FRESH';
    const sourceTruth = !beaconFresh ? 'STALE' : (!exactHeadMatch ? 'CONFLICTING' : (complete ? 'CURRENT' : 'STALE'));
    const missionWorker = surface(beacon, 'missionWorker');
    const watchdog = surface(beacon, 'workerWatchdog');
    const openIssues = (Array.isArray(issues) ? issues : [])
      .filter((item) => item && !item.pull_request && String(item.state || '').toLowerCase() === 'open')
      .slice(0, 30);
    const goals = openIssues.map(issueGoal);
    const answered = Number(beacon?.telemetry?.answeredSurfaceCount || 0);
    const required = Number(beacon?.telemetry?.requiredSurfaceCount || 0);
    const blockers = Array.isArray(beacon?.blockers) ? beacon.blockers.map(String).slice(0, 12) : [];
    const workerState = String(missionWorker?.state || 'UNPROVEN');
    const watchdogState = String(watchdog?.state || 'UNPROVEN');
    const recentMovement = openIssues.slice(0, 6).map((item) => ({
      title: `#${item.number} ${item.title}`,
      timestampUtc: String(item.updated_at || ''),
      source: 'GitHub issue updated time',
    }));

    return {
      sourceTruth,
      portfolioSource: 'REMOTE_GITHUB_PUBLIC_PROJECTION',
      finalVerdict: sourceTruth === 'CURRENT' ? 'GOAL_DASHBOARD_REMOTE_CURRENT' : 'GOAL_DASHBOARD_REMOTE_DEGRADED',
      goals,
      goalBuildGateObservatory: projectRemoteGateLedger(beacon, { head: battleBridgeHead, exactHeadMatch, beaconFresh }),
      activeLaneCount: null,
      queueDispatcher: {
        dispatcherState: workerState,
        capabilityMode: 'remote-read-only',
      },
      battleBridgeSupervisor: {
        overallState: sourceTruth,
        services: (Array.isArray(beacon?.surfaces) ? beacon.surfaces : []).map((item) => ({
          serviceId: String(item?.id || 'surface'),
          state: String(item?.state || 'UNKNOWN'),
        })),
      },
      currentAgentStates: {
        github: { state: exactHeadMatch ? `main ${githubHead.slice(0, 8)} · Battle Bridge exact-head` : `main ${githubHead.slice(0, 8) || 'unknown'} · source mismatch` },
        stephanos: { state: `Mission Worker ${workerState} · watchdog ${watchdogState}` },
      },
      proofTruth: {
        github: exactHeadMatch ? 'CURRENT' : 'CONFLICTING',
        runtime: required > 0 && answered === required ? 'CURRENT' : 'STALE',
        perGoal: 'UNKNOWN',
      },
      operatorAttention: {
        approvals: [],
        maintenanceActions: [],
        localProofNeeded: [],
        blockers,
        exactNextAction: String(beacon?.nextAutomaticAction || 'Refresh the remote project projection.'),
      },
      recentMovement,
      remoteProjection: {
        schemaVersion: 'stephanos.goal-dashboard-remote-public-projection.v1',
        repository: REPOSITORY,
        observedAtUtc: String(beacon?.observedAtUtc || ''),
        githubHead,
        battleBridgeHead,
        exactHeadMatch,
        beaconFresh,
        beaconAgeMs: ageMs,
        telemetryCompleteness: String(beacon?.telemetryCompleteness || 'UNKNOWN'),
        answeredSurfaceCount: answered,
        requiredSurfaceCount: required,
        missionWorkerState: workerState,
        workerWatchdogState: watchdogState,
        blockerCount: blockers.length,
        readOnly: true,
      },
    };
  }

  async function fetchJson(url, signal) {
    const response = await window.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error(`REMOTE_GITHUB_HTTP_${response.status}`);
    return response.json();
  }

  function setTelemetry(key, value) {
    if (typeof window.setField === 'function') {
      window.setField(key, value);
      return;
    }
    const target = document.querySelector?.(`[data-live-telemetry-field="${key}"]`);
    if (target) target.textContent = String(value ?? '');
  }

  function setBadge(value, truthState) {
    if (typeof window.setSourceBadge === 'function') {
      window.setSourceBadge(value, truthState);
      return;
    }
    setTelemetry('source-badge', value);
  }

  function applyRemoteProjection(projection) {
    const remote = projection.remoteProjection;
    const feedState = projection.sourceTruth === 'CURRENT' ? 'ready' : 'stale';
    if (typeof window.applyProjection === 'function') {
      window.applyProjection(projection, 'remote-github', feedState);
    } else if (typeof window.renderGoals === 'function') {
      window.renderGoals(projection.goals, 'remote-github');
    }

    setBadge(projection.sourceTruth === 'CURRENT' ? 'REMOTE LIVE' : 'REMOTE DEGRADED', projection.sourceTruth);
    setTelemetry('goal-data-source', 'REMOTE GitHub + Battle Bridge health beacon · read-only');
    setTelemetry('github-state', remote.exactHeadMatch
      ? `main ${remote.githubHead.slice(0, 8)} · Battle Bridge exact-head`
      : `main ${remote.githubHead.slice(0, 8) || 'unknown'} · Battle Bridge ${remote.battleBridgeHead.slice(0, 8) || 'unknown'}`);
    setTelemetry('automation-state', `Mission Worker ${remote.missionWorkerState} · watchdog ${remote.workerWatchdogState}`);
    setTelemetry('proof-state', `Runtime surfaces ${remote.answeredSurfaceCount}/${remote.requiredSurfaceCount} proven · per-goal proof UNKNOWN`);
    setTelemetry('feed-endpoint', 'GitHub public projection + Battle Bridge beacon #1889');
    setTelemetry('last-refresh', `Remote evidence ${remote.observedAtUtc || 'timestamp unavailable'}`);
    setTelemetry('workspace-root', 'Sanitized remote projection · local workspace path intentionally private');
    setTelemetry('telemetry-blocker', projection.operatorAttention.blockers.length
      ? projection.operatorAttention.blockers.join(' · ')
      : 'No remote blocker published.');

    const grid = document.getElementById?.('goal-grid');
    if (grid?.setAttribute) {
      grid.setAttribute('data-goal-dashboard-source-state', 'remote-github');
      grid.setAttribute('data-goal-dashboard-feed-state', feedState);
    }
    window.__stephanosGoalDashboardProjection = projection;
    window.__stephanosGoalDashboardRemote = {
      state: feedState,
      refreshedAtUtc: new Date().toISOString(),
      ...remote,
    };
  }

  function markRemoteUnavailable(error) {
    const reason = String(error?.message || error || 'REMOTE_GITHUB_PROJECTION_UNAVAILABLE').slice(0, 180);
    setBadge('REMOTE UNAVAILABLE', 'UNAVAILABLE');
    setTelemetry('goal-data-source', 'Remote GitHub projection unavailable · safe fallback retained');
    setTelemetry('github-state', 'Remote GitHub truth unavailable');
    setTelemetry('automation-state', 'Remote automation truth unavailable');
    setTelemetry('proof-state', 'Evidence unavailable from remote projection');
    setTelemetry('feed-endpoint', 'GitHub public projection unavailable');
    setTelemetry('last-refresh', 'Remote refresh failed');
    setTelemetry('workspace-root', 'Local workspace is intentionally not exposed to remote browsers');
    setTelemetry('telemetry-blocker', reason);
    window.__stephanosGoalDashboardRemote = { state: 'error', blocker: reason };
  }

  async function refreshRemote() {
    if (isLocalHost()) return { skipped: true, reason: 'LOCAL_BACKEND_REMAINS_CANONICAL' };
    const canonicalBackend = canonicalHostedBackendRoute();
    if (canonicalBackend) {
      return {
        skipped: true,
        reason: 'CANONICAL_HOSTED_BACKEND_REMAINS_CANONICAL',
        backendBase: canonicalBackend,
      };
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const [ref, comments, issues] = await Promise.all([
        fetchJson(`${API_ROOT}/git/ref/heads/main`, controller.signal),
        fetchJson(`${API_ROOT}/issues/${BEACON_ISSUE}/comments?per_page=30`, controller.signal),
        fetchJson(`${API_ROOT}/issues?state=open&per_page=100&sort=updated&direction=desc`, controller.signal),
      ]);
      const beacon = latestBeacon(comments);
      if (!beacon) throw new Error('REMOTE_BATTLE_BRIDGE_BEACON_NOT_FOUND');
      const projection = buildProjection({ beacon, ref, issues });
      applyRemoteProjection(projection);
      return projection;
    } catch (error) {
      markRemoteUnavailable(error);
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  window.__stephanosRemoteGoalDashboardV1 = Object.freeze({
    parseBeaconComment,
    latestBeacon,
    buildProjection,
    canonicalHostedBackendRoute,
    refreshRemote,
  });

  if (!isLocalHost()) {
    window.setTimeout(refreshRemote, 0);
    window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshRemote();
    }, REFRESH_MS);
  }
})();
