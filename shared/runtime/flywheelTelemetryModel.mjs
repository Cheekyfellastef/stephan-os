export const FLYWHEEL_FEED_SCHEMA_VERSION = 'stephanos.shared-workspace-dashboard-feed.v1';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = 'UNKNOWN') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function count(value) {
  return asArray(value).length;
}

function shortHead(value = '') {
  const normalized = text(value);
  return /^[0-9a-f]{40}$/i.test(normalized) ? normalized.slice(0, 8) : normalized;
}

export function deriveFlywheelTelemetryView(payload = {}) {
  const projection = payload?.projection;
  const feedState = String(payload?.state || '').toLowerCase();
  const valid = payload?.schemaVersion === FLYWHEEL_FEED_SCHEMA_VERSION
    && projection
    && typeof projection === 'object'
    && !Array.isArray(projection)
    && Array.isArray(projection.goals)
    && ['ready', 'stale'].includes(feedState);

  if (!valid) {
    return {
      valid: false,
      feedState: 'unavailable',
      statusLabel: 'BACKEND UNREACHABLE',
      reason: text(payload?.reason, 'Live Flywheel telemetry is unavailable.'),
      stateItems: [],
      metrics: [],
      exactNextAction: 'Restore the shared workspace telemetry feed.',
    };
  }

  const queue = projection.queueDispatcher || {};
  const bridge = projection.captainsBridge || {};
  const build = bridge.buildOrchestration || {};
  const merge = bridge.mergePipeline || {};
  const runtime = bridge.runtimeHealth || {};
  const capability = projection.openClawCapabilityLadder || {};
  const attention = projection.operatorAttention || {};
  const portfolio = payload.livePortfolio || {};
  const goals = projection.goals;
  const blockers = asArray(attention.blockers);
  const runnable = asArray(capability.canRunNow);
  const blockedCapacity = asArray(capability.blocked);
  const githubEvidenceSource = text(portfolio.source || projection.portfolioSource, 'UNKNOWN').toUpperCase();
  const githubEvidenceAvailable = /LIVE_GITHUB/.test(githubEvidenceSource);
  const openPrCount = githubEvidenceAvailable
    ? (portfolio.githubOpenPrCount ?? projection.liveGithubPrCount ?? 'UNKNOWN')
    : 'UNKNOWN';
  const currentJob = text(queue.currentJob, 'No current job published');
  const selectedGoal = text(build.selectedGoal, currentJob);

  return {
    valid: true,
    feedState,
    statusLabel: feedState === 'ready' ? 'LIVE' : 'STALE',
    reason: text(payload.reason, feedState === 'ready' ? 'Shared workspace telemetry is current.' : 'Shared workspace telemetry needs refreshing.'),
    exactNextAction: text(
      attention.exactNextAction || bridge.exactNextAction || payload.exactNextAction,
      'No operator action is currently published.',
    ),
    stateItems: [
      {
        id: 'goal-conveyor',
        label: 'Goal Conveyor',
        source: 'queueDispatcher',
        value: currentJob,
        summary: `${text(queue.dispatcherState)} · depth ${queue.queueDepth ?? 'UNKNOWN'} · ${text(queue.capabilityMode)}`,
      },
      {
        id: 'current-build',
        label: 'Current Build',
        source: 'captainsBridge.buildOrchestration',
        value: selectedGoal,
        summary: `${text(build.phase)} · actor ${text(build.actor)} · lane ${text(build.selectedLane)}`,
      },
      {
        id: 'merge-pipeline',
        label: 'Merge Pipeline',
        source: 'captainsBridge.mergePipeline',
        value: merge.prNumber ? `PR #${merge.prNumber}` : 'No active PR published',
        summary: `${text(merge.phase)} · head ${shortHead(merge.headSha)} · ${text(merge.finalVerdict)}`,
      },
      {
        id: 'runtime-health',
        label: 'Runtime Health',
        source: 'captainsBridge.runtimeHealth',
        value: text(runtime.overallTrafficLight),
        summary: `${count(runtime.services)} service health projections`,
      },
      {
        id: 'openclaw-capacity',
        label: 'OpenClaw Capacity',
        source: 'openClawCapabilityLadder',
        value: `${runnable.length} runnable`,
        summary: `${blockedCapacity.length} blocked · ${count(capability.needsApproval)} approval-gated`,
      },
      {
        id: 'next-action',
        label: 'Next Action',
        source: 'operatorAttention',
        value: text(attention.exactNextAction || bridge.exactNextAction || payload.exactNextAction, 'No action published'),
        summary: blockers.length ? `${blockers.length} blocker(s) published` : 'No blocker is explicitly published.',
      },
    ],
    metrics: [
      { label: 'Goals in Feed', value: String(goals.length), detail: 'Canonical goals currently projected by the shared workspace.' },
      { label: 'Queue Depth', value: String(queue.queueDepth ?? 'UNKNOWN'), detail: text(queue.dispatcherState, 'Queue state unknown') },
      { label: 'Open PRs', value: String(openPrCount), detail: text(portfolio.source || projection.portfolioSource, 'GitHub source unavailable') },
      { label: 'Blockers', value: String(blockers.length), detail: blockers.length ? blockers.slice(0, 3).map((item) => text(item)).join(' · ') : 'No blockers published.' },
      { label: 'Runnable Capacity', value: String(runnable.length), detail: runnable.length ? runnable.slice(0, 3).map((item) => text(item)).join(' · ') : 'No runnable OpenClaw capacity published.' },
      { label: 'Live Services', value: String(count(runtime.services)), detail: `Runtime traffic light: ${text(runtime.overallTrafficLight)}` },
    ],
  };
}
