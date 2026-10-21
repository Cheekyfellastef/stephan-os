// Synthetic, offline fixtures only. Nothing here is a live review or approval.
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { buildIndependentReviewArtifact, independentReviewArtifactName } from './operatorMergeReviewArtifactV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import { recipientSpkiBase64 } from './r7FirstRootRecipientSpkiV1.fixture.mjs';
import { R7_FIRST_ROOT_INTAKE_MODE as mode, R7_FIRST_ROOT_INTAKE_WORKFLOW as workflow,
  R7_FIRST_ROOT_INTAKE_PURPOSE as purpose,R7_FIRST_ROOT_INTAKE_AUDIENCE as prefix } from './r7FirstRootOwnerIntakeProposalV1.mjs';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const REPO='Cheekyfellastef/stephan-os',API='https://api.github.com/repos/'+REPO;
export const STORAGE='https://productionresultssa17.blob.core.windows.net/actions-results/80c77559-8ff7-49a5-9d2f-08c5e8ff1b84/workflow-job-run-4d9be84b-e576-5bc3-a654-2085dc99aec3/artifacts/7fc179bd387fce1470d9f99f52fcca5a01ff1d1358562f69c71f5f1cf03b08f4.zip?rscd=attachment&rsct=application%2Fzip&se=2099-01-01T00%3A00%3A00Z&sig=FIXTURE_ONLY&ske=2099-01-01T00%3A00%3A00Z&skoid=00000000-0000-0000-0000-000000000000&sks=b&skt=2099-01-01T00%3A00%3A00Z&sktid=00000000-0000-0000-0000-000000000000&skv=2025-11-05&sp=r&spr=https&sr=b&st=2099-01-01T00%3A00%3A00Z&sv=2025-11-05';
export function zip(entries,{compressed=false,descriptor=false}={}) {
  const locals=[],centrals=[];let offset=0;
  for(const [file,payload] of entries) {
    const bytes=Buffer.from(payload),name=Buffer.from(file),data=compressed?deflateRawSync(bytes):bytes;
    const flags=descriptor?8:0,method=compressed?8:0,version=compressed?20:10,crc=crc32(bytes);
    const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(version,4);
    local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt32LE(descriptor?0:crc,14);
    local.writeUInt32LE(descriptor?0:data.length,18);local.writeUInt32LE(descriptor?0:bytes.length,22);
    local.writeUInt16LE(name.length,26);name.copy(local,30);
    const desc=Buffer.alloc(descriptor?16:0);if(descriptor){desc.writeUInt32LE(0x08074b50);desc.writeUInt32LE(crc,4);desc.writeUInt32LE(data.length,8);desc.writeUInt32LE(bytes.length,12);}
    const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(version,6);
    central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);
    central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);name.copy(central,46);
    locals.push(local,data,desc);centrals.push(central);offset+=local.length+data.length+desc.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(centrals.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,...centrals,end]);
}
export function fixture({moved=false,merged=true,bom=true,compressed=false,descriptor=false}={}) {
  const current=Date.now(),time=minutes=>new Date(current+minutes*60000).toISOString();
  const repo={id:1179385578,full_name:REPO,owner:{id:267490109,login:'Cheekyfellastef'},default_branch:'main'};
  const c={branch:'feature/3123-r7-registry-protection-readback-20261020',sourceHead:'a'.repeat(40),sourceTree:'b'.repeat(40),
    reviewedBase:'c'.repeat(40),sourceMergeCommit:'d'.repeat(40),expectedMain:(moved?'e':'d').repeat(40),
    imageSha256:'',bundleSha256:'',manifestSha256:''};
  const image=Buffer.from('MZ_SYNTHETIC_NONEXECUTABLE_FIXTURE_ONLY');c.imageSha256=hash(image);
  const manifestText=Object.entries({schemaVersion:'stephanos.original-r7-source-only-package.v1',repository:REPO,
    sourceHead:c.sourceHead,imageFile:'Stephanos.OriginalR7CustodyWitness.exe',imageSha256:c.imageSha256,
    managedPayloadLayout:'SINGLE_FILE_WIN_X64_SELF_CONTAINED',binaryStatus:'UNSIGNED_UNCOMMISSIONED',
    protectedServiceSidQualified:'false',originalWriterProvenanceAuthenticated:'false',wholeSourceWriterExclusionProven:'false',
    signingAuthorityProven:'false',operatorApprovalProven:'false',physicalBattleBridgeCommissioned:'false',originalLeaseReleased:'false',historicalOutcome:'UNKNOWN'})
    .map(([k,v])=>k+'='+v).join(bom?'\r\n':'\n')+(bom?'\r\n':'\n');
  const manifest=Buffer.concat([bom?Buffer.from([0xef,0xbb,0xbf]):Buffer.alloc(0),Buffer.from(manifestText)]);c.manifestSha256=hash(manifest);
  const packageEntries=[['Stephanos.OriginalR7CustodyWitness.exe',image],['UNTRUSTED-CI-PACKAGE-MANIFEST.txt',manifest],['THIRD_PARTY_NOTICES.txt','Fixture notices']];
  const nativeZip=zip(packageEntries,{compressed,descriptor});c.bundleSha256=hash(nativeZip);
  const artifact=buildIndependentReviewArtifact({repository:REPO,prNumber:3178,branch:c.branch,sourceHead:c.sourceHead,baseSha:c.reviewedBase,
    workflowRunId:123,workflowRunAttempt:2,createdAtUtc:time(-15),analysis:{schemaVersion:'stephanos.independent-security-analysis.v1',findings:[],
      counts:{P0:0,P1:0,P2:0},verdict:'clean',proofRefs:['proofs/fixture/only'],finalVerdict:'INDEPENDENT_SECURITY_REVIEW_CLEAN'}});
  const reviewZip=zip([['independent-review-result.json',JSON.stringify(artifact)]]);
  const r={runId:'123',runAttempt:'2',artifactId:'456',archiveSha256:hash(reviewZip),payloadSha256:artifact.payloadSha256,
    reviewedSourceHead:c.sourceHead,reviewedSourceTree:c.sourceTree,reviewedBase:c.reviewedBase};
  const packet={schemaVersion:'stephanos.r7-first-root-owner-intake-proposal.v1',purpose,repository:REPO,capabilityIssue:3123,prNumber:3178,
    requestId:'r7-resolver-fixture-only',original:{missionId:'critical-2962-elastic-goal',leaseId:'critical-2962-elastic-goal-r7-lease',leaseRevision:7,
      leaseDigest:'f'.repeat(64),sourceExecutionId:'critical-2962-elastic-goal-r1-0123456789ab',branch:'openclaw/elastic-goal-2962',
      sourceHead:'4e5023eef829b285095db4eeb09d6f2b365e33e4',historicalOutcome:'UNKNOWN'},candidate:c,review:r,
    hostPolicyProposalDigest:'d'.repeat(64),fixedRecipeDigest:'e'.repeat(64),issuedAtUtc:time(-1),expiresAtUtc:time(4)};
  const title='Protected operator merge '+c.sourceHead;
  const ownerCommand={schemaVersion:'stephanos.protected-workflow-dispatch.v1',requestId:'owner-source-fixture-only',operation:'DISPATCH_PROTECTED_OPERATOR_MERGE',
    repository:REPO,issueNumber:CANONICAL_MAILBOX_ISSUE,operatorApproval:'operator-approved',expiresAt:time(-5),mode:'user-owned-protected-squash',prNumber:3178,
    expectedBranch:c.branch,expectedHead:c.sourceHead,expectedHeadTree:c.sourceTree,expectedBase:c.reviewedBase,
    authorizationHead:c.sourceHead,authorizationHeadTree:c.sourceTree,authorizationBase:c.reviewedBase,
    independentReviewRunId:123,independentReviewRunAttempt:2,independentReviewArtifactId:456,
    independentReviewArtifactDigest:'sha256:'+r.archiveSha256,independentReviewPayloadSha256:r.payloadSha256};
  const ownerBody='```stephanos-protected-workflow-dispatch\n'+JSON.stringify(ownerCommand)+'\n```';
  const completion={schemaVersion:'stephanos.personal-repository-merge-completion.v1',repository:REPO,prNumber:3178,branch:c.branch,sourceHead:c.sourceHead,
    sourceTree:c.sourceTree,baseSha:c.reviewedBase,mergeCommit:c.sourceMergeCommit,mainTree:c.sourceTree,workflowRunId:321,workflowRunAttempt:1,
    authorizationCommentId:902,authorizationCommentSha256:hash(ownerBody),environment:'operator-merge-approval',independentReviewWorkflowRunId:123,
    independentReviewWorkflowRunAttempt:2,independentReviewArtifactId:456,independentReviewArtifactDigest:'sha256:'+r.archiveSha256,
    independentReviewPayloadSha256:r.payloadSha256,evidenceSha256:'f'.repeat(64),mergeMethod:'squash',sourceBranchRetained:true};
  const completionBody='<!-- stephanos-personal-repository-protected-squash-completion -->\n## Protected personal-repository squash merge completed\n\n```json\n'+JSON.stringify(completion,null,2)+'\n```\n';
  const references={schemaVersion:'stephanos.r7-source-provenance-references-proposal.v1',permitSha256:'',sourceCompletion:{runId:'321',runAttempt:'1',commentId:'901',
    commentBodySha256:hash(completionBody),authorizationCommentId:'902',authorizationCommentSha256:hash(ownerBody),evidenceSha256:'f'.repeat(64)},
    nativePackage:{runId:'654',runAttempt:'1',jobId:'803',artifactId:'987',archiveSha256:c.bundleSha256,manifestSha256:c.manifestSha256}};
  const resources=new Map();const set=(p,v)=>resources.set(API+p,v);
  const pr={number:3178,state:merged?'closed':'open',merged,merge_commit_sha:merged?c.sourceMergeCommit:null,merged_at:merged?time(-3):null,
    head:{ref:c.branch,sha:c.sourceHead,repo},base:{ref:'main',sha:c.expectedMain,repo}};
  set('',repo);set('/git/ref/heads/main',{ref:'refs/heads/main',object:{type:'commit',sha:c.expectedMain}});set('/pulls/3178',pr);
  set('/git/commits/'+c.sourceHead,{sha:c.sourceHead,tree:{sha:c.sourceTree}});
  set('/git/ref/heads/'+c.branch,{ref:'refs/heads/'+c.branch,object:{type:'commit',sha:c.sourceHead}});
  set('/git/commits/'+c.sourceMergeCommit,{sha:c.sourceMergeCommit,tree:{sha:c.sourceTree},parents:[{sha:c.reviewedBase}]});
  const job=(id,name,runId,attempt,workflowName,headSha,headBranch)=>({id,name,run_id:runId,run_attempt:attempt,workflow_name:workflowName,
    head_sha:headSha,head_branch:headBranch,status:'completed',conclusion:'success',url:API+'/actions/jobs/'+id,
    run_url:API+'/actions/runs/'+runId,check_run_url:API+'/check-runs/'+id,html_url:'https://github.com/'+REPO+'/actions/runs/'+runId+'/job/'+id,
    started_at:time(-7),completed_at:time(-2)});
  set('/actions/workflows/independent-merge-security-review.yml',{id:11,path:'.github/workflows/independent-merge-security-review.yml',name:'Independent Merge Security Review',state:'active'});
  set('/actions/runs/123',{id:123,run_attempt:2,workflow_id:11,name:'Independent Merge Security Review',path:'.github/workflows/independent-merge-security-review.yml',
    event:'pull_request_target',repository:repo,head_sha:c.reviewedBase,status:'completed',conclusion:'success',pull_requests:[{number:3178,
      head:{ref:c.branch,sha:c.sourceHead},base:{ref:'main',sha:c.reviewedBase}}]});
  set('/actions/runs/123/attempts/2/jobs?filter=all&per_page=100&page=1',{total_count:1,jobs:[job(800,'independent-security-review',123,2,'Independent Merge Security Review',c.reviewedBase,'main')]});
  set('/actions/runs/123/artifacts?per_page=100&page=1',{total_count:1,artifacts:[{id:456,name:independentReviewArtifactName(123,2),expired:false,size_in_bytes:reviewZip.length,
    digest:'sha256:'+r.archiveSha256,workflow_run:{id:123}}]});
  set('/actions/workflows/original-r7-scm-preflight.yml',{id:387670512,path:'.github/workflows/original-r7-scm-preflight.yml',name:'Original R7 Windows SCM Preflight',state:'active'});
  set('/actions/runs/654',{id:654,run_attempt:1,workflow_id:387670512,name:'Original R7 Windows SCM Preflight',path:'.github/workflows/original-r7-scm-preflight.yml',
    event:'pull_request',repository:repo,head_repository:repo,head_sha:c.sourceHead,head_branch:c.branch,status:'completed',conclusion:'success',pull_requests:[{number:3178,
      head:{ref:c.branch,sha:c.sourceHead,repo:{id:1179385578}},base:{ref:'main',sha:c.reviewedBase,repo:{id:1179385578}}}]});
  set('/actions/runs/654/attempts/1/jobs?filter=all&per_page=100&page=1',{total_count:1,jobs:[job(803,'native-scm-preflight',654,1,'Original R7 Windows SCM Preflight',c.sourceHead,c.branch)]});
  set('/actions/runs/654/artifacts?per_page=100&page=1',{total_count:1,artifacts:[{id:987,name:'r7-witness-uncommissioned-source-only',expired:false,size_in_bytes:nativeZip.length,
    digest:'sha256:'+c.bundleSha256,created_at:time(-5),workflow_run:{id:654,head_sha:c.sourceHead}}]});
  set('/actions/workflows/operator-merge-approval-gate.yml',{id:22,path:'.github/workflows/operator-merge-approval-gate.yml',name:'Protected Operator Merge Queue Boundary',state:'active'});
  set('/actions/runs/321',{id:321,run_attempt:1,workflow_id:22,name:title,display_title:title,path:'.github/workflows/operator-merge-approval-gate.yml',event:'workflow_dispatch',
    repository:repo,head_repository:repo,head_sha:c.reviewedBase,head_branch:'main',status:'completed',conclusion:'success',created_at:time(-9),updated_at:time(-1),
    actor:{login:'Cheekyfellastef',id:267490109},triggering_actor:{login:'Cheekyfellastef',id:267490109}});
  set('/actions/runs/321/attempts/1/jobs?filter=all&per_page=100&page=1',{total_count:3,jobs:['personal-repository-evidence','operator-personal-repository-approval','operator-personal-repository-squash-merge'].map((n,i)=>job(810+i,n,321,1,title,c.reviewedBase,'main'))});
  set('/environments/operator-merge-approval',{id:91,name:'operator-merge-approval',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'Cheekyfellastef'}}]}],deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}});
  set('/actions/runs/321/approvals',[{state:'approved',user:{login:'Cheekyfellastef',id:267490109,type:'User'},environments:[{id:91,name:'operator-merge-approval'}]}]);
  set('/issues/comments/901',{id:901,issue_url:API+'/issues/3178',user:{id:41898282,login:'github-actions[bot]',type:'Bot'},performed_via_github_app:{id:15368,slug:'github-actions'},created_at:time(-3),updated_at:time(-3),body:completionBody});
  set('/issues/comments/902',{id:902,issue_url:API+'/issues/'+CANONICAL_MAILBOX_ISSUE,user:{id:267490109,login:'Cheekyfellastef',type:'User'},created_at:time(-10),updated_at:time(-10),body:ownerBody});
  if(moved)set('/compare/'+c.sourceMergeCommit+'...'+c.expectedMain+'?per_page=100&page=1',{status:'ahead',behind_by:0,ahead_by:1,total_commits:1,
    commits:[{sha:c.expectedMain}],base_commit:{sha:c.sourceMergeCommit},merge_base_commit:{sha:c.sourceMergeCommit}});
  const calls=[];const storageBytes=new Map([[STORAGE,reviewZip],[STORAGE.replace('sig=FIXTURE_ONLY','sig=PACKAGE_FIXTURE_ONLY'),nativeZip]]);
  function input(){const permitWire=JSON.stringify(packet),permitSha256=hash(permitWire),nativeAudience=prefix+permitSha256+':'+'f'.repeat(64)+':'+hash(Buffer.from(recipientSpkiBase64,'base64'));
    references.permitSha256=permitSha256;const referencesWire=JSON.stringify(references);
    return {permitWire,permitSha256,nativeAudience,nativeRecipientSpkiBase64:recipientSpkiBase64,referencesWire,referencesSha256:hash(referencesWire),dispatch:{mode,pr_number:'3178',expected_branch:c.branch,
      expected_head:c.sourceHead,expected_head_tree:c.sourceTree,expected_base:c.expectedMain,independent_review_run_id:r.runId,independent_review_run_attempt:r.runAttempt,
      independent_review_artifact_id:r.artifactId,independent_review_artifact_digest:'sha256:'+r.archiveSha256,independent_review_payload_sha256:r.payloadSha256,
      authorization_comment_id:'',r7_owner_permit_json:permitWire,r7_owner_permit_sha256:permitSha256,r7_native_challenge_audience:nativeAudience,
      r7_native_recipient_spki_base64:recipientSpkiBase64},context:{eventName:'workflow_dispatch',mode,
      repository:REPO,repositoryId:'1179385578',ownerId:'267490109',actor:'Cheekyfellastef',actorId:'267490109',triggeringActor:'Cheekyfellastef',ref:'refs/heads/main',sha:c.expectedMain,
      workflowRef:workflow,runId:'789',runAttempt:'1'}};}
  function response(url,bytes,{status=200,type='application/json',headers={},redirected=false}={}){const result=new Response(bytes,{status,headers:{'content-type':type,'content-length':String(bytes?.length??0),...headers}});
    Object.defineProperties(result,{url:{value:url,configurable:true},redirected:{value:redirected,configurable:true}});return result;}
  const fetch=async(url,options)=>{calls.push({url,options});
    if(storageBytes.has(url))return response(url,storageBytes.get(url),{type:'application/zip'});
    if(url===API+'/actions/artifacts/456/zip'||url===API+'/actions/artifacts/987/zip')return response(url,null,{status:302,headers:{location:url.includes('/987/')?STORAGE.replace('sig=FIXTURE_ONLY','sig=PACKAGE_FIXTURE_ONLY'):STORAGE}});
    if(!resources.has(url))throw new Error('Unexpected fixture URL '+url);
    return response(url,Buffer.from(JSON.stringify(structuredClone(resources.get(url)))));};
  return {packet,references,resources,calls,storageBytes,input,fetch,response,set,artifact,reviewZip,nativeZip,packageEntries};
}
