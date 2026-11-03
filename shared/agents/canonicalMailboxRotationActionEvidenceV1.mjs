import {createHash} from 'node:crypto';

export const MAILBOX_ACTION_EVIDENCE_SCHEMA = 'stephanos.mailbox-actions-execution-evidence.v1';
export const LEGACY_PUBLICATION_CONTRACTS = Object.freeze([
 Object.freeze({head:'a33f134c32783a7315fb8afde1ac1c9ddf828fb1',path:'.github/workflows/mailbox-receipt-index.yml',blob:'e8365079c489770113c2fbfb8260da7963bf812d',module:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody'}),
 Object.freeze({head:'a33f134c32783a7315fb8afde1ac1c9ddf828fb1',path:'.github/workflows/codex-banked-reset-telemetry.yml',blob:'4a5ceed577b8d46dad9dbc7a731593ef87d334cc',module:'shared/agents/codexBankedResetTelemetryMirror.mjs',legacyBuilder:'buildCodexBankedResetTelemetryIssueBody'}),
 Object.freeze({head:'b84edbda829e871aeda03333645659d363d7da92',path:'.github/workflows/mailbox-receipt-index.yml',blob:'710622f4964c0e58c25f82eebe4fa301481087ef',module:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody'}),
]);
const repository='Cheekyfellastef/stephan-os';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const terminal=new Set(['success','failure','cancelled','skipped','timed_out','neutral','action_required','stale']);
export const mailboxActionEvidenceDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function legacyPublicationContract(run){
 return LEGACY_PUBLICATION_CONTRACTS.find(c=>run?.head_sha===c.head&&run?.path===c.path)||null;
}

function exactRun(pending,proof){
 const r=proof?.run,c=legacyPublicationContract(r);
 if(!c||r.id!==pending?.id||r.status!==pending.status||!['queued','in_progress','waiting','requested','pending'].includes(r.status)||r.path!==`.github/workflows/${pending.workflow}`
   ||r.event!=='issue_comment'||r.head_branch!=='main'||!positive(r.run_attempt)||!positive(r.workflow_id)
   ||r.repository?.full_name!==repository||r.head_repository?.full_name!==repository
   ||proof.workflow?.path!==c.path||proof.workflow?.ref!==c.head||proof.workflow?.sha!==c.blob)return null;
 const after=proof.runAfter;
 if(!after||after.id!==r.id||after.run_attempt!==r.run_attempt||after.head_sha!==r.head_sha
   ||after.status!==r.status||after.path!==r.path||after.workflow_id!==r.workflow_id||after.event!==r.event
   ||after.head_branch!==r.head_branch||after.repository?.full_name!==repository||after.head_repository?.full_name!==repository
   ||!Number.isFinite(Date.parse(proof.observedAt)))return null;
 const j=proof.jobs;
 if(!j||!Number.isSafeInteger(j.total_count)||j.total_count<0||j.total_count>100
   ||!Array.isArray(j.jobs)||j.jobs.length!==j.total_count||proof.attempt!==r.run_attempt)return null;
 return{r,c,j};
}

function revokedEntryPoint(source,contract){
 if(!source||!sha(source.mainHead)||!sha(source.activationHead)||!Array.isArray(source.modules))return false;
 const entries=source.modules.filter(m=>m.path===contract.module);
 if(entries.length!==1)return false;
 const m=entries[0];
 return m.legacyBuilder===contract.legacyBuilder&&m.apiVersion===2&&m.legacyAbsent===true
   &&m.replacementPresent===true&&sha(m.localBlob)&&m.mainBlob===m.localBlob&&m.activationBlob===m.localBlob;
}

export function classifyMailboxActionEvidence(pending,proof,source){
 const exact=exactRun(pending,proof);
 if(!exact)return{quiescent:false,reason:'ACTION_EXECUTION_UNPROVEN'};
 const {r,c,j}=exact;
 // A future queued checkout is contained only by the exact immutable caller
 // and physically absent V1 builder in both protected-main and activation.
 if(r.status==='queued'&&j.total_count===0&&revokedEntryPoint(source,c))
   return{quiescent:true,reason:'LEGACY_PUBLICATION_ENTRYPOINT_REVOKED',attempt:r.run_attempt,workflowBlob:c.blob};
 // Complete the entire known two-job DAG, never an empty or partial list.
 if(j.total_count!==2||new Set(j.jobs.map(x=>x.id)).size!==2
   ||JSON.stringify(j.jobs.map(x=>x.name).sort())!==JSON.stringify(['mirror','proof']))
   return{quiescent:false,reason:'ACTION_JOB_DAG_INCOMPLETE'};
 for(const job of j.jobs){
  if(!positive(job.id)||job.run_id!==r.id||job.head_sha!==r.head_sha||job.status!=='completed'
    ||!terminal.has(job.conclusion)||!Number.isFinite(Date.parse(job.completed_at))
    ||Date.parse(job.completed_at)>Date.parse(proof.observedAt))
    return{quiescent:false,reason:'ACTION_JOB_NOT_TERMINAL'};
  if(job.name==='proof'&&job.conclusion==='skipped')continue;
  if(!Array.isArray(job.steps)||!job.steps.length||job.steps.some(s=>s.status!=='completed')
    ||job.steps.at(-1).name!=='Complete job')return{quiescent:false,reason:'ACTION_JOB_FINAL_STEP_UNPROVEN'};
 }
 return{quiescent:true,reason:'EXACT_WORKFLOW_DAG_TERMINAL',attempt:r.run_attempt,workflowBlob:c.blob};
}

export function withMailboxActionEvidence(inventory,{proofs=[],source=null}={}){
 if(inventory?.complete!==true||!Array.isArray(inventory.pendingRuns))throw Error('MAILBOX_ACTION_INVENTORY_INCOMPLETE');
 const evidence={schemaVersion:MAILBOX_ACTION_EVIDENCE_SCHEMA,proofs,source};
 const dispositions=inventory.pendingRuns.map(p=>({id:p.id,...classifyMailboxActionEvidence(p,proofs.find(x=>x?.run?.id===p.id),source)}));
 return{...inventory,executionEvidence:evidence,blockingRuns:inventory.pendingRuns.filter((_,i)=>!dispositions[i].quiescent),
   aggregateDispositions:dispositions,evidenceDigest:mailboxActionEvidenceDigest({pending:inventory.pendingRuns,evidence})};
}

function validEvidenceEnvelope(actions){
 if(actions?.complete!==true||!Array.isArray(actions.pendingRuns))return false;
 const e=actions.executionEvidence;
 const observed=Date.parse(actions.observedAt);
 if(e?.schemaVersion!==MAILBOX_ACTION_EVIDENCE_SCHEMA||!Array.isArray(e.proofs)
   ||!Number.isFinite(observed)||e.proofs.some(x=>!Number.isFinite(Date.parse(x?.observedAt))||observed-Date.parse(x.observedAt)<0||observed-Date.parse(x.observedAt)>120000)
   ||new Set(actions.pendingRuns.map(x=>x.id)).size!==actions.pendingRuns.length
   ||!actions.pendingRuns.every(p=>positive(p.id)&&typeof p.workflow==='string'&&typeof p.status==='string')
   ||new Set(e.proofs.map(x=>x?.run?.id)).size!==e.proofs.length
   ||e.proofs.some(x=>!actions.pendingRuns.some(p=>p.id===x?.run?.id))
   ||actions.evidenceDigest!==mailboxActionEvidenceDigest({pending:actions.pendingRuns,evidence:e}))return false;
 return true;
}

export function mailboxActionsExecutionQuiescent(actions,{now,mainHead,activationHead}={}){
 if(actions?.complete!==true||!Array.isArray(actions.pendingRuns))return false;
 if(now!==undefined&&(!Number.isFinite(Date.parse(now))||!Number.isFinite(Date.parse(actions.observedAt))
   ||Date.parse(now)-Date.parse(actions.observedAt)<0||Date.parse(now)-Date.parse(actions.observedAt)>120000))return false;
 if(actions.pendingRuns.length===0)return true;
 if(!validEvidenceEnvelope(actions))return false;
 const e=actions.executionEvidence;
 if(now!==undefined&&e.proofs.some(x=>Date.parse(now)-Date.parse(x.observedAt)<0||Date.parse(now)-Date.parse(x.observedAt)>120000))return false;
 const needsRevocation=actions.pendingRuns.some(p=>classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).reason==='LEGACY_PUBLICATION_ENTRYPOINT_REVOKED');
 if(needsRevocation&&((mainHead!==undefined&&e.source?.mainHead!==mainHead)||(activationHead!==undefined&&e.source?.activationHead!==activationHead)))return false;
 return actions.pendingRuns.every(p=>classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).quiescent);
}

export function mailboxActionEvidenceSummary(actions){
 const count=actions?.complete===true&&Array.isArray(actions.pendingRuns)?actions.pendingRuns.length:-1;
 const quiet=mailboxActionsExecutionQuiescent(actions);
 const e=actions?.executionEvidence;
 const blocking=quiet?0:validEvidenceEnvelope(actions)?actions.pendingRuns.filter(p=>!classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).quiescent).length:count;
 return{actionPendingAggregateCount:count,actionBlockingCount:blocking,
  actionsQuiescenceDigest:quiet&&count>0?actions.evidenceDigest:''};
}
