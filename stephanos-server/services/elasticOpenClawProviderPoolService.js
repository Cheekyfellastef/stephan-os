import { readFile } from 'node:fs/promises';

import { MAXIMUM_BUILD_LANES } from '../../shared/agents/elasticBuildCapacityV1.mjs';
import {
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  OPENCLAW_PROVIDER_ROUTE,
  routeWithQualifiedOpenClawProvider,
} from '../../shared/agents/openClawProviderPoolQualificationV1.mjs';
import { resolveSharedWorkspacePath } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { readMissionControllerCapacityRoutingInput } from './programmeAuthorityService.js';

export const OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA = 'stephanos.openclaw-elastic-provider-pool.v1';
export const OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE = 'openclaw-provider-pool-current.json';

const SHA_40 = /^[0-9a-f]{40}$/i;
const ALLOWED_EXTERNAL_ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
  OPENCLAW_PROVIDER_ROUTE,
]);
const ALLOWED_EXTERNAL_ADAPTERS = new Set(['chatgpt-github', 'foundry-forge', 'openclaw-local']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safePoolContexts(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  if (record.schemaVersion !== OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA) return [];
  if (!Array.isArray(record.hostContexts) || record.hostContexts.length > MAXIMUM_BUILD_LANES) return [];
  return record.hostContexts.filter((context) => context && typeof context === 'object' && !Array.isArray(context));
}

function normalizedCandidate(candidate = {}) {
  const route = text(candidate.route).toUpperCase();
  const adapter = text(candidate.adapter).toLowerCase();
  const workerId = text(candidate.workerId);
  if (!ALLOWED_EXTERNAL_ROUTES.has(route) || !ALLOWED_EXTERNAL_ADAPTERS.has(adapter) || !workerId) return null;
  return Object.freeze({
    route,
    adapter,
    workerId,
    receiptId: text(candidate.receiptId || candidate.selectedCapacityReceiptId),
    proofRefs: Object.freeze(Array.isArray(candidate.proofRefs) ? [...candidate.proofRefs] : []),
    queueDepth: Number.isSafeInteger(candidate.queueDepth) ? candidate.queueDepth : 0,
    p95StartLatencySeconds: Number.isFinite(candidate.p95StartLatencySeconds) ? candidate.p95StartLatencySeconds : 0,
  });
}

function dedupeCandidates(candidates = []) {
  const byWorker = new Map();
  for (const candidate of candidates) {
    const normalized = normalizedCandidate(candidate);
    if (!normalized) continue;
    const key = `${normalized.adapter}:${normalized.workerId}`.toLowerCase();
    const current = byWorker.get(key);
    if (!current
      || normalized.p95StartLatencySeconds < current.p95StartLatencySeconds
      || (normalized.p95StartLatencySeconds === current.p95StartLatencySeconds && normalized.queueDepth < current.queueDepth)) {
      byWorker.set(key, normalized);
    }
  }
  return [...byWorker.values()]
    .sort((left, right) => (
      left.p95StartLatencySeconds - right.p95StartLatencySeconds
      || left.queueDepth - right.queueDepth
      || left.route.localeCompare(right.route)
      || left.workerId.localeCompare(right.workerId)
    ))
    .slice(0, MAXIMUM_BUILD_LANES);
}

export function openClawHostContextsFromCapacityRouting(capacityRouting = {}) {
  const pooled = Array.isArray(capacityRouting.openClawHostContexts)
    ? capacityRouting.openClawHostContexts
    : [];
  const legacy = capacityRouting.openClawHostContext && typeof capacityRouting.openClawHostContext === 'object'
    ? [capacityRouting.openClawHostContext]
    : [];
  return [...pooled, ...legacy]
    .filter((context) => context && typeof context === 'object' && !Array.isArray(context))
    .slice(0, MAXIMUM_BUILD_LANES);
}

export async function readElasticMissionControllerCapacityRoutingInput({
  root,
  repoRoot,
  nowUtc,
  readFileImpl = readFile,
  readBaseInput = readMissionControllerCapacityRoutingInput,
} = {}) {
  const base = await readBaseInput({ root, repoRoot, nowUtc, readFileImpl });
  if (!base) return null;
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: ['status', OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE],
  });
  if (!resolved.ok) {
    return Object.freeze({ ...base, openClawHostContext: null, openClawHostContexts: Object.freeze([]) });
  }
  let record = null;
  try {
    record = JSON.parse(await readFileImpl(resolved.path, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return Object.freeze({ ...base, openClawHostContext: null, openClawHostContexts: Object.freeze([]) });
    }
  }
  const contexts = Object.freeze(safePoolContexts(record));
  return Object.freeze({
    ...base,
    openClawHostContext: contexts[0] ?? null,
    openClawHostContexts: contexts,
  });
}

export function resolveElasticExternalCapacityCandidates(
  mission,
  capacityRouting,
  sourceRevision,
  nowUtc,
  dependencies = {},
) {
  if (!capacityRouting || !SHA_40.test(text(sourceRevision))) return [];
  const routeCapacity = dependencies.routeCapacity ?? routeMissionControllerCapacity;
  const routeOpenClaw = dependencies.routeOpenClaw ?? routeWithQualifiedOpenClawProvider;
  const baseInput = {
    ...capacityRouting,
    nowUtc,
    sourceHead: text(sourceRevision).toLowerCase(),
    mission,
  };
  const fallback = routeCapacity({ ...baseInput, codexStatus: null });
  const candidates = Array.isArray(fallback?.fallbackCandidates)
    ? fallback.fallbackCandidates.map(normalizedCandidate).filter(Boolean)
    : [];

  for (const hostContext of openClawHostContextsFromCapacityRouting(capacityRouting)) {
    const routed = routeOpenClaw({
      ...baseInput,
      mission: { ...mission, preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
      task: { preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    }, hostContext);
    if (routed?.dispatchAllowed !== true || text(routed.adapter).toLowerCase() !== 'openclaw-local') continue;
    const receipt = routed.openClawCapacity?.receipt;
    candidates.push({
      route: routed.route,
      adapter: routed.adapter,
      workerId: routed.workerId,
      receiptId: routed.selectedCapacityReceiptId,
      proofRefs: routed.proofRefs,
      queueDepth: receipt?.queueDepth,
      p95StartLatencySeconds: receipt?.p95StartLatencySeconds,
    });
  }

  return Object.freeze(dedupeCandidates(candidates));
}
