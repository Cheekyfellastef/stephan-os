import {createHash} from 'node:crypto';
import {
 buildPersonalRepositoryCheckExpectation, validatePersonalRepositoryCheckRuns,
 extractPersonalRepositoryArtifactZip,
} from './operatorPersonalRepositoryMergeV1.mjs';
import {
 INDEPENDENT_REVIEW_ARTIFACT_FILE, INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES,
 validateIndependentReviewArtifact, validateIndependentReviewArtifactSet,
} from './operatorMergeReviewArtifactV1.mjs';
import {
 INDEPENDENT_REVIEW_WORKFLOW_NAME, INDEPENDENT_REVIEW_WORKFLOW_PATH,
 validateIndependentReviewWorkflowRun,
} from './operatorMergeApprovalGate.mjs';
import {validateIndependentReviewWorkflowDispatchExecutionV1} from './independentReviewWorkflowDispatchExecutionV1.mjs';
import {independentReviewWorkflowDispatchRunNameV1} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

// Advisory, offline preflight for an authenticated API snapshot. This is not a
// review receipt, operator approval or protected executor. Callers must retain
// collection completeness and fetch provenance; the final gate re-reads reality.
function inspectReview(review, expected) {
 if (!review || typeof review !== 'object') return {valid:false,blockers:['preflight-review-missing']};
 const {definition,run,jobs,artifacts,selection,archiveBytes}=review;
 const blockers=[];
 if (definition?.name!==INDEPENDENT_REVIEW_WORKFLOW_NAME
  || definition?.path!==INDEPENDENT_REVIEW_WORKFLOW_PATH || definition?.state!=='active'
  || !Number.isSafeInteger(definition?.id) || definition.id<=0) blockers.push('preflight-review-definition-invalid');
 const options={repository:expected.repository,prNumber:expected.prNumber,
  expectedHead:expected.sourceHead,expectedBranch:expected.branch,expectedBaseBranch:'main',
  expectedBaseSha:expected.baseSha,expectedWorkflowId:definition?.id,
  workflowRunId:selection?.runId,workflowRunAttempt:selection?.runAttempt};
 const workflow=run?.event==='workflow_dispatch'
  ? validateIndependentReviewWorkflowDispatchExecutionV1(run,jobs,options)
  : validateIndependentReviewWorkflowRun(run,jobs,{...options,
   expectedWorkflowRunName:independentReviewWorkflowDispatchRunNameV1({
    prNumber:expected.prNumber,sourceHead:expected.sourceHead,handoffBindingSha256:'legacy-pull-request-target'})});
 if (!workflow.valid) blockers.push(...workflow.blockers);
 const artifactSet=validateIndependentReviewArtifactSet(artifacts,{
  workflowRunId:selection?.runId,workflowRunAttempt:selection?.runAttempt});
 if (!artifactSet.valid) blockers.push(...artifactSet.blockers);
 if (artifactSet.artifactId!==selection?.artifactId
  || artifactSet.archiveDigest!==selection?.archiveDigest) blockers.push('preflight-selected-artifact-mismatch');
 let artifact=null;
 if (!Buffer.isBuffer(archiveBytes)||archiveBytes.length===0||archiveBytes.length>INDEPENDENT_REVIEW_ARTIFACT_MAX_BYTES) {
  blockers.push('preflight-review-archive-invalid');
 } else if (archiveBytes.length!==artifactSet.sizeInBytes
  || 'sha256:'+createHash('sha256').update(archiveBytes).digest('hex')!==selection?.archiveDigest) {
  blockers.push('preflight-review-archive-mismatch');
 } else {
  try {artifact=JSON.parse(extractPersonalRepositoryArtifactZip(archiveBytes,INDEPENDENT_REVIEW_ARTIFACT_FILE).toString('utf8'));}
  catch {blockers.push('preflight-review-payload-unreadable');}
 }
 // JSON primitives and arrays cannot carry a canonical review artifact.
 // A successful parse is not a clean review, even when its value is falsy.
 if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
  blockers.push('preflight-review-payload-not-object');
 } else {
  const validation=validateIndependentReviewArtifact(artifact,{
   repository:expected.repository,prNumber:expected.prNumber,branch:expected.branch,
   expectedHead:expected.sourceHead,expectedBaseSha:expected.baseSha,
   workflowRunId:selection?.runId,workflowRunAttempt:selection?.runAttempt});
  if (!validation.valid) blockers.push(...validation.blockers);
  if (artifact.payloadSha256!==selection?.payloadSha256
   || artifact.reviewMode!=='clean-independent' || artifact.receipt?.verdict!=='clean'
   || artifact.receipt?.blocker!=='' || artifact.receipt?.findings?.length!==0) blockers.push('preflight-review-not-clean');
 }
 return {valid:blockers.length===0,blockers:[...new Set(blockers)]};
}

export function inspectProtectedSourceCheckPreflightV1(input={}) {
 const expectation=buildPersonalRepositoryCheckExpectation(input);
 const blockers=[...expectation.blockers];
 for (const key of ['checkRuns','workflowRuns','commitStatuses']) {
  if (!Array.isArray(input[key])) blockers.push('preflight-snapshot-collection-missing:'+key);
 }
 const review=input.independentReview===undefined
  ? {valid:false,blockers:[]} : inspectReview(input.independentReview,expectation.expected||{});
 if (input.independentReview!==undefined&&!review.valid) blockers.push(...review.blockers);
 const checks=expectation.valid
  ? validatePersonalRepositoryCheckRuns(input.checkRuns,input.workflowRuns,input.commitStatuses,
   expectation.expected,{cleanIndependentReviewProved:review.valid}) : null;
 if (checks&&!checks.valid) blockers.push(...checks.blockers);
 return Object.freeze({
  schemaVersion:'stephanos.protected-source-check-preflight.v1',
  advisoryOnly:true,checkSnapshotAdmissible:blockers.length===0,
  reviewEvidenceConsistent:review.valid,checkEvidence:checks?.evidence||[],
  blockers:Object.freeze([...new Set(blockers)]),
  operatorApproval:false,mergeAuthority:false,runtimeAuthority:false,
  finalRevalidationRequired:true,
  finalVerdict:blockers.length?'PROTECTED_SOURCE_CHECK_PREFLIGHT_HELD':'PROTECTED_SOURCE_CHECK_PREFLIGHT_CONSISTENT',
 });
}
