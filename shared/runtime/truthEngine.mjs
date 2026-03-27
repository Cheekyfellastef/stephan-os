import { STEPHANOS_LAW_IDS } from './stephanosLaws.mjs';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value, fallback = 'unknown') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function contradiction(id, severity, message, relatedLawId, evidence = {}) {
  return {
    id,
    severity,
    message,
    relatedLawId,
    evidence,
  };
}

export function createTruthSnapshot(input = {}) {
  const launcher = {
    mode: normalizeStatus(input?.launcher?.mode, 'launcher-root'),
    shellStatus: normalizeStatus(input?.launcher?.shellStatus, 'unknown'),
    tileRegistryCount: toFiniteNumber(input?.launcher?.tileRegistryCount, 0),
    tileDomCount: toFiniteNumber(input?.launcher?.tileDomCount, 0),
    launcherCriticalModuleFailureCount: toFiniteNumber(input?.launcher?.launcherCriticalModuleFailureCount, 0),
    buildProofPresent: input?.launcher?.buildProofPresent === true,
    projectsDiscoveredCount: toFiniteNumber(input?.launcher?.projectsDiscoveredCount, 0),
  };

  const sourceBuildServed = {
    buildMarker: normalizeStatus(input?.sourceBuildServed?.buildMarker, 'missing'),
    buildTimestamp: normalizeStatus(input?.sourceBuildServed?.buildTimestamp, 'unknown'),
    servedSourceTruthAvailable: input?.sourceBuildServed?.servedSourceTruthAvailable === true,
    servedDistTruthAvailable: input?.sourceBuildServed?.servedDistTruthAvailable === true,
    sourceDistParityOk: typeof input?.sourceBuildServed?.sourceDistParityOk === 'boolean' ? input.sourceBuildServed.sourceDistParityOk : null,
    servedMarker: normalizeStatus(input?.sourceBuildServed?.servedMarker, 'missing'),
    servedBuildTimestamp: normalizeStatus(input?.sourceBuildServed?.servedBuildTimestamp, 'unknown'),
  };

  const runtime = {
    runtimeDiagnosticsEnabled: input?.runtime?.runtimeDiagnosticsEnabled === true,
    launcherRuntimeFingerprintVisible: input?.runtime?.launcherRuntimeFingerprintVisible === true,
    truthPanelVisible: input?.runtime?.truthPanelVisible === true,
    backendReachable: typeof input?.runtime?.backendReachable === 'boolean' ? input.runtime.backendReachable : null,
    finalRoute: normalizeStatus(input?.runtime?.finalRoute, 'unknown'),
    routeKind: normalizeStatus(input?.runtime?.routeKind, 'unknown'),
    runtimeErrorActive: input?.runtime?.runtimeErrorActive === true,
  };

  const contradictions = collectTruthContradictions({ launcher, sourceBuildServed, runtime });

  return {
    capturedAt: new Date().toISOString(),
    launcher,
    sourceBuildServed,
    runtime,
    contradictions,
    status: contradictions.some((entry) => entry.severity === 'critical')
      ? 'critical'
      : contradictions.length > 0
        ? 'degraded'
        : 'healthy',
  };
}

export function collectTruthContradictions({ launcher = {}, sourceBuildServed = {}, runtime = {} } = {}) {
  const contradictions = [];

  if (toFiniteNumber(launcher.projectsDiscoveredCount, 0) > 0 && toFiniteNumber(launcher.tileDomCount, 0) === 0) {
    contradictions.push(contradiction(
      'tiles-discovered-but-not-rendered',
      'critical',
      `Projects discovered (${launcher.projectsDiscoveredCount}) but rendered tile count is 0.`,
      STEPHANOS_LAW_IDS.UNIVERSAL_ENTRY,
      {
        projectsDiscoveredCount: toFiniteNumber(launcher.projectsDiscoveredCount, 0),
        tileDomCount: toFiniteNumber(launcher.tileDomCount, 0),
      },
    ));
  }

  if (toFiniteNumber(launcher.launcherCriticalModuleFailureCount, 0) > 0 && normalizeStatus(launcher.shellStatus, 'unknown') === 'healthy') {
    contradictions.push(contradiction(
      'critical-module-failure-while-healthy',
      'critical',
      'Launcher reports healthy shell status while launcher-critical module failures exist.',
      STEPHANOS_LAW_IDS.IMPORT_STRUCTURE_GUARD,
      {
        launcherCriticalModuleFailureCount: toFiniteNumber(launcher.launcherCriticalModuleFailureCount, 0),
        shellStatus: normalizeStatus(launcher.shellStatus, 'unknown'),
      },
    ));
  }

  if (!launcher.buildProofPresent) {
    contradictions.push(contradiction(
      'build-proof-missing',
      'high',
      'Launcher build proof surface is missing while build truth is expected.',
      STEPHANOS_LAW_IDS.BUILD_TRUTH_PARITY,
      {
        buildProofPresent: false,
      },
    ));
  }

  if (sourceBuildServed.sourceDistParityOk === false) {
    contradictions.push(contradiction(
      'source-dist-parity-mismatch',
      'critical',
      'Source/build/served truth parity check mismatch detected.',
      STEPHANOS_LAW_IDS.BUILD_TRUTH_PARITY,
      {
        buildMarker: normalizeStatus(sourceBuildServed.buildMarker, 'missing'),
        servedMarker: normalizeStatus(sourceBuildServed.servedMarker, 'missing'),
      },
    ));
  }

  if (runtime.runtimeDiagnosticsEnabled === false && runtime.runtimeErrorActive === true) {
    contradictions.push(contradiction(
      'runtime-errors-hidden',
      'medium',
      'Runtime diagnostics are hidden while runtime error state is active.',
      STEPHANOS_LAW_IDS.DIAGNOSTICS_BOUNDARY,
      {
        runtimeDiagnosticsEnabled: runtime.runtimeDiagnosticsEnabled,
        runtimeErrorActive: runtime.runtimeErrorActive,
      },
    ));
  }

  return contradictions;
}
