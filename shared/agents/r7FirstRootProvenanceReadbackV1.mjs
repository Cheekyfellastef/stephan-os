import { createHash } from 'node:crypto';
import { validateProtectedEnvironment } from './operatorMergeApprovalGate.mjs';
import { validatePersonalRepositoryDispatchWorkflowDefinition, validatePersonalRepositoryPriorJobEnvelope,
  validatePersonalRepositorySquashCompletion, validatePersonalRepositoryArtifactArchiveRedirect,
  buildPersonalRepositoryArtifactArchiveRequest, validatePersonalRepositoryArtifactArchiveResponse,
  readBoundedPersonalRepositoryResponseBody } from './operatorPersonalRepositoryMergeV1.mjs';
import { validateProtectedWorkflowActorHandoff } from './protectedWorkflowDispatchMailboxV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import { inspectR7UntrustedSourcePackage, R7_PACKAGE_ARCHIVE_MAX_BYTES } from './r7UntrustedSourcePackageV1.mjs';

const REPO='Cheekyfellastef/stephan-os', ROOT='/repos/'+REPO, API='https://api.github.com'+ROOT;
const hash=x=>createHash('sha256').update(x).digest('hex');
export class R7SourceProvenanceError extends Error {
  constructor(code){super('R7_PROVENANCE_'+code);this.code='R7_PROVENANCE_'+code;}
}
const need=(ok,code)=>{if(!ok)throw new R7SourceProvenanceError(code);};
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const positive=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x));
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const repo=x=>x?.id===1179385578&&x.full_name===REPO&&x.owner?.id===267490109&&x.owner.login==='Cheekyfellastef';
const when=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));

// Proposed, unadopted locator envelope. References are never approvals. The
// digest prevents accidental mixing with another permit; actual API records
// and bytes must still satisfy every identity predicate below.
export function parseR7SourceProvenanceReferences(wire,expectedHash,permitHash,packet) {
  need(typeof wire==='string'&&Buffer.byteLength(wire)<=8192&&digest(expectedHash)&&hash(wire)===expectedHash,'REFERENCES_BYTES');
  const p=JSON.parse(wire);
  need(JSON.stringify(p)===wire&&closed(p,['schemaVersion','permitSha256','sourceCompletion','nativePackage'])
    &&p.schemaVersion==='stephanos.r7-source-provenance-references-proposal.v1'&&p.permitSha256===permitHash,'REFERENCES_IDENTITY');
  const s=p.sourceCompletion,n=p.nativePackage;
  need(closed(s,['runId','runAttempt','commentId','commentBodySha256','authorizationCommentId','authorizationCommentSha256','evidenceSha256'])
    &&['runId','runAttempt','commentId','authorizationCommentId'].every(k=>positive(s[k]))
    &&['commentBodySha256','authorizationCommentSha256','evidenceSha256'].every(k=>digest(s[k])),'SOURCE_REFERENCES');
  need(closed(n,['runId','runAttempt','jobId','artifactId','archiveSha256','manifestSha256'])
    &&['runId','runAttempt','jobId','artifactId'].every(k=>positive(n[k]))
    &&n.archiveSha256===packet.candidate.bundleSha256&&n.manifestSha256===packet.candidate.manifestSha256,'PACKAGE_REFERENCES');
  return p;
}

const COMPLETION_KEYS=['schemaVersion','repository','prNumber','branch','sourceHead','sourceTree','baseSha','mergeCommit','mainTree',
  'workflowRunId','workflowRunAttempt','authorizationCommentId','authorizationCommentSha256','environment',
  'independentReviewWorkflowRunId','independentReviewWorkflowRunAttempt','independentReviewArtifactId',
  'independentReviewArtifactDigest','independentReviewPayloadSha256','evidenceSha256','mergeMethod','sourceBranchRetained'];

// Internal readback adapter. An injected reader is only a fixture, never an
// authentication source. The production resolver supplies its fixed HTTPS
// transport and projects provenance facts; this adapter emits no authority.
export async function readR7ProtectedSourceProvenance({packet,references,readJson,pages,main,pr,branch,alive}) {
  const c=packet.candidate,r=packet.review,s=references.sourceCompletion;
  need(pr.merged===true&&pr.state==='closed'&&pr.merge_commit_sha===c.sourceMergeCommit,'SOURCE_NOT_MERGED');
  const metadata=await readJson('/actions/workflows/operator-merge-approval-gate.yml');
  need(validatePersonalRepositoryDispatchWorkflowDefinition([metadata]).valid,'WORKFLOW_DEFINITION');
  const run=await readJson('/actions/runs/'+s.runId);
  // Run approval history has no attempt discriminator. Accept exactly attempt1
  // only; never infer which rerun a prior environment approval authorized.
  const title='Protected operator merge '+c.sourceHead;
  need(run.id===Number(s.runId)&&s.runAttempt==='1'&&run.run_attempt===1&&run.workflow_id===metadata.id
    &&repo(run.repository)&&repo(run.head_repository)&&run.path===metadata.path&&run.name===title&&run.display_title===title
    &&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.head_sha===c.reviewedBase
    &&run.status==='completed'&&run.conclusion==='success'&&when(run.created_at)&&when(run.updated_at),'PROTECTED_RUN');
  const collected=await pages('/actions/runs/'+s.runId+'/attempts/1/jobs?filter=all','jobs');
  for(const name of ['personal-repository-evidence','operator-personal-repository-approval','operator-personal-repository-squash-merge']) {
    const jobs=collected.jobs.filter(j=>j.name===name);
    need(jobs.length===1&&jobs[0].status==='completed'&&jobs[0].conclusion==='success'
      &&jobs[0].run_attempt===1&&validatePersonalRepositoryPriorJobEnvelope(run,jobs[0]).valid,'PROTECTED_JOB');
  }
  const mergeJob=collected.jobs.find(j=>j.name==='operator-personal-repository-squash-merge');
  const environment=await readJson('/environments/operator-merge-approval');
  need(validateProtectedEnvironment(environment).valid&&Number.isSafeInteger(environment.id)&&environment.id>0,'ENVIRONMENT_CONFIGURATION');
  const approvals=await readJson('/actions/runs/'+s.runId+'/approvals');
  need(Array.isArray(approvals)&&approvals.length===1&&approvals[0].state==='approved'
    &&approvals[0].user?.login==='Cheekyfellastef'&&approvals[0].user.id===267490109&&approvals[0].user.type==='User'
    &&Array.isArray(approvals[0].environments)&&approvals[0].environments.length===1
    &&approvals[0].environments[0].id===environment.id&&approvals[0].environments[0].name==='operator-merge-approval','OWNER_APPROVAL_HISTORY');
  const comment=await readJson('/issues/comments/'+s.commentId);
  need(comment?.id===Number(s.commentId)&&comment.issue_url===API+'/issues/3178'
    &&comment.user?.id===41898282&&comment.user.login==='github-actions[bot]'&&comment.user.type==='Bot'
    &&comment.performed_via_github_app?.id===15368&&comment.performed_via_github_app.slug==='github-actions'
    &&comment.created_at===comment.updated_at&&when(comment.created_at)&&hash(String(comment.body))===s.commentBodySha256
    &&Date.parse(comment.created_at)>=Date.parse(mergeJob.started_at)
    &&Date.parse(comment.created_at)<=Date.parse(run.updated_at),'IMMUTABLE_COMPLETION_COMMENT');
  const body=comment.body, marker='<!-- stephanos-personal-repository-protected-squash-completion -->';
  need(body.startsWith(marker+'\n')&&body.split(marker).length===2,'COMPLETION_MARKER');
  const blocks=[...body.matchAll(/```json\n([^]*?)\n```/g)];
  need(blocks.length===1,'COMPLETION_JSON_COUNT');
  const completion=JSON.parse(blocks[0][1]);
  const wanted={schemaVersion:'stephanos.personal-repository-merge-completion.v1',repository:REPO,prNumber:3178,
    branch:c.branch,sourceHead:c.sourceHead,sourceTree:c.sourceTree,baseSha:c.reviewedBase,
    mergeCommit:c.sourceMergeCommit,mainTree:c.sourceTree,workflowRunId:Number(s.runId),workflowRunAttempt:1,
    authorizationCommentId:Number(s.authorizationCommentId),authorizationCommentSha256:s.authorizationCommentSha256,
    environment:'operator-merge-approval',independentReviewWorkflowRunId:Number(r.runId),
    independentReviewWorkflowRunAttempt:Number(r.runAttempt),independentReviewArtifactId:Number(r.artifactId),
    independentReviewArtifactDigest:'sha256:'+r.archiveSha256,independentReviewPayloadSha256:r.payloadSha256,
    evidenceSha256:s.evidenceSha256,mergeMethod:'squash',sourceBranchRetained:true};
  need(closed(completion,COMPLETION_KEYS)&&Object.entries(wanted).every(([key,value])=>completion[key]===value),'COMPLETION_BINDINGS');
  const ownerComment=await readJson('/issues/comments/'+s.authorizationCommentId);
  const handoff=validateProtectedWorkflowActorHandoff(ownerComment,{
    operation:'DISPATCH_PROTECTED_OPERATOR_MERGE',repository:REPO,issueNumber:CANONICAL_MAILBOX_ISSUE,
    operatorApproval:'operator-approved',mode:'user-owned-protected-squash',prNumber:3178,expectedBranch:c.branch,
    expectedHead:c.sourceHead,expectedHeadTree:c.sourceTree,expectedBase:c.reviewedBase,
    authorizationHead:c.sourceHead,authorizationHeadTree:c.sourceTree,authorizationBase:c.reviewedBase,
    independentReviewRunId:Number(r.runId),independentReviewRunAttempt:Number(r.runAttempt),
    independentReviewArtifactId:Number(r.artifactId),independentReviewArtifactDigest:'sha256:'+r.archiveSha256,
    independentReviewPayloadSha256:r.payloadSha256}, {
    transportActor:run.actor?.login,transportActorId:run.actor?.id,
    expectedCommentId:Number(s.authorizationCommentId),expectedCommentSha256:s.authorizationCommentSha256,
    // Historical source dispatch is evaluated at its authenticated creation
    // time, never reused as a fresh dispatch or first-root host authorization.
    now:new Date(run.created_at)});
  need(handoff.ok&&run.triggering_actor?.id===run.actor.id&&run.triggering_actor.login===run.actor.login,'OWNER_DISPATCH_PROVENANCE');
  const merged=await readJson('/git/commits/'+c.sourceMergeCommit);
  need(merged.sha===c.sourceMergeCommit&&merged.tree?.sha===c.sourceTree&&merged.parents?.length===1
    &&merged.parents[0].sha===c.reviewedBase,'HISTORICAL_SQUASH_COMMIT');
  let ancestry=true;
  if(c.expectedMain!==c.sourceMergeCommit) {
    const comparison=await readJson('/compare/'+c.sourceMergeCommit+'...'+c.expectedMain+'?per_page=100&page=1');
    need(comparison.status==='ahead'&&comparison.behind_by===0&&Number.isSafeInteger(comparison.ahead_by)
      &&comparison.ahead_by>0&&comparison.ahead_by<100&&comparison.total_commits===comparison.ahead_by
      &&comparison.commits?.length===comparison.total_commits&&comparison.commits.at(-1)?.sha===c.expectedMain
      &&comparison.base_commit?.sha===c.sourceMergeCommit&&comparison.merge_base_commit?.sha===c.sourceMergeCommit,'FORWARD_MAIN_ANCESTRY');
    // Ancestry does not prove that current files retain source compatibility.
  }
  const canonical=validatePersonalRepositorySquashCompletion({mergeResponse:{merged:pr.merged,sha:pr.merge_commit_sha},
    pullRequest:pr,liveMainRef:main,mergeCommit:merged,branchRef:branch},
    {sourceHead:c.sourceHead,sourceTree:c.sourceTree,baseSha:c.reviewedBase});
  // Re-read every mutable authority-bearing record. Authenticated endpoints are
  // snapshots, not immutable credentials or a replacement for native CAS.
  const [lastComment,lastOwner,lastRun,lastApprovals,lastEnvironment]=await Promise.all([
    readJson('/issues/comments/'+s.commentId),readJson('/issues/comments/'+s.authorizationCommentId),
    readJson('/actions/runs/'+s.runId),readJson('/actions/runs/'+s.runId+'/approvals'),readJson('/environments/operator-merge-approval')]);
  need(JSON.stringify(lastComment)===JSON.stringify(comment)&&JSON.stringify(lastOwner)===JSON.stringify(ownerComment)
    &&JSON.stringify(lastRun)===JSON.stringify(run)
    &&JSON.stringify(lastApprovals)===JSON.stringify(approvals)&&JSON.stringify(lastEnvironment)===JSON.stringify(environment),'SOURCE_AUTHORITY_CHANGED_DURING_READ');
  alive();
  return Object.freeze({protectedSourceApprovalValid:true,historicalSourceCompletionValid:true,forwardMainAncestryObserved:ancestry,
    currentMainCompletionValid:canonical.valid,postMergeCompatibilityPending:c.expectedMain!==c.sourceMergeCommit,
    hostExecutionAuthorized:false,canonicalLeaseReleaseAuthorized:false});
}

export async function readR7NativePackageProvenance({packet,references,readJson,pages,getRedirect,download,alive}) {
  const c=packet.candidate,n=references.nativePackage;
  const definition=await readJson('/actions/workflows/original-r7-scm-preflight.yml');
  need(definition.id===387670512&&definition.path==='.github/workflows/original-r7-scm-preflight.yml'
    &&definition.name==='Original R7 Windows SCM Preflight'&&definition.state==='active','PACKAGE_WORKFLOW_DEFINITION');
  const run=await readJson('/actions/runs/'+n.runId);
  const bound=Array.isArray(run.pull_requests)&&run.pull_requests.length===1?run.pull_requests[0]:{};
  need(run.id===Number(n.runId)&&run.run_attempt===Number(n.runAttempt)&&run.workflow_id===definition.id
    &&run.name===definition.name&&run.path===definition.path&&repo(run.repository)&&repo(run.head_repository)
    &&run.event==='pull_request'&&run.head_branch===c.branch&&run.head_sha===c.sourceHead
    &&run.status==='completed'&&run.conclusion==='success'&&bound.number===3178
    &&bound.head?.ref===c.branch&&bound.head.sha===c.sourceHead&&bound.base?.ref==='main'
    &&bound.base.sha===c.reviewedBase&&bound.head.repo?.id===1179385578&&bound.base.repo?.id===1179385578,'PACKAGE_RUN');
  const jobs=await pages('/actions/runs/'+n.runId+'/attempts/'+n.runAttempt+'/jobs?filter=all','jobs');
  const selectedJobs=jobs.jobs.filter(j=>j.name==='native-scm-preflight');
  const job=selectedJobs[0];
  need(selectedJobs.length===1&&job.id===Number(n.jobId)&&job.run_attempt===Number(n.runAttempt)
    &&job.status==='completed'&&job.conclusion==='success'&&validatePersonalRepositoryPriorJobEnvelope(run,job).valid,'PACKAGE_JOB');
  const listed=await pages('/actions/runs/'+n.runId+'/artifacts','artifacts');
  const artifact=listed.artifacts[0];
  need(listed.total_count===1&&artifact.id===Number(n.artifactId)&&artifact.name==='r7-witness-uncommissioned-source-only'
    &&artifact.expired===false&&artifact.workflow_run?.id===run.id&&artifact.workflow_run.head_sha===c.sourceHead
    &&artifact.digest==='sha256:'+n.archiveSha256&&Number.isSafeInteger(artifact.size_in_bytes)
    &&artifact.size_in_bytes>0&&artifact.size_in_bytes<=R7_PACKAGE_ARCHIVE_MAX_BYTES
    &&when(artifact.created_at)&&Date.parse(artifact.created_at)>=Date.parse(job.started_at)
    &&Date.parse(artifact.created_at)<=Date.parse(job.completed_at),'PACKAGE_ARTIFACT_METADATA');
  const path=ROOT+'/actions/artifacts/'+n.artifactId+'/zip';
  const redirect=await getRedirect('/actions/artifacts/'+n.artifactId+'/zip');
  const validRedirect=validatePersonalRepositoryArtifactArchiveRedirect({path,repository:REPO,response:redirect}).valid;
  const location=redirect.headers.get('location');await redirect.body?.cancel?.();
  need(validRedirect,'PACKAGE_REDIRECT');
  const descriptor=buildPersonalRepositoryArtifactArchiveRequest(location);
  need(descriptor.valid,'PACKAGE_STORAGE_REQUEST');
  const response=await download(descriptor.request);
  const accepted=validatePersonalRepositoryArtifactArchiveResponse({expectedUrl:descriptor.request.url,response,maxBytes:R7_PACKAGE_ARCHIVE_MAX_BYTES});
  if(!accepted.valid||accepted.contentLength!==artifact.size_in_bytes){await response.body?.cancel?.();need(false,'PACKAGE_STORAGE_RESPONSE');}
  const bytes=await readBoundedPersonalRepositoryResponseBody(response,R7_PACKAGE_ARCHIVE_MAX_BYTES);
  need(bytes.length===artifact.size_in_bytes,'PACKAGE_ARCHIVE_SIZE');
  const inspected=inspectR7UntrustedSourcePackage(bytes,c);
  const lastRun=await readJson('/actions/runs/'+n.runId);
  const lastList=await pages('/actions/runs/'+n.runId+'/artifacts','artifacts');
  need(JSON.stringify(lastRun)===JSON.stringify(run)&&lastList.total_count===1
    &&JSON.stringify(lastList.artifacts)===JSON.stringify(listed.artifacts),'PACKAGE_CHANGED_DURING_READ');
  alive();return Object.freeze({packageContentProvenanceValid:true,...inspected});
}
