import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileDurableFlywheelController,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';

const NOW='2026-07-29T14:00:00+01:00';
const MAIN='21dd7e30db529fea6eed0f0085f1b67fe858891c';
const HEAD='762a64949d4e335bbf75b5aa4d2e50bac857d47a';
const LANE_ID='goal-1497-pr-1603';
const OWNER='github-first-chatgpt';

function snapshot(){
  return {
    observedAt:NOW,
    github:{mainHead:MAIN,implementationLanes:[{id:LANE_ID,issueNumber:1497,prNumber:1603,state:'IMPLEMENTING',headSha:HEAD,prState:'OPEN',merged:false}],goals:[]},
    sharedWorkspace:{
      sourceMutationLease:{owner:OWNER,laneId:LANE_ID,expiresAt:'2026-07-29T14:30:00+01:00'},
      controllerHeartbeat:{at:'2026-07-29T13:55:00+01:00'},
      machineryInventory:[{id:'scheduler-primary',kind:'scheduler',state:'RUNNING'},{id:'worker-primary',kind:'worker',state:'RUNNING'}],
    },
    receipts:{
      scheduler:{correlationId:'scheduler-1497',decidedAt:'2026-07-29T13:56:00+01:00',status:'ACTIVE_LANE',failClosed:false,contradictionCodes:[],selectedIssue:null,selectedLifecycle:null,activeIssue:1497,route:'CHATGPT_GITHUB',proofRefs:[],proofHeadShas:[],proofReceipts:[]},
      execution:{schemaVersion:'stephanos.execution-receipt.v1',kind:'stephanos.execution.receipt',receiptId:'execution-1497-1',repository:'Cheekyfellastef/stephan-os',issueNumber:1497,prNumber:1603,branch:'feat/durable-flywheel-controller-vnext',sourceHead:HEAD,workerId:OWNER,workerType:'github-first',executionId:'execution-1497',leaseKey:LANE_ID,state:'completed',phase:'completed',sequence:1,predecessorReceiptId:'',timestampUtc:'2026-07-29T13:57:00+01:00',heartbeatExpiresAtUtc:'2026-07-29T13:57:00+01:00',blocker:'',operatorActionRequired:false,proofRefs:['proofs/execution-1497.json'],expectedNextAction:''},
      proofHeadShas:[],proofReceipts:[],proofRefs:[],
    },
    battleBridge:{proof:null},
  };
}

test('execution receipt must bind to active PR independently of issue identity',()=>{
  const state=snapshot();
  state.receipts.execution.prNumber=9999;
  const result=reconcileDurableFlywheelController(state,{now:NOW});
  assert.equal(result.status,'HOLD');
  assert.ok(result.blockers.includes('execution-receipt-pr-mismatch'));
  assert.ok(!result.blockers.includes('execution-receipt-issue-mismatch'));
});

test('live merged PR truth supersedes stale active-lane state and releases its lease once',async()=>{
  const state=snapshot();
  Object.assign(state.github.implementationLanes[0],{prState:'CLOSED',merged:true,mergedAt:'2026-07-28T11:15:19Z'});
  const reconciliation=reconcileDurableFlywheelController(state,{now:NOW});
  assert.equal(reconciliation.status,'HEALTHY');
  assert.equal(reconciliation.activeLaneCount,0);
  assert.equal(reconciliation.terminalLaneCount,1);
  assert.equal(reconciliation.nextAction,'finalize-merged-lane-release-lease-and-reschedule');

  const calls=[];
  const result=await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async()=>state,
    finalizeTerminalLane:async(packet)=>{calls.push(packet);return{status:'TERMINAL_LANE_RECONCILED',laneId:packet.lane.id};},
    advanceActiveLane:async()=>{throw new Error('must not advance a merged lane');},
    dispatchSelectedGoal:async()=>{throw new Error('must release the stale lease before rescheduling');},
    publishReceipt:async()=>{},
  },{now:NOW});
  assert.equal(calls.length,1);
  assert.equal(calls[0].releaseLease,true);
  assert.equal(calls[0].reschedule,true);
  assert.equal(calls[0].mergeAuthority,false);
  assert.equal(result.status,'TERMINAL_LANE_RECONCILED');
});
