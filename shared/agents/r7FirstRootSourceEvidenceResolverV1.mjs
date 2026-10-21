import { createHash } from 'node:crypto';
import { prepareR7FirstRootOwnerIntakeProposal } from './r7FirstRootOwnerIntakeProposalV1.mjs';
import { validateIndependentReviewWorkflowRun, INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_JOB } from './operatorMergeApprovalGate.mjs';
import { validateIndependentReviewArtifactSet, validateIndependentReviewArtifact,
  INDEPENDENT_REVIEW_ARTIFACT_FILE, INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES } from './operatorMergeReviewArtifactV1.mjs';
import { executePersonalRepositoryArtifactArchiveTransport, extractPersonalRepositoryArtifactZip,
  readBoundedPersonalRepositoryResponseBody } from './operatorPersonalRepositoryMergeV1.mjs';
import { R7SourceProvenanceError, parseR7SourceProvenanceReferences, readR7ProtectedSourceProvenance,
  readR7NativePackageProvenance } from './r7FirstRootProvenanceReadbackV1.mjs';

// Source evidence only. This is not an approval, OIDC issuer, native admission
// adapter, service installer, root enrollment operation or lease executor.
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const API = 'https://api.github.com/repos/' + REPOSITORY;
const REVIEW_PATH = '.github/workflows/independent-merge-security-review.yml';
const MAX_JSON = 512 * 1024, MAX_PAGES = 4, MAX_REQUESTS = 80;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const NO_AUTHORITY = Object.freeze({
  policyAdopted:false, sourceMergeAuthorized:false, hostExecutionAuthorized:false,
  humanOsConsentProven:false, executorAdmitted:false, rootEnrollmentAuthorized:false,
  tokenIssuanceAuthorized:false, independentSignatureProven:false,
  canonicalLeaseReleaseAuthorized:false, approvalCardCreated:false,
  nativeChallengeFreshnessAuthenticated:false,
});
export const R7_SOURCE_EVIDENCE_REMAINING_GATES = Object.freeze([
  'R7_FIRST_ROOT_POLICY_ADOPTION_NOT_PROVEN',
  'R7_FIRST_ROOT_PRIVATE_NATIVE_CHALLENGE_HANDOFF_NOT_IMPLEMENTED',
  'R7_FIRST_ROOT_PRIVATE_TOKEN_DELIVERY_NOT_IMPLEMENTED',
  'R7_FIRST_ROOT_NATIVE_OS_CONSENT_AND_EXECUTOR_ADMISSION_NOT_PROVEN',
]);
class Closed extends Error { constructor(code) { super(code); this.code=code; } }
const need = (condition, code) => { if (!condition) throw new Closed(code); };
const strictId = value => Number.isSafeInteger(value) && value > 0;
const repoIdentity = value => value?.id === 1179385578 && value?.full_name === REPOSITORY
  && value?.owner?.id === 267490109 && value?.owner?.login === 'Cheekyfellastef';
function outcome(blockers, facts={}, observedAtUtc) {
  return Object.freeze({schemaVersion:'stephanos.r7-first-root-source-evidence.v1',
    classification:'R7_FIRST_ROOT_SOURCE_EVIDENCE_HELD',
    blockers:Object.freeze([...new Set(blockers)]), observedAtUtc,
    reviewArtifactAuthenticated:false, sourceIdentityAuthenticated:false,
    sourceMergeReadbackAuthenticated:false, sourceAdoptionAuthenticated:false,
    protectedSourceApprovalAuthenticated:false,nativeImageProvenanceAuthenticated:false,
    ...facts, ...NO_AUTHORITY});
}

// The caller maps an existing read-only ephemeral Actions token explicitly.
// No environment discovery, credential lookup, token export or dispatch occurs.
// Dependencies cannot be overridden by a packet or factory option.
export function createR7FirstRootSourceEvidenceResolver(options={}) {
  need(Object.keys(options).length === 1 && Object.hasOwn(options,'githubReadToken'), 'R7_READ_ONLY_TOKEN_MAPPING_INVALID');
  const token=options.githubReadToken;
  need(typeof token === 'string' && token.length >= 8 && token.length <= 4096
    && /^[\x21-\x7e]+$/.test(token), 'R7_READ_ONLY_TOKEN_MAPPING_INVALID');
  const request=globalThis.fetch.bind(globalThis);
  return Object.freeze({resolve:async input => {
    const started=Date.now(), now=()=>new Date().toISOString();
    const facts={}; let count=0;
    try {
      const inputKeys=['permitWire','permitSha256','nativeAudience','nativeRecipientSpkiBase64','dispatch','context'];
      const withRefs=input && Object.hasOwn(input,'referencesWire');
      need(input && Object.keys(input).sort().join('|') ===
        [...inputKeys,...(withRefs?['referencesWire','referencesSha256']:[])].sort().join('|'), 'R7_RESOLVER_INPUT_INVALID');
      const prepared=prepareR7FirstRootOwnerIntakeProposal({permitWire:input.permitWire,permitSha256:input.permitSha256,
        nativeAudience:input.nativeAudience,nativeRecipientSpkiBase64:input.nativeRecipientSpkiBase64,
        dispatch:input.dispatch,context:input.context,nowUtc:now()});
      need(prepared.classification === 'R7_FIRST_ROOT_INTAKE_PREPARED_HELD','R7_INTAKE_PACKET_INVALID');
      const packet=JSON.parse(input.permitWire), c=packet.candidate, r=packet.review;
      const references=withRefs?parseR7SourceProvenanceReferences(input.referencesWire,input.referencesSha256,input.permitSha256,packet):null;
      const runId=Number(r.runId), attempt=Number(r.runAttempt), artifactId=Number(r.artifactId);
      need([runId,attempt,artifactId].every(strictId),'R7_API_IDENTIFIER_OUT_OF_SAFE_RANGE');
      const alive=()=>need(Date.now()-started < 120000 && Date.now() < Date.parse(packet.expiresAtUtc), 'R7_EVIDENCE_WINDOW_EXPIRED');
      const headers=Object.freeze({Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28', Authorization:'Bearer '+token});
      // No caller-supplied path, URL, header or arbitrary resource can enter here.
      async function get(suffix, archiveRedirect=false) {
        alive(); need(++count <= MAX_REQUESTS,'R7_REQUEST_BUDGET_EXCEEDED');
        const url=API+suffix;
        const response=await request(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(10000)});
        if (archiveRedirect) return response;
        try {
          need(response.url === url && response.redirected === false,'R7_API_REDIRECT_OR_ORIGIN_MISMATCH');
          need(response.status === 200,'R7_API_READ_NOT_OK');
          need(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'R7_API_CONTENT_TYPE_INVALID');
          const length=response.headers.get('content-length');
          need(length === null || (/^[0-9]+$/.test(length) && Number(length)<=MAX_JSON),'R7_API_BODY_TOO_LARGE');
          const bytes=await readBoundedPersonalRepositoryResponseBody(response,MAX_JSON);
          return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        } finally { try { await response.body?.cancel(); } catch {} }
      }
      async function download(descriptor) {
        alive();need(++count<=MAX_REQUESTS,'R7_REQUEST_BUDGET_EXCEEDED');
        return request(descriptor.url,{method:'GET',redirect:'manual',headers:descriptor.headers,
          signal:AbortSignal.timeout(30000)});
      }
      async function pages(suffix, key) {
        const records=[]; let total;
        for(let page=1;page<=MAX_PAGES;page++) {
          const value=await get(suffix+(suffix.includes('?')?'&':'?')+'per_page=100&page='+page);
          need(Number.isSafeInteger(value?.total_count) && value.total_count>=0
            && value.total_count<=MAX_PAGES*100 && Array.isArray(value[key]),'R7_METADATA_PAGE_INVALID');
          total ??= value.total_count;
          need(total===value.total_count && value[key].length<=100,'R7_METADATA_PAGES_CHANGED');
          records.push(...value[key]);
          need(records.length<=total,'R7_METADATA_PAGE_OVERFLOW');
          if(records.length===total) {
            need(records.every(item=>strictId(item?.id)) && new Set(records.map(item=>item.id)).size===records.length,'R7_METADATA_DUPLICATE_OR_INVALID_ID');
            return {total_count:total,[key]:records};
          }
          need(value[key].length===100,'R7_METADATA_PAGE_TRUNCATED');
        }
        throw new Closed('R7_METADATA_PAGE_LIMIT');
      }
      const repository=await get('');
      need(repoIdentity(repository) && repository.default_branch==='main','R7_REPOSITORY_IDENTITY_MISMATCH');
      const main=await get('/git/ref/heads/main');
      need(main?.ref==='refs/heads/main' && main?.object?.type==='commit' && main.object.sha===c.expectedMain,'R7_CURRENT_MAIN_MISMATCH');
      const pr=await get('/pulls/3178');
      need(pr?.number===3178 && repoIdentity(pr.head?.repo) && repoIdentity(pr.base?.repo)
        && pr.head.ref===c.branch && pr.head.sha===c.sourceHead && pr.base.ref==='main','R7_PR_SOURCE_IDENTITY_MISMATCH');
      const source=await get('/git/commits/'+c.sourceHead);
      need(source?.sha===c.sourceHead && source?.tree?.sha===c.sourceTree,'R7_SOURCE_TREE_MISMATCH');
      const branch=await get('/git/ref/heads/'+c.branch);
      need(branch?.ref==='refs/heads/'+c.branch && branch?.object?.type==='commit'
        && branch.object.sha===c.sourceHead,'R7_SOURCE_BRANCH_MOVED');
      facts.sourceIdentityAuthenticated=true;

      const workflow=await get('/actions/workflows/independent-merge-security-review.yml');
      need(strictId(workflow?.id) && workflow.path===REVIEW_PATH && workflow.name===INDEPENDENT_REVIEW_WORKFLOW_NAME
        && workflow.state==='active','R7_REVIEW_WORKFLOW_DEFINITION_INVALID');
      const run=await get('/actions/runs/'+runId);
      need(repoIdentity(run?.repository) && run.head_sha===c.reviewedBase,'R7_REVIEW_RUN_REPOSITORY_OR_HEAD_MISMATCH');
      const jobs=await pages('/actions/runs/'+runId+'/attempts/'+attempt+'/jobs?filter=all','jobs');
      const runValidation=validateIndependentReviewWorkflowRun(run,jobs.jobs,{
        repository:REPOSITORY,prNumber:3178,expectedHead:c.sourceHead,expectedBranch:c.branch,
        expectedBaseSha:c.reviewedBase,expectedBaseBranch:'main',expectedWorkflowId:workflow.id,
        workflowRunId:runId,workflowRunAttempt:attempt});
      need(runValidation.valid,'R7_EXACT_REVIEW_RUN_INVALID');
      const job=jobs.jobs.find(item=>item.name===INDEPENDENT_REVIEW_JOB && item.run_attempt===attempt);
      need(job?.run_id===runId && job.head_sha===run.head_sha
        && job.run_url===API+'/actions/runs/'+runId,'R7_REVIEW_JOB_PARENT_IDENTITY_MISMATCH');
      const listed=await pages('/actions/runs/'+runId+'/artifacts','artifacts');
      const artifactOptions={workflowRunId:runId,workflowRunAttempt:attempt,expectedArtifactId:artifactId,
        expectedArchiveDigest:'sha256:'+r.archiveSha256};
      const selected=validateIndependentReviewArtifactSet(listed,artifactOptions);
      need(selected.valid,'R7_EXACT_REVIEW_ARTIFACT_METADATA_INVALID');
      const archive=await executePersonalRepositoryArtifactArchiveTransport({
        path:'/repos/'+REPOSITORY+'/actions/artifacts/'+artifactId+'/zip',repository:REPOSITORY,
        maxBytes:INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
        requestApiRedirect:()=>get('/actions/artifacts/'+artifactId+'/zip',true),
        requestArchive:async descriptor=>{
          // Canonical transport validates the signed storage origin/path/query.
          // Explicitly omit the GitHub authorization header on this second hop.
          return download(descriptor);
        }});
      need(archive.length===selected.sizeInBytes && sha256(archive)===r.archiveSha256,'R7_REVIEW_ARCHIVE_BYTES_MISMATCH');
      const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
        extractPersonalRepositoryArtifactZip(archive,INDEPENDENT_REVIEW_ARTIFACT_FILE)));
      const artifactValidation=validateIndependentReviewArtifact(payload,{
        repository:REPOSITORY,prNumber:3178,branch:c.branch,expectedHead:c.sourceHead,
        expectedBaseSha:c.reviewedBase,workflowRunId:runId,workflowRunAttempt:attempt,
        expectedPayloadSha256:r.payloadSha256});
      need(artifactValidation.valid && artifactValidation.review.reviewMode==='clean-independent',
        'R7_REVIEW_ARTIFACT_NOT_EXACT_CLEAN_INDEPENDENT');

      // Re-read mutable run/artifact metadata and the source/main after archive
      // hydration. This remains a bounded observation, never a transaction/CAS.
      const finalRun=await get('/actions/runs/'+runId);
      need(repoIdentity(finalRun?.repository) && finalRun.head_sha===run.head_sha
        && validateIndependentReviewWorkflowRun(finalRun,jobs.jobs,{
          repository:REPOSITORY,prNumber:3178,expectedHead:c.sourceHead,expectedBranch:c.branch,
          expectedBaseSha:c.reviewedBase,expectedBaseBranch:'main',expectedWorkflowId:workflow.id,
          workflowRunId:runId,workflowRunAttempt:attempt}).valid,'R7_REVIEW_RUN_CHANGED_DURING_READ');
      const finalArtifacts=await pages('/actions/runs/'+runId+'/artifacts','artifacts');
      const finalSelected=validateIndependentReviewArtifactSet(finalArtifacts,artifactOptions);
      need(finalSelected.valid && finalSelected.sizeInBytes===selected.sizeInBytes,'R7_REVIEW_ARTIFACT_CHANGED_DURING_READ');
      const finalMain=await get('/git/ref/heads/main');
      const finalPr=await get('/pulls/3178');
      const finalBranch=await get('/git/ref/heads/'+c.branch);
      need(finalMain?.ref===main.ref && finalMain?.object?.type==='commit' && finalMain.object.sha===c.expectedMain
        && finalPr?.number===3178 && repoIdentity(finalPr.head?.repo) && repoIdentity(finalPr.base?.repo)
        && finalPr.head.ref===c.branch && finalPr.head.sha===c.sourceHead && finalPr.base.ref==='main'
        && finalPr.merged===pr.merged && finalPr.merge_commit_sha===pr.merge_commit_sha
        && finalBranch?.ref===branch.ref && finalBranch?.object?.type==='commit'
        && finalBranch.object.sha===c.sourceHead,'R7_SOURCE_SNAPSHOT_CHANGED_DURING_READ');
      alive();
      facts.reviewArtifactAuthenticated=true;
      facts.review=Object.freeze({runId:r.runId,runAttempt:r.runAttempt,artifactId:r.artifactId,
        archiveSha256:r.archiveSha256,payloadSha256:r.payloadSha256,sourceHead:c.sourceHead,
        sourceTree:c.sourceTree,reviewedBase:c.reviewedBase});
      const blockers=[...R7_SOURCE_EVIDENCE_REMAINING_GATES];
      if(!references) blockers.push('R7_PROPOSED_SOURCE_PROVENANCE_REFERENCES_MISSING');
      else {
        const native=await readR7NativePackageProvenance({packet,references,readJson:get,pages,
          getRedirect:suffix=>get(suffix,true),download,alive});
        facts.nativeImageProvenanceAuthenticated=native.packageContentProvenanceValid===true;
        if(pr.merged!==true || pr.merge_commit_sha!==c.sourceMergeCommit) blockers.push('R7_EXACT_SOURCE_MERGE_NOT_OBSERVED');
        else {
          const provenance=await readR7ProtectedSourceProvenance({packet,references,readJson:get,pages,
            main:finalMain,pr:finalPr,branch:finalBranch,alive});
          facts.protectedSourceApprovalAuthenticated=provenance.protectedSourceApprovalValid;
          facts.sourceMergeReadbackAuthenticated=provenance.currentMainCompletionValid;
          facts.historicalSourceCompletionAuthenticated=provenance.historicalSourceCompletionValid;
          facts.forwardMainAncestryObserved=provenance.forwardMainAncestryObserved;
          facts.sourceAdoptionAuthenticated=provenance.currentMainCompletionValid
            &&provenance.protectedSourceApprovalValid&&facts.nativeImageProvenanceAuthenticated;
          if(provenance.postMergeCompatibilityPending) blockers.push('R7_POST_MERGE_CURRENT_COMPATIBILITY_NOT_PROVEN');
          else need(provenance.currentMainCompletionValid,'R7_CANONICAL_SQUASH_READBACK_INVALID');
        }
      }
      if(pr.merged!==true) blockers.push('R7_EXACT_SOURCE_MERGE_NOT_OBSERVED');
      const terminalMain=await get('/git/ref/heads/main'),terminalPr=await get('/pulls/3178');
      const terminalBranch=await get('/git/ref/heads/'+c.branch),terminalRun=await get('/actions/runs/'+runId);
      const terminalArtifacts=await pages('/actions/runs/'+runId+'/artifacts','artifacts');
      need(terminalMain?.ref===main.ref&&terminalMain?.object?.type==='commit'&&terminalMain.object.sha===c.expectedMain
        &&terminalPr?.head?.sha===c.sourceHead&&terminalPr.head.ref===c.branch&&repoIdentity(terminalPr.head.repo)
        &&terminalPr.number===3178&&terminalPr.base?.ref==='main'&&repoIdentity(terminalPr.base.repo)
        &&terminalPr.merged===pr.merged&&terminalPr.merge_commit_sha===pr.merge_commit_sha
        &&terminalBranch?.ref===branch.ref&&terminalBranch?.object?.type==='commit'&&terminalBranch.object.sha===c.sourceHead
        &&JSON.stringify(terminalRun)===JSON.stringify(finalRun)
        &&JSON.stringify(terminalArtifacts)===JSON.stringify(finalArtifacts),'R7_TERMINAL_SOURCE_CHANGED');
      alive();
      return outcome(blockers,{...facts,permitDigest:input.permitSha256,
        sourceHead:c.sourceHead,sourceTree:c.sourceTree,expectedMain:c.expectedMain,
        evidenceChannel:'AUTHENTICATED_GITHUB_READ_ONLY',requestCount:count,
        referencesDigest:withRefs?input.referencesSha256:null},now());
    } catch(error) {
      // Never return exception strings, bearer headers, API bodies, signed URLs,
      // raw artifacts, packet contents or user-controlled material to logs.
      return outcome([error instanceof Closed||error instanceof R7SourceProvenanceError?error.code:'R7_SOURCE_EVIDENCE_READ_FAILED'],{},now());
    }
  }});
}
