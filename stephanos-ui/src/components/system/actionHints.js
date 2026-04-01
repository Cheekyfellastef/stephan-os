const DEGRADED_PROVIDER_HEALTH = new Set(['UNKNOWN', 'ERROR', 'DISCONNECTED', 'DEGRADED', 'UNHEALTHY', 'OFFLINE']);
const DEGRADED_MEMORY_MODES = new Set(['local', 'degraded']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

export function getActionHints(finalRouteTruth) {
  if (!finalRouteTruth || typeof finalRouteTruth !== 'object') {
    return [];
  }

  const hints = [];
  const seen = new Set();

  const addHint = ({ id, severity = 'info', subsystem = 'SYSTEM', text }) => {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return;
    }

    const dedupeKey = `${normalizeUpper(subsystem)}::${normalizedText.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    hints.push({
      id: normalizeText(id) || `hint-${hints.length + 1}`,
      severity,
      subsystem: normalizeUpper(subsystem) || 'SYSTEM',
      text: normalizedText,
    });
  };

  const backendReachable = finalRouteTruth.backendReachable;
  const routeKind = normalizeLower(finalRouteTruth.routeKind);
  const fallbackActive = finalRouteTruth.fallbackActive === true;
  const memoryMode = normalizeLower(finalRouteTruth.memoryMode);
  const providerExecution = finalRouteTruth.providerExecution && typeof finalRouteTruth.providerExecution === 'object'
    ? finalRouteTruth.providerExecution
    : {};

  const requestedProvider = normalizeLower(providerExecution.requestedProvider);
  const executableProvider = normalizeLower(providerExecution.executableProvider);
  const providerHealthState = normalizeUpper(providerExecution.providerHealthState);

  if (backendReachable === false) {
    addHint({
      id: 'backend-unreachable',
      severity: 'critical',
      subsystem: 'BACKEND',
      text: 'Check backend health endpoint and local backend availability',
    });
  }

  if (backendReachable === false && (routeKind === 'dist' || routeKind === 'unavailable')) {
    addHint({
      id: 'route-fallback-review',
      severity: 'warning',
      subsystem: 'ROUTE',
      text: 'Review route fallback path and confirm expected local/cloud target',
    });
  }

  if (requestedProvider && executableProvider && requestedProvider !== executableProvider) {
    addHint({
      id: 'provider-mismatch',
      severity: 'warning',
      subsystem: 'PROVIDER',
      text: 'Requested provider is not executing. Check provider health and fallback cause',
    });
  }

  if (providerHealthState && DEGRADED_PROVIDER_HEALTH.has(providerHealthState)) {
    addHint({
      id: 'provider-health-degraded',
      severity: providerHealthState === 'ERROR' || providerHealthState === 'DISCONNECTED' ? 'critical' : 'warning',
      subsystem: 'PROVIDER',
      text: 'Validate provider connectivity and model availability',
    });
  }

  if (executableProvider === 'mock') {
    addHint({
      id: 'provider-mock-active',
      severity: 'warning',
      subsystem: 'PROVIDER',
      text: 'System is using mock provider. Restore live provider connectivity if this is not intentional',
    });
  }

  if (fallbackActive) {
    addHint({
      id: 'fallback-active',
      severity: 'warning',
      subsystem: 'FALLBACK',
      text: 'Fallback is active. Review telemetry feed for trigger sequence and reason',
    });
  }

  if (DEGRADED_MEMORY_MODES.has(memoryMode)) {
    addHint({
      id: 'memory-degraded',
      severity: memoryMode === 'degraded' ? 'warning' : 'info',
      subsystem: 'MEMORY',
      text: 'Shared memory is not fully active. Confirm memory backend and cross-surface persistence',
    });
  }

  if (routeKind === 'unavailable') {
    addHint({
      id: 'route-unavailable',
      severity: 'critical',
      subsystem: 'ROUTE',
      text: 'No usable route is active. Validate backend reachability and route target selection',
    });
  }

  if (routeKind === 'dist' && backendReachable === false) {
    addHint({
      id: 'route-dist-fallback',
      severity: 'warning',
      subsystem: 'ROUTE',
      text: 'System is running in dist fallback mode. Confirm whether this is expected',
    });
  }

  const passthroughFields = [
    ['operatorGuidance', 'operator-guidance'],
    ['operatorAction', 'operator-action'],
    ['actionText', 'action-text'],
  ];

  passthroughFields.forEach(([fieldName, idSuffix]) => {
    const value = normalizeText(finalRouteTruth[fieldName]);
    if (!value) {
      return;
    }
    addHint({
      id: `system-${idSuffix}`,
      severity: 'info',
      subsystem: 'SYSTEM',
      text: value,
    });
  });

  return hints;
}

export default getActionHints;
