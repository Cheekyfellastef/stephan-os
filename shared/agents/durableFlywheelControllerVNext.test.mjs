import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  evaluateControllerLivenessDecision,
  reconcileDurableFlywheelController,
  renderDurableFlywheelReceipt,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA } from './missionControllerCapacityRouterV1.mjs';

const NOW = '2026-07-30T13:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const LANE_HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const LANE_ID = 'goal-1497-pr-1617';
const BRANCH = 'feat/durable-flywheel-controller-vnext';

function projection(status = 'IDLE', overrides = {}) {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status,
    finalVerdict: status === 'HOLD' ? 'AUTHORITATIVE_PROGRAMME_PROJECTION_HOLD' : 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: null,
    mutationLease: null,
    projectionReceipt: { schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA, receiptId: 'programme-projection-20260730130000', status, chatMemoryAuthoritative: false, sourceConstructionMode: 'production-contracts', mergeAuthority: false, workerAuthorityOwnedByController: false, schedulerAuthorityOwnedByController: false, boundedMutationStepsPerCycle: 1 },
    ...overrides,
  };
}
function activeProjection(overrides = {}) { return projection('ACTIVE', { lane: { valid: true, active: true, terminal: false, laneId: LANE_ID, repository: REPOSITORY, issueNumber: 1497, prNumber: 1617, branch: BRANCH, headSha: LANE_HEAD }, mutationLease: { leaseId: 'lease-goal-1497-pr-1617', ownerId: 'mission-worker' }, criticalBacklog: { activeMission: { missionId: 'critical-1497-controller-test', revision: 4, currentPhase: 'CHECK_PULL_REQUEST', repository: REPOSITORY, git: { branch: BRANCH }, pullRequest: { number: 1617, headSha: LANE_HEAD } } }, ...overrides }); }
function machineryFor(authoritativeProjection, overrides = {}) { const heartbeats=[]; const receipts=[]; return { heartbeats, receipts, machinery: { publishControllerHeartbeat: async input => { heartbeats.push(input); return {ok:true}; }, loadAuthoritativeProjection: async()=>authoritativeProjection, publishReceipt: async receipt=>{receipts.push(receipt);return{ok:true};}, ensureBacklogMission: async()=>({ok:true,createdMission:false,projection:{activeMission:{missionId:'critical-1497-controller-test',revision:0,currentPhase:'LIVE_RUNTIME_INVESTIGATION',repository:REPOSITORY}}}), finalizeTerminalLane:async()=>({ok:true}), ...overrides } }; }

test('production canonical ACTIVE projection authorizes one existing worker tick', async()=>{const f=machineryFor(activeProjection());const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});assert.equal(r.status,'ACTIVE');assert.equal(r.action,'ADVANCE_EXISTING_ACTIVE_LANE');assert.equal(r.allowWorkerTick,true);assert.equal(r.boundedMutationSteps,1);assert.equal(r.mergeAuthority,false);assert.equal(r.leaseSeizureAllowed,false);assert.deepEqual(f.heartbeats.map(({cycleState})=>cycleState),['STARTING','ACTIVE_LANE','ACTIVE_LANE']);assert.equal(r.workerActionGrant.missionId,'critical-1497-controller-test');assert.equal(r.workerActionGrant.actionId.includes('critical-1497-controller-test'),true);assert.equal(r.workerActionGrant.boundedActionCount,1);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].repository,REPOSITORY);assert.equal(f.receipts[0].prNumber,1617);assert.equal(f.receipts[0].headSha,LANE_HEAD);});

test('ACTIVE lane keeps moving while one canonical CLOSE_READY goal is retired',async()=>{
  const openProjection=activeProjection({
    goalClosurePlan:{
      state:'READY',
      request:{schemaVersion:'stephanos.goal-closure-request.v1',issueNumber:4242},
    },
  });
  const refreshedProjection=activeProjection({
    goalClosurePlan:{state:'BLOCKED',reason:'CANONICAL_CLOSE_READY_PORTFOLIO_GOAL_REQUIRED'},
  });
  let closed=false;
  const closureCalls=[];
  const f=machineryFor(openProjection,{
    loadAuthoritativeProjection:async()=>closed?refreshedProjection:openProjection,
    closeReadyGoal:async(projectionValue)=>{
      closureCalls.push(projectionValue.goalClosurePlan.request.issueNumber);
      closed=true;
      return {
        state:'CLOSED_COMPLETED',
        stateReason:'completed',
        repository:REPOSITORY,
        issueNumber:4242,
        resultProofRefs:['proof/result-4242.json'],
        reusableCapabilityId:'CAPABILITY_GOAL_RETIREMENT_V1',
        sharedLessonId:'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
      };
    },
    loadCapacityRoutingInput:async()=>null,
  });
  const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});
  assert.deepEqual(closureCalls,[4242]);
  assert.equal(r.status,'ACTIVE');
  assert.equal(r.action,'ADVANCE_ACTIVE_LANE_AND_CLOSE_COMPLETED_GOAL');
  assert.equal(r.goalClosureResult.state,'CLOSED_COMPLETED');
  assert.equal(r.goalClosureResult.issueNumber,4242);
  assert.equal(r.allowWorkerTick,true);
  assert.equal(r.workerActionGrant.missionId,'critical-1497-controller-test');
  assert.equal(r.cycleReceipt.goalClosureState,'CLOSED_COMPLETED');
  assert.equal(r.cycleReceipt.goalClosureIssueNumber,4242);
  assert.equal(r.cycleReceipt.goalClosureRepository,REPOSITORY);
  assert.equal(r.cycleReceipt.goalClosureStateReason,'completed');
  assert.deepEqual(r.cycleReceipt.goalClosureResultProofRefs,['proof/result-4242.json']);
  assert.equal(r.cycleReceipt.goalClosureReusableCapabilityId,'CAPABILITY_GOAL_RETIREMENT_V1');
  assert.equal(r.cycleReceipt.goalClosureSharedLessonId,'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF');
  assert.equal(r.mergeAuthority,false);
});

test('ACTIVE source work receives one exact proven fallback grant when Codex capacity is low',async()=>{const sourceMission={missionId:'critical-1497-controller-test',revision:4,currentPhase:'AGENT_IMPLEMENTATION',title:'Repair controller routing',repository:REPOSITORY,operatorIntent:'Repair the bounded controller route.',intendedOutcome:'The route is proven by focused tests.',allowedFiles:['shared/agents/controller.mjs'],requiredTests:['node --test shared/agents/controller.test.mjs'],requiredEvidence:['focused tests'],dispatch:{adapter:'codex',status:'pending'},git:{branch:BRANCH,worktreePath:'/bounded/worktree'}};const f=machineryFor(activeProjection({criticalBacklog:{activeMission:sourceMission}}),{loadCapacityRoutingInput:async()=>({nowUtc:NOW,codexStatus:{schemaVersion:'shared-agent-workspace-record.v1',statusId:'codex-capacity-current',truthState:'CURRENT',meterTruthUsable:true,observedAtUtc:NOW,remainingPercent:3,availability:'AVAILABLE',confidence:'high'},githubLaneReceipt:{schemaVersion:BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,receiptId:'github-builder-capacity-controller-test',route:'CHATGPT_GITHUB',repository:REPOSITORY,workerId:'shared-fabric-chatgpt-github-builder-01',state:'READY',supportedOperations:['SOURCE_CONSTRUCTION','FOCUSED_TESTS'],supportedTaskClasses:['FOCUSED_REPAIR'],observedAtUtc:NOW,expiresAtUtc:'2026-07-30T13:15:00.000Z',queueDepth:0,p95StartLatencySeconds:15,authorityReceiptIds:[],proofRefs:['receipts/github-builder/capacity.json']}})});const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});assert.equal(r.status,'ACTIVE');assert.equal(r.workerActionGrant.adapter,'chatgpt-github');assert.equal(r.workerActionGrant.capacityRoute,'CHATGPT_GITHUB');assert.equal(r.workerActionGrant.capacityReceiptId,'github-builder-capacity-controller-test');assert.deepEqual(r.workerActionGrant.capacityProofRefs,['receipts/github-builder/capacity.json']);assert.equal(r.workerActionGrant.mergeAuthority,false);assert.equal(r.workerActionGrant.leaseSeizureAllowed,false);});

test('canonical HOLD projection preserves authority blockers and forbids work',async()=>{const f=machineryFor(projection('HOLD',{blockers:['lane:github-merge-evidence-incomplete','execution:sourceHead mismatch','critical-backlog-active-lane-pr-mismatch']}));const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});assert.equal(r.status,'HOLD');assert.equal(r.allowWorkerTick,false);assert.deepEqual(r.blockers,['authoritative-programme-reconciliation-blocked','authority:lane:github-merge-evidence-incomplete','authority:execution:sourceHead mismatch','authority:critical-backlog-active-lane-pr-mismatch']);assert.deepEqual(f.heartbeats.map(({cycleState})=>cycleState),['STARTING','HOLD']);});

test('non-production, memory-authoritative, malformed, and unknown projections fail closed',()=>{for(const [candidate,blocker] of [[projection('IDLE',{schemaVersion:'legacy.parallel-authority.v1'}),'authoritative-programme-projection-schema-mismatch'],[projection('IDLE',{sourceConstructionMode:'deterministic-testing-seam'}),'authoritative-programme-projection-not-production-constructed'],[projection('IDLE',{chatMemoryAuthoritative:true}),'chat-memory-authority-not-explicitly-disabled'],[projection('UNRECOGNIZED'),'authoritative-programme-status-invalid'],[null,'authoritative-programme-projection-invalid']]){const r=reconcileDurableFlywheelController(candidate,{nowUtc:NOW,sourceRevision:SOURCE_REVISION});assert.equal(r.status,'HOLD');assert.equal(r.allowWorkerTick,false);assert.ok(r.blockers.includes(blocker));}});
test('explicit observation time and exact source revision are mandatory',()=>{const a=reconcileDurableFlywheelController(projection('IDLE',{observedAtUtc:undefined}),{sourceRevision:SOURCE_REVISION});assert.ok(a.blockers.includes('controller-observation-time-invalid'));const b=reconcileDurableFlywheelController(projection(),{nowUtc:NOW});assert.ok(b.blockers.includes('controller-source-revision-invalid'));assert.equal(b.allowWorkerTick,false);});
test('invalid startup source revision publishes a durable HOLD without touching authority services',async()=>{let calls=0;const receipts=[];const r=await runDurableFlywheelStartupCycle({publishControllerHeartbeat:async()=>{calls++;return{ok:true}},loadAuthoritativeProjection:async()=>{calls++;return projection()},publishReceipt:async x=>{receipts.push(x);return{ok:true}}},{nowUtc:NOW,sourceRevision:'not-a-sha',env:{}});assert.equal(r.status,'HOLD');assert.equal(r.allowWorkerTick,false);assert.equal(calls,0);assert.equal(receipts.length,1);assert.equal(receipts[0].action,'HOLD');});
test('IDLE waits without mutation and renders its authority posture',async()=>{const f=machineryFor(projection('IDLE'));const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});const rendered=renderDurableFlywheelReceipt(r);assert.equal(r.status,'IDLE');assert.equal(r.allowWorkerTick,false);assert.equal(r.boundedMutationSteps,0);assert.match(rendered,/Status: IDLE/);assert.match(rendered,/Worker-Tick-Allowed: false/);assert.match(rendered,/Merge-Authority: false/);assert.match(rendered,/Lease-Seizure-Allowed: false/);assert.match(rendered,/Blockers: none/);});

test('controller recovers stale CREATE_WORKTREE deadlock before reconciliation and emits the exact worktree grant',async()=>{const staleMission={missionId:'critical-1292-1293-dispatch-conveyor',revision:7,currentPhase:'CREATE_WORKTREE',repository:REPOSITORY,repositoryRoot:'/repo',baseBranch:'main',git:{branch:'openclaw/critical-1292-1293-dispatch-conveyor',worktreePath:'/bounded/critical-1292-1293-dispatch-conveyor'}};const stale=projection('HOLD',{blockers:['critical-backlog-idle-selection-identity-mismatch'],scheduler:{selectedGoal:2314,decisionReceipt:{selectedIssue:2314}},criticalBacklog:{decision:'WAIT_ACTIVE_MISSION',activeMission:staleMission,selectedItem:{issueNumbers:[1292],mission:staleMission}}});const ready=projection('READY',{scheduler:{selectedGoal:2314,decisionReceipt:{selectedIssue:2314}},criticalBacklog:{decision:'CREATE_NEXT_MISSION',selectedItem:{issueNumbers:[2314]}}});const next={missionId:'critical-2314-elastic-goal',revision:0,currentPhase:'CREATE_WORKTREE',repository:REPOSITORY,repositoryRoot:'/repo',baseBranch:'main',git:{branch:'openclaw/critical-2314-elastic-goal',worktreePath:'/bounded/critical-2314-elastic-goal'}};let recovered=false;const recoveryCalls=[];const ensureCalls=[];const f=machineryFor(stale,{loadAuthoritativeProjection:async()=>recovered?ready:stale,recoverOrphanedBacklogMission:async o=>{recoveryCalls.push(o);recovered=true;return{ok:true,recovered:true,classification:'ORPHANED_ACTIVE_MISSION_BLOCKED_FOR_PARKING',missionId:staleMission.missionId}},ensureBacklogMission:async(o={})=>{ensureCalls.push(o);if(o.allowLegacyMissionCreation===false)return{ok:true,createdMission:false,classification:'CREATE_NEXT_MISSION_DEFERRED_TO_DURABLE_CONTROLLER',projection:{decision:'CREATE_NEXT_MISSION',selectedItem:{issueNumbers:[2314]}}};return{ok:true,createdMission:true,classification:'WAIT_ACTIVE_MISSION',projection:{decision:'WAIT_ACTIVE_MISSION',selectedItem:{issueNumbers:[2314]},activeMission:next}}},loadCapacityRoutingInput:async()=>null});const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{},controllerLivenessEvidence:{surfaceFailures:[{surfaceId:'openclaw-local',failureClass:'SURFACE_UNAVAILABLE'},{surfaceId:'openclaw-local',failureClass:'SURFACE_UNAVAILABLE'}],qualifiedSurfaces:['openclaw-local','chatgpt-github'],safeEligibleWorkRemaining:true}});assert.equal(recoveryCalls.length,1);assert.equal(ensureCalls.length,2);assert.equal(ensureCalls[0].allowLegacyMissionCreation,false);assert.equal(ensureCalls[0].admissionOwner,'durable-flywheel-controller-orphan-recovery');assert.deepEqual(ensureCalls[0].blockedAdapters,['openclaw-local']);assert.equal(ensureCalls[1].allowLegacyMissionCreation,undefined);assert.deepEqual(ensureCalls[1].blockedAdapters,['openclaw-local']);assert.equal(r.orphanRecovery.recovered,true);assert.equal(r.orphanRecoveryRefresh.ok,true);assert.equal(r.status,'READY');assert.equal(r.allowWorkerTick,true);assert.equal(r.workerActionGrant.missionId,next.missionId);assert.equal(r.workerActionGrant.currentPhase,'CREATE_WORKTREE');assert.equal(r.workerActionGrant.operation,'create-worktree');assert.equal(r.workerActionGrant.adapter,'openclaw-signed');assert.equal(r.workerActionGrant.issueNumber,2314);assert.equal(r.workerActionGrant.boundedActionCount,1);assert.equal(r.workerActionGrant.mergeAuthority,false);assert.equal(r.workerActionGrant.leaseSeizureAllowed,false);});
test('controller never invokes orphan recovery for unrelated HOLD states',async()=>{let calls=0;const f=machineryFor(projection('HOLD',{blockers:['lane:github-merge-evidence-incomplete'],scheduler:{selectedGoal:2314},criticalBacklog:{decision:'WAIT_ACTIVE_MISSION',activeMission:{missionId:'critical-1292-1293-dispatch-conveyor',currentPhase:'CREATE_WORKTREE'}}}),{recoverOrphanedBacklogMission:async()=>{calls++;return{ok:true,recovered:true}}});const r=await runDurableFlywheelStartupCycle(f.machinery,{nowUtc:NOW,sourceRevision:SOURCE_REVISION,env:{}});assert.equal(calls,0);assert.equal(r.status,'HOLD');assert.equal(r.allowWorkerTick,false);});


test('surface-local failures never disable the controller and select an alternate qualified route', () => {
  const result = evaluateControllerLivenessDecision({
    surfaceFailures: [
      { surfaceId: 'github-raw-writer', failureClass: 'SAFETY_WRAPPER_REJECTED' },
      { surfaceId: 'github-raw-writer', failureClass: 'SAFETY_WRAPPER_REJECTED' },
    ],
    qualifiedSurfaces: ['github-raw-writer', 'github-owner-dispatch', 'battle-bridge-mailbox'],
    safeEligibleWorkRemaining: true,
  });
  assert.equal(result.decision, 'REMAIN_ENABLED');
  assert.equal(result.disableAllowed, false);
  assert.equal(result.controllerShouldRemainEnabled, true);
  assert.deepEqual(result.blockedSurfaceIds, ['github-raw-writer']);
  assert.equal(result.selectedAlternateSurface, 'github-owner-dispatch');
  assert.equal(result.retryNextScheduledRun, false);
  assert.equal(result.reason, 'SURFACE_BLOCKED_CONTROLLER_LIVE');
});

test('two different failure classes still quarantine the same unstable surface', () => {
  const result = evaluateControllerLivenessDecision({
    surfaceFailures: [
      { surfaceId: 'openclaw-local', failureClass: 'WRITE_BLOCKED' },
      { surfaceId: 'openclaw-local', failureClass: 'SURFACE_UNAVAILABLE' },
    ],
    qualifiedSurfaces: ['openclaw-local', 'chatgpt-github'],
    safeEligibleWorkRemaining: true,
  });
  assert.deepEqual(result.blockedSurfaceIds, ['openclaw-local']);
  assert.equal(result.selectedAlternateSurface, 'chatgpt-github');
  assert.equal(result.controllerShouldRemainEnabled, true);
});

test('one failure does not prematurely quarantine a surface', () => {
  const result = evaluateControllerLivenessDecision({
    surfaceFailures: [
      { surfaceId: 'github-raw-writer', failureClass: 'SAFETY_WRAPPER_REJECTED' },
    ],
    qualifiedSurfaces: ['github-raw-writer'],
    safeEligibleWorkRemaining: true,
  });
  assert.deepEqual(result.blockedSurfaceIds, []);
  assert.equal(result.selectedAlternateSurface, 'github-raw-writer');
  assert.equal(result.controllerShouldRemainEnabled, true);
});

test('fully blocked non-unsafe cycle remains enabled for the next scheduled run', () => {
  const result = evaluateControllerLivenessDecision({
    surfaceFailures: [
      { surfaceId: 'github-raw-writer', failureClass: 'SAFETY_WRAPPER_REJECTED' },
      { surfaceId: 'github-raw-writer', failureClass: 'SAFETY_WRAPPER_REJECTED' },
      { surfaceId: 'github-owner-dispatch', failureClass: 'SURFACE_UNAVAILABLE' },
      { surfaceId: 'github-owner-dispatch', failureClass: 'SURFACE_UNAVAILABLE' },
    ],
    qualifiedSurfaces: ['github-raw-writer', 'github-owner-dispatch'],
    safeEligibleWorkRemaining: false,
  });
  assert.equal(result.decision, 'REMAIN_ENABLED');
  assert.equal(result.retryNextScheduledRun, true);
  assert.equal(result.controllerShouldRemainEnabled, true);
  assert.equal(result.controllerLevelUnsafeProven, false);
});

test('disablement is restricted to explicit operator intent, terminal completion, or proven controller-wide unsafety', () => {
  const operator = evaluateControllerLivenessDecision({ operatorDisableRequested: true });
  assert.equal(operator.disableAllowed, true);
  assert.equal(operator.reason, 'EXPLICIT_OPERATOR_DISABLE');

  const terminal = evaluateControllerLivenessDecision({
    terminalCompletion: true,
    safeEligibleWorkRemaining: false,
  });
  assert.equal(terminal.disableAllowed, true);
  assert.equal(terminal.reason, 'TERMINAL_SCOPE_COMPLETE');

  const incompleteUnsafe = evaluateControllerLivenessDecision({
    controllerLevelUnsafe: true,
    scopedActions: ['research', 'spatial', 'starfield'],
    unsafeScopedActions: ['starfield'],
  });
  assert.equal(incompleteUnsafe.disableAllowed, false);
  assert.equal(incompleteUnsafe.controllerLevelUnsafeProven, false);

  const provenUnsafe = evaluateControllerLivenessDecision({
    controllerLevelUnsafe: true,
    scopedActions: ['research', 'spatial', 'starfield'],
    unsafeScopedActions: ['research', 'spatial', 'starfield'],
  });
  assert.equal(provenUnsafe.disableAllowed, true);
  assert.equal(provenUnsafe.reason, 'CONTROLLER_LEVEL_UNSAFE');
});


test('live flywheel quarantines a twice-failed adapter and grants the existing alternate surface', async () => {
  const sourceMission = {
    missionId: 'critical-1497-controller-test',
    revision: 4,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: 'Repair controller liveness routing',
    repository: REPOSITORY,
    operatorIntent: 'Keep the controller live and route around a blocked writer.',
    intendedOutcome: 'The existing alternate builder receives the bounded source grant.',
    allowedFiles: ['shared/agents/controller.mjs'],
    requiredTests: ['node --test shared/agents/controller.test.mjs'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
    git: { branch: BRANCH, worktreePath: '/bounded/worktree' },
  };
  const f = machineryFor(activeProjection({ criticalBacklog: { activeMission: sourceMission } }), {
    loadCapacityRoutingInput: async () => ({
      nowUtc: NOW,
      codexStatus: {
        schemaVersion: 'shared-agent-workspace-record.v1',
        statusId: 'codex-capacity-current',
        truthState: 'CURRENT',
        meterTruthUsable: true,
        observedAtUtc: NOW,
        remainingPercent: 80,
        availability: 'AVAILABLE',
        confidence: 'high',
      },
      githubLaneReceipt: {
        schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
        receiptId: 'github-builder-capacity-liveness-test',
        route: 'CHATGPT_GITHUB',
        repository: REPOSITORY,
        workerId: 'shared-fabric-chatgpt-github-builder-01',
        state: 'READY',
        supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
        supportedTaskClasses: ['FOCUSED_REPAIR'],
        observedAtUtc: NOW,
        expiresAtUtc: '2026-07-30T13:15:00.000Z',
        queueDepth: 0,
        p95StartLatencySeconds: 15,
        authorityReceiptIds: [],
        proofRefs: ['receipts/github-builder/capacity.json'],
      },
    }),
  });
  const result = await runDurableFlywheelStartupCycle(f.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
    controllerLivenessEvidence: {
      surfaceFailures: [
        { surfaceId: 'codex', failureClass: 'EXECUTION_SURFACE_FAILURE' },
        { surfaceId: 'codex', failureClass: 'EXECUTION_SURFACE_FAILURE' },
      ],
      qualifiedSurfaces: ['codex', 'chatgpt-github'],
      safeEligibleWorkRemaining: true,
    },
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.controllerLivenessDecision.decision, 'REMAIN_ENABLED');
  assert.deepEqual(result.controllerLivenessDecision.blockedSurfaceIds, ['codex']);
  assert.equal(result.controllerLivenessDecision.selectedAlternateSurface, 'chatgpt-github');
  assert.equal(result.workerActionGrant.adapter, 'chatgpt-github');
  assert.equal(result.workerActionGrant.capacityRoute, 'CHATGPT_GITHUB');
  assert.equal(result.cycleReceipt.controllerShouldRemainEnabled, true);
  assert.equal(result.cycleReceipt.controllerDisableAllowed, false);
  assert.deepEqual(result.cycleReceipt.blockedSurfaceIds, ['codex']);
  assert.equal(result.cycleReceipt.selectedAlternateSurface, 'chatgpt-github');
});


test('stale capacity evidence is never recorded as a selected liveness alternate', async () => {
  const sourceMission = {
    missionId: 'critical-1497-controller-test',
    revision: 4,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: 'Reject stale alternate capacity',
    repository: REPOSITORY,
    operatorIntent: 'Keep the controller live without inventing an alternate route.',
    intendedOutcome: 'Stale capacity is rejected and no alternate is claimed.',
    allowedFiles: ['shared/agents/controller.mjs'],
    requiredTests: ['node --test shared/agents/controller.test.mjs'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
    git: { branch: BRANCH, worktreePath: '/bounded/worktree' },
  };
  const f = machineryFor(activeProjection({ criticalBacklog: { activeMission: sourceMission } }), {
    loadCapacityRoutingInput: async () => ({
      nowUtc: NOW,
      codexStatus: {
        schemaVersion: 'shared-agent-workspace-record.v1',
        statusId: 'codex-capacity-current',
        truthState: 'CURRENT',
        meterTruthUsable: true,
        observedAtUtc: NOW,
        remainingPercent: 80,
        availability: 'AVAILABLE',
        confidence: 'high',
      },
      githubLaneReceipt: {
        schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
        receiptId: 'github-builder-stale-liveness-test',
        route: 'CHATGPT_GITHUB',
        repository: REPOSITORY,
        workerId: 'shared-fabric-chatgpt-github-builder-01',
        state: 'READY',
        supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
        supportedTaskClasses: ['FOCUSED_REPAIR'],
        observedAtUtc: '2026-07-29T10:00:00.000Z',
        expiresAtUtc: '2026-07-29T10:15:00.000Z',
        queueDepth: 0,
        p95StartLatencySeconds: 15,
        authorityReceiptIds: [],
        proofRefs: ['receipts/github-builder/stale-capacity.json'],
      },
    }),
  });
  const result = await runDurableFlywheelStartupCycle(f.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
    controllerLivenessEvidence: {
      surfaceFailures: [
        { surfaceId: 'codex', failureClass: 'EXECUTION_SURFACE_FAILURE' },
        { surfaceId: 'codex', failureClass: 'EXECUTION_SURFACE_FAILURE' },
      ],
      qualifiedSurfaces: ['chatgpt-github'],
      safeEligibleWorkRemaining: true,
    },
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.workerActionGrant, undefined);
  assert.equal(result.controllerLivenessDecision.decision, 'REMAIN_ENABLED');
  assert.deepEqual(result.controllerLivenessDecision.blockedSurfaceIds, ['codex']);
  assert.deepEqual(result.controllerLivenessDecision.qualifiedSurfaces, []);
  assert.equal(result.controllerLivenessDecision.selectedAlternateSurface, null);
  assert.equal(result.controllerLivenessDecision.retryNextScheduledRun, true);
  assert.equal(result.cycleReceipt.selectedAlternateSurface, null);
  assert.equal(result.cycleReceipt.controllerShouldRemainEnabled, true);
  assert.equal(result.cycleReceipt.controllerDisableAllowed, false);
});
