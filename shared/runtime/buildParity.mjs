export const SYSTEM_PANEL_TOGGLE_REGISTRY_VERSION = 2;

export const SYSTEM_PANEL_TOGGLE_DEFINITIONS = Object.freeze([
  { id: 'module-manager-panel', label: 'Modules', type: 'panel' },
  { id: 'agent-console-panel', label: 'Agents Console', type: 'panel' },
  { id: 'command-console-panel', label: 'Debug Console', type: 'panel' },
  { id: 'task-monitor-panel', label: 'Task Monitor', type: 'panel' },
  { id: 'dev-console', label: 'Developer Console', type: 'panel' },
  { id: 'stephanos-laws-panel', label: 'Laws Panel', type: 'panel' },
  { id: 'stephanos-build-panel', label: 'Build Panel', type: 'panel' },
  { id: 'runtime-diagnostics', label: 'Runtime Diagnostics', type: 'surface' },
  { id: 'launcher-fingerprint', label: 'Launcher Runtime Fingerprint', type: 'surface' },
  { id: 'truth-panel', label: 'Truth Panel', type: 'surface' },
  { id: 'reality-sync', label: 'Reality Sync / Auto Truth Refresh', type: 'surface' },
]);

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTimestamp(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : normalized;
}

export function createBuildParitySnapshot({
  launcher = {},
  tile = {},
  served = {},
  sourceTruth = {},
} = {}) {
  const launcherMarker = normalizeString(launcher.runtimeMarker);
  const tileMarker = normalizeString(tile.runtimeMarker);
  const servedMarker = normalizeString(served.runtimeMarker || sourceTruth.runtimeMarker);
  const launcherTimestamp = normalizeTimestamp(launcher.buildTimestamp);
  const tileTimestamp = normalizeTimestamp(tile.buildTimestamp);
  const servedTimestamp = normalizeTimestamp(served.buildTimestamp || sourceTruth.buildTimestamp);

  const markerParity = Boolean(launcherMarker && tileMarker && launcherMarker === tileMarker);
  const servedParity = Boolean(tileMarker && servedMarker && tileMarker === servedMarker);
  const timestampParity = Boolean(tileTimestamp && servedTimestamp && tileTimestamp === servedTimestamp);
  const parityOk = markerParity && servedParity && timestampParity;

  return {
    launcherVersion: normalizeString(launcher.version, 'unknown'),
    tileVersion: normalizeString(tile.version, 'unknown'),
    launcherRuntimeMarker: launcherMarker || 'missing',
    tileRuntimeMarker: tileMarker || 'missing',
    servedRuntimeMarker: servedMarker || 'missing',
    launcherBuildTimestamp: launcherTimestamp || 'unknown',
    tileBuildTimestamp: tileTimestamp || 'unknown',
    servedBuildTimestamp: servedTimestamp || 'unknown',
    gitCommit: normalizeString(tile.gitCommit || launcher.gitCommit || served.gitCommit, 'unknown'),
    runtimeMode: normalizeString(launcher.runtimeMode || tile.runtimeMode, 'unknown'),
    artifactOrigin: normalizeString(served.source || sourceTruth.source || tile.source || launcher.source, 'unknown'),
    markerParity,
    servedParity,
    timestampParity,
    parityOk,
  };
}

export function evaluateToggleRegistryParity(actualToggleIds = []) {
  const expectedIds = SYSTEM_PANEL_TOGGLE_DEFINITIONS.map((entry) => entry.id);
  const actual = new Set((Array.isArray(actualToggleIds) ? actualToggleIds : []).map((entry) => normalizeString(entry)));
  const missing = expectedIds.filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => id && !expectedIds.includes(id));
  return {
    expectedCount: expectedIds.length,
    actualCount: actual.size,
    missing,
    unexpected,
    parityOk: missing.length === 0 && unexpected.length === 0,
  };
}
