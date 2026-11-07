// Pure projection. Only the fixed hosted adapter fetches authority-bearing inputs.
import { createHash } from 'node:crypto';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
export const LAB_SCHEMA='stephanos.r7-isolated-native-lab-approval.v1';
export const LAB_MARKER='stephanos-r7-isolated-native-lab-approval';
export const LAB_REPOSITORY='Cheekyfellastef/stephan-os';
export const LAB_WORKFLOW='.github/workflows/original-r7-native-windows-proof.yml';
export const LAB_BRANCH='fix/3123-native-recovery-inspection-20261023';
export const LAB_ISO_SHA256='3e4fa6d8507b554856fc9ca6079cc402df11a8b79344871669f0251535255325';
export const LAB_WIM_SHA256='e073fe38d47d9832608ec4dff061cd5358f3924650dcd5c1b13456abc34eaac9';
const OWNER_ID=267490109, OWNER='Cheekyfellastef';
const FIELDS=['schemaVersion','operation','repository','prNumber','sourceHead','sourceTree','workflowRunId','workflowRunAttempt','nativeRunId','nativeRunAttempt','artifactId','artifactArchiveSha256','nativePackageSha256','driverSha256','clientSha256','officialIsoSha256','installWimSha256','expiresAtUtc','acceptEvaluationTerms'];
const api='https://api.github.com/repos/'+LAB_REPOSITORY;
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const integer=v=>Number.isSafeInteger(v)&&v>0;
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)?Date.parse(v):NaN;
const owner=v=>v?.login===OWNER&&v.id===OWNER_ID&&v.type==='User';
const digest=v=>createHash('sha256').update(v).digest('hex');
const hold=blocker=>Object.freeze({admitted:false,blocker,guestExecutionAuthority:false,productionAuthority:false,claimMutationAuthority:false});
export function parseLabApproval(comment={}) {
  if(typeof comment.body!=='string'||Buffer.byteLength(comment.body)>16384)return null;
  const fence='\x60\x60\x60';
  const expression=new RegExp('^'+fence+LAB_MARKER+'\\r?\\n([\\s\\S]*?)\\r?\\n'+fence+'[ \\t]*$','gm');
  const matches=[...comment.body.matchAll(expression)];
  if(matches.length!==1)return null;
  try {return JSON.parse(matches[0][1]);}catch{return null;}
}
export function inspectLabApproval(input={}) {
 try {
  const {comment={},run={},nativeRun={},artifact={},pr={},source={},packagePins={},nowUtc}=input;
  const p=parseLabApproval(comment);
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(p,k)))return hold('LAB_APPROVAL_SCHEMA_INVALID');
  if(p.schemaVersion!==LAB_SCHEMA||p.operation!=='RUN_R7_DISPOSABLE_NATIVE_SMOKE'||p.repository!==LAB_REPOSITORY||p.prNumber!==3211||p.acceptEvaluationTerms!==true)return hold('LAB_APPROVAL_SCOPE_INVALID');
  if(!integer(comment.id)||!owner(comment.user)||comment.author_association!=='OWNER'||comment.issue_url!==api+'/issues/'+CANONICAL_MAILBOX_ISSUE||comment.created_at!==comment.updated_at)return hold('LAB_APPROVAL_OWNER_OR_IMMUTABILITY_UNPROVEN');
  if(!hex(p.sourceHead,40)||!hex(p.sourceTree,40)||!['artifactArchiveSha256','nativePackageSha256','driverSha256','clientSha256'].every(k=>hex(p[k],64))||p.officialIsoSha256!==LAB_ISO_SHA256||p.installWimSha256!==LAB_WIM_SHA256)return hold('LAB_APPROVAL_INPUT_PINS_INVALID');
  if(!['workflowRunId','nativeRunId','nativeRunAttempt','artifactId'].every(k=>integer(p[k]))||p.workflowRunAttempt!==1)return hold('LAB_APPROVAL_RUN_BINDING_INVALID');
  const now=instant(nowUtc),created=instant(comment.created_at),expires=instant(p.expiresAtUtc),started=instant(run.created_at),built=instant(nativeRun.updated_at);
  if(![now,created,expires,started,built].every(Number.isFinite)||started>created||built>created||created>now||now>=expires||expires>created+2*60*60_000||now-created>10*60_000||expires-now<110*60_000)return hold('LAB_APPROVAL_FRESHNESS_UNPROVEN');
  if(run.id!==p.workflowRunId||run.run_attempt!==1||run.event!=='workflow_dispatch'||run.path!==LAB_WORKFLOW||run.name!=='Native Windows r7 Access Probe Proof'||run.status!=='in_progress'||!owner(run.actor)||!owner(run.triggering_actor)||run.head_sha!==p.sourceHead||run.head_repository?.full_name!==LAB_REPOSITORY)return hold('LAB_ACTUAL_HOSTED_RUN_UNPROVEN');
  if(source.head!==p.sourceHead||source.tree!==p.sourceTree||source.runId!==run.id||source.runAttempt!==1)return hold('LAB_CHECKOUT_IDENTITY_MISMATCH');
  if(pr.number!==3211||pr.merged!==true||pr.head?.sha!==p.sourceHead||pr.head?.ref!==LAB_BRANCH||pr.head?.repo?.full_name!==LAB_REPOSITORY||pr.base?.repo?.full_name!==LAB_REPOSITORY)return hold('LAB_MERGED_SOURCE_IDENTITY_UNPROVEN');
  if(nativeRun.id!==p.nativeRunId||nativeRun.run_attempt!==p.nativeRunAttempt||nativeRun.event!=='pull_request'||nativeRun.path!==LAB_WORKFLOW||nativeRun.status!=='completed'||nativeRun.conclusion!=='success'||nativeRun.head_sha!==p.sourceHead||nativeRun.head_repository?.full_name!==LAB_REPOSITORY)return hold('LAB_SUCCESSFUL_NATIVE_BUILD_UNPROVEN');
  if(artifact.id!==p.artifactId||artifact.expired!==false||artifact.workflow_run?.id!==p.nativeRunId||artifact.workflow_run?.head_sha!==p.sourceHead||artifact.workflow_run?.repository_id!==1179385578||artifact.name!=='r7-native-test-'+p.sourceHead+'-'+p.nativeRunId+'-'+p.nativeRunAttempt||artifact.digest!=='sha256:'+p.artifactArchiveSha256||!integer(artifact.size_in_bytes)||artifact.size_in_bytes>3*1024*1024)return hold('LAB_IMMUTABLE_NATIVE_ARTIFACT_UNPROVEN');
  if(packagePins.schemaVersion!=='stephanos.r7-native-test-package-pins.v1'||packagePins.sourceHead!==p.sourceHead||packagePins.sourceTree!==p.sourceTree||String(packagePins.runId)!==String(p.nativeRunId)||String(packagePins.runAttempt)!==String(p.nativeRunAttempt)||packagePins.archiveSha256!==p.nativePackageSha256||packagePins.driverLoaded!==false||packagePins.nativeCallbacksExecuted!==false||packagePins.productionAuthority!==false||packagePins.leaseChanged!==false)return hold('LAB_PACKAGE_PINS_UNPROVEN');
  const parts=packagePins.components;
  if(!Array.isArray(parts)||parts.length!==2||parts.filter(x=>x.name==='R7NativeQualification.sys'&&x.sha256===p.driverSha256).length!==1||parts.filter(x=>x.name==='R7NativeQualificationClient.exe'&&x.sha256===p.clientSha256).length!==1)return hold('LAB_COMPONENT_PINS_UNPROVEN');
  return Object.freeze({admitted:true,blocker:'',schemaVersion:'stephanos.r7-isolated-native-admission.v1',approvalCommentId:comment.id,workflowCreatedAtUtc:run.created_at,approvalBodySha256:digest(comment.body),workflowRunId:run.id,workflowRunAttempt:1,sourceHead:p.sourceHead,sourceTree:p.sourceTree,artifactId:p.artifactId,nativePackageSha256:p.nativePackageSha256,driverSha256:p.driverSha256,clientSha256:p.clientSha256,expiresAtUtc:p.expiresAtUtc,guestExecutionAuthority:true,productionAuthority:false,claimMutationAuthority:false});
 }catch{return hold('LAB_APPROVAL_UNREADABLE');}
}
