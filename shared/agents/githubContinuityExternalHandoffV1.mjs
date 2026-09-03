import {
  GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA,
} from './githubContinuityExecutionGrantV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';
import {
  MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
  MISSION_ORCHESTRATOR_SCHEMA_VERSION,
  applyMissionOrchestratorEvent,
} from './missionOrchestrator.mjs';
import { buildMissionWorkerAction } from './missionOrchestratorWorker.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA = 'stephanos.github-continuity-external-handoff.v1';
export const GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA = 'stephanos.github-continuity-external-completion.v1';
export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA = 'stephanos.external-build-lane-handoff.v1';
export const MISSION_WORKER_QUEUE_ITEM_SCHEMA = 'stephanos.mission-worker-queue-item.v1';
export const GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE = Object.freeze({
  EXTERNAL_HANDOFF_CANDIDATE_READY: 'EXTERNAL_HANDOFF_CANDIDATE_READY',
  EXISTING_IN_PROCESS_ROUTE_PRESERVED: 'EXISTING_IN_PROCESS_ROUTE_PRESERVED',
  SAFE_HOLD: 'SAFE_HOLD',
});

const EXTERNAL_ROUTES = new Map([
  [MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB, 'chatgpt-github'],
  [MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE, 'foundry-forge'],
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const BUILD_KEYS = new Set(['repository', 'expectedSourceHead', 'nowUtc', 'executionGrant', 'missionState']);
const COMPLETION_INPUT_KEYS = new Set(['handoff', 'completionReceipt', 'missionState']);
const GRANT_KEYS = Object.freeze([
  'schemaVersion','grantId','repository','expectedSourceHead','missionId','taskId','route','adapter',
  'selectedCapacityReceiptId','proofRefs','grantedAtUtc','executionScope','windowsBound',
  'existingDispatchTakeoverAllowed','sourceMutationAuthorityAdded','mergeAuthorityAdded',
  'deploymentAuthorityAdded','runtimeMutationAuthorityAdded','protectedMergeDispatchAllowed',
  'leaseSeizureAllowed','duplicateDispatchAllowed','arbitraryCommandAllowed',
]);
const COMPLETION_KEYS = Object.freeze([
  'schemaVersion','handoffId','grantId','missionId','taskId','repository','expectedSourceHead','adapter',
  'capacityRoute','success','resultId','changedFiles','receipt','proofRefs','completedAtUtc','error',
  'sourceMutationAuthorityAdded','mergeAuthorityAdded','deploymentAuthorityAdded','runtimeMutationAuthorityAdded',
  'protectedMergeDispatchAllowed','duplicateDispatchAllowed','arbitraryCommandAllowed',
]);
const ZERO_AUTHORITY = Object.freeze({
  queueWriteAllowed:false, sharedWorkspaceWriteAllowed:false, existingDispatchTakeoverAllowed:false,
  sourceMutationAuthorityAdded:false, mergeAuthorityAdded:false, deploymentAuthorityAdded:false,
  runtimeMutationAuthorityAdded:false, protectedMergeDispatchAllowed:false, leaseSeizureAllowed:false,
  duplicateDispatchAllowed:false, arbitraryCommandAllowed:false,
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function isoMs(value) {
  const v = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString() === v ? ms : null;
}
function snapshot(value, state={n:0}, depth=0, seen=new Set()) {
  state.n += 1;
  if (state.n > 8192 || depth > 16) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= 32768 ? value : undefined;
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) return undefined;
      const d = Object.getOwnPropertyDescriptors(value);
      const len = d.length?.value;
      if (!Number.isSafeInteger(len) || len < 0 || len > 1024 || d.length?.get || d.length?.set) return undefined;
      const expected = new Set(['length', ...Array.from({length:len}, (_,i)=>String(i))]);
      if (Object.keys(d).some((k)=>!expected.has(k))) return undefined;
      seen.add(value);
      const out=[];
      for (let i=0;i<len;i+=1) {
        const item=d[String(i)];
        if (!item || !item.enumerable || !Object.hasOwn(item,'value') || item.get || item.set) { seen.delete(value); return undefined; }
        const v=snapshot(item.value,state,depth+1,seen);
        if (v===undefined) { seen.delete(value); return undefined; }
        out.push(v);
      }
      seen.delete(value);
      return Object.freeze(out);
    }
    const proto=Object.getPrototypeOf(value);
    if ((proto!==Object.prototype && proto!==null) || Object.getOwnPropertySymbols(value).length) return undefined;
    const d=Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    const out=Object.create(null);
    for (const k of Object.keys(d).sort()) {
      const item=d[k];
      if (RESERVED.has(k) || !item.enumerable || !Object.hasOwn(item,'value') || item.get || item.set) { seen.delete(value); return undefined; }
      const v=snapshot(item.value,state,depth+1,seen);
      if (v===undefined) { seen.delete(value); return undefined; }
      Object.defineProperty(out,k,{value:v,enumerable:true,writable:false,configurable:false});
    }
    seen.delete(value);
    return Object.freeze(out);
  } catch { return undefined; }
}
function closedWorld(value, keys) {
  const v=snapshot(value);
  return v && !Array.isArray(v) && !Object.keys(v).some((k)=>!keys.has(k)) ? v : null;
}
function exactKeys(value, keys) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  const a=Object.keys(value).sort(), b=[...keys].sort();
  return a.length===b.length && a.every((k,i)=>k===b[i]);
}
function refs(value,min=0) {
  if (!Array.isArray(value) || value.length<min || value.length>32) return null;
  const r=value.map(text);
  return r.some((x)=>!SAFE_REF.test(x)||x.includes('..')) || new Set(r).size!==r.length ? null : Object.freeze(r);
}
function safePath(value) {
  const p=text(value).replace(/\\/g,'/').replace(/^\.\/+/, '');
  return Boolean(p && !p.startsWith('/') && !/^[a-z]:\//i.test(p) && !p.split('/').includes('..')
    && !/(^|\/)(?:\.git|node_modules|runtime|runtime-data|data|tmp)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i.test(p));
}
function changedFiles(value) {
  if (!Array.isArray(value) || value.length>256) return null;
  const files=value.map((x)=>text(x).replace(/\\/g,'/'));
  return files.some((f)=>!safePath(f)) || new Set(files).size!==files.length ? null : Object.freeze(files);
}
function issueIdentity(id) {
  const v=text(id).toLowerCase();
  const g=/^goal-([1-9]\d*)-pr-([1-9]\d*)(?:$|[-_.])/.exec(v);
  if (g) return {issueNumber:Number(g[1]),prNumber:Number(g[2])};
  const c=/^critical-([1-9]\d*)(?:$|[-_.])/.exec(v);
  return {issueNumber:c?Number(c[1]):null,prNumber:null};
}
function blockedBuild(input, blocker) {
  return Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,state:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD,
    repository:text(input?.repository),expectedSourceHead:text(input?.expectedSourceHead).toLowerCase(),grantId:text(input?.executionGrant?.grantId),
    actionId:'',handoffId:'',queueItemCandidate:null,sharedWorkspaceHandoffCandidate:null,blockers:Object.freeze([blocker]),
    authority:ZERO_AUTHORITY,finalVerdict:'GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SAFE_HOLD'});
}
function validateGrant(g, identity) {
  if (!exactKeys(g,GRANT_KEYS)) return 'execution-grant-shape-invalid';
  const route=text(g.route).toUpperCase(), adapter=text(g.adapter), proofRefs=refs(g.proofRefs);
  const receiptId=g.selectedCapacityReceiptId===null?null:text(g.selectedCapacityReceiptId);
  if (g.schemaVersion!==GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA) return 'execution-grant-schema-invalid';
  if (g.repository!==identity.repository || text(g.expectedSourceHead).toLowerCase()!==identity.expectedSourceHead) return 'execution-grant-identity-mismatch';
  if (![g.grantId,g.missionId,g.taskId].every((v)=>SAFE_ID.test(text(v)))) return 'execution-grant-id-invalid';
  if (!Object.values(MISSION_CONTROLLER_ROUTE).includes(route) || !SAFE_ID.test(adapter) || proofRefs===null) return 'execution-grant-route-evidence-invalid';
  if (route===MISSION_CONTROLLER_ROUTE.CODEX) {
    if (receiptId!==null || adapter!=='codex') return 'execution-grant-codex-binding-invalid';
  } else if (!SAFE_ID.test(receiptId||'') || proofRefs.length<1) return 'execution-grant-capacity-evidence-invalid';
  if (isoMs(g.grantedAtUtc)===null || g.executionScope!=='SOURCE_ONLY_EXISTING_ROUTE' || g.windowsBound!==false) return 'execution-grant-scope-or-time-invalid';
  if ([g.existingDispatchTakeoverAllowed,g.sourceMutationAuthorityAdded,g.mergeAuthorityAdded,g.deploymentAuthorityAdded,
    g.runtimeMutationAuthorityAdded,g.protectedMergeDispatchAllowed,g.leaseSeizureAllowed,g.duplicateDispatchAllowed,g.arbitraryCommandAllowed].some((v)=>v!==false)) return 'execution-grant-authority-invalid';
  return '';
}
function validateMissionState(s,g,repository) {
  if (!s || s.schemaVersion!==MISSION_ORCHESTRATOR_SCHEMA_VERSION) return 'mission-state-schema-invalid';
  if (text(s.repository)!==repository || text(s.missionId)!==text(g.missionId)) return 'mission-state-identity-mismatch';
  const phase=text(s.currentPhase).toUpperCase();
  if (phase==='REPAIR_REQUIRED') return 'repair-start-must-be-persisted-by-canonical-mission-service';
  if (phase!=='AGENT_IMPLEMENTATION') return 'mission-state-not-source-handoff-ready';
  if (text(s.dispatch?.status).toLowerCase()==='running') return 'existing-dispatch-owns-mission';
  if (!Array.isArray(s.allowedFiles)||!s.allowedFiles.length||s.allowedFiles.some((f)=>!safePath(f))) return 'mission-state-source-scope-invalid';
  if (!Array.isArray(s.requiredTests)||!s.requiredTests.length) return 'mission-state-tests-invalid';
  if (!Array.isArray(s.requiredEvidence)||!s.requiredEvidence.length) return 'mission-state-evidence-invalid';
  return '';
}
function workerGrant(g) {
  return Object.freeze({schemaVersion:'stephanos.mission-worker-action-grant.v1',missionId:g.missionId,capacityRoute:g.route,
    adapter:g.adapter,workerId:g.adapter,capacityReceiptId:g.selectedCapacityReceiptId,capacityProofRefs:Object.freeze([...g.proofRefs])});
}
function preflightWorkspaceHandoff(handoff, action, grant, nowMs) {
  if (!handoff || handoff.handoffId!==action.actionId || handoff.correlationId!==action.missionId) return 'shared-workspace-handoff-identity-invalid';
  const v=validateSharedWorkspaceRecord(handoff,{nowMs});
  if (!v.valid || v.stale) return 'shared-workspace-handoff-preflight-invalid';
  let body;
  try { body=JSON.parse(handoff.body); } catch { return 'shared-workspace-handoff-body-invalid'; }
  return body?.schemaVersion===GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA && body.actionId===action.actionId
    && body.grantId===grant.grantId && body.taskId===grant.taskId && body.expectedSourceHead===grant.expectedSourceHead
    && body.repository===grant.repository && body.adapter===action.adapter
    && text(body.capacityRoute).toUpperCase()===text(action.capacityRoute).toUpperCase()
    && body.capacityReceiptId===action.capacityReceiptId && body.mergeAuthority===false && body.leaseSeizureAllowed===false
    ? '' : 'shared-workspace-handoff-body-binding-invalid';
}

export function buildGitHubContinuityExternalHandoffV1(rawInput={}) {
  const input=closedWorld(rawInput,BUILD_KEYS);
  if (!input) return blockedBuild(null,'handoff-input-not-data-only-or-closed-world');
  const repository=text(input.repository), expectedSourceHead=text(input.expectedSourceHead).toLowerCase(), nowUtc=text(input.nowUtc), nowMs=isoMs(nowUtc);
  if (!REPOSITORY.test(repository)||!SHA40.test(expectedSourceHead)||nowMs===null) return blockedBuild(input,'handoff-identity-invalid');
  const grantBlocker=validateGrant(input.executionGrant,{repository,expectedSourceHead});
  if (grantBlocker) return blockedBuild(input,grantBlocker);
  const missionBlocker=validateMissionState(input.missionState,input.executionGrant,repository);
  if (missionBlocker) return blockedBuild(input,missionBlocker);
  const route=text(input.executionGrant.route).toUpperCase();
  if (route===MISSION_CONTROLLER_ROUTE.CODEX) return Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,
    state:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXISTING_IN_PROCESS_ROUTE_PRESERVED,repository,expectedSourceHead,
    grantId:input.executionGrant.grantId,actionId:'',handoffId:'',queueItemCandidate:null,sharedWorkspaceHandoffCandidate:null,
    blockers:Object.freeze([]),authority:ZERO_AUTHORITY,finalVerdict:'GITHUB_CONTINUITY_EXISTING_IN_PROCESS_ROUTE_PRESERVED'});
  const expectedAdapter=EXTERNAL_ROUTES.get(route);
  if (!expectedAdapter || input.executionGrant.adapter!==expectedAdapter) return blockedBuild(input,'execution-grant-external-route-binding-invalid');
  const action=buildMissionWorkerAction(input.missionState,{now:new Date(nowUtc),actionGrant:workerGrant(input.executionGrant)});
  if (action?.executable!==true||action.actionKind!=='agent-handoff'||action.adapter!==expectedAdapter
      ||text(action.capacityRoute).toUpperCase()!==route||text(action.capacityReceiptId)!==text(input.executionGrant.selectedCapacityReceiptId)
      ||JSON.stringify(action.capacityProofRefs||[])!==JSON.stringify(input.executionGrant.proofRefs||[])||action.repository!==repository) {
    return blockedBuild(input,'canonical-mission-worker-action-binding-invalid');
  }
  const identity=issueIdentity(input.missionState.missionId);
  const body=Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA,missionId:input.missionState.missionId,
    taskId:input.executionGrant.taskId,grantId:input.executionGrant.grantId,actionId:action.actionId,adapter:action.adapter,
    capacityRoute:action.capacityRoute,capacityReceiptId:action.capacityReceiptId,repository,expectedSourceHead,
    branch:input.missionState.git?.branch||'',allowedFiles:Object.freeze([...(action.allowedFiles||[])]),
    requiredTests:Object.freeze([...(action.requiredTests||[])]),requiredEvidence:Object.freeze([...(action.requiredEvidence||[])]),
    mergeAuthority:false,leaseSeizureAllowed:false});
  const workspace=createSharedWorkspaceHandoffRecord({handoffId:action.actionId,participantId:'mission-orchestrator',
    fromParticipantId:'mission-orchestrator',toParticipantId:expectedAdapter==='chatgpt-github'?'chatgpt':'future-agent',
    timestampUtc:nowUtc,correlationId:input.missionState.missionId,relatedIssue:`#${identity.issueNumber||1637}`,
    relatedPr:identity.prNumber?`#${identity.prNumber}`:'',proofRefs:input.executionGrant.proofRefs,
    summary:`${expectedAdapter} is the exact GitHub Continuity source owner for ${input.missionState.missionId}.`,body:JSON.stringify(body)});
  const workspaceBlocker=preflightWorkspaceHandoff(workspace,action,input.executionGrant,nowMs);
  if (workspaceBlocker) return blockedBuild(input,workspaceBlocker);
  const queue=Object.freeze({schemaVersion:MISSION_WORKER_QUEUE_ITEM_SCHEMA,adapter:expectedAdapter,actionId:action.actionId,
    missionId:input.missionState.missionId,createdAt:nowUtc,payload:Object.freeze({...action})});
  return Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA,
    state:GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY,repository,expectedSourceHead,
    grantId:input.executionGrant.grantId,taskId:input.executionGrant.taskId,actionId:action.actionId,handoffId:action.actionId,
    missionRevision:input.missionState.revision,queueItemCandidate:queue,sharedWorkspaceHandoffCandidate:workspace,
    blockers:Object.freeze([]),authority:ZERO_AUTHORITY,finalVerdict:'GITHUB_CONTINUITY_EXTERNAL_HANDOFF_CANDIDATE_READY'});
}

function validMissionReceipt(r) {
  if (!r||typeof r!=='object'||Array.isArray(r)||!text(r.requirement)||!text(r.source)||!text(r.evidenceType)||r.verified!==true) return false;
  if (SHA256.test(text(r.sha256))||SHA256.test(text(r.commandOutputHash))||(Number.isInteger(r.exitCode)&&r.exitCode===0)) return true;
  const p=text(r.receiptPath).replace(/\\/g,'/');
  return SAFE_REF.test(p)&&!p.includes('..');
}
function blockedCompletion(blocker) {
  return Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,valid:false,eventCandidate:null,projectedMissionState:null,
    blockers:Object.freeze([blocker]),authority:ZERO_AUTHORITY,finalVerdict:'GITHUB_CONTINUITY_EXTERNAL_COMPLETION_BLOCKED'});
}
function validPreparedHandoff(h) {
  if (!h||h.schemaVersion!==GITHUB_CONTINUITY_EXTERNAL_HANDOFF_SCHEMA||h.state!==GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY
      ||!h.queueItemCandidate||!h.sharedWorkspaceHandoffCandidate||h.handoffId!==h.actionId) return false;
  const q=h.queueItemCandidate,w=h.sharedWorkspaceHandoffCandidate;
  if (q.schemaVersion!==MISSION_WORKER_QUEUE_ITEM_SCHEMA||q.actionId!==h.actionId||q.missionId!==w.correlationId||w.handoffId!==h.actionId) return false;
  const expectedTarget=q.adapter==='chatgpt-github'?'chatgpt':q.adapter==='foundry-forge'?'future-agent':'';
  if (!expectedTarget||w.toParticipantId!==expectedTarget) return false;
  let b;
  try { b=JSON.parse(w.body); } catch { return false; }
  return b?.schemaVersion===GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA&&b.actionId===h.actionId&&b.grantId===h.grantId
    &&b.taskId===h.taskId&&b.repository===h.repository&&b.expectedSourceHead===h.expectedSourceHead&&b.adapter===q.adapter
    &&text(b.capacityRoute).toUpperCase()===text(q.payload?.capacityRoute).toUpperCase();
}

export function adjudicateGitHubContinuityExternalCompletionV1(rawInput={}) {
  const input=closedWorld(rawInput,COMPLETION_INPUT_KEYS);
  if (!input) return blockedCompletion('completion-input-not-data-only-or-closed-world');
  const h=input.handoff,c=input.completionReceipt,s=input.missionState;
  if (!validPreparedHandoff(h)) return blockedCompletion('handoff-candidate-invalid');
  if (!c||!exactKeys(c,COMPLETION_KEYS)||c.schemaVersion!==GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA) return blockedCompletion('completion-receipt-shape-invalid');
  const proofRefs=refs(c.proofRefs,1), files=changedFiles(c.changedFiles), completedAt=isoMs(c.completedAtUtc);
  if (!proofRefs||!files||completedAt===null) return blockedCompletion('completion-evidence-invalid');
  if (c.repository!==h.repository||text(c.expectedSourceHead).toLowerCase()!==h.expectedSourceHead||c.handoffId!==h.handoffId
      ||c.grantId!==h.grantId||c.missionId!==h.queueItemCandidate.missionId||c.taskId!==h.taskId||c.adapter!==h.queueItemCandidate.adapter
      ||text(c.capacityRoute).toUpperCase()!==text(h.queueItemCandidate.payload?.capacityRoute).toUpperCase()) return blockedCompletion('completion-handoff-identity-mismatch');
  if ([c.sourceMutationAuthorityAdded,c.mergeAuthorityAdded,c.deploymentAuthorityAdded,c.runtimeMutationAuthorityAdded,
    c.protectedMergeDispatchAllowed,c.duplicateDispatchAllowed,c.arbitraryCommandAllowed].some((v)=>v!==false)) return blockedCompletion('completion-authority-invalid');
  if (typeof c.success!=='boolean') return blockedCompletion('completion-success-invalid');
  if (c.success===true) {
    if (!SAFE_ID.test(text(c.resultId))||text(c.error)||!validMissionReceipt(c.receipt)) return blockedCompletion('completion-success-payload-invalid');
  } else if (!text(c.error)||files.length>0||c.resultId!=='') return blockedCompletion('completion-failure-payload-invalid');
  if (!s||s.schemaVersion!==MISSION_ORCHESTRATOR_SCHEMA_VERSION||s.missionId!==c.missionId||s.repository!==c.repository
      ||text(s.dispatch?.status).toLowerCase()!=='running'||text(s.dispatch?.adapter)!==c.adapter) return blockedCompletion('completion-mission-state-mismatch');
  const event=Object.freeze({schemaVersion:MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,missionId:c.missionId,eventType:'AGENT_RESULT_RECEIVED',timestamp:c.completedAtUtc,
    summary:c.success?`GitHub Continuity external lane completed ${c.taskId}.`:`GitHub Continuity external lane failed ${c.taskId}.`,
    success:c.success,resultId:c.resultId,changedFiles:files,receipt:c.receipt,error:c.error});
  const projected=applyMissionOrchestratorEvent(s,event,{now:new Date(c.completedAtUtc)});
  if (c.success===true) {
    if (projected?.dispatch?.status!=='complete'||projected?.dispatch?.resultId!==c.resultId||text(projected?.currentPhase).toUpperCase()==='BLOCKED') return blockedCompletion('completion-event-preflight-failed');
  } else if (text(projected?.currentPhase).toUpperCase()!=='BLOCKED') return blockedCompletion('failure-event-preflight-failed');
  return Object.freeze({schemaVersion:GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,valid:true,handoffId:c.handoffId,grantId:c.grantId,
    missionId:c.missionId,taskId:c.taskId,eventCandidate:event,projectedMissionState:projected,blockers:Object.freeze([]),authority:ZERO_AUTHORITY,
    finalVerdict:c.success?'GITHUB_CONTINUITY_EXTERNAL_COMPLETION_EVENT_READY':'GITHUB_CONTINUITY_EXTERNAL_FAILURE_EVENT_READY'});
}
