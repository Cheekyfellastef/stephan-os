export const AUTONOMY_BUILD_TRACK_SCHEMA = 'stephanos.autonomy-build-track.v1';
export const AUTONOMY_BUILD_TRACK_STATUS_ID = 'autonomy-build-track-current';

export const AUTONOMY_BUILD_TRACK_STATES = Object.freeze({
  PASS: 'PASS',
  BLOCKED: 'BLOCKED',
  WAITING: 'WAITING',
  NOT_REACHED: 'NOT_REACHED',
  UNKNOWN: 'UNKNOWN',
});

export const AUTONOMY_BUILD_TRACK_GATES = Object.freeze([
  'SYNC','CONTROL_PLANE','HEARTBEAT','ELIGIBLE_GOAL','SELECT','MISSION','CLAIM','WORKER','PROVIDER',
  'SOURCE_CHANGED','TESTED','TERMINAL_RECEIPT','REVIEW_HANDOFF','RELEASE','SELECT_NEXT',
]);

const LIVE_GATES = Object.freeze([
  'HEARTBEAT','ELIGIBLE_GOAL','SELECT','MISSION','CLAIM','WORKER','PROVIDER',
  'SOURCE_CHANGED','TESTED','TERMINAL_RECEIPT','REVIEW_HANDOFF','RELEASE','SELECT_NEXT',
]);

function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function freezeGate(id, state, reason = '') { return Object.freeze({ id, state, reason: text(reason) }); }
function issueFromMission(mission = {}) { const direct=Number(mission.issueNumber||mission.issue||0); if(Number.isSafeInteger(direct)&&direct>0)return direct; const parsed=Number(text(mission.missionId).match(/^critical-([1-9]\d*)-elastic-goal/i)?.[1]||0); return Number.isSafeInteger(parsed)&&parsed>0?parsed:null; }
function selectedMission(conveyor={}) { return conveyor?.elasticAdmission?.selectedMission||conveyor?.projection?.activeMission||conveyor?.missionRecord||null; }
function dispatchFacts(conveyor={}) { const elastic=conveyor?.elasticIgnition||{}, active=conveyor?.activeMissionIgnition||{}; const dispatched=Number(elastic.dispatchCount||0)>0||active.published===true||active.classification==='CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING'; const blocked=elastic.ok===false||active.ok===false; const reason=(Array.isArray(elastic.held)&&elastic.held.length?elastic.held.map(i=>text(i?.reason)).filter(Boolean).join(','):'')||(Array.isArray(active.blockers)?active.blockers.map(text).filter(Boolean).join(','):'')||text(elastic.classification||active.classification); return Object.freeze({dispatched,blocked,reason}); }
function firstActionableGate(gates=[]) { return gates.find(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.BLOCKED)||gates.find(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.WAITING)||gates.find(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.UNKNOWN)||gates.find(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED)||null; }
function lastPassedGate(gates=[]) { return [...gates].reverse().find(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.PASS)?.id||''; }

function gateGuidance(gate={}) {
  const reason=text(gate.reason);
  const detail=reason ? `: ${reason}` : '';
  const guidance={
    SYNC:['Battle Bridge source sync is not proven'+detail,'Repair or refresh the canonical GitHub sync before diagnosing downstream build stages.'],
    CONTROL_PLANE:['The Stephanos control plane is not proven ready'+detail,'Repair the control-plane/runtime refresh blocker, then rerun the existing heartbeat.'],
    HEARTBEAT:['The autonomous goal heartbeat is blocked'+detail,'Inspect the heartbeat/conveyor failure. Do not infer scheduler or worker health from later stale records.'],
    ELIGIBLE_GOAL:['No eligible goal reached the autonomous conveyor'+detail,'Inspect canonical goal discovery, admission and eligibility. Confirm an open goal becomes scheduler-visible.'],
    SELECT:['A goal is visible but scheduler selection is not proven'+detail,'Inspect the scheduler decision and contradictions for the visible goal.'],
    MISSION:['The scheduler selected work but no durable mission is visible'+detail,'Inspect mission creation/publication and mission-store persistence for the selected goal.'],
    CLAIM:['A mission exists but no source claim/dispatch is proven'+detail,'Inspect lease/claim creation and the provider-neutral dispatch handoff for this mission.'],
    WORKER:['A claim exists but the source worker has not picked it up'+detail,'Inspect the Mission Worker heartbeat, queue claim and worker acceptance for this mission.'],
    PROVIDER:['The worker reached provider execution but the provider did not complete'+detail,'Inspect the selected provider/adapter result and route around unavailable capacity without changing mission identity.'],
    SOURCE_CHANGED:['Provider execution did not produce a valid source change'+detail,'Inspect the bounded source-builder failure and preserve the exact mission/branch/worktree identity.'],
    TESTED:['Source changed but required deterministic tests are not proven'+detail,'Run or repair the mission-bound required tests before handoff.'],
    TERMINAL_RECEIPT:['Source and tests passed but the terminal execution receipt is not proven'+detail,'Publish or repair the exact mission execution receipt before review handoff.'],
    REVIEW_HANDOFF:['Build completion has not reached exact-head review handoff'+detail,'Inspect review dispatch/publication for the exact completed head.'],
    RELEASE:['The completed construction slot has not been released'+detail,'Inspect exact lease/slot release after terminal evidence.'],
    SELECT_NEXT:['The previous lane completed but the next selection cycle is not proven'+detail,'Run the existing controller cycle and verify capacity refills or truthfully reports no eligible work.'],
  };
  return guidance[gate.id]||['Autonomy build telemetry is incomplete'+detail,'Refresh canonical telemetry and inspect the first non-passing gate.'];
}

function buildTrack({timestampUtc,sourceHead='',missionId='',issueNumber=null,actionId='',providerAdapter='',cycleId='',attemptNumber=0,materialActionsSucceeded=0,successfulMissionIds=[],cycleDecision=null,gates=[]}={}) {
  const actionable=firstActionableGate(gates);
  const [diagnosis,exactNextAction]=actionable?gateGuidance(actionable):['The autonomous build chain is fully proven.','Continue through the existing controller and select the next eligible goal.'];
  return Object.freeze({
    schemaVersion:AUTONOMY_BUILD_TRACK_SCHEMA,
    timestampUtc:text(timestampUtc),
    cycleId:text(cycleId),
    attemptNumber:Number.isSafeInteger(Number(attemptNumber))&&Number(attemptNumber)>0?Number(attemptNumber):0,
    materialActionsSucceeded:Math.max(0,Number.parseInt(materialActionsSucceeded,10)||0),
    successfulMissionIds:Object.freeze([...new Set((Array.isArray(successfulMissionIds)?successfulMissionIds:[]).map(text).filter(Boolean))]),
    cycleDecision:cycleDecision&&typeof cycleDecision==='object'?cycleDecision:null,
    sourceHead:text(sourceHead).toLowerCase(),
    missionId:text(missionId),
    issueNumber:Number.isSafeInteger(issueNumber)&&issueNumber>0?issueNumber:null,
    actionId:text(actionId),
    providerAdapter:text(providerAdapter),
    gates:Object.freeze(gates),
    currentGate:actionable?.id||'COMPLETE',
    currentState:actionable?.state||AUTONOMY_BUILD_TRACK_STATES.PASS,
    currentReason:text(actionable?.reason),
    blocker:actionable?.state===AUTONOMY_BUILD_TRACK_STATES.BLOCKED?text(actionable.reason):'',
    diagnosis,
    exactNextAction,
    lastPassedGate:lastPassedGate(gates),
    autonomousLoopProven:gates.length>0&&gates.every(g=>g.state===AUTONOMY_BUILD_TRACK_STATES.PASS),
  });
}

export function projectHeartbeatAutonomyBuildTrack({conveyorResult=null,sourceBuild=null,timestampUtc=new Date().toISOString(),cycleId='',attemptNumber=0,materialActionsSucceeded=0,successfulMissionIds=[],cycleDecision=null}={}) {
  const conveyor=conveyorResult||{};
  const conveyorOk=conveyor?.ok===true;
  const mission=selectedMission(conveyor);
  const missionId=text(mission?.missionId||conveyor?.missionRecord?.missionId);
  const selectedItemId=text(conveyor?.projection?.selectedItem?.itemId);
  const remainingItems=Array.isArray(conveyor?.projection?.remainingItemIds)?conveyor.projection.remainingItemIds:[];
  const observed=Boolean(selectedItemId||missionId||remainingItems.length||conveyor?.classification==='ELASTIC_GOAL_MISSION_SELECTED'||conveyor?.classification==='WAIT_ACTIVE_MISSION');
  const selected=Boolean(selectedItemId||missionId||conveyor?.classification==='ELASTIC_GOAL_MISSION_SELECTED'||conveyor?.classification==='WAIT_ACTIVE_MISSION');
  const missionCreated=Boolean(missionId);
  const issueNumber=issueFromMission(mission||conveyor?.missionRecord||{});
  const dispatch=dispatchFacts(conveyor);
  const processed=sourceBuild?.processed===true;
  const success=processed&&sourceBuild?.success===true;
  const typedUnprocessedBlocker=[
    'PROVIDER_NEUTRAL_ORPHAN_RECOVERY_HOLD',
    'PROVIDER_NEUTRAL_SOURCE_BUILD_EXCEPTION',
    'PROVIDER_NEUTRAL_PENDING_QUEUE_RECOVERY',
  ].includes(text(sourceBuild?.finalVerdict));
  const buildBlocked=(processed&&sourceBuild?.success===false)||typedUnprocessedBlocker;
  const adapter=text(sourceBuild?.providerAdapter||sourceBuild?.adapter);
  const providerInvoked=typeof sourceBuild?.providerInvoked==='boolean'
    ? sourceBuild.providerInvoked
    : processed&&Boolean(adapter);
  const providerCompleted=typeof sourceBuild?.providerCompleted==='boolean'
    ? sourceBuild.providerCompleted
    : success&&Boolean(adapter);
  const failureStage=text(sourceBuild?.failureStage);
  const sourceHead=text(conveyor?.elasticIgnition?.sourceRevision||conveyor?.activeMissionIgnition?.sourceRevision||sourceBuild?.sourceHead);
  const actionId=text(sourceBuild?.actionId);
  const exactBuildMissionId=text(sourceBuild?.missionId);
  const hasExactBuildIdentity=Boolean(exactBuildMissionId||actionId);
  const conveyorBlocker=text(conveyor?.blocker||conveyor?.classification||conveyor?.finalVerdict);
  const buildReason=text(sourceBuild?.error||sourceBuild?.reason||sourceBuild?.finalVerdict);
  const claimBlocked=typedUnprocessedBlocker&&(
    text(sourceBuild?.finalVerdict)==='PROVIDER_NEUTRAL_PENDING_QUEUE_RECOVERY'
    || !hasExactBuildIdentity
  );
  const workerPreProviderBlocked=buildBlocked&&!claimBlocked&&(
    failureStage==='WORKER_PRE_PROVIDER'
    || failureStage==='WORKER'
    || failureStage==='WORKER_UNKNOWN'
    || (!processed&&!failureStage)
  );
  const claimPass=dispatch.dispatched||processed||workerPreProviderBlocked;
  const providerBlocked=buildBlocked&&!claimBlocked&&!workerPreProviderBlocked&&(failureStage==='PROVIDER'||(providerInvoked&&!providerCompleted));
  const sourceBlocked=buildBlocked&&!claimBlocked&&!workerPreProviderBlocked&&!providerBlocked;

  const gates=[
    freezeGate('HEARTBEAT',conveyorOk?'PASS':'BLOCKED',conveyorOk?'':conveyorBlocker),
    freezeGate('ELIGIBLE_GOAL',observed?'PASS':(conveyorOk?'WAITING':'NOT_REACHED'),observed?'':'NO_ELIGIBLE_GOAL_OBSERVED'),
    freezeGate('SELECT',selected?'PASS':observed?'WAITING':'NOT_REACHED',selected?'':'SCHEDULER_SELECTION_NOT_OBSERVED'),
    freezeGate('MISSION',missionCreated?'PASS':selected?'WAITING':'NOT_REACHED',missionCreated?'':'MISSION_NOT_CREATED'),
    freezeGate('CLAIM',claimBlocked?'BLOCKED':claimPass?'PASS':missionCreated&&dispatch.blocked?'BLOCKED':missionCreated?'WAITING':'NOT_REACHED',claimBlocked?buildReason:claimPass?'':dispatch.reason||'SOURCE_CLAIM_NOT_OBSERVED'),
    freezeGate('WORKER',workerPreProviderBlocked?'BLOCKED':processed?'PASS':claimPass?'WAITING':'NOT_REACHED',workerPreProviderBlocked?buildReason:processed?'':'WORKER_PICKUP_NOT_OBSERVED'),
    freezeGate('PROVIDER',providerCompleted?'PASS':providerBlocked?'BLOCKED':processed&&providerInvoked?'WAITING':processed?'NOT_REACHED':'NOT_REACHED',providerCompleted?'':providerBlocked?buildReason:providerInvoked?'PROVIDER_COMPLETION_NOT_OBSERVED':'PROVIDER_INVOCATION_NOT_OBSERVED'),
    freezeGate('SOURCE_CHANGED',success?'PASS':sourceBlocked?'BLOCKED':'NOT_REACHED',sourceBlocked?buildReason:''),
    freezeGate('TESTED',success?'PASS':'NOT_REACHED'),
    freezeGate('TERMINAL_RECEIPT',success?'PASS':'NOT_REACHED'),
    freezeGate('REVIEW_HANDOFF',success?'WAITING':'NOT_REACHED',success?'REVIEW_HANDOFF_NOT_OBSERVED':''),
    freezeGate('RELEASE','NOT_REACHED'),
    freezeGate('SELECT_NEXT','NOT_REACHED'),
  ];
  const projectedMissionId=buildBlocked?exactBuildMissionId:missionId;
  const projectedIssueNumber=buildBlocked&&!exactBuildMissionId?null:issueNumber;
  return buildTrack({timestampUtc,sourceHead,missionId:projectedMissionId,issueNumber:projectedIssueNumber,actionId,providerAdapter:adapter,cycleId,attemptNumber,materialActionsSucceeded,successfulMissionIds,cycleDecision,gates});
}

function recordMs(record) { if (!record || typeof record !== 'object') return 0; const parsed=Date.parse(text(record.timestampUtc||record.checkedAtUtc||record.createdAt)); return Number.isFinite(parsed)?parsed:0; }
function latestStatus(records=[],statusId) { return (Array.isArray(records)?records:[]).filter(r=>text(r?.statusId)===statusId).sort((l,r)=>recordMs(r)-recordMs(l))[0]||null; }
function isFresh(record,nowMs,staleAfterMs) { const ms=recordMs(record); return Boolean(ms&&nowMs-ms<=staleAfterMs); }
function syncGate(sync,fresh) { if(!sync)return freezeGate('SYNC','UNKNOWN','SYNC_STATUS_MISSING'); const value=text(sync.status||sync.classification||sync.evaluation?.classification).toUpperCase(); if(!fresh)return freezeGate('SYNC','UNKNOWN','SYNC_STATUS_STALE'); if(value.includes('BLOCK'))return freezeGate('SYNC','BLOCKED',value); if(value.includes('SYNC_NO_CHANGE')||value.includes('SYNC')||value.includes('PASS'))return freezeGate('SYNC','PASS'); return freezeGate('SYNC','UNKNOWN',value||'SYNC_STATUS_UNKNOWN'); }
function controlPlaneGate({refresh,refreshFresh,heartbeat,heartbeatFresh}) { if(heartbeatFresh&&heartbeat?.autonomyTrack?.gates?.some(g=>g?.id==='HEARTBEAT'&&g?.state==='PASS'))return freezeGate('CONTROL_PLANE','PASS'); const blocker=text(refresh?.blocker); if(blocker.startsWith('CONTROL_PLANE_'))return freezeGate('CONTROL_PLANE','BLOCKED',blocker); if(!refresh)return freezeGate('CONTROL_PLANE','UNKNOWN','CONTROL_PLANE_STATUS_MISSING'); if(!refreshFresh)return freezeGate('CONTROL_PLANE','UNKNOWN',blocker||'CONTROL_PLANE_STATUS_STALE'); const status=text(refresh.status||refresh.classification).toUpperCase(); if(status.includes('BLOCK')&&blocker)return freezeGate('CONTROL_PLANE','BLOCKED',blocker); if(!blocker&&(status.includes('COMPLETE')||status.includes('PASS')||refresh.exactHeadProofOk===true))return freezeGate('CONTROL_PLANE','PASS'); return freezeGate('CONTROL_PLANE','UNKNOWN',blocker||status||'CONTROL_PLANE_STATUS_UNKNOWN'); }

function timestamp(value) { const parsed=Date.parse(text(value)); return Number.isFinite(parsed)?parsed:0; }
function matchingTerminalRelease(records,track,nowMs,staleAfterMs) {
  const missionId=text(track?.missionId);
  const heartbeatMs=timestamp(track?.timestampUtc);
  if(!missionId||!heartbeatMs)return null;
  const issueNumber=Number(track?.issueNumber||0);
  return (Array.isArray(records)?records:[])
    .filter((record)=>{
      const releasedMs=timestamp(record?.releasedAtUtc||record?.timestampUtc);
      return text(record?.schema)==='stephanos.source-mutation-lease-release.v1'
        && text(record?.statusId).startsWith('source-lease-release-')
        && text(record?.participantId)==='source-mutation-lease-authority'
        && text(record?.status).toUpperCase()==='RELEASED'
        && text(record?.laneId)===missionId
        && (!issueNumber||Number(record?.issueNumber||0)===issueNumber)
        && record?.releaseOnlyExactLease===true
        && record?.mergeAuthority===false
        && releasedMs>=heartbeatMs
        && isFresh(record,nowMs,staleAfterMs);
    })
    .sort((left,right)=>recordMs(right)-recordMs(left))[0]||null;
}
function controllerReselectionAfterRelease(records,release,track,nowMs,staleAfterMs) {
  const releaseMs=timestamp(release?.releasedAtUtc||release?.timestampUtc);
  if(!releaseMs)return null;
  const priorMissionId=text(track?.missionId);
  const candidates=(Array.isArray(records)?records:[])
    .filter((record)=>{
      const observedMs=recordMs(record);
      const reconciledMs=timestamp(record?.lastSuccessfulReconciliationUtc);
      return text(record?.schema)==='stephanos.programme-controller-heartbeat.v1'
        && text(record?.statusId)==='programme-controller-heartbeat'
        && text(record?.participantId)===text(record?.controllerId)
        && observedMs>=releaseMs
        && reconciledMs>=releaseMs
        && Boolean(text(record?.lastPublishedReceiptId))
        && isFresh(record,nowMs,staleAfterMs);
    })
    .sort((left,right)=>recordMs(right)-recordMs(left));
  for(const record of candidates) {
    const state=text(record?.cycleState).toUpperCase();
    const activeLaneId=text(record?.activeLaneId);
    if(state==='ACTIVE_LANE'&&activeLaneId&&activeLaneId!==priorMissionId) return {record,outcome:'NEXT_LANE_SELECTED'};
    if(state==='IDLE'&&!activeLaneId) return {record,outcome:'RECONCILED_NO_ELIGIBLE_NEXT_WORK'};
  }
  return null;
}
function overlayTerminalTail(gates,{statusRecords,heartbeatTrack,nowMs,staleAfterMs}) {
  if(!heartbeatTrack||!Array.isArray(gates))return gates;
  const terminalPassed=heartbeatTrack.gates?.some((gate)=>gate?.id==='TERMINAL_RECEIPT'&&gate?.state==='PASS');
  if(!terminalPassed)return gates;
  const release=matchingTerminalRelease(statusRecords,heartbeatTrack,nowMs,staleAfterMs);
  if(!release)return gates;
  const reselection=controllerReselectionAfterRelease(statusRecords,release,heartbeatTrack,nowMs,staleAfterMs);
  return gates.map((gate)=>{
    if(gate.id==='REVIEW_HANDOFF')return freezeGate('REVIEW_HANDOFF','PASS','TERMINAL_LANE_RELEASE_PROVES_REVIEW_HANDOFF');
    if(gate.id==='RELEASE')return freezeGate('RELEASE','PASS','MATCHING_SOURCE_MUTATION_LEASE_RELEASED');
    if(gate.id==='SELECT_NEXT')return reselection
      ? freezeGate('SELECT_NEXT','PASS',reselection.outcome)
      : freezeGate('SELECT_NEXT','WAITING','CONTROLLER_RESELECTION_NOT_OBSERVED_AFTER_RELEASE');
    return gate;
  });
}

export function projectWorkspaceAutonomyBuildTrack({statusRecords=[],nowMs=Date.now(),staleAfterMs=60*60*1000}={}) {
  const sync=latestStatus(statusRecords,'battle-bridge-github-sync-current');
  const refresh=latestStatus(statusRecords,'post-sync-runtime-refresh-current');
  const heartbeat=latestStatus(statusRecords,AUTONOMY_BUILD_TRACK_STATUS_ID);
  const syncFresh=isFresh(sync,nowMs,staleAfterMs);
  const refreshFresh=isFresh(refresh,nowMs,staleAfterMs);
  const heartbeatFresh=isFresh(heartbeat,nowMs,staleAfterMs);
  const heartbeatTrack=heartbeatFresh&&heartbeat?.autonomyTrack?.schemaVersion===AUTONOMY_BUILD_TRACK_SCHEMA?heartbeat.autonomyTrack:null;
  const syncStatus=syncGate(sync,syncFresh);
  const controlPlaneStatus=controlPlaneGate({refresh,refreshFresh,heartbeat,heartbeatFresh});
  const fallback=LIVE_GATES.map((id,index)=>freezeGate(
    id,
    controlPlaneStatus.state==='BLOCKED' ? 'NOT_REACHED' : index===0 ? 'UNKNOWN' : 'NOT_REACHED',
    controlPlaneStatus.state==='BLOCKED' ? '' : index===0 ? 'HEARTBEAT_TELEMETRY_MISSING_OR_STALE' : '',
  ));
  const heartbeatGates=heartbeatTrack?.gates||fallback;
  const tailAwareHeartbeatGates=overlayTerminalTail(heartbeatGates,{statusRecords,heartbeatTrack,nowMs,staleAfterMs});
  const gates=[syncStatus,controlPlaneStatus,...tailAwareHeartbeatGates];
  return buildTrack({
    timestampUtc:new Date(nowMs).toISOString(),
    sourceHead:heartbeatTrack?.sourceHead||text(sync?.sourceHead||sync?.localHeadAfter||sync?.remoteHeadObserved),
    missionId:heartbeatTrack?.missionId||'',
    issueNumber:heartbeatTrack?.issueNumber||null,
    actionId:heartbeatTrack?.actionId||'',
    providerAdapter:heartbeatTrack?.providerAdapter||'',
    cycleId:heartbeatTrack?.cycleId||'',
    attemptNumber:heartbeatTrack?.attemptNumber||0,
    materialActionsSucceeded:heartbeatTrack?.materialActionsSucceeded||0,
    successfulMissionIds:heartbeatTrack?.successfulMissionIds||[],
    cycleDecision:heartbeatTrack?.cycleDecision||null,
    gates,
  });
}
