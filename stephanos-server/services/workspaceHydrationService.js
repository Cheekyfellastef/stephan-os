import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';
import { readVrCapabilityFeed } from './vrCapabilityFeedService.js';
import { readVrPlaytestFeed } from './vrPlaytestFeedService.js';
import { readSpatialWorkspaceTelemetryFeed } from './spatialWorkspaceTelemetryService.js';
import {
  buildWorkspaceDatasetProvenanceV1,
  buildWorkspaceIntegrityMeshV1,
} from '../../shared/runtime/workspaceIntegrityMeshV1.mjs';

export const WORKSPACE_HYDRATION_SCHEMA_V1 = 'stephanos.workspace-hydration.v1';
export const WORKSPACE_HYDRATION_ROUTE = '/api/shared-workspace/hydrate';

export const WORKSPACE_HYDRATION_DATASETS = Object.freeze([
  'dashboard',
  'vr-capability',
  'vr-playtest',
  'spatial-telemetry',
]);

export const WORKSPACE_HYDRATION_DATASET_SCHEMAS = Object.freeze({
  dashboard: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
  'vr-capability': 'stephanos.vr-capability-live-feed.v1',
  'vr-playtest': 'stephanos.vr-playtest-live-feed.v1',
  'spatial-telemetry': 'stephanos.spatial-workspace-telemetry-feed.v1',
});

const DEFAULT_DATASETS_BY_WORKSPACE = Object.freeze({
  'goal-dashboard': Object.freeze(['dashboard']),
  'flywheel': Object.freeze(['dashboard']),
  'agents': Object.freeze(['dashboard']),
  'agents-workspace': Object.freeze(['dashboard']),
  'cockpit': Object.freeze(['dashboard']),
  'landing': Object.freeze(['dashboard']),
  'stephanos': Object.freeze(['dashboard']),
  'stephanos-ai': Object.freeze(['dashboard']),
  'vr-capability-atlas': Object.freeze(['vr-capability', 'spatial-telemetry']),
  'vr-research-lab': Object.freeze(['dashboard', 'vr-capability', 'vr-playtest', 'spatial-telemetry']),
  'starfield-vr-lab': Object.freeze(['dashboard', 'vr-capability', 'vr-playtest']),
  'starfield-vr-reference-lab': Object.freeze(['dashboard', 'vr-capability', 'vr-playtest']),
});

function text(value = '') {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function normalizeWorkspaceHydrationWorkspaceId(value = '') {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeDatasetList(input = []) {
  const raw = Array.isArray(input)
    ? input
    : text(input).split(',');
  const allowed = new Set(WORKSPACE_HYDRATION_DATASETS);
  return [...new Set(
    raw
      .map((value) => text(value).toLowerCase())
      .filter((value) => allowed.has(value)),
  )];
}

export function resolveWorkspaceHydrationDatasets({ workspaceId = '', datasets = [] } = {}) {
  const explicit = normalizeDatasetList(datasets);
  if (explicit.length) return Object.freeze(explicit);
  const normalizedWorkspaceId = normalizeWorkspaceHydrationWorkspaceId(workspaceId);
  const defaults = DEFAULT_DATASETS_BY_WORKSPACE[normalizedWorkspaceId] || ['dashboard'];
  return Object.freeze([...defaults]);
}

function datasetState(payload) {
  const state = text(payload?.state || payload?.workspace?.state || '').toLowerCase();
  if (['ready', 'current'].includes(state)) return 'ready';
  if (['stale', 'degraded', 'partial'].includes(state)) return 'stale';
  if (['unavailable', 'error', 'blocked'].includes(state)) return 'unavailable';
  return payload ? 'ready' : 'unavailable';
}

function hydrationState(results) {
  const values = Object.values(results);
  if (!values.length) return 'unavailable';
  const states = values.map((item) => item.state);
  const readyCount = states.filter((state) => state === 'ready').length;
  const staleCount = states.filter((state) => state === 'stale').length;
  const unavailableCount = states.filter((state) => state === 'unavailable').length;

  if (unavailableCount === states.length) return 'unavailable';
  if (unavailableCount > 0) return 'partial';
  if (staleCount > 0 && readyCount > 0) return 'partial';
  if (staleCount === states.length) return 'stale';
  return 'ready';
}

function defaultReaders() {
  return {
    dashboard: readBackendSharedWorkspaceDashboardFeed,
    'vr-capability': readVrCapabilityFeed,
    'vr-playtest': readVrPlaytestFeed,
    'spatial-telemetry': readSpatialWorkspaceTelemetryFeed,
  };
}

export async function readWorkspaceHydrationBundle({
  workspaceId,
  datasets,
  env = process.env,
  repoRoot = process.cwd(),
  nowMs = Date.now(),
  staleAfterMs,
  readers = defaultReaders(),
} = {}) {
  const normalizedWorkspaceId = normalizeWorkspaceHydrationWorkspaceId(workspaceId);
  if (!normalizedWorkspaceId) {
    return Object.freeze({
      schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
      route: WORKSPACE_HYDRATION_ROUTE,
      readOnly: true,
      state: 'unavailable',
      reason: 'WORKSPACE_ID_REQUIRED',
      workspaceId: '',
      requestedDatasets: Object.freeze([]),
      hydratedAtUtc: new Date(nowMs).toISOString(),
      datasets: Object.freeze({}),
      errors: Object.freeze(['WORKSPACE_ID_REQUIRED']),
    });
  }

  const selectedDatasets = resolveWorkspaceHydrationDatasets({
    workspaceId: normalizedWorkspaceId,
    datasets,
  });
  const readerMap = { ...defaultReaders(), ...(readers || {}) };

  const entries = await Promise.all(selectedDatasets.map(async (dataset) => {
    const reader = readerMap[dataset];
    if (typeof reader !== 'function') {
      return [dataset, Object.freeze({
        state: 'unavailable',
        reason: 'WORKSPACE_HYDRATION_READER_UNAVAILABLE',
        payload: null,
      })];
    }

    try {
      const common = { env, repoRoot, nowMs, staleAfterMs };
      const dashboardRecordScope = normalizedWorkspaceId === 'flywheel'
        ? 'full-history'
        : 'current-state';
      const payload = dataset === 'dashboard'
        ? await reader({ ...common, recordScope: dashboardRecordScope })
        : await reader(common);
      return [dataset, Object.freeze({
        state: datasetState(payload),
        reason: text(payload?.reason, 'WORKSPACE_HYDRATION_DATASET_READY'),
        payload,
      })];
    } catch (error) {
      return [dataset, Object.freeze({
        state: 'unavailable',
        reason: text(error?.message, 'WORKSPACE_HYDRATION_DATASET_FAILED'),
        payload: null,
      })];
    }
  }));

  const hydratedAtUtc = new Date(nowMs).toISOString();
  const enrichedEntries = entries.map(([dataset, value]) => {
    const provenance = buildWorkspaceDatasetProvenanceV1({
      workspaceId: normalizedWorkspaceId,
      datasetId: dataset,
      payload: value.payload,
      state: value.state,
      expectedSchemaVersion: WORKSPACE_HYDRATION_DATASET_SCHEMAS[dataset] || '',
      observedAtUtc: hydratedAtUtc,
    });
    return [dataset, Object.freeze({ ...value, provenance })];
  });
  const projectedDatasets = Object.freeze(Object.fromEntries(enrichedEntries));
  const state = hydrationState(projectedDatasets);
  const integrity = buildWorkspaceIntegrityMeshV1({
    nowMs,
    staleAfterMs: Number.isFinite(staleAfterMs) ? staleAfterMs : 5 * 60 * 1000,
    bindings: enrichedEntries.map(([, value]) => value.provenance),
    importantSources: selectedDatasets,
  });
  const errors = Object.freeze(entries
    .filter(([, value]) => value.state === 'unavailable')
    .map(([dataset, value]) => `${dataset}:${value.reason}`));

  return Object.freeze({
    schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
    route: WORKSPACE_HYDRATION_ROUTE,
    readOnly: true,
    state,
    reason: state === 'ready'
      ? 'WORKSPACE_HYDRATION_READY'
      : state === 'stale'
        ? 'WORKSPACE_HYDRATION_STALE'
        : state === 'partial'
          ? 'WORKSPACE_HYDRATION_PARTIAL'
          : 'WORKSPACE_HYDRATION_UNAVAILABLE',
    workspaceId: normalizedWorkspaceId,
    requestedDatasets: selectedDatasets,
    hydratedAtUtc,
    datasets: projectedDatasets,
    integrity,
    errors,
  });
}
