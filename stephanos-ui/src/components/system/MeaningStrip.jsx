import React from 'react';

export function MeaningStrip({ finalRouteTruth }) {
  if (!finalRouteTruth) {
    return (
      <div className="meaning-strip error">
        ⚠️ NO RUNTIME TRUTH AVAILABLE
      </div>
    );
  }

  const {
    routeKind,
    backendReachable,
    providerExecution,
    fallbackActive,
    memoryMode,
  } = finalRouteTruth;

  const systemState = backendReachable === true ? '🟢 SYSTEM HEALTHY' : '🔴 BACKEND OFFLINE';

  const routeState = routeKind
    ? `📡 ROUTE: ${routeKind.toUpperCase()}`
    : '📡 ROUTE: UNKNOWN';

  const aiState = providerExecution?.executableProvider
    ? `🧠 AI: ${providerExecution.executableProvider.toUpperCase()}`
    : '🧠 AI: UNKNOWN';

  const fallbackState = fallbackActive === true
    ? '⚠️ FALLBACK ACTIVE'
    : '✅ NO FALLBACK';

  const memoryState = memoryMode
    ? `💾 MEMORY: ${memoryMode.toUpperCase()}`
    : '💾 MEMORY: UNKNOWN';

  return (
    <div className="meaning-strip">
      {systemState} | {aiState} | {routeState} | {fallbackState} | {memoryState}
    </div>
  );
}

export default MeaningStrip;
