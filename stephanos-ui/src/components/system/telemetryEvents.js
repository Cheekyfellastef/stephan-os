const DEFAULT_MAX_HISTORY = 50;

function readProviderExecutionField(finalRouteTruth = {}, field) {
  if (finalRouteTruth.providerExecution && typeof finalRouteTruth.providerExecution === 'object') {
    const nestedValue = finalRouteTruth.providerExecution[field];
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }
  return finalRouteTruth[field];
}

function asBoolLabel(value, trueLabel, falseLabel) {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return 'unknown';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const arrayValue = firstNonEmpty(...value);
      if (arrayValue) {
        return arrayValue;
      }
      continue;
    }
    const normalized = String(value ?? '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function createEvent({ subsystem, change, reason = null, impact = null, timestamp, field, from, to }) {
  return {
    id: `${subsystem.toLowerCase()}-${field}-${String(from)}-${String(to)}-${timestamp}`,
    timestamp,
    subsystem,
    change,
    reason,
    impact,
  };
}

function pushTransitionEvent(events, { previousTruth, currentTruth, field, subsystem, buildChange, reason, impact, timestamp }) {
  const previousValue = field(previousTruth);
  const currentValue = field(currentTruth);

  if (previousValue === currentValue) {
    return;
  }

  events.push(createEvent({
    subsystem,
    change: buildChange(previousValue, currentValue),
    reason,
    impact,
    timestamp,
    field: subsystem.toLowerCase(),
    from: previousValue,
    to: currentValue,
  }));
}

export function createTelemetryBaselineEvent(finalRouteTruth = {}, timestamp = new Date().toISOString()) {
  return createEvent({
    subsystem: 'SYSTEM',
    change: 'Telemetry baseline established',
    reason: firstNonEmpty(finalRouteTruth.winningReason, finalRouteTruth.selectedRouteReason),
    impact: firstNonEmpty(finalRouteTruth.operatorGuidance, finalRouteTruth.operatorAction),
    timestamp,
    field: 'baseline',
    from: 'none',
    to: 'active',
  });
}

export function extractTelemetryEvents(previousTruth, currentTruth, timestamp = new Date().toISOString()) {
  if (!previousTruth || !currentTruth) {
    return [];
  }

  const events = [];
  const routeReason = firstNonEmpty(currentTruth.winningReason, currentTruth.selectedRouteReason);
  const fallbackReason = firstNonEmpty(currentTruth.fallbackReason);
  const providerReason = firstNonEmpty(currentTruth.providerReason, readProviderExecutionField(currentTruth, 'providerReason'));
  const operatorImpact = firstNonEmpty(currentTruth.operatorGuidance, currentTruth.operatorAction, currentTruth.actionText);

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => truth.routeKind,
    subsystem: 'ROUTE',
    buildChange: (before, after) => `${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: routeReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => truth.backendReachable,
    subsystem: 'BACKEND',
    buildChange: (before, after) => `${asBoolLabel(before, 'reachable', 'unreachable')} → ${asBoolLabel(after, 'reachable', 'unreachable')}`,
    reason: routeReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => truth.fallbackActive,
    subsystem: 'FALLBACK',
    buildChange: (before, after) => `${asBoolLabel(before, 'active', 'inactive')} → ${asBoolLabel(after, 'active', 'inactive')}`,
    reason: fallbackReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => readProviderExecutionField(truth, 'selectedProvider'),
    subsystem: 'PROVIDER',
    buildChange: (before, after) => `selected ${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: providerReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => readProviderExecutionField(truth, 'executableProvider'),
    subsystem: 'PROVIDER',
    buildChange: (before, after) => `executable ${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: providerReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => readProviderExecutionField(truth, 'requestedProvider'),
    subsystem: 'PROVIDER',
    buildChange: (before, after) => `requested ${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: providerReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => readProviderExecutionField(truth, 'providerHealthState'),
    subsystem: 'PROVIDER',
    buildChange: (before, after) => `health ${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: providerReason,
    impact: operatorImpact,
    timestamp,
  });

  pushTransitionEvent(events, {
    previousTruth,
    currentTruth,
    field: (truth) => truth.memoryMode,
    subsystem: 'MEMORY',
    buildChange: (before, after) => `${before ?? 'unknown'} → ${after ?? 'unknown'}`,
    reason: firstNonEmpty(currentTruth.memoryReason),
    impact: operatorImpact,
    timestamp,
  });

  return events;
}

export function appendTelemetryHistory(existingEvents = [], incomingEvents = [], maxHistory = DEFAULT_MAX_HISTORY) {
  const safeExistingEvents = Array.isArray(existingEvents) ? existingEvents : [];
  const safeIncomingEvents = Array.isArray(incomingEvents) ? incomingEvents : [];
  if (safeIncomingEvents.length === 0) {
    return safeExistingEvents;
  }
  return [...safeIncomingEvents, ...safeExistingEvents].slice(0, maxHistory);
}

export const TELEMETRY_MAX_HISTORY = DEFAULT_MAX_HISTORY;
