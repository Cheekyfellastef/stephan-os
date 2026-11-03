// Fail-closed, read-only recovery triage; NO remote command execution or authority.
const SHA = /^[a-f0-9]{40}$/;
export const SOVEREIGN_GOAL_RECOVERY_TRIAGE_SCHEMA = 'stephanos.sovereign-goal-recovery-triage.v1';
const TICKET = Object.freeze({
  custody: 'COMMISSION_INDEPENDENT_WINDOWS_ORIGINAL_WRITER_WITNESS',
  island: 'BUILD_AND_QUALIFY_RESCUE_ISLAND_OS_OWNERSHIP_ADAPTER',
  seed: 'QUALIFY_LLAMA_ROUTER_GAMING_GOVERNOR_CUSTODY',
  native: 'VERIFY_SIGNED_NATIVE_CAPACITY_PUBLISHER_RECEIPT',
});
function ticket(id, reason, next) {
  return Object.freeze({id,reason,next,autoInstallAllowed:false,privilegeEscalationAllowed:false});
}
export function triageSovereignGoalRecoveryV1(input={}) {
  const main=typeof input?.mainHead==='string'?input.mainHead:'';
  const machine=typeof input?.machineHead==='string'?input.machineHead:'';
  const observed=typeof input?.observedAtUtc==='string'?Date.parse(input.observedAtUtc):NaN;
  const now=typeof input?.nowUtc==='string'?Date.parse(input.nowUtc):NaN;
  const current=SHA.test(main)&&SHA.test(machine)&&main===machine
    && Number.isFinite(now)&&Number.isFinite(observed)&&observed<=now
    && now-observed<=90_000;
  const gaps=[];
  if(input?.originalCustodyReleased!==true)
    gaps.push(ticket('custody','ORIGINAL_WRITER_CUSTODY_NOT_INDEPENDENTLY_PROVEN',
      'Commission protected Windows witness and independent operator approval; retain exact #2962/r7 HOLD'));
  if(input?.islandPhysicalPickupVerified!==true)
    gaps.push(ticket('island','ISLAND_FIRST_PHYSICAL_PICKUP_UNPROVEN',
      'Build separate OS-authenticated owner/claim/gaming ingress for unclaimed #3109 pilot'));
  if(input?.seedRouterEvictionVerified!==true)
    gaps.push(ticket('seed','SEED_ROUTER_GAMING_EVICTION_UNPROVEN',
      'Qualify governed llama.cpp router residency, eviction and zero-VRAM proof'));
  if(input?.nativeCapacitySignedVerified!==true)
    gaps.push(ticket('native','NATIVE_CAPACITY_SIGNED_RECEIPT_UNPROVEN',
      'Inspect existing publisher command terminal receipt; do not retry an accepted live command'));
  const safeAction=current?'controller-lane-status':'visibility-snapshot';
  return Object.freeze({
    schemaVersion:SOVEREIGN_GOAL_RECOVERY_TRIAGE_SCHEMA,
    sourceHeadFresh:current,
    safeReadOnlyRemoteAction:safeAction,
    originalConveyor:{
      state:input?.originalCustodyReleased===true?'CUSTODY_GATE_CLAIMED_UNVERIFIED':'CUSTODY_HOLD',
      releaseRecommended:false,
    },
    rescueIsland:{state:input?.islandPhysicalPickupVerified===true?'PICKUP_CLAIMED_UNVERIFIED':'PHYSICAL_PICKUP_UNPROVEN'},
    seedCanopy:{state:input?.seedRouterEvictionVerified===true?'GOVERNOR_CLAIMED_UNVERIFIED':'GAMING_GOVERNOR_HOLD'},
    capabilityRequests:Object.freeze(gaps),
    authoritySource:'EXTERNAL_INDEPENDENT_PROOFS_REQUIRED',
    canReleaseLease:false,canStartWorker:false,canInstallPrivilegedService:false,
    canForcePush:false,canMergeProtectedMain:false,
    gamingPreemptionRequired:true,
    finalVerdict:current?'CAPABILITY_GAPS_REMAIN_AUTHORITY_HELD':'FRESH_HEAD_AND_RUNTIME_EVIDENCE_REQUIRED',
  });
}
