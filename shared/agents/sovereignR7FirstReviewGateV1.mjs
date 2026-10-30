import {
  assessSovereignReviewCoverageV1,
} from './sovereignReviewCoverageV1.mjs';
import {
  sovereignWindowsCalibrationManifestV1,
} from './sovereignWindowsCalibrationV1.mjs';

// The original R7 goal must be the FIRST real Windows specialist candidate.
// This is a fail-closed intake for two independent *source-only* experiments,
// never a reviewer authority grant, OS witness or lease-release procedure.
export const SOVEREIGN_R7_FIRST_REVIEW_GATE_SCHEMA =
  'stephanos.sovereign-r7-first-review-gate.v1';
const ORIGINAL_R7_LEASE = 'critical-2962-elastic-goal-r7-lease';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const originalR7 = /(?:original.?r7|original.?source.?custody|legacyOriginalSourceOrphan|original.?writer|r7.?witness)/i;
const immutableNoAuthority = Object.freeze({
  qualifiedWindowsSpecialist:false,
  independentReviewAttested:false,
  reviewAcceptanceAuthority:false,
  reviewerTrustEnrollmentAuthority:false,
  privilegedHostAuthority:false,
  witnessInstalled:false,
  signedCustodyWitnessProven:false,
  operatorSignerProven:false,
  originalWriterDenied:false,
  originalR7LeaseReleased:false,
  sourceMutationAuthority:false,
  protectedMergeAuthority:false,
  originalR7BuilderPickedUp:false,
});
const mustStillProve = Object.freeze([
  'INDEPENDENT_WINDOWS_SPECIALIST_QUALIFICATION',
  'EXACT_HEAD_AUTHENTICATED_INDEPENDENT_PR_REVIEW',
  'PROTECTED_OPERATOR_MERGE_AND_BATTLE_BRIDGE_INSTALL',
  'ACTUAL_ORIGINAL_WRITER_TOKEN_HANDLES_TASK_WMI_COM_REENTRY_DENIAL',
  'INDEPENDENT_PROTECTED_WITNESS_SIGNER_AND_OPERATOR_SIGNATURE',
  'CANONICAL_ORIGINAL_R7_LEASE_CAS_AND_PHYSICAL_PICKUP',
]);
function held(reason, extras={}) {
  return Object.freeze({
    schemaVersion:SOVEREIGN_R7_FIRST_REVIEW_GATE_SCHEMA,
    status:'R7_REVIEW_PREQUALIFICATION_HELD', reason,
    leaseId:ORIGINAL_R7_LEASE,
    ...extras,
    outstandingProofs:mustStillProve,
    ...immutableNoAuthority,
  });
}
const exactList = x => Array.isArray(x) && x.every(y=>typeof y==='string');
export function assessSovereignR7FirstReviewGateV1(input={}) {
  const {repository,prNumber,branch,sourceHead,baseSha,changedFiles,
    calibration,highRiskReview}=input;
  if(repository!=='Cheekyfellastef/stephan-os' ||
    !Number.isSafeInteger(prNumber) || prNumber < 1 ||
    !SHA.test(sourceHead??'') || !SHA.test(baseSha??'') ||
    sourceHead===baseSha || typeof branch!=='string') return held('EXACT_PR_IDENTITY_UNVERIFIED');
  const coverage=assessSovereignReviewCoverageV1({
    repository,prNumber,branch,sourceHead,baseSha,changedFiles,
  });
  if (coverage.status==='REVIEW_COVERAGE_HELD' ||
    !exactList(changedFiles) ||
    !changedFiles.some(path=>originalR7.test(path)) ||
    !coverage.domains.includes('windows-os-and-services')) {
    return held('ORIGINAL_R7_WINDOWS_CHANGESET_NOT_PROVEN');
  }
  const manifest=sovereignWindowsCalibrationManifestV1();
  if (calibration?.schemaVersion!=='stephanos.sovereign-windows-calibration.v1' ||
    calibration?.status!=='WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED' ||
    calibration?.repository!==repository ||
    calibration?.sourceHead!==sourceHead || calibration?.baseSha!==baseSha ||
    calibration?.manifestSha256!==manifest.manifestSha256 ||
    calibration?.completedCases!==manifest.challengeCount ||
    calibration?.passedCases!==manifest.challengeCount ||
    !HASH.test(calibration?.observationsSha256??'') ||
    calibration?.qualification!=='PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION' ||
    calibration?.qualifiedWindowsSpecialist!==false ||
    calibration?.independentSecurityReviewSatisfied!==false ||
    calibration?.leaseReleaseAuthority!==false) {
    return held('R7_WINDOWS_MODEL_COMPETENCY_NOT_PROVEN');
  }
  const candidate=highRiskReview?.candidateEvidence;
  if (highRiskReview?.status!=='HIGH_RISK_LOCAL_CANDIDATE_READY' ||
    highRiskReview?.specialistAuthority!==false ||
    highRiskReview?.mergeAuthority!==false ||
    candidate?.schemaVersion!=='stephanos.sovereign-high-risk-review-candidate.v1' ||
    candidate?.repository!==repository || candidate?.prNumber!==prNumber ||
    candidate?.branch!==branch ||
    candidate?.sourceHead!==sourceHead || candidate?.baseSha!==baseSha ||
    !exactList(candidate?.changedFiles) ||
    JSON.stringify([...candidate.changedFiles].sort())!==
      JSON.stringify([...changedFiles].sort()) ||
    !HASH.test(candidate?.fullDiffSha256??'') ||
    !HASH.test(candidate?.reviewPacketSha256??'') ||
    !Number.isSafeInteger(candidate?.chunkCount) || candidate.chunkCount<1 ||
    !Array.isArray(candidate?.reviewedChunks) ||
    candidate.reviewedChunks.length!==candidate.chunkCount ||
    candidate?.qualification!=='PENDING_INDEPENDENT_SPECIALIST_ATTESTATION' ||
    candidate?.riskTier!=='high' ||
    candidate?.specialistAuthority!==false ||
    candidate?.approvalAuthority!==false ||
    candidate?.mergeAuthority!==false) {
    return held('R7_EXACT_HEAD_SOURCE_REVIEW_NOT_PROVEN');
  }
  if(candidate.verdict!=='candidate-clean' ||
    !Array.isArray(candidate.findings) || candidate.findings.length!==0 ||
    candidate.reviewedChunks.some(x=>!HASH.test(x?.contentSha256??'') ||
      !candidate.changedFiles.includes(x?.path))) {
    return held('R7_SOURCE_REVIEW_HAS_FINDINGS_OR_INCOMPLETE_CHUNKS');
  }
  // A caller can forge both source-only observations. Independently enforced
  // attestations must authenticate the model, original Windows principals and
  // signers before any downstream protected governance can accept a review.
  return Object.freeze({
    schemaVersion:SOVEREIGN_R7_FIRST_REVIEW_GATE_SCHEMA,
    status:'R7_SOURCE_REVIEW_CANDIDATE_READY_UNATTESTED',
    reason:'INDEPENDENT_WINDOWS_AND_R7_CUSTODY_PROOF_OUTSTANDING',
    leaseId:ORIGINAL_R7_LEASE,
    repository,prNumber,branch,sourceHead,baseSha,
    modelExerciseCount:manifest.challengeCount,
    reviewedChunkCount:candidate.chunkCount,
    reviewedFileCount:changedFiles.length,
    sourceReviewPacketSha256:candidate.reviewPacketSha256,
    calibrationObservationsSha256:calibration.observationsSha256,
    outstandingProofs:mustStillProve,
    ...immutableNoAuthority,
  });
}
