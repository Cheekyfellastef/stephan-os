#!/usr/bin/env node
// Fixed GitHub-hosted adapter. No injected transport, arbitrary URL/command or
// caller-produced authority flags. The pure projector is not an authority API.
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {CANONICAL_MAILBOX_ISSUE} from '../../shared/agents/canonicalMailboxAuthorityV1.mjs';
import {LAB_SCHEMA,LAB_MARKER,LAB_REPOSITORY,LAB_WORKFLOW,LAB_BRANCH,LAB_ISO_SHA256,LAB_WIM_SHA256,parseLabApproval,inspectLabApproval} from '../../shared/agents/r7IsolatedNativeLabAdmissionV1.mjs';
const API='https://api.github.com/repos/'+LAB_REPOSITORY;
const sha=x=>createHash('sha256').update(x).digest('hex');
const positive=s=>/^[1-9][0-9]{0,15}$/.test(String(s))&&Number.isSafeInteger(Number(s))?Number(s):0;
function fail(reason){throw Error(reason);}
function context(){
 if(process.argv.length!==3||!['prepare','admit'].includes(process.argv[2])||process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.RUNNER_OS!=='Windows'||process.env.RUNNER_ARCH!=='X64'||process.env.ImageOS!=='win22'||process.env.GITHUB_RUN_ATTEMPT!=='1'||process.env.GITHUB_REPOSITORY!==LAB_REPOSITORY||process.env.GITHUB_REF!=='refs/heads/'+LAB_BRANCH)fail('LAB_FIXED_HOSTED_CONTEXT_REQUIRED');
 const runId=positive(process.env.GITHUB_RUN_ID),artifactId=positive(process.env.R7_NATIVE_ARTIFACT_ID);
 if(!runId||!artifactId||!process.env.GITHUB_TOKEN)fail('LAB_HOSTED_IDENTITIES_OR_READ_TOKEN_MISSING');
 const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
 const git=args=>execFileSync('C:/Program Files/Git/cmd/git.exe',['-C',repo,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,shell:false}).trim();
 const source={head:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),runId,runAttempt:1};
 if(source.head!==process.env.GITHUB_SHA||!/^[a-f0-9]{40}$/.test(source.head)||!/^[a-f0-9]{40}$/.test(source.tree))fail('LAB_LOCAL_CHECKOUT_UNPROVEN');
 const directory=join(resolve(process.env.RUNNER_TEMP),'r7-native-invocation-'+runId);
 return {repo,source,directory,runId,artifactId};
}
async function boundedResponse(response,limit){
 const chunks=[];let total=0;
 for await(const value of response.body){total+=value.length;if(total>limit)fail('LAB_HTTP_RESPONSE_BOUND');chunks.push(Buffer.from(value));}
 return Buffer.concat(chunks);
}
async function get(path){
 const response=await fetch(API+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28','Cache-Control':'no-cache'}});
 if(!response.ok)fail('LAB_GITHUB_READ_FAILED_'+response.status);
 return {value:JSON.parse((await boundedResponse(response,2*1024*1024)).toString('utf8')),next:/rel="next"/.test(response.headers.get('link')||'')};
}
async function readEvidence(c){
 const [run,pr,artifact,main]=await Promise.all([get('/actions/runs/'+c.runId),get('/pulls/3211'),get('/actions/artifacts/'+c.artifactId),get('/git/ref/heads/main')]);
 const head=main.value?.object?.sha;
 if(!/^[a-f0-9]{40}$/.test(head||''))fail('LAB_CANONICAL_SOURCE_UNPROVEN');
 const config=(await get('/contents/shared/agents/canonicalMailboxAuthorityV1.mjs?ref='+head)).value;
 if(config.encoding!=='base64'||typeof config.content!=='string'||config.size>32768)fail('LAB_CANONICAL_MAILBOX_SOURCE_UNREADABLE');
 const body=Buffer.from(config.content.replace(/\s/g,''),'base64').toString('utf8');
 const declarations=[...body.matchAll(/^export const CANONICAL_MAILBOX_ISSUE = ([1-9][0-9]*);$/gm)];
 if(declarations.length!==1||Number(declarations[0][1])!==CANONICAL_MAILBOX_ISSUE)fail('LAB_CANONICAL_MAILBOX_CHANGED');
 const r=run.value,a=artifact.value,p=pr.value;
 if(r.id!==c.runId||r.run_attempt!==1||r.event!=='workflow_dispatch'||r.path!==LAB_WORKFLOW||r.status!=='in_progress'||r.head_sha!==c.source.head||r.head_repository?.full_name!==LAB_REPOSITORY||r.actor?.login!=='Cheekyfellastef'||r.actor?.id!==267490109||r.actor?.type!=='User'||r.triggering_actor?.id!==267490109)fail('LAB_ACTUAL_WORKFLOW_DISPATCH_UNPROVEN');
 if(p.merged!==true||p.head?.sha!==c.source.head||p.head?.ref!==LAB_BRANCH||p.head?.repo?.full_name!==LAB_REPOSITORY)fail('LAB_PROTECTED_MERGED_CANDIDATE_REQUIRED');
 if(a.id!==c.artifactId||a.expired!==false||a.workflow_run?.head_sha!==c.source.head||a.workflow_run?.repository_id!==1179385578||!positive(a.workflow_run?.id)||!/^sha256:[a-f0-9]{64}$/.test(a.digest||'')||a.size_in_bytes>3*1024*1024)fail('LAB_NATIVE_ARTIFACT_IDENTITY_UNPROVEN');
 const nativeRun=(await get('/actions/runs/'+a.workflow_run.id)).value;
 if(nativeRun.status!=='completed'||nativeRun.conclusion!=='success'||nativeRun.event!=='pull_request'||nativeRun.path!==LAB_WORKFLOW||nativeRun.head_sha!==c.source.head||a.name!=='r7-native-test-'+c.source.head+'-'+nativeRun.id+'-'+nativeRun.run_attempt)fail('LAB_SUCCESSFUL_BUILD_REQUIRED');
 return {run:r,pr:p,artifact:a,nativeRun,source:c.source};
}
async function downloadArtifact(c,e){
 const response=await fetch(API+'/actions/artifacts/'+c.artifactId+'/zip',{method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(response.status!==302)fail('LAB_ARTIFACT_DOWNLOAD_REDIRECT_REQUIRED');
 const target=new URL(response.headers.get('location')||'');
 if(target.protocol!=='https:'||target.username||target.password||!target.hostname.endsWith('.blob.core.windows.net'))fail('LAB_ARTIFACT_DOWNLOAD_HOST_UNPROVEN');
 // Never forward the GitHub token to the signed blob URL or log that URL.
 const blob=await fetch(target,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!blob.ok)fail('LAB_ARTIFACT_DOWNLOAD_FAILED');
 const bytes=await boundedResponse(blob,3*1024*1024);
 if(bytes.length!==e.artifact.size_in_bytes||'sha256:'+sha(bytes)!==e.artifact.digest)fail('LAB_ARTIFACT_ARCHIVE_DIGEST_MISMATCH');
 return bytes;
}
function loadPrepared(c,e){
 const file=join(c.directory,'preparation.json');
 const bytes=readFileSync(file);if(bytes.length>32768)fail('LAB_PREPARATION_BOUND');
 const prepared=JSON.parse(bytes);
 if(prepared.workflowRunId!==c.runId||prepared.workflowRunAttempt!==1||prepared.sourceHead!==c.source.head||prepared.sourceTree!==c.source.tree||prepared.artifactId!==c.artifactId||prepared.artifactArchiveSha256!==e.artifact.digest.slice(7))fail('LAB_PREPARATION_IDENTITY_CHANGED');
 const pins=JSON.parse(readFileSync(join(c.directory,'package/r7-native-test-package-pins.json'),'utf8'));
 return {prepared,packagePins:pins};
}
function writeNew(path,value){const fd=openSync(path,'wx');try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');}finally{closeSync(fd);}}
async function prepare(c){
 const e=await readEvidence(c);
 mkdirSync(c.directory,{recursive:false});
 const outer=await downloadArtifact(c,e);
 const expected={artifactArchiveSha256:e.artifact.digest.slice(7),sourceHead:c.source.head,sourceTree:c.source.tree,nativeRunId:e.nativeRun.id,nativeRunAttempt:e.nativeRun.run_attempt};
 writeFileSync(join(c.directory,'artifact.zip'),outer,{flag:'wx'});
 writeNew(join(c.directory,'expected.json'),expected);
 execFileSync('python',['-I',join(c.repo,'scripts/windows/prepare-r7-hosted-native-package.py'),join(c.directory,'artifact.zip'),join(c.directory,'expected.json'),join(c.directory,'package')],{timeout:30000,maxBuffer:32768,shell:false});
 const pins=JSON.parse(readFileSync(join(c.directory,'package/r7-native-test-package-pins.json'),'utf8'));
 const approval={schemaVersion:LAB_SCHEMA,operation:'RUN_R7_DISPOSABLE_NATIVE_SMOKE',repository:LAB_REPOSITORY,prNumber:3211,sourceHead:c.source.head,sourceTree:c.source.tree,workflowRunId:c.runId,workflowRunAttempt:1,nativeRunId:e.nativeRun.id,nativeRunAttempt:e.nativeRun.run_attempt,artifactId:c.artifactId,artifactArchiveSha256:expected.artifactArchiveSha256,nativePackageSha256:pins.archiveSha256,driverSha256:pins.components.find(x=>x.name==='R7NativeQualification.sys').sha256,clientSha256:pins.components.find(x=>x.name==='R7NativeQualificationClient.exe').sha256,officialIsoSha256:LAB_ISO_SHA256,installWimSha256:LAB_WIM_SHA256,expiresAtUtc:new Date(Date.now()+2*60*60_000).toISOString(),acceptEvaluationTerms:false};
 const prepared={...approval,preparedAtUtc:new Date().toISOString(),workflowCreatedAtUtc:e.run.created_at,canonicalApprovalMailbox:CANONICAL_MAILBOX_ISSUE,approvalMarker:LAB_MARKER,guestExecutionAuthority:false,productionAuthority:false,claimMutationAuthority:false};
 writeNew(join(c.directory,'preparation.json'),prepared);
 console.log(JSON.stringify(prepared));
}
async function admit(c){
 const until=Date.now()+15*60_000;
 while(Date.now()<until){
  const e=await readEvidence(c);const p=loadPrepared(c,e);let comments=[];
  for(let page=1;page<=5;page++){
   const batch=await get('/issues/'+CANONICAL_MAILBOX_ISSUE+'/comments?since='+encodeURIComponent(e.run.created_at)+'&per_page=100&page='+page);
   if(!Array.isArray(batch.value))fail('LAB_APPROVAL_COMMENT_RESPONSE_UNREADABLE');
   comments.push(...batch.value);
   if(!batch.next)break;
   if(page===5)fail('LAB_APPROVAL_DISCOVERY_BOUND');
  }
  const matches=comments.filter(x=>parseLabApproval(x)?.workflowRunId===c.runId);
  if(matches.length>1)fail('LAB_RUN_APPROVAL_AMBIGUOUS');
  if(matches.length===1){
   const closing=(await get('/issues/comments/'+matches[0].id)).value;
   if(closing.body!==matches[0].body||closing.updated_at!==matches[0].updated_at)fail('LAB_APPROVAL_CHANGED_DURING_READ');
   const result=inspectLabApproval({...e,packagePins:p.packagePins,comment:closing,nowUtc:new Date().toISOString()});
   if(!result.admitted)fail(result.blocker);
   writeNew(join(c.directory,'admission.json'),result); // one consumption in attempt1
   console.log(JSON.stringify(result));return;
  }
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 fail('LAB_FRESH_EXACT_RUN_OWNER_APPROVAL_NOT_PRESENT');
}
try{const c=context();if(process.argv[2]==='prepare')await prepare(c);else await admit(c);}
catch(error){console.error(/^[A-Z][A-Z0-9_]{0,100}$/.test(error?.message||'')?error.message:'LAB_HOSTED_ADMISSION_UNPROVEN');process.exitCode=2;}
