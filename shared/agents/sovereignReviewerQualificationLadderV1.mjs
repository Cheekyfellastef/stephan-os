// Goal #1574: read-only qualification progress for the EXISTING Sovereign Reviewer.
// Input is untrusted observation, not independently authenticated provenance.
// This module cannot commission a model, signer, OS principal, review policy or R7 writer.
export const SOVEREIGN_REVIEWER_QUALIFICATION_LADDER_SCHEMA =
  'stephanos.sovereign-reviewer-qualification-ladder.v1';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const BRANCH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/;
const CLOSED_AUTHORITY = Object.freeze({
  qualifiedSpecialist: false,
  reviewerEnrolled: false,
  independentSecurityReviewSatisfied: false,
  independentAuditorCommissioned: false,
  signatureVerified: false,
  protectedMergeAuthority: false,
  sourceMutationAuthority: false,
  signerCreationAuthority: false,
  windowsServiceInstallationAuthority: false,
  originalR7LeaseReleaseAuthority: false,
  physicalWorkerPickupProven: false,
});
const CALIBRATION_AUTHORITY_FLAGS = Object.freeze([
  'qualifiedWindowsSpecialist', 'independentSecurityReviewSatisfied',
  'independentHostAttestation', 'signatureVerified', 'protectedMergeAuthority',
  'serviceInstallationAuthority', 'sourceMutationAuthority',
  'leaseReleaseAuthority', 'signedWindowsCustodyProven',
  'physicalPickupProven',
]);
const RUNG_IDS = Object.freeze([
  'EXACT_SOURCE_PAIR',
  'PHYSICAL_MODEL_OBSERVATION',
  'WINDOWS_13_CASE_CANDIDATE',
  'SIGNED_BASELINE_AND_PRIVILEGED_EXAM',
  'PROTECTED_AUDITOR_AND_POLICY_ADMISSION',
]);
const NEXT = Object.freeze({
  EXACT_SOURCE_PAIR: 'VERIFY_EXACT_REPOSITORY_HEAD_BASE_AND_BRANCH',
  PHYSICAL_MODEL_OBSERVATION: 'OBSERVE_CURRENT_BATTLE_BRIDGE_MODEL_AND_GAMING_GOVERNOR',
  WINDOWS_13_CASE_CANDIDATE: 'RUN_FIXED_WINDOWS_13_CASE_CALIBRATION_AFTER_SOURCE_INSTALL',
  SIGNED_BASELINE_AND_PRIVILEGED_EXAM: 'COLLECT_INDEPENDENT_10_PLUS_5_SIGNED_WINDOWS_EXAM',
  PROTECTED_AUDITOR_AND_POLICY_ADMISSION: 'COMMISSION_PROTECTED_AUDITOR_AND_INDEPENDENTLY_ADMIT_REVIEW_POLICY',
});
const record = (id, state, reason) => Object.freeze({ id, state, reason });
const isObject = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
// Reject accessors, proxies, cycles, executable objects, sparse arrays and
// oversized caller input *before* reading any nested evidence fields.
function boundedPlainData(value) {
  const seen = new WeakSet();
  let nodes = 0;
  function inspect(v, depth) {
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0);
    if (typeof v === 'string') return v.length <= 4096;
    if (typeof v !== 'object' || depth > 9 || ++nodes > 384 || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length > 64 || Object.keys(v).length !== v.length) return false;
      return v.every(item => inspect(item, depth + 1));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    const properties = Object.getOwnPropertyDescriptors(v);
    const names = Reflect.ownKeys(properties);
    if (names.length > 128 || names.some(k => typeof k !== 'string')) return false;
    return names.every(k => 'value' in properties[k] && inspect(properties[k].value, depth + 1));
  }
  try { return inspect(value, 0); } catch { return false; }
}

const safeSha = s => typeof s === 'string' && SHA40.test(s);
const denied = value => CALIBRATION_AUTHORITY_FLAGS.every(k => value?.[k] === false);
const validSource = x => x?.repository === REPOSITORY
  && Number.isSafeInteger(x?.prNumber) && x.prNumber > 0
  && typeof x.branch === 'string' && BRANCH.test(x.branch) && !x.branch.includes('..')
  && safeSha(x.sourceHead) && safeSha(x.baseSha) && x.sourceHead !== x.baseSha;

/**
 * The external auditor's trust root CANNOT come from this packet or from a
 * callback supplied by the reviewer. Even an apparent full score is candidate
 * evidence, not provider-neutral protected admission or signed R7 custody.
 */
export function assessSovereignReviewerQualificationLadderV1(input = {}) {
  const inputSafe = boundedPlainData(input);
  const safe = inputSafe && isObject(input) ? input : {};
  const source = isObject(safe.source) ? safe.source : {};
  const host = isObject(safe.hostObservation) ? safe.hostObservation : {};
  const calibration = isObject(safe.windowsCalibration) ? safe.windowsCalibration : {};
  const exam = isObject(safe.signedCapabilityExam) ? safe.signedCapabilityExam : {};
  const sourceOk = validSource(source);

  // A public Commander host observation is valuable operational telemetry, not
  // identity/signer attestation. Never infer a local installed model digest from
  // a display name, parameter count, GPU load or a successful Ollama HTTP 200.
  const observed = isObject(host.observation) ? host.observation : host;
  const modelCount = observed?.ollama?.loadedModelCount;
  const hostOk = sourceOk && host.expectedHeadMatch === true
    && host.sourceHead === source.sourceHead
    && observed?.ollama?.reachable === true
    && Number.isSafeInteger(modelCount) && modelCount > 0
    && modelCount <= 32
    && observed?.gpu?.available === true;

  // A remote projection is *only* a candidate. Its exact manifest and installed
  // executable graph must still be authenticated by the existing native loader.
  const calibrationOk = sourceOk
    && calibration.schemaVersion === 'stephanos.sovereign-windows-calibration-remote.v1'
    && calibration.status === 'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
    && calibration.reason === ''
    && calibration.sourceHead === source.sourceHead
    && calibration.baseSha === source.baseSha
    && SHA64.test(calibration.manifestSha256 ?? '')
    && SHA64.test(calibration.observationsSha256 ?? '')
    && SHA64.test(calibration.modelDigestSha256 ?? '')
    && calibration.completedCases === 13 && calibration.passedCases === 13
    && calibration.qualification === 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION'
    && denied(calibration);

  // The existing localReviewCapabilityExamV1 validator owns signature checks.
  // Caller-supplied exam status or its trust pin cannot be promoted here.
  const examReported = sourceOk
    && exam.schemaVersion === 'stephanos.local-review-capability-exam.v1'
    && exam.sourceHead === source.sourceHead && exam.baseSha === source.baseSha
    && exam.status === 'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION'
    && exam.challengeCount === 15
    && exam.baselineChallengeCount === 10
    && exam.baselineEvidenceComplete === true
    && exam.windowsEvidenceComplete === true
    && Array.isArray(exam.blockers) && exam.blockers.length === 0
    && Array.isArray(exam.missingBaseline) && exam.missingBaseline.length === 0
    && Array.isArray(exam.missingPrivileged) && exam.missingPrivileged.length === 0
    && exam.qualifiedWindowsSpecialist === false
    && exam.protectedMergeAuthority === false
    && exam.leaseReleaseAuthority === false;

  const rungs = Object.freeze([
    record(RUNG_IDS[0], sourceOk ? 'IDENTITY_REPORTED_UNATTESTED' : 'HELD',
      sourceOk ? 'SOURCE_PAIR_REQUIRES_TRUSTED_GIT_READBACK' : (inputSafe ? 'INVALID_SOURCE_PAIR' : 'UNTRUSTED_INPUT_INVALID')),
    record(RUNG_IDS[1], hostOk ? 'OBSERVED_UNATTESTED' : 'HELD',
      hostOk ? 'MODEL_NAME_IS_NOT_PINNED_MODEL_DIGEST_OR_GOVERNOR_PROOF' : 'NO_EXACT_HOST_MODEL_OBSERVATION'),
    record(RUNG_IDS[2], calibrationOk ? 'CANDIDATE_UNATTESTED' : 'HELD',
      calibrationOk ? 'NATIVE_EXECUTABLE_AND_MODEL_PROVENANCE_STILL_UNATTESTED' : 'WINDOWS_13_CASE_CANDIDATE_NOT_PROVEN'),
    record(RUNG_IDS[3], examReported ? 'EXAM_REPORTED_UNATTESTED' : 'HELD',
      examReported ? 'INDEPENDENT_AUDITOR_TRUST_PIN_NOT_AUTHENTICATED_HERE' : 'SIGNED_10_PLUS_5_EXAM_NOT_PROVEN'),
    record(RUNG_IDS[4], 'HELD', 'INDEPENDENT_AUDITOR_SIGNER_AND_PROTECTED_POLICY_ADMISSION_REQUIRED'),
  ]);
  const firstHeld = rungs.find(x => x.state === 'HELD');
  const diagnostics = Object.freeze({
    sourceIdentityReported: sourceOk,
    hostModelObserved: hostOk,
    windows13CaseCandidateReported: calibrationOk,
    signed15CaseExamReported: examReported,
    independentlyCommissioned: false,
    reviewerPolicyAdmitted: false,
    r7OriginalWriterCustodyProven: false,
  });
  return Object.freeze({
    schemaVersion: SOVEREIGN_REVIEWER_QUALIFICATION_LADDER_SCHEMA,
    goal: 1574,
    status: firstHeld ? 'SOVEREIGN_REVIEWER_QUALIFICATION_HELD' : 'SOVEREIGN_REVIEWER_CANDIDATE_UNATTESTED',
    sourceHead: sourceOk ? source.sourceHead : '',
    baseSha: sourceOk ? source.baseSha : '',
    rungs,
    nextGate: firstHeld?.id ?? RUNG_IDS[4],
    nextAction: NEXT[firstHeld?.id ?? RUNG_IDS[4]],
    diagnostics,
    evidenceProvenance: 'UNTRUSTED_INPUT_CANDIDATE_ONLY',
    ...CLOSED_AUTHORITY,
  });
}
