function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asTimestamp(value) {
  const text = asText(value);
  if (!text) return '';
  return Number.isNaN(Date.parse(text)) ? '' : text;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function statusRank(status = 'unknown') {
  if (status === 'blocked') return 6;
  if (status === 'degraded') return 5;
  if (status === 'flowing') return 4;
  if (status === 'started') return 3;
  if (status === 'not_started') return 2;
  if (status === 'unavailable') return 1;
  return 0;
}

function pickTopSeverity(entries = []) {
  return [...entries].sort((a, b) => statusRank(asText(b?.status).toLowerCase()) - statusRank(asText(a?.status).toLowerCase()))[0] || null;
}

function summarizeTransition(entry = {}) {
  const subsystem = asText(entry?.subsystem, 'SYSTEM');
  const change = asText(entry?.change || entry?.label || entry?.event, 'transition observed');
  return `${subsystem}: ${change}`;
}

function buildTelemetryStatus({ eventCount, recentEventCount, blockers, warnings, unavailable }) {
  if (unavailable) return 'unavailable';
  if (blockers.length > 0) return 'blocked';
  if (eventCount === 0) return 'not_started';
  if (recentEventCount === 0) return warnings.length > 0 ? 'degraded' : 'started';
  if (warnings.length > 0) return 'degraded';
  return recentEventCount >= 2 ? 'flowing' : 'started';
}

export function buildTelemetrySummary({
  telemetryEntries = [],
  telemetryAvailable = true,
  agentTaskLifecycle = null,
  lifecycleEntries = [],
  now = Date.now(),
  recentWindowMs = 15 * 60 * 1000,
  seededData = false,
} = {}) {
  const events = asArray(telemetryEntries)
    .map((entry, index) => ({
      id: asText(entry?.id, `telemetry-${index + 1}`),
      subsystem: asText(entry?.subsystem, 'SYSTEM'),
      change: asText(entry?.change || entry?.label || entry?.event, 'transition observed'),
      reason: asText(entry?.reason),
      impact: asText(entry?.impact),
      status: asText(entry?.status).toLowerCase(),
      timestamp: asTimestamp(entry?.timestamp),
      nextAction: asText(entry?.nextAction || entry?.nextRecommendedAction),
    }))
    .filter((entry) => entry.change.length > 0);

  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const recentEvents = events.filter((entry) => {
    const parsed = Date.parse(entry.timestamp);
    return Number.isFinite(parsed) && parsed >= (nowMs - Math.max(60_000, asNumber(recentWindowMs, 15 * 60 * 1000)));
  });

  const transitionSource = recentEvents.length > 0 ? recentEvents : events;
  const recentTransitions = transitionSource.slice(-3).reverse().map((entry) => summarizeTransition(entry));
  const blockers = events
    .filter((entry) => entry.status === 'blocked')
    .map((entry) => `${entry.subsystem}: ${entry.reason || entry.change}`)
    .slice(0, 3);
  const warnings = events
    .filter((entry) => ['failed', 'error', 'degraded'].includes(entry.status) || entry.status === 'warning')
    .map((entry) => `${entry.subsystem}: ${entry.reason || entry.impact || entry.change}`)
    .slice(0, 3);
  const topSignal = recentTransitions[0] || (events.length > 0 ? summarizeTransition(events[events.length - 1]) : 'No telemetry events yet.');
  const topWarning = warnings[0] || blockers[0] || '';
  const status = buildTelemetryStatus({
    eventCount: events.length,
    recentEventCount: recentEvents.length,
    blockers,
    warnings,
    unavailable: telemetryAvailable !== true,
  });
  const lifecycleSignals = asArray(lifecycleEntries)
    .map((entry) => asText(entry))
    .filter(Boolean);
  const derivedLifecycleSignals = events
    .filter((entry) => /(agent|task|lifecycle|handoff|verification)/i.test(`${entry.subsystem} ${entry.change} ${entry.reason}`))
    .map((entry) => summarizeTransition(entry));
  const taskLifecycleState = asText(agentTaskLifecycle?.phase || agentTaskLifecycle?.lifecycleState || agentTaskLifecycle?.status, '').toLowerCase();
  const lifecycleTransitions = [...lifecycleSignals, ...derivedLifecycleSignals].slice(0, 8);
  const recentLifecycleEventCount = recentEvents.filter((entry) => /(agent|task|lifecycle|handoff|verification)/i.test(`${entry.subsystem} ${entry.change} ${entry.reason}`)).length;
  const lifecycleEventCount = lifecycleTransitions.length;
  const lifecycleBindingEvidence = [];
  if (lifecycleSignals.length > 0) lifecycleBindingEvidence.push(`event-stream-derived:${lifecycleSignals.length}`);
  if (derivedLifecycleSignals.length > 0) lifecycleBindingEvidence.push(`telemetry-derived:${derivedLifecycleSignals.length}`);
  if (taskLifecycleState) lifecycleBindingEvidence.push(`projection-derived:${taskLifecycleState}`);
  const topLifecycleSignal = lifecycleTransitions[0] || (taskLifecycleState ? `Agent Task lifecycle (projection): ${taskLifecycleState}` : '');
  let lifecycleBindingStatus = 'unknown';
  if (telemetryAvailable !== true) lifecycleBindingStatus = 'unknown';
  else if (!taskLifecycleState && lifecycleEventCount === 0) lifecycleBindingStatus = 'missing';
  else if (lifecycleSignals.length > 0 || recentLifecycleEventCount > 0) lifecycleBindingStatus = 'bound';
  else if (taskLifecycleState) lifecycleBindingStatus = 'partial';
  else if (events.length > 0 && lifecycleEventCount === 0) lifecycleBindingStatus = 'degraded';
  const agentTaskLifecycleBound = lifecycleBindingStatus === 'bound' || lifecycleBindingStatus === 'partial';
  const lifecycleBindingNextAction = lifecycleBindingStatus === 'missing'
    ? 'Bind telemetry summary to agent/task lifecycle transitions (no lifecycle signals detected).'
    : lifecycleBindingStatus === 'partial'
      ? 'Promote projection-derived lifecycle evidence to event-stream lifecycle telemetry.'
      : lifecycleBindingStatus === 'degraded'
        ? 'Repair lifecycle telemetry tags so mission lifecycle transitions are observable.'
        : 'Lifecycle telemetry binding is present.';

  const readinessScore = telemetryAvailable !== true
    ? 10
    : status === 'flowing'
      ? 82
      : status === 'started'
        ? 62
        : status === 'degraded'
          ? 46
          : status === 'blocked'
            ? 30
            : status === 'not_started'
              ? 25
              : 15;

  const nextActions = [];
  if (telemetryAvailable !== true) {
    nextActions.push('Restore telemetry feed wiring for Mission Console surfaces.');
  } else if (lifecycleBindingStatus === 'missing') {
    nextActions.push('Bind telemetry summary to agent/task lifecycle transitions.');
  } else if (lifecycleBindingStatus === 'partial') {
    nextActions.push('Upgrade lifecycle telemetry from projection-derived to event-stream-derived evidence.');
  } else if (recentEvents.length === 0) {
    nextActions.push('Emit fresh telemetry transitions from current mission lifecycle.');
  } else if (blockers.length > 0) {
    nextActions.push('Resolve telemetry blockers before relying on automation readiness.');
  } else if (warnings.length > 0) {
    nextActions.push('Reduce telemetry warning noise and preserve lifecycle-critical signals.');
  } else {
    nextActions.push('Bind telemetry summary to agent/task lifecycle for completion adjudication.');
  }

  const lastEventAt = events.length > 0 ? events[events.length - 1].timestamp : '';
  const lastLifecycleEventAt = recentLifecycleEventCount > 0
    ? recentEvents.filter((entry) => /(agent|task|lifecycle|handoff|verification)/i.test(`${entry.subsystem} ${entry.change} ${entry.reason}`)).slice(-1)[0]?.timestamp || ''
    : '';
  const evidence = [];
  if (events.length > 0) {
    evidence.push(`Telemetry feed captured ${events.length} event(s).`);
  }
  if (recentEvents.length > 0) {
    evidence.push(`${recentEvents.length} event(s) observed within recent window.`);
  }
  if (lifecycleBindingEvidence.length > 0) {
    evidence.push(`Lifecycle binding evidence: ${lifecycleBindingEvidence.join(', ')}.`);
  }
  if (seededData) {
    evidence.push('Telemetry evidence includes seeded/static data.');
  }

  const dashboardSummaryText = telemetryAvailable !== true
    ? 'Telemetry summary unavailable because telemetry feed is not reachable from this session.'
    : `${status === 'flowing' ? 'Telemetry is flowing.' : `Telemetry status is ${status}.`} ${topSignal}`;
  const compactSummaryText = `Telemetry ${status} · events ${events.length} · recent ${recentEvents.length}${topWarning ? ` · warn ${topWarning}` : ''}`;

  return {
    systemId: 'telemetry',
    label: 'Telemetry',
    status,
    readinessScore,
    eventCount: events.length,
    recentEventCount: recentEvents.length,
    recentTransitions,
    agentTaskLifecycleBound,
    lifecycleEventCount,
    recentLifecycleEventCount,
    lastLifecycleEventAt,
    lifecycleTransitions,
    taskLifecycleSignals: lifecycleBindingEvidence,
    topLifecycleSignal,
    lifecycleBindingStatus,
    lifecycleBindingNextAction,
    lifecycleBindingEvidence,
    lastEventAt,
    topSignal,
    topWarning,
    blockers,
    warnings,
    nextActions,
    evidence,
    dashboardSummaryText,
    compactSummaryText,
  };
}
