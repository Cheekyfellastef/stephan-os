import { validateExecutionReceipt } from './executionReceiptV1.mjs';
import { buildMissionScheduler } from '../runtime/missionScheduler.mjs';

const SHA_RE=/^[0-9a-f]{40}$/i;
const ACTIVE_LANE_STATES=new Set(['ACTIVE','IMPLEMENTING','CI_REVIEW','PROOF_RUNNING']);
const KNOWN_LANE_STATES=new Set(['QUEUED','READY','ACTIVE','IMPLEMENTING','CI_REVIEW','PROOF_RUNNING','IMPLEMENTED','COMPLETE','CLOSED','SUPERSEDED','DUPLICATE','BLOCKED','STALLED','WAITING_FOR_DEPENDENCY','WAITING_FOR_EXTERNAL_CONDITION','APPROVAL_REQUIRED']);
const ACTIVE_MACHINERY_STATES=new Set(['ACTIVE','RUNNING','DISPATCHED','WAITING_PROOF']);
const KNOWN_MACHINERY_STATES=new Set(['IDLE','READY','ACTIVE','RUNNING','DISPATCHED','WAITING_PROOF','STOPPED','COMPLETE','COMPLETED','BLOCKED','FAILED','CANCELLED']);
const DEFAULT_HEARTBEAT_MAX_AGE_MS=20*60*1000;
const DEFAULT_RECEIPT_MAX_AGE_MS=2*60*60*1000;
const DEFAULT_FUTURE_SKEW_MS=60*1000;

const text=(value)=>typeof value==='string'&&value.trim()?value.trim():null;
const sha=(value)=>{const candidate=text(value);return candidate&&SHA_RE.test(candidate)?candidate.toLowerCase():null;};
const array=(value)=>Array.isArray(value)?value:[];
const hasOwn=(object,key)=>Boolean(object&&typeof object==='object'&&Object.prototype.hasOwnProperty.call(object,key));
const normalizedState=(value)=>text(value)?.toUpperCase()??'UNKNOWN';
function timestamp(value){const candidate=text(value);if(!candidate||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate))return null;const parsed=Date.parse(candidate);return Number.isFinite(parsed)?parsed:null;}
function evidenceAge(at,nowMs,futureSkewMs){const atMs=timestamp(at);if(atMs===null||nowMs===null)return{ageMs:Number.POSITIVE_INFINITY,future:false,valid:false};if(atMs-nowMs>futureSkewMs)return{ageMs:Number.POSITIVE_INFINITY,future:true,valid:false};return{ageMs:Math.max(0,nowMs-atMs),future:false,valid:true};}
function validLaneRecord(lane){if(!lane||typeof lane!=='object'||Array.isArray(lane))return false;const state=normalizedState(lane.state);return Boolean(text(lane.id)&&KNOWN_LANE_STATES.has(state)&&(!ACTIVE_LANE_STATES.has(state)||sha(lane.headSha)));}
const activeLane=(lane)=>validLaneRecord(lane)&&ACTIVE_LANE_STATES.has(normalizedState(lane.state));
function validMachineryRecord(machine){return Boolean(machine&&typeof machine==='object'&&!Array.isArray(machine)&&text(machine.id)&&text(machine.kind)&&KNOWN_MACHINERY_STATES.has(normalizedState(machine.state)));}
const activeMachine=(machine)=>validMachineryRecord(machine)&&ACTIVE_MACHINERY_STATES.has(normalizedState(machine.state));
function duplicateActiveMachinery(machinery){const groups=new Map();for(const machine of array(machinery).filter(activeMachine)){const kind=text(machine.kind)?.toLowerCase()??'unknown';groups.set(kind,[...(groups.get(kind)??[]),text(machine.id)??text(machine.name)??kind]);}return[...groups.entries()].filter(([,entries])=>entries.length>1).map(([kind,entries])=>({kind,entries}));}
function validLease(lease,nowMs){const expiresAtMs=timestamp(lease?.expiresAt);return Boolean(lease&&typeof lease==='object'&&nowMs!==null&&text(lease.owner)&&text(lease.laneId)&&expiresAtMs!==null&&expiresAtMs>nowMs);}
function schedulerReceiptEvidence(receipt,nowMs,maxAgeMs,futureSkewMs){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return{valid:false,reason:'missing-scheduler-receipt'};
  const allowed=new Set(['BLOCKED_FAIL_CLOSED','ACTIVE_LANE','MERGE_READY','CLOSE_READY','LANE_SELECTED','APPROVAL_REQUIRED','WAITING']);
  if(!text(receipt.correlationId)||!allowed.has(text(receipt.status))||typeof receipt.failClosed!=='boolean'||!Array.isArray(receipt.contradictionCodes))return{valid:false,reason:'scheduler-receipt-contract-invalid'};
  if(receipt.failClosed===true||receipt.status==='BLOCKED_FAIL_CLOSED'||receipt.contradictionCodes.length>0)return{valid:false,reason:'scheduler-receipt-fail-closed'};
  const age=evidenceAge(receipt.decidedAt,nowMs,futureSkewMs);if(age.future)return{valid:false,reason:'scheduler-receipt-future-dated'};if(!age.valid||age.ageMs>maxAgeMs)return{valid:false,reason:'scheduler-receipt-stale'};return{valid:true,reason:null};
}
function executionReceiptEvidence(receipt,lane,lease,nowMs,maxAgeMs,futureSkewMs){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return{valid:false,reason:'missing-execution-receipt'};
  const options={expectedHead:sha(lane?.headSha),leaseKey:text(lease?.laneId)};
  const validation=validateExecutionReceipt(receipt,options);
  if(!validation.valid)return{valid:false,reason:`execution-receipt-${validation.refusalReason||'contract-invalid'}`};
  if(text(receipt.workerId)!==text(lease?.owner))return{valid:false,reason:'execution-receipt-worker-lease-owner-mismatch'};
  if(receipt.state!=='completed')return{valid:false,reason:'execution-receipt-not-complete'};
  const age=evidenceAge(receipt.timestampUtc,nowMs,futureSkewMs);if(age.future)return{valid:false,reason:'execution-receipt-future-dated'};if(!age.valid||age.ageMs>maxAgeMs)return{valid:false,reason:'execution-receipt-stale'};return{valid:true,reason:null};
}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;if(Array.isArray(value))return Object.freeze(value.map(freeze));for(const key of Object.keys(value))value[key]=freeze(value[key]);return Object.freeze(value);}
function requireFunction(value,name){if(typeof value!=='function')throw new TypeError(`${name} must be a function`);return value;}
function schedulerInputFromSnapshot(snapshot,now){return{now:now??snapshot.observedAt,goals:snapshot.github?.goals,proofHeadShas:snapshot.receipts?.proofHeadShas,proofReceipts:snapshot.receipts?.proofReceipts,proofRefs:snapshot.receipts?.proofRefs,correlationId:text(snapshot.correlationId)??undefined};}
function cycleReceipt({reconciliation,scheduler=null,execution=null}){return freeze({schema:'Stephanos Durable Flywheel Startup Cycle VNext',status:reconciliation.status==='HOLD'?'HOLD':execution?.status??(scheduler?'SCHEDULER_DECIDED':'RECONCILED'),chatMemoryAuthoritative:false,reconciliation,schedulerDecision:scheduler?.decisionReceipt??null,execution:execution??null});}

export function reconcileDurableFlywheelController(snapshot={},options={}){
  const durableSnapshot=snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)?snapshot:{};
  const suppliedNow=options.now??durableSnapshot.observedAt;
  const nowMs=timestamp(suppliedNow);
  const heartbeatMaxAgeMs=Number.isFinite(options.heartbeatMaxAgeMs)?options.heartbeatMaxAgeMs:DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const receiptMaxAgeMs=Number.isFinite(options.receiptMaxAgeMs)?options.receiptMaxAgeMs:DEFAULT_RECEIPT_MAX_AGE_MS;
  const futureSkewMs=Number.isFinite(options.futureSkewMs)&&options.futureSkewMs>=0?options.futureSkewMs:DEFAULT_FUTURE_SKEW_MS;
  const blockers=[];const caveats=[];
  if(nowMs===null)blockers.push('reconciliation-time-unproven');
  const mainHead=sha(durableSnapshot.github?.mainHead);if(!mainHead)blockers.push('github-main-head-unproven');
  const lanesPresent=hasOwn(durableSnapshot.github,'implementationLanes');const lanesValid=lanesPresent&&Array.isArray(durableSnapshot.github.implementationLanes);if(!lanesValid)blockers.push('github-implementation-lanes-unproven');
  const laneInventory=lanesValid?durableSnapshot.github.implementationLanes:[];if(lanesValid&&laneInventory.some((lane)=>!validLaneRecord(lane)))blockers.push('github-implementation-lane-entry-invalid');
  const lanes=laneInventory.filter(activeLane);if(lanes.length>1)blockers.push('split-brain-multiple-active-implementation-lanes');
  const lease=durableSnapshot.sharedWorkspace?.sourceMutationLease;const leaseValid=validLease(lease,nowMs);
  if(lanes.length===1&&!leaseValid)blockers.push('active-lane-without-valid-source-mutation-lease');
  if(lanes.length===0&&leaseValid)blockers.push('valid-lease-without-active-lane');
  if(lanes.length===1&&leaseValid&&text(lease.laneId)!==text(lanes[0].id))blockers.push('lease-lane-binding-mismatch');
  const heartbeat=evidenceAge(durableSnapshot.sharedWorkspace?.controllerHeartbeat?.at,nowMs,futureSkewMs);if(heartbeat.future)blockers.push('controller-heartbeat-future-dated');else if(!heartbeat.valid||heartbeat.ageMs>heartbeatMaxAgeMs)blockers.push('controller-heartbeat-stale-or-missing');
  const machineryPresent=hasOwn(durableSnapshot.sharedWorkspace,'machineryInventory');const machineryValid=machineryPresent&&Array.isArray(durableSnapshot.sharedWorkspace.machineryInventory);if(!machineryValid)blockers.push('shared-workspace-machinery-inventory-unproven');
  const machinery=machineryValid?durableSnapshot.sharedWorkspace.machineryInventory:[];if(machineryValid&&machinery.some((machine)=>!validMachineryRecord(machine)))blockers.push('shared-workspace-machinery-entry-invalid');
  const duplicates=duplicateActiveMachinery(machinery);if(duplicates.length)blockers.push('duplicate-active-machinery');
  const schedulerReceipt=schedulerReceiptEvidence(durableSnapshot.receipts?.scheduler,nowMs,receiptMaxAgeMs,futureSkewMs);if(!schedulerReceipt.valid)blockers.push(schedulerReceipt.reason);
  if(lanes.length===1){const executionReceipt=executionReceiptEvidence(durableSnapshot.receipts?.execution,lanes[0],lease,nowMs,receiptMaxAgeMs,futureSkewMs);if(!executionReceipt.valid)blockers.push(executionReceipt.reason);}
  const runtimeProof=durableSnapshot.battleBridge?.proof;
  if(lanes.some((lane)=>normalizedState(lane.state)==='PROOF_RUNNING')){if(!runtimeProof||normalizedState(runtimeProof.state)!=='OBSERVED')blockers.push('battle-bridge-proof-missing');if(runtimeProof){const proofAge=evidenceAge(runtimeProof.at,nowMs,futureSkewMs);if(proofAge.future)blockers.push('battle-bridge-proof-future-dated');else if(!proofAge.valid||proofAge.ageMs>receiptMaxAgeMs)blockers.push('battle-bridge-proof-stale');}const activeHead=lanes.length===1?sha(lanes[0].headSha):null;if(runtimeProof&&activeHead&&sha(runtimeProof.sourceHead)!==activeHead)blockers.push('battle-bridge-proof-source-head-mismatch');}
  const status=blockers.length?'HOLD':'HEALTHY';const nextAction=blockers.length?'publish-reconciliation-receipt-and-stop-without-mutation':lanes.length===1?'advance-one-bounded-step-under-existing-lease':'scheduler-may-select-one-runnable-goal';
  return freeze({schema:'Stephanos Durable Flywheel Controller VNext',status,authoritativeSources:['github','shared-workspace','battle-bridge-proofs','execution-receipts'],chatMemoryAuthoritative:false,observedAt:text(suppliedNow),mainHead,activeLaneCount:lanes.length,activeLane:lanes.length===1?{id:text(lanes[0].id),state:normalizedState(lanes[0].state),headSha:sha(lanes[0].headSha)}:null,lease:{valid:leaseValid,owner:text(lease?.owner),laneId:text(lease?.laneId),expiresAt:text(lease?.expiresAt)},heartbeat:{ageMs:heartbeat.ageMs,fresh:heartbeat.valid&&heartbeat.ageMs<=heartbeatMaxAgeMs,futureDated:heartbeat.future},duplicateMachinery:duplicates,blockers,caveats,mergeAuthority:false,leaseSeizureAllowed:false,nextAction});
}

export async function runDurableFlywheelStartupCycle(machinery={},options={}){
  const loadDurableSnapshot=requireFunction(machinery.loadDurableSnapshot,'loadDurableSnapshot');const publishReceipt=requireFunction(machinery.publishReceipt,'publishReceipt');
  const loaded=await loadDurableSnapshot();const snapshot=loaded&&typeof loaded==='object'&&!Array.isArray(loaded)?loaded:{};const reconciliation=reconcileDurableFlywheelController(snapshot,options);
  if(reconciliation.status==='HOLD'){const receipt=cycleReceipt({reconciliation});await publishReceipt(receipt);return receipt;}
  if(reconciliation.activeLaneCount===1){const advance=requireFunction(machinery.advanceActiveLane,'advanceActiveLane');const execution=await advance({snapshot,lane:reconciliation.activeLane,lease:reconciliation.lease,boundedSteps:1,mergeAuthority:false,leaseSeizureAllowed:false});const receipt=cycleReceipt({reconciliation,execution});await publishReceipt(receipt);return receipt;}
  const scheduler=buildMissionScheduler(schedulerInputFromSnapshot(snapshot,options.now));if(scheduler.failClosed||!scheduler.selectedGoal){const receipt=cycleReceipt({reconciliation,scheduler});await publishReceipt(receipt);return receipt;}
  const dispatch=requireFunction(machinery.dispatchSelectedGoal,'dispatchSelectedGoal');const execution=await dispatch({snapshot,selectedGoal:scheduler.selectedGoal,selectedRoute:scheduler.selectedRoute,selectedLifecycle:scheduler.selectedLifecycle,schedulerReceipt:scheduler.decisionReceipt,boundedSteps:1,createReplacementMachinery:false,mergeAuthority:false,leaseSeizureAllowed:false});const receipt=cycleReceipt({reconciliation,scheduler,execution});await publishReceipt(receipt);return receipt;
}

export function renderDurableFlywheelReceipt(result){if(!result||typeof result!=='object')throw new TypeError('result is required');return['Durable Flywheel Reconciliation Receipt VNext',`Status: ${result.status}`,`Observed-At: ${result.observedAt??'unproven'}`,`Main-Head: ${result.mainHead??'unproven'}`,`Active-Lanes: ${result.activeLaneCount}`,`Lease-Valid: ${result.lease?.valid===true}`,`Heartbeat-Fresh: ${result.heartbeat?.fresh===true}`,'Merge-Authority: false','Lease-Seizure-Allowed: false',`Next-Action: ${result.nextAction}`,`Blockers: ${result.blockers?.length?result.blockers.join(', '):'none'}`,`Caveats: ${result.caveats?.length?result.caveats.join(', '):'none'}`].join('\n');}
