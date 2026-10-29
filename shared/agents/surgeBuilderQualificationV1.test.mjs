import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifySurgeBuilderFleetV1 as qualify } from './surgeBuilderQualificationV1.mjs';
const NOW = '2026-10-29T19:00:00Z';
const HEAD = 'a'.repeat(40);
const ID = 'surge-builder-09';
const slot = (n=9) => ({slot:n,workerId:`surge-builder-${String(n).padStart(2,'0')}`,expectedHead:HEAD,
  queueId:`queue-${n}`,worktreeId:`worktree-${n}`,capacityResourceId:`model-${n}`,
  capacityProofRef:`proofs/capacity-${n}`,canonicalClaimId:`claim-${n}`,nativeBuildProofRef:`proofs/build-${n}`,
  protectedLiveProofRef:`proofs/live-${n}`});
const verifiers = (options={}) => ({
  verifySignedCapacity: async c => options.badCapacity ? null : ({verified:true,workerId:c.workerId,
    sourceHead:c.expectedHead,capacityResourceId:c.capacityResourceId,observedAtUtc:NOW,
    expiresAtUtc:'2026-10-29T19:04:00Z',gamingIdle:!options.gaming,resourceBudgetReady:true}),
  verifyNativeBuild: async c=>options.badBuild?null:({verified:true,workerId:c.workerId,
    sourceHead:c.expectedHead,canonicalClaimId:c.canonicalClaimId,
    materialDiffSha256:'d'.repeat(64),focusedTestsPassed:true,physicalPickupProven:true}),
  verifyProtectedLive:async c=>options.badLive?null:({verified:true,workerId:c.workerId,sourceHead:c.expectedHead,
    exactHeadReviewed:true,protectedMergeProven:true,installedRuntimeProven:true}),
});
const run=(instances,opts={})=>qualify({nowUtc:NOW,expectedHead:HEAD,instances},verifiers(opts));
test('only genuine host-verified capacity, native build and protected live can report Builder 9 live',async()=>{
  const r=await run([slot()]);assert.equal(r.valid,true);assert.equal(r.liveBuilders,1);
  assert.equal(r.materialBuilders,1);assert.equal(r.verifiedCapacitySlots,1);
  assert.equal(r.instances[0].state,'LIVE_PROVEN');assert.equal(r.nextEligibleSlot,10);
  assert.equal(r.mutationAuthority,false);assert.equal(r.installAuthority,false);assert.equal(r.mergeAuthority,false);
});
test('registered slots are not physical workers and no host verifier means no admission',async()=>{
  const r=await qualify({nowUtc:NOW,expectedHead:HEAD,instances:[slot()]});
  assert.equal(r.valid,false);assert.equal(r.reason,'TRUSTED_HOST_VERIFIERS_UNAVAILABLE');
  const e=await run([]);assert.equal(e.materialBuilders,0);assert.equal(e.liveBuilders,0);
  assert.equal(e.instances.filter(x=>x.reason==='SLOT_UNINSTALLED').length,5);
});
test('a second model slot cannot inflate capacity when queue, worktree or resource is shared',async()=>{
  for(const key of ['queueId','worktreeId','capacityResourceId']) {
    const a=slot(9), b=slot(10);b[key]=a[key];const r=await run([a,b]);
    assert.equal(r.instances[1].state,'HELD');assert.equal(r.instances[1].reason,'SHARED_RESOURCE_OR_QUEUE_NOT_INDEPENDENT');
    assert.equal(r.liveBuilders,1);
  }
});
test('whitespace-equivalent queue, worktree and resource spellings cannot inflate independent capacity',async()=>{
  for(const key of ['queueId','worktreeId','capacityResourceId']) {
    const a=slot(9),b=slot(10);
    b[key]=` ${a[key]} `;
    let signedCalls=0;
    const v=verifiers();
    const r=await qualify({nowUtc:NOW,expectedHead:HEAD,instances:[a,b]},
      {...v,verifySignedCapacity:async c=>{signedCalls++;return v.verifySignedCapacity(c);}});
    assert.equal(r.valid,true);
    assert.equal(r.instances[1].state,'HELD');
    assert.equal(r.instances[1].reason,'SCOPED_IDENTITY_OR_PROOF_REF_INVALID');
    assert.equal(r.verifiedCapacitySlots,1);
    assert.equal(r.liveBuilders,1);
    assert.equal(signedCalls,1,'noncanonical second slot cannot enter the trusted host verifier');
  }
});
test('one noncanonical ID, claim or proof reference fails without source admission',async()=>{
  for(const key of ['queueId','worktreeId','capacityResourceId','capacityProofRef','canonicalClaimId','nativeBuildProofRef','protectedLiveProofRef']) {
    const candidate=slot();candidate[key]=` ${candidate[key]} `;
    const r=await run([candidate]);
    assert.equal(r.liveBuilders,0,key);
    assert.notEqual(r.instances[0].state,'LIVE_PROVEN',key);
    assert.ok(r.instances[0].reason,key);
  }
});
test('Builder 10-13 cannot be counted as material before the Builder 9 canary',async()=>{
  const r=await run([slot(10)]);assert.equal(r.verifiedCapacitySlots,1);assert.equal(r.materialBuilders,0);
  assert.equal(r.instances[1].state,'CAPACITY_ONLY');
  assert.equal(r.instances[1].reason,'BUILDER_09_MATERIAL_CANARY_REQUIRED');
});
test('signed capacity fail, gaming and resource budget fail without native dispatch',async()=>{
  for(const options of [{badCapacity:true},{gaming:true}]) {
    let buildCalls=0;const v=verifiers(options);
    const r=await qualify({nowUtc:NOW,expectedHead:HEAD,instances:[slot()]},{...v,
      verifyNativeBuild:async()=>{buildCalls++;return v.verifyNativeBuild();}});
    assert.equal(buildCalls,0);assert.equal(r.instances[0].reason,'FRESH_SIGNED_CAPACITY_OR_GAMING_PROOF_MISSING');
  }
});
test('stale source head, forged worker and bad scoped ref fail closed',async()=>{
  for (const change of [{expectedHead:'b'.repeat(40)},{workerId:'surge-builder-10'},
    {nativeBuildProofRef:'../../secrets'},{worktreeId:'../../bad'}]) {
    const r=await run([{...slot(),...change}]);assert.equal(r.materialBuilders,0);
    assert.equal(r.instances[0].state==='HELD'||r.instances[0].state==='CAPACITY_ONLY',true);
  }
});
test('missing material pickup or review does not become live',async()=>{
  let r=await run([slot()],{badBuild:true});assert.equal(r.materialBuilders,0);
  assert.equal(r.instances[0].state,'CAPACITY_ONLY');
  r=await run([slot()],{badLive:true});assert.equal(r.materialBuilders,1);
  assert.equal(r.liveBuilders,0);assert.equal(r.instances[0].state,'MATERIAL_BUILD_PROVEN');
});
test('duplicate or out-of-range slots and wrong trusted time reject entire inventory',async()=>{
  for (const instances of [[slot(),slot()],[{...slot(),slot:8}],new Array(1)]) {
    const r=await run(instances);assert.equal(r.valid,false);
  }
  const r=await qualify({nowUtc:'not-a-time',expectedHead:HEAD,instances:[slot()]},verifiers());
  assert.equal(r.valid,false);assert.equal(r.reason,'TRUSTED_CLOCK_OR_SOURCE_HEAD_MISSING');
});
test('capacity proof cannot have an unbounded signed TTL or future timestamp',async()=>{
  const v=verifiers(),bad=async c=>({...await v.verifySignedCapacity(c),expiresAtUtc:'2026-10-29T20:00:00Z'});
  const r=await qualify({nowUtc:NOW,expectedHead:HEAD,instances:[slot()]},{...v,verifySignedCapacity:bad});
  assert.equal(r.instances[0].state,'HELD');
});
