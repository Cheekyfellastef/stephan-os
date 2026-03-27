function normalizeMarker(value) {
  const marker = String(value ?? '').trim();
  return marker || null;
}

function normalizeTimestamp(value) {
  const timestamp = String(value ?? '').trim();
  return timestamp || null;
}

export function resolveStephanosLaunchEntry(target = {}) {
  if (!target || typeof target !== 'object') {
    return { resolvedEntry: null, source: 'missing' };
  }

  const launchEntry = normalizeMarker(target.launchEntry);
  if (launchEntry) {
    return { resolvedEntry: launchEntry, source: 'launchEntry' };
  }

  const runtimeEntry = normalizeMarker(target.runtimeEntry);
  if (runtimeEntry) {
    return { resolvedEntry: runtimeEntry, source: 'runtimeEntry' };
  }

  const compatibilityEntry = normalizeMarker(target.entry);
  if (compatibilityEntry) {
    return { resolvedEntry: compatibilityEntry, source: 'entry' };
  }

  return { resolvedEntry: null, source: 'missing' };
}

export function createBuildParitySnapshot(input = {}) {
  const requestedSourceMarker = normalizeMarker(input.requestedSourceMarker);
  const builtMarker = normalizeMarker(input.builtMarker);
  const servedMarker = normalizeMarker(input.servedMarker);
  const buildTimestamp = normalizeTimestamp(input.buildTimestamp);
  const servedBuildTimestamp = normalizeTimestamp(input.servedBuildTimestamp);

  const servedSourceTruthAvailable = input.servedSourceTruthAvailable === true
    || Boolean(requestedSourceMarker);
  const servedDistTruthAvailable = input.servedDistTruthAvailable === true
    || Boolean(servedMarker || servedBuildTimestamp);

  const sourceDistParityOk = typeof input.sourceDistParityOk === 'boolean'
    ? input.sourceDistParityOk
    : builtMarker && servedMarker
      ? builtMarker === servedMarker
      : null;

  const localhostMirrorDrift = sourceDistParityOk === false;
  const ignitionRestartSupported = input.ignitionRestartSupported === true;
  const ignitionRestartRequired = localhostMirrorDrift && ignitionRestartSupported && input.realitySyncEnabled === false;
  const confidence = !servedSourceTruthAvailable
    ? 'degraded'
    : sourceDistParityOk === false
      ? 'drift'
      : sourceDistParityOk === true
        ? 'current'
        : 'pending';

  return {
    requestedSourceMarker,
    builtMarker,
    servedMarker,
    buildTimestamp,
    servedBuildTimestamp,
    servedSourceTruthAvailable,
    servedDistTruthAvailable,
    sourceDistParityOk,
    localhostMirrorDrift,
    ignitionRestartSupported,
    ignitionRestartRequired,
    confidence,
  };
}
