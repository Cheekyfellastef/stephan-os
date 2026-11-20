import assert from 'node:assert/strict';
import test from 'node:test';
import { exactElasticExternalGrant } from '../../stephanos-server/services/criticalBacklogConveyorServiceCore.js';
import { createExactWorkerActionGrant } from './durableFlywheelControllerVNext.mjs';
import { missionWorkerActionGrantsMatchV1 } from './missionOrchestratorWorker.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA, forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef } from './missionControllerCapacityRouterV1.mjs';

const now = new Date('2026-10-30T14:00:00.000Z');
const head = 'a'.repeat(40);
function producers() {
  const mission = { missionId:'critical-1574-elastic-goal', title:'Bounded source repair',
    revision:5, currentPhase:'AGENT_IMPLEMENTATION', repository:'Cheekyfellastef/stephan-os',
    operatorIntent:'Repair the bounded source contract.', intendedOutcome:'Tested source correction.',
    allowedFiles:['stephanos-server/services/contract.js'],
    requiredTests:['node --test stephanos-server/services/contract.test.js'],
    requiredEvidence:['focused source tests'], providerRouteIntent:'AUTO',
    dispatch:{adapter:'codex',status:'pending'},
    git:{branch:'openclaw/elastic-goal-1574',worktreePath:'/bounded/goal-1574'} };
  const candidate = {route:'FOUNDRY_FORGE',adapter:'foundry-forge',
    workerId:'stephanos-forge-lifeboat-local',receiptId:'forge-capacity-test',
    proofRefs:[forgeLifeboatProofRef(head)]};
  const receipt={schemaVersion:BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    route:candidate.route,workerId:candidate.workerId,receiptId:candidate.receiptId,
    proofRefs:candidate.proofRefs,repository:mission.repository,state:'READY',
    supportedOperations:['SOURCE_CONSTRUCTION','FOCUSED_TESTS'],
    supportedTaskClasses:['FOCUSED_REPAIR','MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc:'2026-10-30T13:59:00.000Z',expiresAtUtc:'2026-10-30T14:14:00.000Z',
    queueDepth:0,p95StartLatencySeconds:3,authorityReceiptIds:[forgeLifeboatAuthorityReceiptId(head)]};
  const grants=[exactElasticExternalGrant(mission,candidate,head,now),
    createExactWorkerActionGrant({observedAtUtc:now.toISOString(),criticalBacklog:{activeMission:mission}},
      head,{nowUtc:now.toISOString(),sourceHead:head,forgeLaneReceipt:receipt},()=>[candidate])];
  assert.ok(grants[0],'actual elastic factory must produce its grant');
  assert.ok(grants[1],'actual durable factory must produce its grant');
  return grants;
}

test('both actual production factories compose the same exact focused-source grant',()=>{
  const [elastic,controller]=producers();
  assert.ok(elastic && controller);
  assert.deepEqual(elastic,controller);
  assert.equal(missionWorkerActionGrantsMatchV1(elastic,controller),true);
});

test('legacy absent optional memory equals null; no authority field gets a default',()=>{
  const [grant]=producers(), legacy={...grant};
  delete legacy.engineeringMemoryPack;delete legacy.engineeringMemoryPackId;
  assert.equal(missionWorkerActionGrantsMatchV1(legacy,grant),true);
  delete legacy.providerRouteIntent;
  assert.equal(missionWorkerActionGrantsMatchV1(legacy,grant),false);
});

for(const key of ['grantId','controllerId','sourceRevision','missionId','missionRevision',
  'currentPhase','actionId','actionKind','adapter','operation','providerRouteIntent',
  'capacityRoute','capacityReceiptId','capacityProofRefs','workerId','laneId','repository',
  'issueNumber','prNumber','branch','headSha','boundedActionCount','mergeAuthority','leaseSeizureAllowed']) {
  test('grant mismatch remains closed for '+key,()=>{
    const [grant]=producers();
    const changed={...grant,[key]:Array.isArray(grant[key])?['proof/foreign.json']
      :typeof grant[key]==='number'?grant[key]+1:typeof grant[key]==='boolean'?!grant[key]:'foreign'};
    assert.equal(missionWorkerActionGrantsMatchV1(grant,changed),false);
  });
}

test('unknown, non-enumerable, symbol, accessor and non-JSON authority cannot match itself',()=>{
  const [grant]=producers();let accessorRead=false;
  const cases=[{...grant,executeAuthority:true},
    Object.defineProperty({...grant},'executeAuthority',{value:true}),
    {...grant,[Symbol('executeAuthority')]:true},
    Object.defineProperty({...grant},'providerRouteIntent',{get(){accessorRead=true;return 'AUTO';},enumerable:true}),
    {...grant,capacityProofRefs:[undefined]}, {...grant,missionRevision:NaN},
    {...grant,sourceRevision:[head]}, {...grant,headSha:[head]}];
  for(const candidate of cases)assert.equal(missionWorkerActionGrantsMatchV1(candidate,candidate),false);
  assert.equal(accessorRead,false);
});

test('self-consistent fake or authority-widening memory cannot become a matching grant',()=>{
  const [grant]=producers();
  for(const pack of [{schemaVersion:'stephanos.engineering-coding-memory-pack.v1',packId:'fake'},
    {schemaVersion:'stephanos.engineering-coding-memory-pack.v1',packId:'fake',authority:{mergeAuthority:true}}]) {
    const candidate={...grant,engineeringMemoryPack:pack,engineeringMemoryPackId:pack.packId};
    assert.equal(missionWorkerActionGrantsMatchV1(candidate,candidate),false);
  }
});
