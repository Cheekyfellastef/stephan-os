import React from 'react';

const knownProvider = (provider) => {
  const value = String(provider || '').trim();
  return value && !['unknown', 'none', 'pending', 'unavailable', 'n/a'].includes(value.toLowerCase())
    ? value.toUpperCase()
    : '';
};

export function MeaningStrip({ finalRouteTruth, memoryMode = '', lastExecutionMetadata = null }) {
  if (!finalRouteTruth) {
    return (
      <div className="meaning-strip error">
        ⚠️ NO RUNTIME TRUTH AVAILABLE
      </div>
    );
  }

  const {
    routeKind,
    backendReachableState,
    currentBackendHealthFresh,
    routeTruthHealthSource,
    selectedProvider,
    executedProvider,
    fallbackActive,
    routeLayerStatus,
    backendExecutionContractStatus,
    providerExecutionGateStatus,
  } = finalRouteTruth;

  // The canonical route projection uses a tri-state, not the legacy backendReachable boolean.
  // Unknown reachability must not be rendered as a confirmed backend outage.
  const freshVerifiedBackend = String(currentBackendHealthFresh || '').toLowerCase() === 'yes'
    && !['stale-route-candidate', 'unknown', 'unavailable'].includes(String(routeTruthHealthSource || '').toLowerCase());
  const systemState = !freshVerifiedBackend
    ? '🟠 BACKEND UNVERIFIED'
    : backendReachableState === 'yes'
      ? '🟢 BACKEND REACHABLE'
      : backendReachableState === 'no'
        ? '🔴 BACKEND UNREACHABLE FROM UI'
        : '🟠 BACKEND UNVERIFIED';

  const routeState = routeKind && routeKind !== 'unavailable'
    ? `📡 ROUTE: ${routeKind.toUpperCase()}`
    : '📡 ROUTE: UNKNOWN';

  // Selection is not proof of execution. Show which provider is selected when
  // the latest executed provider is not confirmed, without inventing a successful run.
  const selected = knownProvider(selectedProvider);
  // Route projection may be executable/healthy on startup without a request.
  // Only an actual request execution receipt may justify "EXECUTION RECORDED".
  const recordedExecution = knownProvider(lastExecutionMetadata?.actual_provider_used);
  const aiState = recordedExecution
    ? `🧠 AI: ${recordedExecution} (EXECUTION RECORDED${selected && selected !== recordedExecution ? `; ${selected} SELECTED` : ''})`
    : selected
      ? `🧠 AI: ${selected} (SELECTED)`
      : '🧠 AI: UNVERIFIED';

  const fallbackState = fallbackActive === true
    ? '⚠️ FALLBACK ACTIVE'
    : '✅ NO FALLBACK';

  const resolvedMemoryMode = String(memoryMode || finalRouteTruth.memoryMode || '').trim();
  const memoryState = resolvedMemoryMode
    ? `💾 MEMORY: ${resolvedMemoryMode.toUpperCase()}`
    : '💾 MEMORY: UNKNOWN';

  const operatorBoundaryState = routeLayerStatus === 'healthy' && backendExecutionContractStatus === 'stale-or-incomplete'
    ? '🛠️ ROUTE HEALTHY · BACKEND CONTRACT STALE'
    : providerExecutionGateStatus === 'route-blocked'
      ? '🚧 ROUTE ISSUE'
      : '🧭 BOUNDARY: STABLE';

  return (
    <div className="meaning-strip">
      {systemState} | {aiState} | {routeState} | {fallbackState} | {memoryState} | {operatorBoundaryState}
    </div>
  );
}

export default MeaningStrip;
