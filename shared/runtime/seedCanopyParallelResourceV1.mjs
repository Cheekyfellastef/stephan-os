export const PARALLEL_SEED_RESOURCE_PREFLIGHT_SCHEMA = 'stephanos.seed-parallel-resource-preflight.v1';

export const SEED_PARALLEL_GOVERNOR_MAX_AGE_MS = 30000;

export function checkParallelSeedModelResourceV1({ governor, ollamaPs, selectedModel, nowMs = Date.now() } = {}) {
  const reasons = [];
  if (governor?.schemaVersion !== 'stephanos.vr-resource-governor.v1') reasons.push('VR_GOVERNOR_TRUTH_MISSING');
  if (governor?.active !== false || governor?.localModelAllowed !== true)
    reasons.push('VR_OR_GAMING_MODEL_PROTECTION_ACTIVE');
  const observed = Date.parse(governor?.updatedAtUtc || '');
  if (!Number.isFinite(observed) || !Number.isFinite(nowMs) || observed > nowMs
    || nowMs - observed > SEED_PARALLEL_GOVERNOR_MAX_AGE_MS)
    reasons.push('VR_GOVERNOR_SNAPSHOT_STALE_OR_UNPROVEN');
  if (typeof selectedModel !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,100}$/.test(selectedModel))
    reasons.push('LOCAL_MODEL_ID_INVALID');
  const loaded = Array.isArray(ollamaPs?.models) ? ollamaPs.models : [];
  const selectedIsLoaded = loaded.some((m) => m?.name === selectedModel || m?.model === selectedModel);
  if (!selectedIsLoaded) reasons.push('LOCAL_MODEL_NOT_ALREADY_LOADED');
  return Object.freeze({
    schemaVersion: PARALLEL_SEED_RESOURCE_PREFLIGHT_SCHEMA,
    ok: reasons.length === 0,
    selectedModel: typeof selectedModel === 'string' ? selectedModel : '',
    alreadyLoaded: selectedIsLoaded,
    reasonCodes: Object.freeze(reasons),
    addedModelResidencyAllowed: false,
    gamingResourceProtectionRequired: true,
  });
}
