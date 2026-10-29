// Goal #3006: read-only, host-verifier-bound qualification for Builder 9-13.
// Do not register another worker or infer capacity from configured slots.
export const SURGE_BUILDER_QUALIFICATION_SCHEMA = 'stephanos.surge-builder-qualification.v1';
export const SURGE_BUILDER_SLOTS = Object.freeze([9, 10, 11, 12, 13]);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const REF = /^(?:proof|proofs|receipts)\/[a-z0-9][a-z0-9._/@:#-]{0,239}$/i;
const ID = /^[a-z0-9][a-z0-9._:-]{3,127}$/;
const MAX_AGE_MS = 5 * 60_000;
const text = value => typeof value === 'string' ? value.trim() : '';
const validTime = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const exactId = slot => `surge-builder-${String(slot).padStart(2, '0')}`;
const freeze = x => Object.freeze(x);
const held = (slot, code) => freeze({ slot, workerId:exactId(slot), state:'HELD', reason:code,
  capacityQualified:false, materialBuildProven:false, liveProven:false });
const validProofRef = value => REF.test(text(value));

// These are TRUSTED HOST callbacks, not fields accepted from GitHub comments or a
// task. They MUST authenticate current signed producer and OS evidence against
// the existing Programme Authority, Mission Worker and host/lease ledger.
// This module performs no token, process, filesystem, GPU or source mutations.
export async function qualifySurgeBuilderFleetV1(input = {}, trusted = {}) {
  const now = text(input.nowUtc);
  const expectedHead = text(input.expectedHead).toLowerCase();
  const items = input.instances;
  const fail = code => freeze({schemaVersion:SURGE_BUILDER_QUALIFICATION_SCHEMA,
    readOnly:true, mutationAuthority:false, installAuthority:false, mergeAuthority:false,
    valid:false, reason:code, instances:freeze([]), verifiedCapacitySlots:0,
    materialBuilders:0, liveBuilders:0, nextEligibleSlot:null });
  if (!validTime(now) || !SHA.test(expectedHead)) return fail('TRUSTED_CLOCK_OR_SOURCE_HEAD_MISSING');
  if (!Array.isArray(items) || items.length > SURGE_BUILDER_SLOTS.length
      || Array.from({length:items.length}, (_,i) => i).some(i => !Object.hasOwn(items,i)
        || !items[i] || typeof items[i] !== 'object' || Array.isArray(items[i])))
    return fail('SURGE_INSTANCE_INVENTORY_INVALID');
  if (typeof trusted.verifySignedCapacity !== 'function'
      || typeof trusted.verifyNativeBuild !== 'function'
      || typeof trusted.verifyProtectedLive !== 'function')
    return fail('TRUSTED_HOST_VERIFIERS_UNAVAILABLE');
  const bySlot = new Map();
  for (const item of items) {
    if (!SURGE_BUILDER_SLOTS.includes(item.slot) || bySlot.has(item.slot))
      return fail('SURGE_SLOT_IDENTITY_DUPLICATE_OR_INVALID');
    bySlot.set(item.slot,item);
  }
  const observedAt = Date.parse(now);
  const occupied = new Set();
  const verdicts = [];
  let materialBuilders = 0, liveBuilders = 0, verifiedCapacitySlots = 0;
  for (const slot of SURGE_BUILDER_SLOTS) {
    const item = bySlot.get(slot);
    if (!item) { verdicts.push(held(slot,'SLOT_UNINSTALLED')); continue; }
    const workerId = exactId(slot);
    if (text(item.workerId) !== workerId || text(item.expectedHead).toLowerCase() !== expectedHead)
      { verdicts.push(held(slot,'WORKER_OR_HEAD_IDENTITY_MISMATCH')); continue; }
    if (!ID.test(text(item.worktreeId)) || !ID.test(text(item.capacityResourceId))
        || !ID.test(text(item.queueId)) || !validProofRef(item.capacityProofRef))
      { verdicts.push(held(slot,'SCOPED_IDENTITY_OR_PROOF_REF_INVALID')); continue; }
    const keys = [item.worktreeId, item.capacityResourceId, item.queueId];
    if (keys.some(x=>occupied.has(x)) || new Set(keys).size !== keys.length)
      { verdicts.push(held(slot,'SHARED_RESOURCE_OR_QUEUE_NOT_INDEPENDENT')); continue; }
    // A resource is conservatively reserved after discovery, including holds;
    // another slot must never borrow it to fabricate independent capacity.
    for (const key of keys) occupied.add(key);
    let capacity;
    try { capacity = await trusted.verifySignedCapacity(freeze({
      slot, workerId, expectedHead, capacityResourceId:item.capacityResourceId,
      queueId:item.queueId, worktreeId:item.worktreeId, proofRef:item.capacityProofRef,
    })); } catch { capacity=null; }
    if (capacity?.verified !== true || text(capacity.workerId)!==workerId
        || text(capacity.sourceHead).toLowerCase()!==expectedHead
        || text(capacity.capacityResourceId)!==item.capacityResourceId
        || !validTime(capacity.observedAtUtc) || !validTime(capacity.expiresAtUtc)
        || observedAt-Date.parse(capacity.observedAtUtc)<0
        || observedAt-Date.parse(capacity.observedAtUtc)>MAX_AGE_MS
        || Date.parse(capacity.expiresAtUtc)<=observedAt
        || Date.parse(capacity.expiresAtUtc)-Date.parse(capacity.observedAtUtc)>MAX_AGE_MS
        || capacity.gamingIdle!==true || capacity.resourceBudgetReady!==true)
      { verdicts.push(held(slot,'FRESH_SIGNED_CAPACITY_OR_GAMING_PROOF_MISSING')); continue; }
    verifiedCapacitySlots++;
    if (slot>9 && !verdicts.some(v=>v.slot===9 && v.materialBuildProven)) {
      verdicts.push(freeze({slot,workerId,state:'CAPACITY_ONLY',reason:'BUILDER_09_MATERIAL_CANARY_REQUIRED',
        capacityQualified:true,materialBuildProven:false,liveProven:false})); continue;
    }
    if (!ID.test(text(item.canonicalClaimId)) || !validProofRef(item.nativeBuildProofRef)) {
      verdicts.push(freeze({slot,workerId,state:'CAPACITY_ONLY',reason:'CANONICAL_CLAIM_OR_NATIVE_BUILD_PROOF_MISSING',
        capacityQualified:true,materialBuildProven:false,liveProven:false})); continue;
    }
    let build;
    try { build = await trusted.verifyNativeBuild(freeze({slot,workerId,expectedHead,
      canonicalClaimId:item.canonicalClaimId,proofRef:item.nativeBuildProofRef})); } catch { build=null; }
    if (build?.verified!==true || text(build.workerId)!==workerId
        || text(build.sourceHead).toLowerCase()!==expectedHead
        || text(build.canonicalClaimId)!==item.canonicalClaimId
        || !DIGEST.test(text(build.materialDiffSha256))
        || build.focusedTestsPassed!==true || build.physicalPickupProven!==true) {
      verdicts.push(freeze({slot,workerId,state:'CAPACITY_ONLY',reason:'MATERIAL_NATIVE_BUILD_UNPROVEN',
        capacityQualified:true,materialBuildProven:false,liveProven:false})); continue;
    }
    materialBuilders++;
    if (!validProofRef(item.protectedLiveProofRef)) {
      verdicts.push(freeze({slot,workerId,state:'MATERIAL_BUILD_PROVEN',reason:'PROTECTED_LIVE_PROOF_PENDING',
        capacityQualified:true,materialBuildProven:true,liveProven:false})); continue;
    }
    let live;
    try { live = await trusted.verifyProtectedLive(freeze({slot,workerId,expectedHead,
      canonicalClaimId:item.canonicalClaimId,proofRef:item.protectedLiveProofRef})); } catch { live=null; }
    if (live?.verified!==true || text(live.workerId)!==workerId
        || text(live.sourceHead).toLowerCase()!==expectedHead
        || live.exactHeadReviewed!==true || live.protectedMergeProven!==true
        || live.installedRuntimeProven!==true) {
      verdicts.push(freeze({slot,workerId,state:'MATERIAL_BUILD_PROVEN',reason:'REVIEW_MERGE_OR_INSTALLED_RUNTIME_UNPROVEN',
        capacityQualified:true,materialBuildProven:true,liveProven:false})); continue;
    }
    liveBuilders++;
    verdicts.push(freeze({slot,workerId,state:'LIVE_PROVEN',reason:'',capacityQualified:true,
      materialBuildProven:true,liveProven:true}));
  }
  const nextEligibleSlot = verdicts.find(x=>x.state==='HELD' && x.reason==='SLOT_UNINSTALLED')?.slot ?? null;
  return freeze({schemaVersion:SURGE_BUILDER_QUALIFICATION_SCHEMA,readOnly:true,
    mutationAuthority:false,installAuthority:false,mergeAuthority:false,valid:true,reason:'',
    instances:freeze(verdicts),verifiedCapacitySlots,materialBuilders,liveBuilders,nextEligibleSlot});
}
