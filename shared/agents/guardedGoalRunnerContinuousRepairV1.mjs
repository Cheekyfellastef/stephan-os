import { createHash } from 'node:crypto';
import { evaluateGuardedRepairLoop } from './guardedGoalRunnerRepairLoopV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIONS = new Set(['OBSERVE_EXISTING_REPAIR','WAIT_FOR_CANONICAL_EXECUTION_RECEIPT']);
function text(v){return typeof v==='string'&&v.trim()?v.trim():null;}
function sha(v){const x=text(v);return x&&SHA_RE.test(x)?x.toLowerCase():null;}
function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;if(Array.isArray(v))return Object.freeze(v.map(freeze));for(const k of Object.keys(v))v[k]=freeze(v[k]);return Object.freeze(v);}
function fn(v,n){if(typeof v!=='function')throw new TypeError(`${n} must be a function`);return v;}
function id(snapshot,verdict,iteration){return `repair-cycle-${snapshot.prNumber}-${sha(snapshot.headSha)?.slice(0,12)||'unknown'}-${iteration}-${createHash('sha256').update(JSON.stringify([verdict.verdict,verdict.repairOrder?.findingIds??[]])).digest('hex').slice(0,12)}`;}
function receipt(snapshot,verdict,iteration,status,extra={}){return freeze({schema:'Stephanos Guarded Continuous Repair Cycle V1',cycleId:id(snapshot,verdict,iteration),repository:text(snapshot.repository),issueNumber:snapshot.issueNumber,prNumber:snapshot.prNumber,headSha:sha(snapshot.headSha),iteration,status,verdict:verdict.verdict,nextAction:verdict.nextAction,repairOrderId:verdict.repairOrder?.repairOrderId??null,findingIds:verdict.repairOrder?.findingIds??[],mergeAuthority:false,approvalAuthority:false,...extra});}
function result(status,last,history){return freeze({status,receipt:last,history:[...history],mergeAuthority:false,approvalAuthority:false});}

export async function runGuardedContinuousRepairCycle(options={}){
 const loadSnapshot=fn(options.loadSnapshot,'loadSnapshot');
 const persistCycleReceipt=fn(options.persistCycleReceipt,'persistCycleReceipt');
 const persistExecutionReceipt=fn(options.persistExecutionReceipt,'persistExecutionReceipt');
 const dispatchRepair=fn(options.dispatchRepair,'dispatchRepair');
 const requestExactHeadVerification=fn(options.requestExactHeadVerification,'requestExactHeadVerification');
 const maxIterations=Number.isSafeInteger(options.maxIterations)&&options.maxIterations>0?options.maxIterations:12;
 const maxRepairsPerHead=Number.isSafeInteger(options.maxRepairsPerHead)&&options.maxRepairsPerHead>0?options.maxRepairsPerHead:4;
 const history=Array.isArray(options.history)?[...options.history]:[];
 for(let iteration=1;iteration<=maxIterations;iteration+=1){
  const snapshot=await loadSnapshot({iteration,previousReceipt:history.at(-1)??null});
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)){const r=receipt({}, {verdict:'abort-missing-proof',nextAction:'STOP_AND_SURFACE_BLOCKER'},iteration,'blocked',{reason:'Durable repair snapshot is missing or malformed.'});await persistCycleReceipt(r);history.push(r);return result('BLOCKED',r,history);}
  const verdict=evaluateGuardedRepairLoop(snapshot);
  if(verdict.nextAction==='PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER'){
   const count=history.filter(x=>x?.status==='repair-dispatched'&&sha(x.headSha)===sha(snapshot.headSha)).length;
   if(count>=maxRepairsPerHead){const r=receipt(snapshot,verdict,iteration,'blocked',{reason:'Automatic repair budget exhausted for this exact head.'});await persistCycleReceipt(r);history.push(r);return result('BLOCKED_REPAIR_BUDGET',r,history);}
   await persistExecutionReceipt(verdict.nextReceipt,{snapshot,verdict});
   const dispatched=await dispatchRepair(verdict.repairOrder,{snapshot,verdict});
   const r=receipt(snapshot,verdict,iteration,'repair-dispatched',{dispatchAccepted:dispatched?.accepted===true,workerTaskId:text(dispatched?.workerTaskId)});await persistCycleReceipt(r);history.push(r);
   if(dispatched?.accepted!==true)return result('BLOCKED_DISPATCH_REJECTED',r,history);
   continue;
  }
  if(ACTIONS.has(verdict.nextAction)){const r=receipt(snapshot,verdict,iteration,'waiting-repair',{reason:verdict.reason});await persistCycleReceipt(r);history.push(r);continue;}
  if(verdict.nextAction==='WAIT_FOR_EXACT_HEAD_VERIFICATION'){
   const verification=await requestExactHeadVerification({snapshot,verdict,headSha:sha(snapshot.headSha)});
   const r=receipt(snapshot,verdict,iteration,'verification-requested',{verificationAccepted:verification?.accepted===true,verificationId:text(verification?.verificationId)});await persistCycleReceipt(r);history.push(r);
   if(verification?.accepted!==true)return result('BLOCKED_VERIFICATION_REJECTED',r,history);
   continue;
  }
  if(verdict.nextAction==='REQUEST_EXACT_HEAD_MERGE_APPROVAL'){const r=receipt(snapshot,verdict,iteration,'merge-ready',{expectedHeadSha:sha(verdict.expectedHeadSha??snapshot.headSha),reason:verdict.reason});await persistCycleReceipt(r);history.push(r);return result('MERGE_READY',r,history);}
  if(verdict.nextAction==='COMPLETE_AND_SELECT_NEXT_GOAL'){const r=receipt(snapshot,verdict,iteration,'complete',{reason:verdict.reason});await persistCycleReceipt(r);history.push(r);return result('COMPLETE',r,history);}
  const r=receipt(snapshot,verdict,iteration,'blocked',{reason:verdict.reason});await persistCycleReceipt(r);history.push(r);return result('BLOCKED',r,history);
 }
 return result('BLOCKED_ITERATION_BUDGET',history.at(-1)??null,history);
}
