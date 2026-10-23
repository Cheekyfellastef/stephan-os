import { types as nodeTypes } from 'node:util';

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
    if (typeof v !== 'object' || depth > 9 || ++nodes > 384 || seen.has(v)
        || nodeTypes.isProxy(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) {
      // Array.every and v[i] invoke accessors. Inspect descriptors instead,
      // including rejecting subclasses and sparse or extra own properties.
      if (Object.getPrototypeOf(v) !== Array.prototype) return false;
      const fields = Object.getOwnPropertyDescriptors(v);
      const length = fields.length?.value;
      if (!Number.isSafeInteger(length) || length > 64
          || Reflect.ownKeys(fields).length !== length + 1) return false;
      for (let i = 0; i < length; ++i) {
        const slot = fields[String(i)];
        if (!slot || !Object.hasOwn(slot, 'value')
            || !inspect(slot.value, depth + 1)) return false;
      }
      return true;
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


// Connect existing Sovereign Commander *read-only* Island observations to the
// existing Sovereign Reviewer's commissioning checklist. This is NOT a new
// execution adapter. Inputs, including GitHub-shaped evidence, are untrusted.
// Independent host, signer and exact-head review authorities are separate.
export const SOVEREIGN_INDEPENDENT_BUILDER_COMMISSIONING_SCHEMA =
  'stephanos.sovereign-independent-builder-commissioning.v1';

const INDEPENDENT_BUILDER_OWNERS = Object.freeze({
  island: Object.freeze({
    issue: 3109, pr: 3195,
    issueTitle: 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
    prTitle: 'Rescue Island #3109: add native host bootstrap and process-token observation',
    nativeStage: 'ISLAND_PROTECTED_OS_PRINCIPAL_AND_WHOLE_EXECUTION_ESTATE_REQUIRED',
    firstPickup: 'PROVE_ISLAND01_SELECTED_CLAIMED_PHYSICAL_PICKUP_EDITED_TESTED_ISOLATED_COMMIT',
  }),
  seed: Object.freeze({
    issue: 3096, pr: 3205,
    issueTitle: 'Goal: Independent Seed Canopy Parallel Forge, isolated local-model build route',
    prTitle: 'Seed #3096: retain deterministic inventory input and output custody',
    nativeStage: 'SEED_PROTECTED_ORIGINAL_WRITER_AND_FIXED_OPERATION_CUSTODY_REQUIRED',
    firstPickup: 'PROVE_SEED_DETERMINISTIC_INVENTORY_REAL_OS_PICKUP_AND_SOURCE_COMMIT',
  }),
});
const INDEPENDENT_BUILDER_DENIALS = Object.freeze({
  authenticatedIndependentWindowsSigner: false,
  reviewerQualifiedWindowsSpecialist: false,
  sourceMutationAllowed: false,
  sourceWriterOwnerAuthenticated: false,
  protectedNativeHostInstalled: false,
  completeExecutionEstateProtected: false,
  originalR7LeaseReleased: false,
  originalR7LeaseAccessAllowed: false,
  gamingGovernorCustodyProven: false,
  modelInferenceAllowed: false,
  physicalBuilderPickupProven: false,
  protectedMergeAuthority: false,
  deploymentAllowed: false,
});

const reportedOriginalPr = (packet, original) => Boolean(
  isObject(packet)
  && packet.repository === REPOSITORY
  && packet.issueNumber === original.issue
  && packet.issueTitle === original.issueTitle
  && packet.prNumber === original.pr
  && packet.prTitle === original.prTitle
  && typeof packet.branch === 'string' && BRANCH.test(packet.branch)
  && !packet.branch.includes('..') && !packet.branch.startsWith('/')
  && safeSha(packet.head) && safeSha(packet.base) && packet.head !== packet.base
);

// Commander output may be independently fetched using the *existing* private
// transport, but carrying it into this untrusted input does not prove host
// identity. The exact approved main pair and all no-authority flags must agree.
function reportedCommanderIslandBoundary(packet, mainHead) {
  const x = packet;
  return Boolean(isObject(x) && safeSha(mainHead) && x.sourceHead === mainHead
    && x.remoteAction === 'rescue-island-readonly-boundary'
    && x.finalVerdict === 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_OBSERVED'
    && x.sourceMutationAllowed === false
    && x.originalSourceLeaseReleaseAllowed === false
    && x.mergeAuthority === false
    && x.publicReceiptSafe === true && x.secretMaterialReturned === false
    && isObject(x.rescueIslandBoundary)
    && x.rescueIslandBoundary.schemaVersion === 'stephanos.rescue-island-boundary-probe.v1'
    && x.rescueIslandBoundary.ok === true && x.rescueIslandBoundary.readOnly === true
    && x.rescueIslandBoundary.observedPathCount === 3
    && x.rescueIslandBoundary.physicalScopeReadback === 'LOCAL_OS_SCOPE_OBSERVED'
    && x.rescueIslandBoundary.sourceMutationAllowed === false
    && x.rescueIslandBoundary.workerStartAllowed === false
    && x.rescueIslandBoundary.independentOwnershipAuthenticated === false
    && x.rescueIslandBoundary.gamingBudgetAuthenticated === false
    && x.rescueIslandBoundary.originalSourceLeaseReleaseAllowed === false
    && x.rescueIslandBoundary.seedForgeQueueAccessAllowed === false
    && x.rescueIslandBoundary.mergeAllowed === false
    && x.rescueIslandBoundary.publicReceiptSafe === true
    && x.rescueIslandBoundary.secretMaterialReturned === false);
}

/**
 * Sovereign-to-Sovereign engineering handoff for existing #3109 and #3096.
 * The prior #2962/r7 SAFE_HOLD cannot be used to block disjoint source tests
 * or as permission to clone, seize, or release any original writer.
 * Every observed GitHub CI / Commander packet remains UNATTESTED until
 * independently authenticated by the already protected authority adapters.
 */
export function assessSovereignIndependentBuilderCommissioningV1(input = {}) {
  const safeInput = boundedPlainData(input) && isObject(input) ? input : {};
  const mainHead = safeSha(safeInput.mainHead) ? safeInput.mainHead : '';
  const islandPacket = safeInput.island;
  const seedPacket = safeInput.seed;
  const islandIdentified = reportedOriginalPr(islandPacket, INDEPENDENT_BUILDER_OWNERS.island);
  const seedIdentified = reportedOriginalPr(seedPacket, INDEPENDENT_BUILDER_OWNERS.seed);
  const boundaryReported = islandIdentified
    && reportedCommanderIslandBoundary(safeInput.islandCommanderBoundary, mainHead);

  const route = (name, identified) => {
    const own = INDEPENDENT_BUILDER_OWNERS[name];
    const sourceHead = identified ? safeInput[name].head : '';
    const baseSha = identified ? safeInput[name].base : '';
    return Object.freeze({
      ownerIssue: own.issue,
      ownerIssueTitle: own.issueTitle,
      originalPrNumber: own.pr,
      originalPrTitle: own.prTitle,
      sourceHead,
      baseSha,
      sourceIdentityReportedUnattested: identified,
      hostedWindowsProofIsPhysicalPickup: false,
      nextGate: !mainHead ? 'VERIFY_CURRENT_PROTECTED_MAIN'
        : !identified ? 'VERIFY_ORIGINAL_OWNER_PR_HEAD_AND_TITLE'
          : own.nativeStage,
      firstPhysicalPickupTarget: own.firstPickup,
      sourceOwnerChangeAuthority: false,
      osWorkerCommissioned: false,
      physicalBuilderPickupVerified: false,
      originalR7WriterReused: false,
    });
  };
  const island = route('island', islandIdentified);
  const seed = route('seed', seedIdentified);
  return Object.freeze({
    schemaVersion: SOVEREIGN_INDEPENDENT_BUILDER_COMMISSIONING_SCHEMA,
    status: 'INDEPENDENT_WINDOWS_COMMISSIONING_REQUIRED',
    observedCurrentMainHead: mainHead,
    island: Object.freeze({
      ...island,
      commanderPhysicalScopeReportedUnattested: boundaryReported,
      physicalScopeAllowsExecution: false,
      nextCommanderAction: boundaryReported
        ? 'OBTAIN_INDEPENDENT_OS_IDENTITY_AND_TASK_BOUND_COMPLETE_EXECUTION_CUSTODY'
        : 'READ_EXISTING_RESCUE_ISLAND_BOUNDARY_RECEIPT_AT_EXACT_MAIN',
    }),
    seed: Object.freeze({
      ...seed,
      deterministicInventoryDoesNotRequireResidentLlamaModel: true,
      modelBackedForgeHeldForRouterEviction: true,
      nextCommanderAction: 'QUALIFY_SEED_NATIVE_FIXED_OUTPUT_WRITER_WITH_COMPLETE_OS_CUSTODY',
    }),
    reviewer: Object.freeze({
      goal: 1574,
      nextAction: 'QUALIFY_SOVEREIGN_REVIEWER_WITH_SEPARATE_WINDOWS_SIGNER_AND_INDEPENDENT_AUDITOR',
      localExamOrHostedCiIsIndependentApproval: false,
      selfReviewAllowed: false,
      originalPrHeadsNeedExactFreshReview: true,
      physicalAttestationPresent: false,
    }),
    nextRealBuildMilestone: island.firstPhysicalPickupTarget,
    thirdSystemOriginalR7StillHeld: true,
    noNewControllerOrQueue: true,
    evidenceProvenance: 'UNTRUSTED_INPUT_CANDIDATE_ONLY',
    ...INDEPENDENT_BUILDER_DENIALS,
  });
}
