import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSurgeBuilderQualificationV1 as project, SURGE_BUILDER_SLOTS } from './surgeBuilderQualificationV1.mjs';

const NOW='2026-10-29T18:30:00.000Z';
const EXPIRES='2026-10-29T18:34:00.000Z';
const HEAD='a'.repeat(40),COMMIT='b'.repeat(40);
const call=slot=>`surge-builder-${String(slot).padStart(2,'0')}`;
const cap=slot=>({verified:true,workerId:call(slot),sourceHead:HEAD,observedAtUtc:NOW,
  expiresAtUtc:EXPIRES,proofRef:`proofs/surge-cap-${slot}`,gamingIdle:true,resourceBudgetReady:true,
  worktreeId:`worktree-${slot}`,queueId:`queue-${slot}`,capacityResourceId:`resource-${slot}`});
const build=slot=>({verified:true,workerId:call(slot),sourceCommitSha:COMMIT,
  canonicalClaimId:`claim-${slot}`,materialDiffSha256:'f'.repeat(64),physicalPickupProven:true,
  focusedTestsPassed:true,resourceIds:[`goal:${slot}`],proofRef:`proofs/surge-native-${slot}`,observedAtUtc:NOW});
const live=slot=>({verified:true,workerId:call(slot),canonicalClaimId:`claim-${slot}`,
  reviewedSourceHeadSha:COMMIT,installedMainSha:HEAD,exactHeadIndependentReview:true,
  protectedMergeProven:true,installedRuntimeProven:true,proofRef:`proofs/surge-live-${slot}`,
  observedAtUtc:NOW});
function trusted(overrides={}) {
  return {readCanonicalOccupiedResources:async()=>({verified:true,expectedMainSha:HEAD,
    proofRef:'proofs/canonical-occupancy',resourceIds:[]}),
    verifySignedCapacity:async({slot})=>cap(slot),verifyNativeBuild:async({slot})=>build(slot),
    verifyProtectedLive:async({slot})=>live(slot),...overrides};
}
const projectSlots=(slots,source=trusted(),other={})=>project({nowUtc:NOW,expectedMainSha:HEAD,
  instances:slots.map(slot=>({slot})),...other},source);

test('no registered slots means zero builders, not five invented physical processes',async()=>{
  const result=await projectSlots([]);
  assert.equal(result.valid,true);assert.equal(result.liveBuilders,0);
  assert.deepEqual(result.instances.map(x=>x.state),Array(5).fill('UNINSTALLED'));
  assert.equal(result.nextEligibleSlot,9);
  assert.equal(result.mutationAuthority,false);
});
test('Builder 9 is the initial material canary, then genuine distinct 10-13 may qualify',async()=>{
  const result=await projectSlots(SURGE_BUILDER_SLOTS);
  assert.equal(result.valid,true);assert.equal(result.liveBuilders,5);
  assert.equal(result.materialBuilders,5);
  assert.equal(result.instances[0].state,'LIVE_PROVEN');
});
test('Builder 10 cannot skip missing Builder 9 physical canary',async()=>{
  const result=await projectSlots([10]);
  assert.equal(result.liveBuilders,0);
  assert.equal(result.instances[1].reason,'BUILDER_09_LIVE_CANARY_REQUIRED');
});
test('missing host or invalid inventory does not grant even capacity',async()=>{
  for (const instances of [[{slot:9},{slot:9}],[{slot:8}],[{slot:9,live:true}]]) {
    const result=await project({nowUtc:NOW,expectedMainSha:HEAD,instances},trusted());
    assert.equal(result.valid,false);assert.equal(result.liveBuilders,0);
  }
  assert.equal((await projectSlots([9],{})).valid,false);
});
test('forged capacity, stale observation and gaming pressure fail closed',async()=>{
  for (const bad of [ {verified:false},{sourceHead:'c'.repeat(40)},
    {observedAtUtc:'2026-10-29T18:00:00Z'},{gamingIdle:false},
    {resourceBudgetReady:false},{expiresAtUtc:NOW},{proofRef:'https://untrusted.invalid'} ]) {
    const result=await projectSlots([9],trusted({verifySignedCapacity:async()=>({...cap(9),...bad})}));
    assert.equal(result.capacityQualified,0);assert.equal(result.liveBuilders,0);
  }
});
test('source diff, exact claim, tests and physical pickup must all be native verified',async()=>{
  for (const bad of [{verified:false},{physicalPickupProven:false},
    {focusedTestsPassed:false},{materialDiffSha256:'oops'},{canonicalClaimId:'bad'}]) {
    const result=await projectSlots([9],trusted({verifyNativeBuild:async()=>({...build(9),...bad})}));
    assert.equal(result.instances[0].state,'CAPACITY_ONLY');assert.equal(result.liveBuilders,0);
  }
});
test('shared worktrees, queues and resource slots never count as new capacity',async()=>{
  for (const field of ['worktreeId','queueId','capacityResourceId']) {
    const result=await projectSlots([9,10],trusted({verifySignedCapacity:async({slot})=>({
      ...cap(slot),[field]:cap(9)[field]})}));
    assert.equal(result.liveBuilders,1);
    assert.equal(result.instances[1].reason,'CAPACITY_IDENTITY_SHARED_WITH_ANOTHER_SLOT');
  }
});
test('canonical resource overlap and rejected occupancy prevent duplicate writers',async()=>{
  const a=await projectSlots([9],trusted({readCanonicalOccupiedResources:async()=>({verified:true,
    expectedMainSha:HEAD,proofRef:'proofs/occupied',resourceIds:['goal:9']})}));
  assert.equal(a.liveBuilders,0);
  assert.equal(a.instances[0].reason,'CANONICAL_RESOURCE_CLAIM_CONFLICT_OR_INVALID');
  const b=await projectSlots([9],trusted({readCanonicalOccupiedResources:async()=>({verified:false,
    expectedMainSha:HEAD,proofRef:'proofs/occupied',resourceIds:[]})}));
  assert.equal(b.valid,false);
});
test('review, protected merge and actual installed head are separate from material build',async()=>{
  for(const bad of [{protectedMergeProven:false},{exactHeadIndependentReview:false},
    {installedMainSha:'c'.repeat(40)},{installedRuntimeProven:false}]) {
    const result=await projectSlots([9],trusted({verifyProtectedLive:async()=>({...live(9),...bad})}));
    assert.equal(result.materialBuilders,1);assert.equal(result.liveBuilders,0);
    assert.equal(result.instances[0].state,'MATERIAL_BUILD_PROVEN');
  }
});

test('Builder 10 stays held even if Builder 9 edited source but has no reviewed live proof',async()=>{
  const result=await projectSlots([9,10],trusted({verifyProtectedLive:async({slot})=>slot===9 ? {...live(9),protectedMergeProven:false} : live(slot)}));
  assert.equal(result.materialBuilders,1);assert.equal(result.liveBuilders,0);
  assert.equal(result.instances[1].reason,'BUILDER_09_LIVE_CANARY_REQUIRED');
  assert.equal(result.nextEligibleSlot,9);
});
