export const PARALLEL_SEED_RESOURCE_PREFLIGHT_SCHEMA = 'stephanos.seed-parallel-resource-preflight.v1';

export const SEED_PARALLEL_GOVERNOR_MAX_AGE_MS = 30000;

// Shared freshness predicate for the on-demand canonical governor reconcile and
// the final independent pre-inference safety verdict. Never infer idle from age.
export function isParallelSeedGovernorSnapshotFreshV1(governor, nowMs = Date.now()) {
  const observed = Date.parse(governor?.updatedAtUtc || '');
  return Number.isFinite(observed) && Number.isFinite(nowMs)
    && observed <= nowMs && nowMs - observed <= SEED_PARALLEL_GOVERNOR_MAX_AGE_MS;
}

// One canonical fail-closed predicate is used before and during any
// CPU/GPU-intensive local Seed Forge work, including tests after inference.
export function isParallelSeedLocalWorkAllowedV1(governor, nowMs = Date.now()) {
  return governor?.schemaVersion === 'stephanos.vr-resource-governor.v1'
    && governor.active === false && governor.phase === 'NORMAL'
    && governor.localModelAllowed === true
    && isParallelSeedGovernorSnapshotFreshV1(governor, nowMs);
}

export function checkParallelSeedModelResourceV1({ governor, modelInventory, selectedModel, nowMs = Date.now() } = {}) {
  const reasons = [];
  if (governor?.schemaVersion !== 'stephanos.vr-resource-governor.v1') reasons.push('VR_GOVERNOR_TRUTH_MISSING');
  if (governor?.active !== false || governor?.phase !== 'NORMAL'
    || governor?.localModelAllowed !== true)
    reasons.push('VR_OR_GAMING_MODEL_PROTECTION_ACTIVE');
  if (!isParallelSeedGovernorSnapshotFreshV1(governor, nowMs))
    reasons.push('VR_GOVERNOR_SNAPSHOT_STALE_OR_UNPROVEN');
  if (typeof selectedModel !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,100}$/.test(selectedModel))
    reasons.push('LOCAL_MODEL_ID_INVALID');
  // llama.cpp router /models reports residency explicitly. /api/ps plus
  // Ollama /api/generate is NOT a no-autoload contract: generate can reload
  // an evicted model between the read and the request.
  const loaded = Array.isArray(modelInventory?.data) ? modelInventory.data : [];
  const selectedIsLoaded = loaded.some((m) =>
    m?.id === selectedModel && m?.status?.value === 'loaded');
  if (!selectedIsLoaded) reasons.push('LOCAL_MODEL_NOT_ALREADY_LOADED');
  // llama.cpp can wake an idle-sleeping model and reload its memory even
  // with router autoload=false. Reject an advertised sleep-enabled worker;
  // a separately qualified host startup contract is still required.
  const selected = loaded.find((m) => m?.id === selectedModel);
  const argv = selected?.status?.args;
  if (selectedIsLoaded && (!Array.isArray(argv)
    || argv.some((arg) => /^--?sleep-idle-seconds(?:=|$)/.test(String(arg))))) {
    reasons.push('RESIDENT_MODEL_SLEEP_SAFETY_UNPROVEN');
  }
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
