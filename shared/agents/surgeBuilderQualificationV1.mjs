// Goal #3006: evidence-only acceptance for Builders 9-13. Not a worker or a grant.
import { adjudicateResourceScopeOverlap, projectCanonicalResourceIds } from './elasticBuildCapacityV1.mjs';

export const SURGE_BUILDER_QUALIFICATION_SCHEMA = 'stephanos.surge-builder-qualification.v1';
export const SURGE_BUILDER_SLOTS = Object.freeze([9, 10, 11, 12, 13]);

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{3,127}$/;
const REF = /^(?:proof|proofs|receipts)\/[a-z0-9][a-z0-9._/@:#-]{0,239}$/i;
const EXPLICIT_UTC = /(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_AGE_MS = 5 * 60_000;
const text = value => typeof value === 'string' ? value.trim() : '';
const workerId = slot => `surge-builder-${String(slot).padStart(2, '0')}`;
const freeze = value => Object.freeze(value);
const instant = value => typeof value === 'string' && EXPLICIT_UTC.test(value) && Number.isFinite(Date.parse(value))
  ? Date.parse(value) : NaN;
const held = (slot, reason) => freeze({ slot, workerId:workerId(slot), state:'HELD', reason,
  capacityQualified:false, materialBuildProven:false, liveProven:false });
const missing = slot => freeze({ slot, workerId:workerId(slot), state:'UNINSTALLED', reason:'SLOT_UNINSTALLED',
  capacityQualified:false, materialBuildProven:false, liveProven:false });
const observed = (record, nowMs) => {
  const at = instant(record?.observedAtUtc);
  return Number.isFinite(at) && at <= nowMs + 60_000 && nowMs - at <= MAX_AGE_MS;
};
const distinct = (records, key) => {
  const names = records.map(row => text(row?.[key]));
  return names.every(Boolean) && new Set(names).size === names.length;
};
const snapshot = (slot, state, reason, capacityQualified, materialBuildProven, liveProven, proofRefs) =>
  freeze({slot, workerId:workerId(slot), state, reason, capacityQualified, materialBuildProven,
    liveProven, proofRefs:freeze([...proofRefs])});
const safeRef = value => REF.test(text(value));
const canonicalId = value => typeof value === 'string' && value === text(value) && ID.test(value);
const proofTime = (receipt, nowMs) => observed(receipt,nowMs) && instant(receipt?.expiresAtUtc) > nowMs
  && instant(receipt.expiresAtUtc) - instant(receipt.observedAtUtc) <= MAX_AGE_MS;

/** Trusted callbacks MUST read canonical source custody, signed producer and OS receipts.
 * Caller-provided slot descriptors, comments, green flags and status rows confer no authority.
 * This read-only projection does not reserve, launch, merge, install or release anything.
 */
export async function projectSurgeBuilderQualificationV1(input = {}, trusted = {}) {
  const nowMs = instant(input?.nowUtc);
  const head = text(input?.expectedMainSha).toLowerCase();
  const requested = input?.instances;
  const invalid = reason => freeze({schemaVersion:SURGE_BUILDER_QUALIFICATION_SCHEMA,
    readOnly:true, mutationAuthority:false, installAuthority:false, mergeAuthority:false,
    valid:false, reason, instances:freeze([]), capacityQualified:0, materialBuilders:0,
    liveBuilders:0, nextEligibleSlot:null});
  if (!Number.isFinite(nowMs) || !SHA.test(head)) return invalid('CLOCK_OR_MAIN_HEAD_UNPROVEN');
  if (!Array.isArray(requested) || requested.length > SURGE_BUILDER_SLOTS.length
    || Array.from({length:requested.length}, (_,i) => i).some(i => !Object.hasOwn(requested,i))
    || requested.some(row => !row || typeof row !== 'object' || Array.isArray(row)
      || !SURGE_BUILDER_SLOTS.includes(row.slot)
      || Object.keys(row).length !== 1 || !Object.hasOwn(row,'slot'))
    || new Set(requested.map(row => row.slot)).size !== requested.length)
    return invalid('SURGE_SLOT_INVENTORY_INVALID');
  if (['readCanonicalOccupiedResources','verifySignedCapacity','verifyNativeBuild',
    'verifyProtectedLive'].some(key => typeof trusted?.[key] !== 'function'))
    return invalid('TRUSTED_HOST_VERIFIERS_UNAVAILABLE');
  let occupancy;
  try { occupancy = await trusted.readCanonicalOccupiedResources(freeze({expectedMainSha:head})); }
  catch { return invalid('CANONICAL_OCCUPANCY_UNAVAILABLE'); }
  if (occupancy?.verified !== true || text(occupancy.expectedMainSha).toLowerCase() !== head
    || !safeRef(occupancy.proofRef)) return invalid('CANONICAL_OCCUPANCY_UNVERIFIED');
  const occupied = projectCanonicalResourceIds(occupancy.resourceIds);
  if (!occupied.valid) return invalid('CANONICAL_OCCUPANCY_INVALID');
  const claimedResources = [...occupied.resourceIds];
  const inUse = { worktreeId:new Set(), queueId:new Set(), capacityResourceId:new Set(), claimId:new Set() };
  const bySlot = new Map(requested.map(row => [row.slot,row]));
  const results = [];
  let builder9Live = false;

  for (const slot of SURGE_BUILDER_SLOTS) {
    if (!bySlot.has(slot)) { results.push(missing(slot)); continue; }
    if (slot > 9 && !builder9Live) { results.push(held(slot,'BUILDER_09_LIVE_CANARY_REQUIRED')); continue; }
    const id = workerId(slot);
    const request = freeze({slot,workerId:id,expectedMainSha:head});
    let capacity;
    try { capacity = await trusted.verifySignedCapacity(request); }
    catch { results.push(held(slot,'SIGNED_CAPACITY_VERIFIER_FAILED')); continue; }
    if (capacity?.verified !== true || text(capacity.workerId) !== id
      || text(capacity.sourceHead).toLowerCase() !== head || !proofTime(capacity,nowMs)
      || !safeRef(capacity.proofRef) || capacity.gamingIdle !== true
      || capacity.resourceBudgetReady !== true || !canonicalId(capacity.worktreeId)
      || !canonicalId(capacity.queueId) || !canonicalId(capacity.capacityResourceId)) {
      results.push(held(slot,'SIGNED_CAPACITY_OR_GAMING_PROOF_MISSING')); continue;
    }
    const keys = ['worktreeId','queueId','capacityResourceId'];
    if (keys.some(key => inUse[key].has(capacity[key])) || !distinct([capacity], 'worktreeId')) {
      results.push(held(slot,'CAPACITY_IDENTITY_SHARED_WITH_ANOTHER_SLOT')); continue;
    }
    for (const key of keys) inUse[key].add(capacity[key]);
    const proofs = [capacity.proofRef];
    let native;
    try { native = await trusted.verifyNativeBuild(request); }
    catch { results.push(snapshot(slot,'CAPACITY_ONLY','NATIVE_BUILD_VERIFIER_FAILED',true,false,false,proofs)); continue; }
    if (native?.verified !== true || text(native.workerId) !== id
      || !canonicalId(native.canonicalClaimId) || !SHA.test(text(native.sourceCommitSha))
      || !DIGEST.test(text(native.materialDiffSha256))
      || native.physicalPickupProven !== true || native.focusedTestsPassed !== true
      || !safeRef(native.proofRef) || !observed(native,nowMs)
      || inUse.claimId.has(native.canonicalClaimId)) {
      results.push(snapshot(slot,'CAPACITY_ONLY','NATIVE_PHYSICAL_BUILD_UNPROVEN',true,false,false,proofs)); continue;
    }
    const scoped = projectCanonicalResourceIds(native.resourceIds);
    const collision = scoped.valid && scoped.resourceIds.length > 0
      ? adjudicateResourceScopeOverlap(claimedResources,scoped.resourceIds) : null;
    if (!collision?.valid || collision.overlaps) {
      results.push(snapshot(slot,'CAPACITY_ONLY','CANONICAL_RESOURCE_CLAIM_CONFLICT_OR_INVALID',true,false,false,proofs)); continue;
    }
    inUse.claimId.add(native.canonicalClaimId);
    claimedResources.push(...scoped.resourceIds);
    proofs.push(native.proofRef);
    let live;
    try { live = await trusted.verifyProtectedLive(freeze({...request,
      canonicalClaimId:native.canonicalClaimId,sourceCommitSha:native.sourceCommitSha})); }
    catch { results.push(snapshot(slot,'MATERIAL_BUILD_PROVEN','PROTECTED_LIVE_VERIFIER_FAILED',true,true,false,proofs)); continue; }
    if (live?.verified !== true || text(live.workerId) !== id
      || text(live.canonicalClaimId) !== native.canonicalClaimId
      || text(live.reviewedSourceHeadSha) !== native.sourceCommitSha
      || text(live.installedMainSha) !== head
      || live.exactHeadIndependentReview !== true || live.protectedMergeProven !== true
      || live.installedRuntimeProven !== true || !safeRef(live.proofRef) || !observed(live,nowMs)) {
      results.push(snapshot(slot,'MATERIAL_BUILD_PROVEN','PROTECTED_REVIEW_MERGE_OR_LIVE_UNPROVEN',true,true,false,proofs)); continue;
    }
    proofs.push(live.proofRef);
    if (slot === 9) builder9Live = true;
    results.push(snapshot(slot,'LIVE_PROVEN','',true,true,true,proofs));
  }
  return freeze({schemaVersion:SURGE_BUILDER_QUALIFICATION_SCHEMA,readOnly:true,
    mutationAuthority:false,installAuthority:false,mergeAuthority:false,valid:true,reason:'',
    instances:freeze(results),capacityQualified:results.filter(x=>x.capacityQualified).length,
    materialBuilders:results.filter(x=>x.materialBuildProven).length,
    liveBuilders:results.filter(x=>x.liveProven).length,
    nextEligibleSlot:!builder9Live ? 9 : (results.find(x=>x.state==='UNINSTALLED')?.slot ?? null)});
}
