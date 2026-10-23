export const PARALLEL_SEED_RESOURCE_PREFLIGHT_SCHEMA = 'stephanos.seed-parallel-resource-preflight.v1';

export const SEED_PARALLEL_GOVERNOR_MAX_AGE_MS = 30000;

// Architectural hold, not a configurable approval flag. The canonical governor
// evicts Ollama, but has no registered llama.cpp router PID/model lease or
// independently verified zero-residency acknowledgement. HTTP cancellation and
// self-reported /models argv cannot establish that missing resource custody.
// Only a separately implemented and qualified canonical governor adapter may
// remove this hold. No environment variable or caller JSON can override it.
export const SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED = false;

// Pathname rechecks cannot bind the eventual source write against a hostile
// same-account parent/leaf replacement. This affects deterministic inventory
// proposals too: avoiding inference does not supply source-write custody.
// Keep actual worker admission held until a separately reviewed, physically
// qualified writer protects the complete operation. Caller approval, platform
// labels and environment flags cannot commission that missing capability.
export const SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED = false;

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
  if (!SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED)
    reasons.push('RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED');
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
    residencyCustodyProven: false,
    liveInferenceQualified: false,
    reasonCodes: Object.freeze(reasons),
    addedModelResidencyAllowed: false,
    gamingResourceProtectionRequired: true,
  });
}
