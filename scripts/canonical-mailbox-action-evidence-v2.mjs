import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as index from '../shared/agents/mailboxReceiptIndexGitHubMirror.mjs';
import * as telemetry from '../shared/agents/codexBankedResetTelemetryMirror.mjs';
import {evaluateMailboxRotationActionInventory} from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';
import {legacyPublicationContract,withMailboxActionEvidence} from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';

const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const modules=[
 {path:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',namespace:index,version:'MAILBOX_RECEIPT_PUBLICATION_API_VERSION',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody',replacement:'buildTrustedMailboxReceiptIndexGitHubBodyV2'},
 {path:'shared/agents/codexBankedResetTelemetryMirror.mjs',namespace:telemetry,version:'CODEX_BANKED_RESET_PUBLICATION_API_VERSION',legacyBuilder:'buildCodexBankedResetTelemetryIssueBody',replacement:'buildCodexBankedResetTelemetryIssueBodyV2'},
];
export function localMailboxPublicationRevocations(){
 return modules.map(m=>{
  const raw=Buffer.from(readFileSync(new URL('../'+m.path,import.meta.url),'utf8').replaceAll('\r\n','\n'));
  return{path:m.path,localBlob:createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),
   legacyBuilder:m.legacyBuilder,apiVersion:m.namespace[m.version],legacyAbsent:!(m.legacyBuilder in m.namespace),replacementPresent:typeof m.namespace[m.replacement]==='function'};
 });
}

// Fixed public GET evidence only. The production caller supplies its existing
// authenticated GitHub reader; no caller controls endpoints or proof results.
export function inventoryMailboxRotationExecution({read,activationHead,now=()=>new Date().toISOString(),local=localMailboxPublicationRevocations}={}){
 if(typeof read!=='function'||!sha(activationHead))throw Error('MAILBOX_ACTION_EVIDENCE_CONTEXT_INVALID');
 const main=(read('commits/main'))?.sha;
 if(!sha(main))throw Error('MAILBOX_ACTION_MAIN_UNPROVEN');
 const responses=[];
 for(const status of ['queued','in_progress','waiting','requested','pending'])responses.push(read(`actions/runs?status=${status}&per_page=100`));
 const observedAt=now(),inventory=evaluateMailboxRotationActionInventory(responses,observedAt);
 const raw=responses.flatMap(r=>r.workflow_runs),proofs=[];
 const locals=local();let source=null;
 if(!Array.isArray(locals)||locals.length!==modules.length||modules.some(m=>locals.filter(x=>x.path===m.path&&x.legacyBuilder===m.legacyBuilder&&sha(x.localBlob)).length!==1))
  throw Error('MAILBOX_ACTION_LOCAL_REVOCATION_CONTEXT_INVALID');
 if(inventory.pendingRuns.some(p=>raw.some(r=>r.id===p.id&&r.status==='queued'&&legacyPublicationContract(r)))){
  const bound=[];
  for(const m of locals){
   const a=read(`contents/${m.path}?ref=${main}`),b=main===activationHead?a:read(`contents/${m.path}?ref=${activationHead}`);
   if(a?.path!==m.path||b?.path!==m.path||!sha(a?.sha)||!sha(b?.sha)
     ||a.type!=='file'||b.type!=='file'||!Number.isSafeInteger(a.size)||!Number.isSafeInteger(b.size)
     ||a.size<=0||b.size<=0||a.size>128*1024||b.size>128*1024)throw Error('MAILBOX_ACTION_REVOCATION_SOURCE_UNPROVEN');
   bound.push({...m,mainBlob:a.sha,activationBlob:b.sha});
  }
  source={mainHead:main,activationHead,modules:bound};
 }
 const workflows=new Map();
 for(const pending of inventory.pendingRuns){
  const listed=raw.find(r=>r.id===pending.id),c=legacyPublicationContract(listed);
  if(!c)continue; // Unknown/execution-capable records remain in blockingRuns.
  const before=read(`actions/runs/${pending.id}`);
  if(before?.id!==pending.id||!Number.isSafeInteger(before.run_attempt)||before.run_attempt<=0
    ||before.run_attempt!==listed.run_attempt||before.head_sha!==listed.head_sha||before.status!==listed.status
    ||before.path!==c.path||before.event!=='issue_comment')continue;
  const key=c.head+':'+c.path;
  if(!workflows.has(key)){
   const w=read(`contents/${c.path}?ref=${c.head}`);
   workflows.set(key,{path:w?.path,ref:c.head,sha:w?.sha});
  }
  const jobs=read(`actions/runs/${pending.id}/attempts/${before.run_attempt}/jobs?per_page=100`);
  const after=read(`actions/runs/${pending.id}`);
  proofs.push({run:before,runAfter:after,workflow:workflows.get(key),attempt:before.run_attempt,jobs,observedAt:now()});
 }
 if((read('commits/main'))?.sha!==main)throw Error('MAILBOX_ACTION_MAIN_MOVED');
 return withMailboxActionEvidence({...inventory,observedAt:now()},{proofs,source});
}
