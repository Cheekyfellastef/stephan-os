import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTemporarySovereignLeaseRescueV1 as project } from
  './temporarySovereignLeaseRescueV1.mjs';
import { runTemporarySovereignRescueObservationV1 as run } from
  '../../scripts/temporary-sovereign-lease-rescue.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-10-12T12:30:00.000Z';
const LEASE = Object.freeze({
  leaseId: 'critical-2962-elastic-goal-r7-lease',
  laneId: 'critical-2962-elastic-goal',
});
const STALE = Object.freeze({
  ok: true, present: true, record: LEASE,
  validation: { valid: true, active: false, stale: true },
});
const inputs = (other = {}) => ({
  timestampUtc: NOW, sourceHead: HEAD, leaseRead: STALE,
  ...other,
});
const paths = Object.freeze({
  repoRoot: '/example/stephan-os',
  workspaceRoot: '/example/shared-workspace',
});

test('stale disputed original stays HELD and does not inherit release or writer authority', () => {
  const view = project(inputs({ forensic: {
    classification: 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN',
    bindingMismatchCodes: ['HEAD_SHA', 'LEASE_KEY', 'PR_NUMBER'],
  }}));
  assert.equal(view.mode, 'ORIGINAL_OWNER_REPAIR_REQUIRED');
  assert.equal(view.blocker, 'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN');
  assert.equal(view.status, 'HELD');
  assert.equal(view.safeParallelForensicsAllowed, true);
  for (const key of ['sourceMutationAllowed', 'leaseSeizureAllowed',
    'newWriterAllowed', 'independentWorkerDispatchAllowed',
    'protectedMergeAllowed', 'runtimeMutationAllowed',
    'duplicateSchedulerAllowed', 'arbitraryShellAllowed']) {
    assert.equal(view[key], false, key);
  }
});

test('exact original terminal pair is still not lease-release proof', () => {
  const view = project(inputs({ forensic: {
    classification: 'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT', exactPairCount: 1,
  }}));
  assert.equal(view.mode, 'WAITING_EXACT_RELEASE');
  assert.equal(view.canonicalLeaseReleaseProven, false);
  assert.equal(view.physicalPickupProven, false);
});

test('only canonical reconciler can advance to await physical pickup proof', () => {
  const view = project(inputs({
    canonicalReconciliation: { ok: true, released: true },
  }));
  assert.equal(view.mode, 'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF');
  assert.equal(view.canonicalLeaseReleaseProven, true);
  assert.equal(view.twoUnattendedRefillsProven, false);
  assert.equal(view.status, 'HELD');
});

test('missing lease, invalid head and unexpected owner all fail closed', () => {
  assert.equal(project(inputs({leaseRead:{ok:true,present:false}})).mode,
    'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF');
  assert.equal(project(inputs({sourceHead:''})).blocker,
    'EXACT_LOCAL_SOURCE_HEAD_UNAVAILABLE');
  assert.equal(project(inputs({leaseRead:{ok:true,present:true,
    record:{leaseId:'other-lease'}}})).blocker,'UNEXPECTED_SOURCE_LEASE_OWNER');
  assert.equal(project(inputs({leaseRead:{ok:false}})).blocker,'LEASE_AUTHORITY_UNVERIFIED');
  assert.equal(project(inputs({leaseRead:{ok:true,present:true,
    record: LEASE,validation:{valid:true,active:true,stale:false}}})).blocker,
    'ORIGINAL_LEASE_NOT_SAFE_TO_RELEASE');
});

test('malformed input strips unsafe forensic details from shared status', () => {
  const view = project(inputs({ forensic: {
    classification:'EXFILTRATE:token-value',
    bindingMismatchCodes: ['HEAD_SHA','../../secret','KEY_TOKEN','A'.repeat(120)],
  }}));
  assert.equal(view.forensicClassification,'FORENSIC_NOT_PROVEN');
  assert.deepEqual(view.bindingMismatchCodes,['HEAD_SHA']);
  assert.equal(JSON.stringify(view).includes('token-value'), false);
});

test('separate rescue cycle observes only when lease is safe to reconcile', async () => {
  let reconciles=0; let inspects=0; let missions=0; const published=[];
  const result=await run({
    now:new Date(NOW),sourceHead:HEAD,paths,
    readLease:async()=>({...STALE,validation:{
      valid:true,active:true,stale:false,
    }}),
    inspectPair:async()=>{inspects++;return { classification:'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT' };},
    readMissions:async()=>{missions++;return []},
    reconcile:async()=>{reconciles++;return {ok:true,released:true}},
    writeStatus:async(...args)=>{published.push(args);return {ok:true}},
  });
  assert.equal(inspects,1); assert.equal(missions,0); assert.equal(reconciles,0);
  assert.equal(result.canonicalLeaseReleaseProven,false);
  assert.equal(published.length,1);
  assert.deepEqual(published[0][1],['status','temporary-sovereign-rescue-lane-current.json']);
  assert.equal(published[0][2].status,'HELD');
});

test('expired exact lease invokes canonical reconciler, never direct release', async () => {
  let reconciles=0; let seenMissions; let record;
  const result=await run({
    now:new Date(NOW),sourceHead:HEAD,paths,
    readLease:async()=>STALE,
    inspectPair:async()=>({classification:'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT',exactPairCount:1}),
    readMissions:async()=>[{missionId:'critical-2962-elastic-goal'}],
    reconcile:async(options)=>{
      reconciles++;seenMissions=options.missionRecords;
      assert.equal(options.paths.repoRoot,paths.repoRoot);
      return {ok:false,released:false,blocker:'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN'};
    },
    writeStatus:async(_root,_segments,value)=>{record=value;return {ok:true};},
  });
  assert.equal(reconciles,1);
  assert.equal(seenMissions.length,1);
  assert.equal(result.canonicalLeaseReleaseProven,false);
  assert.equal(result.mode,'WAITING_EXACT_RELEASE');
  assert.equal(record.rescue.originalLeaseId,LEASE.leaseId);
  assert.equal(result.publicationOk,true);
});

test('absent original worker evidence cannot release, and failed publication is visible', async () => {
  let reconciles=0;
  const result=await run({
    now:new Date(NOW),sourceHead:HEAD,paths,
    readLease:async()=>({ok:true,present:false}),
    readMissions:async()=>{throw Error('unexpected')},
    reconcile:async()=>{reconciles++;throw Error('unexpected')},
    writeStatus:async()=>({ok:false,reason:'STATUS_BLOCKED'}),
  });
  assert.equal(reconciles,0);
  assert.equal(result.publicationOk,false);
  assert.equal(result.publicationBlocker,'STATUS_BLOCKED');
  assert.equal(result.physicalPickupProven,false);
});


test('emergency observer cannot reconcile an unrelated stale source lease', async () => {
  let called = false;
  const view = await run({
    now: new Date(NOW), sourceHead: HEAD, paths,
    readLease: async () => ({
      ok: true, present: true,
      record: { leaseId: 'critical-2955-elastic-goal-r4-lease', laneId: 'critical-2955-elastic-goal' },
      validation: {valid: true, active: false, stale: true},
    }),
    readMissions: async () => { called = true; return []; },
    reconcile: async () => { called = true; return {ok: true, released: true}; },
    writeStatus: async () => ({ok:true}),
  });
  assert.equal(called, false);
  assert.equal(view.blocker, 'UNEXPECTED_SOURCE_LEASE_OWNER');
  assert.equal(view.canonicalLeaseReleaseProven, false);
});
