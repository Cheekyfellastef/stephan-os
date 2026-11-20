import { createHash, createPublicKey, verify } from 'node:crypto';
import authorityClosure from './sovereignSpecialistAuthorityClosureV1.json' with { type: 'json' };
import { SOVEREIGN_SPECIALIST_ENROLLMENTS_V1 as enrollments,
  SOVEREIGN_SPECIALIST_PUBLIC_ARTIFACTS_V1 as publicArtifacts } from './sovereignQualifiedSpecialistEnrollmentV1.mjs';
import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import { assessLocalReviewCapabilityExam, LOCAL_REVIEW_EXAM_SCHEMA,
  LOCAL_REVIEW_EXAM_CHALLENGES, LOCAL_REVIEW_EXAM_PRIVILEGED } from './localReviewCapabilityExamV1.mjs';
import { assessSovereignReviewCoverageV1, SOVEREIGN_REVIEW_DOMAINS } from './sovereignReviewCoverageV1.mjs';
import { SOVEREIGN_CALIBRATION_SCHEMA, SOVEREIGN_CALIBRATION_CASE_COUNT,
  SOVEREIGN_CALIBRATION_MANIFEST_SHA256 } from './sovereignCalibrationV1.mjs';
import { SOVEREIGN_WINDOWS_CALIBRATION_SCHEMA, SOVEREIGN_WINDOWS_CALIBRATION_CASE_COUNT,
  sovereignWindowsCalibrationManifestV1 } from './sovereignWindowsCalibrationV1.mjs';

export const SOVEREIGN_SPECIALIST_ARTIFACT_SCHEMA_V1 = 'stephanos.sovereign-qualified-specialist-artifact.v1';
export const SOVEREIGN_SPECIALIST_COMMENT_MARKER_V1 = '<!-- stephanos-sovereign-qualified-specialist-review:v1 -->';
export const SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1 = Object.freeze({
  review: 'stephanos.sovereign-specialist-review-signature.v1',
  native: 'stephanos.sovereign-specialist-native-custody.v1',
  auditor: 'stephanos.sovereign-specialist-auditor-attestation.v1',
  replay: 'stephanos.sovereign-specialist-replay-witness.v1',
  selfChange: 'stephanos.sovereign-specialist-out-of-band-approval.v1',
  execution: 'stephanos.sovereign-complete-review-execution.v1',
});
export const SOVEREIGN_SPECIALIST_MAX_DIFF_BYTES_V1 = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 60 * 1024;
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const MAX_NATIVE_TO_REVIEW_MS = 2 * 60 * 1000;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._:-]{3,119}$/;
const PATH = /^(?:[a-z0-9]|\.[a-z0-9])[a-z0-9._/-]{0,240}$/i;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_FIELDS = Object.freeze(['repository', 'prNumber', 'branch', 'sourceHead', 'baseSha',
  'sourceTree', 'baseTree', 'diffRepresentation', 'fullDiffSha256', 'diffBytes',
  'reviewedObjectClosureSha256', 'sourceEvidence', 'reviewDomains']);
const REVIEW_CORE_FIELDS = Object.freeze(['schemaVersion', 'kind', ...SOURCE_FIELDS, 'enrollmentId',
  'reviewNonce', 'modelDigestSha256', 'escalationPaths', 'receipt', 'nativeEvidence',
  'baselineCalibration', 'windowsCalibration', 'capabilityExam', 'reviewExecution']);
const ARTIFACT_FIELDS = Object.freeze([...REVIEW_CORE_FIELDS, 'reviewerSignatureBase64',
  'auditorAttestation', 'replayWitness', 'selfChangeAttestation', 'payloadSha256']);
const ENROLLMENT_FIELDS = Object.freeze(['schemaVersion', 'enrollmentId', 'repository', 'reviewerId',
  'provider', 'modelClass', 'modelDigestSha256', 'reviewerPrincipal', 'reviewerPrincipalSha256',
  'auditorPrincipal', 'auditorPrincipalSha256', 'witnessPrincipal', 'witnessPrincipalSha256',
  'deviceIdSha256', 'protectedRuntimeProfileSha256', 'signerCustodyProfileSha256',
  'reentryTaskDefinitionSha256', 'negativeWriteTargets', 'keys', 'allowedDomains',
  'domainQualificationSha256', 'maxDiffBytes', 'commissioningProofSha256',
  'nativeCommissioningProofSha256', 'independentReviewArtifactSha256', 'operatorApprovalRef',
  'notBeforeUtc', 'expiresAtUtc', 'revokedAtUtc', 'minimumJournalGeneration', 'outOfBandAuditor', 'reviewExecutionProfile']);
const WRITE_ROLES = Object.freeze(['reviewer-executable', 'reviewer-key', 'auditor-key', 'witness-key', 'trust-registry']);
// The complete trusted intake/consumer execution estate is one protected
// source manifest, with parse-only closure/drift proof in the required source
// workflow. Windows path aliases must retain the same fourth-root boundary.
const SELF_CHANGE_PATHS = new Set([...authorityClosure.modules, ...authorityClosure.protectedFiles]
  .map(path => path.toLowerCase()));
const NO_MUTATION = Object.freeze({ mergeAuthority: false, operatorApprovalAuthority: false,
  sourceMutationAllowed: false, runtimeMutationAllowed: false, reviewerEnrollmentAuthority: false,
  leaseReleaseAuthority: false, physicalPickupProven: false });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dense = value => Array.isArray(value) && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const exactKeys = (value, fields) => record(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
const integer = value => Number.isSafeInteger(value) && value > 0;
const safePath = value => typeof value === 'string' && PATH.test(value) && !value.includes('..')
  && !value.includes('//') && !value.endsWith('/');
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const requireProof = (ok, code) => { if (!ok) throw new Error(code); };
const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));

export function sovereignSpecialistCanonicalV1(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireProof(Number.isSafeInteger(value) && !Object.is(value, -0), 'SOVEREIGN_SPECIALIST_ENCODING_INVALID');
    return JSON.stringify(value);
  }
  if (dense(value)) return '[' + value.map(sovereignSpecialistCanonicalV1).join(',') + ']';
  requireProof(record(value), 'SOVEREIGN_SPECIALIST_ENCODING_INVALID');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + sovereignSpecialistCanonicalV1(value[key])).join(',') + '}';
}
const equal = (left, right) => sovereignSpecialistCanonicalV1(left) === sovereignSpecialistCanonicalV1(right);
export const sovereignSpecialistDigestV1 = value => digest(sovereignSpecialistCanonicalV1(value));
export const sovereignSpecialistSignatureInputV1 = (domain, payload) => Buffer.from(domain + '\0' + sovereignSpecialistCanonicalV1(payload), 'utf8');
export const sovereignSpecialistReviewBindingV1 = artifact => sovereignSpecialistDigestV1(pick(artifact, REVIEW_CORE_FIELDS));
export function sovereignSpecialistArtifactPayloadSha256V1(artifact) {
  const { payloadSha256, ...payload } = artifact;
  return sovereignSpecialistDigestV1(payload);
}
const held = blocker => Object.freeze({ valid: false, blockers: Object.freeze([blocker]),
  signatureVerified: false, reviewerEnrollmentVerified: false, nativeEvidenceAccepted: false,
  liveSourceBindingVerified: false, ...NO_MUTATION });

function sourceShape(source) {
  requireProof(exactKeys(source, SOURCE_FIELDS) && source.repository === REPOSITORY
    && integer(source.prNumber) && typeof source.branch === 'string'
    && /^[a-z0-9][a-z0-9._/-]{0,180}$/i.test(source.branch) && !source.branch.includes('..')
    && ['sourceHead', 'baseSha', 'sourceTree', 'baseTree'].every(key => SHA40.test(source[key]))
    && source.sourceHead !== source.baseSha && source.diffRepresentation === 'authenticated-replacement-hunks-v1'
    && SHA64.test(source.fullDiffSha256) && SHA64.test(source.reviewedObjectClosureSha256)
    && integer(source.diffBytes) && source.diffBytes <= SOVEREIGN_SPECIALIST_MAX_DIFF_BYTES_V1,
  'SOVEREIGN_SPECIALIST_SOURCE_IDENTITY_INVALID');
  const files = source.sourceEvidence;
  requireProof(dense(files) && files.length > 0 && files.length <= 64 && files.every(file => (
    exactKeys(file, ['path', 'oldMode', 'oldBlobSha', 'newMode', 'newBlobSha', 'oldContentSha256', 'newContentSha256'])
    && safePath(file.path) && (file.oldMode !== null || file.newMode !== null)
    && ['old', 'new'].every(side => file[side + 'Mode'] === null
      ? file[side + 'BlobSha'] === null && file[side + 'ContentSha256'] === null
      : ['100644', '100755'].includes(file[side + 'Mode']) && SHA40.test(file[side + 'BlobSha']) && SHA64.test(file[side + 'ContentSha256']))
    && (file.oldMode === null || file.newMode === null || file.oldMode === file.newMode)
    && (file.oldMode !== file.newMode || file.oldBlobSha !== file.newBlobSha)
  )) && new Set(files.map(file => file.path)).size === files.length
    && equal(files.map(file => file.path), files.map(file => file.path).sort()),
  'SOVEREIGN_SPECIALIST_CHANGED_PATH_ESTATE_INVALID');
  const coverage = assessSovereignReviewCoverageV1({ ...source, changedFiles: files.map(file => file.path) });
  requireProof(coverage.status !== 'REVIEW_COVERAGE_HELD'
    && dense(source.reviewDomains) && equal(source.reviewDomains, coverage.domains),
  'SOVEREIGN_SPECIALIST_DOMAIN_COVERAGE_MISMATCH');
}

// Source binding uses the EXISTING native replacement-hunk representation,
// never the different GitHub patch text. The trusted GitHub source adapter
// authenticates both full tree estates and every changed old/new blob, then
// invokes the same pure formatter used after native Git-object authentication.
// GitHub patch bytes/statistics remain diagnostics; they cannot stand in for
// canonical reviewed bytes or the independently computed object-closure hash.
export function buildSovereignSpecialistSourceBindingV1(input = {}) {
  const { files, sourceCommit, baseCommit, canonicalSnapshot } = input;
  requireProof(dense(files) && files.length > 0 && files.length <= 64
    && sourceCommit?.sha === input.sourceHead && baseCommit?.sha === input.baseSha
    && SHA40.test(sourceCommit?.tree?.sha || '') && SHA40.test(baseCommit?.tree?.sha || ''),
  'SOVEREIGN_SPECIALIST_COMMIT_TREES_UNPROVEN');
  requireProof(record(canonicalSnapshot) && canonicalSnapshot.representation === 'authenticated-replacement-hunks-v1'
    && typeof canonicalSnapshot.fullDiff === 'string'
    && canonicalSnapshot.fullDiffSha256 === digest(canonicalSnapshot.fullDiff)
    && SHA64.test(canonicalSnapshot.reviewedObjectClosureSha256)
    && dense(canonicalSnapshot.changedPaths) && dense(canonicalSnapshot.sourceEvidence)
    && equal(canonicalSnapshot.changedPaths, canonicalSnapshot.sourceEvidence.map(file => file.path)),
  'SOVEREIGN_SPECIALIST_CANONICAL_DIFF_UNPROVEN');
  const coverage = assessSovereignReviewCoverageV1({ ...input, changedFiles: canonicalSnapshot.changedPaths });
  const source = { ...pick(input, ['repository', 'prNumber', 'branch', 'sourceHead', 'baseSha']),
    sourceTree: sourceCommit.tree.sha, baseTree: baseCommit.tree.sha,
    diffRepresentation: canonicalSnapshot.representation, fullDiffSha256: canonicalSnapshot.fullDiffSha256,
    diffBytes: Buffer.byteLength(canonicalSnapshot.fullDiff, 'utf8'),
    reviewedObjectClosureSha256: canonicalSnapshot.reviewedObjectClosureSha256,
    sourceEvidence: canonicalSnapshot.sourceEvidence, reviewDomains: [...coverage.domains] };
  sourceShape(source);
  requireProof(files.every(file => record(file) && !Object.hasOwn(file, 'previous_filename')
    && safePath(file.filename) && ['added', 'modified', 'removed'].includes(file.status)
    && SHA40.test(file.sha) && Number.isSafeInteger(file.additions) && file.additions >= 0
    && Number.isSafeInteger(file.deletions) && file.deletions >= 0)
    && new Set(files.map(file => file.filename)).size === files.length
    && equal(files.map(file => file.filename).sort(), canonicalSnapshot.changedPaths),
  'SOVEREIGN_SPECIALIST_UNRESOLVED_CHANGED_PATH');
  for (const file of files) {
    const evidence = source.sourceEvidence.find(item => item.path === file.filename);
    const status = evidence.oldMode === null ? 'added' : evidence.newMode === null ? 'removed' : 'modified';
    requireProof(file.status === status && file.sha === (evidence.newBlobSha ?? evidence.oldBlobSha),
      'SOVEREIGN_SPECIALIST_GITHUB_CANONICAL_ESTATE_MISMATCH');
  }
  return Object.freeze(source);
}

function currentLifetime(payload, now, earliest = 0) {
  requireProof(timestamp(payload.observedAtUtc) && timestamp(payload.expiresAtUtc), 'SOVEREIGN_SPECIALIST_EVIDENCE_TIME_INVALID');
  const start = Date.parse(payload.observedAtUtc), end = Date.parse(payload.expiresAtUtc);
  requireProof(start >= earliest && start <= now && now < end && end > start && end - start <= MAX_LIFETIME_MS,
    'SOVEREIGN_SPECIALIST_EVIDENCE_NOT_CURRENT');
  return start;
}
function loadKey(pin) {
  requireProof(exactKeys(pin, ['keyId', 'artifactSha256', 'spkiSha256']) && ID.test(pin.keyId)
    && SHA64.test(pin.artifactSha256) && SHA64.test(pin.spkiSha256), 'SOVEREIGN_SPECIALIST_KEY_PIN_INVALID');
  const pem = publicArtifacts[pin.keyId];
  requireProof(typeof pem === 'string' && Buffer.byteLength(pem, 'utf8') <= 4096
    && digest(pem) === pin.artifactSha256, 'SOVEREIGN_SPECIALIST_PUBLIC_KEY_ARTIFACT_MISMATCH');
  let key;
  try { key = createPublicKey(pem); } catch { requireProof(false, 'SOVEREIGN_SPECIALIST_PUBLIC_KEY_INVALID'); }
  requireProof(key.asymmetricKeyType === 'ed25519'
    && digest(key.export({ type: 'spki', format: 'der' })) === pin.spkiSha256,
  'SOVEREIGN_SPECIALIST_PUBLIC_KEY_PIN_MISMATCH');
  return { key, pem, ...pin };
}
function signature(value, domain, payload, key) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  requireProof(bytes.length === 64 && bytes.toString('base64') === value
    && verify(null, sovereignSpecialistSignatureInputV1(domain, payload), key.key, bytes),
  'SOVEREIGN_SPECIALIST_SIGNATURE_INVALID');
}
function signedEnvelope(envelope, domain, key) {
  requireProof(exactKeys(envelope, ['payload', 'signatureBase64']) && record(envelope.payload),
    'SOVEREIGN_SPECIALIST_SIGNED_PROOF_MISSING');
  signature(envelope.signatureBase64, domain, envelope.payload, key);
  return envelope.payload;
}

function enrollmentFor(artifact, now) {
  const matches = enrollments.filter(item => item?.enrollmentId === artifact.enrollmentId);
  requireProof(matches.length === 1, 'SOVEREIGN_SPECIALIST_NOT_ENROLLED');
  const item = matches[0];
  requireProof(exactKeys(item, ENROLLMENT_FIELDS)
    && item.schemaVersion === 'stephanos.sovereign-specialist-enrollment.v1' && item.repository === REPOSITORY
    && ['enrollmentId', 'reviewerId', 'provider', 'modelClass', 'reviewerPrincipal', 'auditorPrincipal', 'witnessPrincipal'].every(key => ID.test(item[key]))
    && ['modelDigestSha256', 'reviewerPrincipalSha256', 'auditorPrincipalSha256', 'witnessPrincipalSha256', 'deviceIdSha256',
      'protectedRuntimeProfileSha256', 'signerCustodyProfileSha256', 'reentryTaskDefinitionSha256',
      'commissioningProofSha256', 'nativeCommissioningProofSha256', 'independentReviewArtifactSha256'].every(key => SHA64.test(item[key]))
    && new Set([item.reviewerPrincipal, item.auditorPrincipal, item.witnessPrincipal]).size === 3
    && new Set([item.reviewerPrincipalSha256, item.auditorPrincipalSha256, item.witnessPrincipalSha256]).size === 3
    && dense(item.allowedDomains) && item.allowedDomains.length > 0
    && new Set(item.allowedDomains).size === item.allowedDomains.length
    && item.allowedDomains.every(domain => SOVEREIGN_REVIEW_DOMAINS.includes(domain))
    && exactKeys(item.domainQualificationSha256, item.allowedDomains)
    && Object.values(item.domainQualificationSha256).every(value => SHA64.test(value))
    && integer(item.maxDiffBytes) && item.maxDiffBytes <= SOVEREIGN_SPECIALIST_MAX_DIFF_BYTES_V1
    && integer(item.minimumJournalGeneration) && exactKeys(item.keys, ['reviewer', 'auditor', 'witness'])
    && exactKeys(item.negativeWriteTargets, WRITE_ROLES) && Object.values(item.negativeWriteTargets).every(value => SHA64.test(value))
    && /^https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/(?:issues|pull)\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/.test(item.operatorApprovalRef)
    && timestamp(item.notBeforeUtc) && timestamp(item.expiresAtUtc)
    && (item.revokedAtUtc === null || timestamp(item.revokedAtUtc)),
  'SOVEREIGN_SPECIALIST_ENROLLMENT_INVALID');
  requireProof(item.revokedAtUtc === null && Date.parse(item.notBeforeUtc) <= now
    && now < Date.parse(item.expiresAtUtc), 'SOVEREIGN_SPECIALIST_ENROLLMENT_NOT_CURRENT');
  requireProof(item.modelDigestSha256 === artifact.modelDigestSha256 && artifact.diffBytes <= item.maxDiffBytes
    && artifact.reviewDomains.every(domain => item.allowedDomains.includes(domain)),
  'SOVEREIGN_SPECIALIST_DOMAIN_OR_MODEL_NOT_QUALIFIED');
  const keys = Object.fromEntries(['reviewer', 'auditor', 'witness'].map(role => [role, loadKey(item.keys[role])]));
  requireProof(new Set(Object.values(keys).map(key => key.spkiSha256)).size === 3
    && new Set(Object.values(keys).map(key => key.keyId)).size === 3, 'SOVEREIGN_SPECIALIST_SIGNERS_NOT_INDEPENDENT');
  const profile = item.reviewExecutionProfile;
  requireProof(exactKeys(profile, ['profileSha256', 'promptTemplateSha256', 'modelContextTokens',
    'maximumReviewDurationMs', 'maximumOutputTokens', 'tokenizerKind', 'tokenizerArtifactSha256'])
    && SHA64.test(profile.profileSha256) && SHA64.test(profile.promptTemplateSha256)
    && integer(profile.modelContextTokens) && profile.modelContextTokens >= 8192 && profile.modelContextTokens <= 1048576
    && integer(profile.maximumReviewDurationMs) && profile.maximumReviewDurationMs <= 13 * 60 * 1000
    && integer(profile.maximumOutputTokens) && profile.maximumOutputTokens <= 16384
    && ['UTF8_BYTE_UPPER_BOUND', 'INDEPENDENT_PINNED_TOKENIZER'].includes(profile.tokenizerKind)
    && (profile.tokenizerKind === 'UTF8_BYTE_UPPER_BOUND' ? profile.tokenizerArtifactSha256 === null : SHA64.test(profile.tokenizerArtifactSha256)),
  'SOVEREIGN_SPECIALIST_EXECUTION_PROFILE_UNQUALIFIED');
  return { item, keys };
}

function nativeEvidence(artifact, enrollment, keys, now) {
  const proof = signedEnvelope(artifact.nativeEvidence, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.native, keys.witness);
  requireProof(exactKeys(proof, ['schemaVersion', 'sourceBindingSha256', 'reviewNonce', 'modelDigestSha256',
    'deviceIdSha256', 'implementerPrincipal', 'implementerPrincipalSha256', 'reviewerPrincipalSha256',
    'auditorPrincipalSha256', 'witnessPrincipalSha256', 'reviewerSessionId', 'implementerSessionId',
    'observedAtUtc', 'expiresAtUtc', 'measurements'])
    && proof.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.native
    && proof.sourceBindingSha256 === sovereignSpecialistDigestV1(pick(artifact, SOURCE_FIELDS))
    && proof.reviewNonce === artifact.reviewNonce && proof.modelDigestSha256 === artifact.modelDigestSha256
    && proof.deviceIdSha256 === enrollment.deviceIdSha256
    && ID.test(proof.implementerPrincipal) && SHA64.test(proof.implementerPrincipalSha256)
    && ['reviewer', 'auditor', 'witness'].every(role => proof[role + 'PrincipalSha256'] === enrollment[role + 'PrincipalSha256'])
    && new Set([proof.implementerPrincipal, enrollment.reviewerPrincipal, enrollment.auditorPrincipal, enrollment.witnessPrincipal]).size === 4
    && new Set([proof.implementerPrincipalSha256, proof.reviewerPrincipalSha256,
      proof.auditorPrincipalSha256, proof.witnessPrincipalSha256]).size === 4
    && proof.reviewerSessionId === artifact.receipt.reviewerSessionId
    && proof.implementerSessionId === artifact.receipt.implementerSessionId
    && proof.reviewerSessionId !== proof.implementerSessionId,
  'SOVEREIGN_SPECIALIST_NATIVE_IDENTITY_MISMATCH');
  const observed = currentLifetime(proof, now, Date.parse(enrollment.notBeforeUtc));
  const reviewed = Date.parse(artifact.receipt.timestampUtc);
  requireProof(timestamp(artifact.receipt.timestampUtc) && reviewed >= observed
    && reviewed - observed <= MAX_NATIVE_TO_REVIEW_MS && reviewed <= now,
  'SOVEREIGN_SPECIALIST_NATIVE_OBSERVATION_NOT_BOUND');
  // These are independently captured OS measurements, not a signed `passed`
  // checkbox. The protected witness must be separately commissioned; the local
  // model/reviewer/auditor key cannot sign this envelope.
  const measured = proof.measurements;
  requireProof(exactKeys(measured, LOCAL_REVIEW_EXAM_PRIVILEGED), 'SOVEREIGN_SPECIALIST_NATIVE_OS_PROOF_MISSING');
  const identity = measured['native-windows-identity'];
  requireProof(exactKeys(identity, ['platform', 'deviceIdSha256', 'tokenUserSidSha256', 'effectivePrincipalSha256',
    'processId', 'processCreatedAtUtc', 'tokenReadbackSha256']) && identity.platform === 'win32'
    && identity.deviceIdSha256 === enrollment.deviceIdSha256
    && identity.tokenUserSidSha256 === enrollment.reviewerPrincipalSha256
    && identity.effectivePrincipalSha256 === enrollment.reviewerPrincipalSha256
    && integer(identity.processId) && timestamp(identity.processCreatedAtUtc)
    && Date.parse(identity.processCreatedAtUtc) <= observed && SHA64.test(identity.tokenReadbackSha256),
  'SOVEREIGN_SPECIALIST_NATIVE_TOKEN_PROOF_INVALID');
  const writes = measured['original-writer-negative-write'];
  requireProof(exactKeys(writes, ['actorPrincipalSha256', 'probes'])
    && writes.actorPrincipalSha256 === proof.implementerPrincipalSha256 && dense(writes.probes)
    && writes.probes.length === WRITE_ROLES.length && new Set(writes.probes.map(probe => probe?.role)).size === WRITE_ROLES.length
    && writes.probes.every(probe => exactKeys(probe, ['role', 'objectSha256', 'win32Error', 'evidenceSha256'])
      && WRITE_ROLES.includes(probe.role) && probe.objectSha256 === enrollment.negativeWriteTargets[probe.role]
      && probe.win32Error === 5 && SHA64.test(probe.evidenceSha256)),
  'SOVEREIGN_SPECIALIST_NEGATIVE_WRITE_PROOF_INVALID');
  const reentry = measured['direct-and-task-reentry-denial'];
  requireProof(exactKeys(reentry, ['actorPrincipalSha256', 'taskDefinitionSha256', 'directWin32Error',
    'taskWin32Error', 'directEvidenceSha256', 'taskEvidenceSha256'])
    && reentry.actorPrincipalSha256 === proof.implementerPrincipalSha256
    && reentry.taskDefinitionSha256 === enrollment.reentryTaskDefinitionSha256
    && reentry.directWin32Error === 5 && reentry.taskWin32Error === 5
    && SHA64.test(reentry.directEvidenceSha256) && SHA64.test(reentry.taskEvidenceSha256),
  'SOVEREIGN_SPECIALIST_REENTRY_PROOF_INVALID');
  const custody = measured['separate-protected-signers'];
  requireProof(exactKeys(custody, ['store', 'profileSha256', 'reviewerSpkiSha256', 'auditorSpkiSha256',
    'witnessSpkiSha256', 'readbackEvidenceSha256']) && custody.store === 'ADMIN_PROTECTED_NATIVE_KEY_STORE'
    && custody.profileSha256 === enrollment.signerCustodyProfileSha256
    && ['reviewer', 'auditor', 'witness'].every(role => custody[role + 'SpkiSha256'] === keys[role].spkiSha256)
    && SHA64.test(custody.readbackEvidenceSha256), 'SOVEREIGN_SPECIALIST_SIGNER_CUSTODY_UNPROVEN');
  const commissioning = measured['independently-audited-commissioning'];
  requireProof(exactKeys(commissioning, ['commissioningProofSha256', 'nativeCommissioningProofSha256',
    'installedHead', 'installedTree', 'installedClosureSha256', 'protectedRuntimeProfileSha256',
    'fullBootWitnessSha256', 'independentAuditProofSha256'])
    && commissioning.commissioningProofSha256 === enrollment.commissioningProofSha256
    && commissioning.nativeCommissioningProofSha256 === enrollment.nativeCommissioningProofSha256
    && commissioning.installedHead === artifact.baseSha && commissioning.installedTree === artifact.baseTree
    && commissioning.protectedRuntimeProfileSha256 === enrollment.protectedRuntimeProfileSha256
    && ['installedClosureSha256', 'fullBootWitnessSha256', 'independentAuditProofSha256'].every(key => SHA64.test(commissioning[key])),
  'SOVEREIGN_SPECIALIST_INSTALLED_PARENT_UNPROVEN');
  return proof;
}

function capabilityExam(artifact, enrollment, keys, native, now) {
  const exam = artifact.capabilityExam;
  requireProof(exactKeys(exam, ['repository', 'sourceHead', 'baseSha', 'implementerPrincipal', 'reviewerPrincipal',
    'auditorPrincipal', 'implementerProvider', 'reviewerProvider', 'hardcodedCodexSpecialistGateStillRequired', 'receipts'])
    && exam.repository === artifact.repository && exam.sourceHead === artifact.sourceHead && exam.baseSha === artifact.baseSha
    && exam.implementerPrincipal === native.implementerPrincipal
    && exam.reviewerPrincipal === enrollment.reviewerPrincipal && exam.auditorPrincipal === enrollment.auditorPrincipal
    && exam.reviewerProvider === enrollment.provider && exam.implementerProvider === artifact.receipt.implementerProvider
    && dense(exam.receipts) && exam.receipts.length === LOCAL_REVIEW_EXAM_CHALLENGES.length + LOCAL_REVIEW_EXAM_PRIVILEGED.length,
  'SOVEREIGN_SPECIALIST_CAPABILITY_EXAM_INVALID');
  const fields = ['schemaVersion', 'challengeId', 'repository', 'sourceHead', 'baseSha', 'reviewerPrincipal',
    'auditorPrincipal', 'observedAtUtc', 'outcome', 'evidenceSha256', 'signatureBase64'];
  requireProof(exam.receipts.every(receipt => exactKeys(receipt, fields)), 'SOVEREIGN_SPECIALIST_CAPABILITY_EXAM_INVALID');
  // The existing exam signs its fixed field order. Reconstruct that exact order
  // after parsing the enclosing canonical artifact; do not change signed values.
  const receipts = exam.receipts.map(receipt => pick(receipt, fields));
  for (const challenge of LOCAL_REVIEW_EXAM_PRIVILEGED) {
    const receipt = receipts.find(item => item.challengeId === challenge);
    requireProof(receipt && receipt.evidenceSha256 === sovereignSpecialistDigestV1(native.measurements[challenge])
      && Date.parse(receipt.observedAtUtc) >= Date.parse(native.observedAtUtc)
      && Date.parse(receipt.observedAtUtc) <= Date.parse(artifact.receipt.timestampUtc),
    'SOVEREIGN_SPECIALIST_EXAM_NATIVE_PROOF_MISMATCH');
  }
  const assessment = assessLocalReviewCapabilityExam({ ...exam, receipts }, {
    nowMs: now, trust: { pinnedAuditorPublicKeyPem: keys.auditor.pem,
      pinnedAuditorPublicKeySha256: keys.auditor.artifactSha256,
      // Derived from verified fixed enrollment AND the independently signed,
      // structured native proof above; never copied from the artifact/caller.
      provisioningVerified: native.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.native },
  });
  requireProof(assessment.status === 'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION'
    && assessment.baselineEvidenceComplete === true && assessment.windowsEvidenceComplete === true,
  'SOVEREIGN_SPECIALIST_CAPABILITY_EXAM_UNQUALIFIED');
}

function calibration(artifact, enrollment, field, windows, now) {
  const packet = artifact[field];
  requireProof(exactKeys(packet, ['modelDigestSha256', 'observedAtUtc', 'result'])
    && packet.modelDigestSha256 === enrollment.modelDigestSha256 && timestamp(packet.observedAtUtc)
    && Date.parse(packet.observedAtUtc) <= Date.parse(artifact.receipt.timestampUtc)
    && now - Date.parse(packet.observedAtUtc) <= 24 * 60 * 60 * 1000,
  'SOVEREIGN_SPECIALIST_MODEL_CALIBRATION_UNBOUND');
  const result = packet.result;
  const authorityFields = windows
    ? ['qualifiedWindowsSpecialist', 'independentSecurityReviewSatisfied', 'independentHostAttestation', 'signatureVerified',
      'protectedMergeAuthority', 'serviceInstallationAuthority', 'sourceMutationAuthority', 'leaseReleaseAuthority',
      'signedWindowsCustodyProven', 'physicalPickupProven']
    : ['independentHostAttestation', 'signatureVerified', 'specialistAuthority', 'independentReviewSatisfied',
      'protectedMergeAuthority', 'sourceMutationAuthority', 'leaseReleaseAuthority', 'windowsCommissioningAuthority', 'physicalPickupProven'];
  requireProof(record(result) && result.schemaVersion === (windows ? SOVEREIGN_WINDOWS_CALIBRATION_SCHEMA : SOVEREIGN_CALIBRATION_SCHEMA)
    && result.status === (windows ? 'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED' : 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED')
    && result.reason === '' && result.repository === artifact.repository && result.sourceHead === artifact.sourceHead
    && result.baseSha === artifact.baseSha && result.reviewerPrincipal === enrollment.reviewerPrincipal
    && result.reviewerProvider === enrollment.provider && result.reviewerSessionId === artifact.receipt.reviewerSessionId
    && result.manifestSha256 === (windows ? sovereignWindowsCalibrationManifestV1().manifestSha256 : SOVEREIGN_CALIBRATION_MANIFEST_SHA256)
    && SHA64.test(result.observationsSha256) && result.completedCases === (windows ? SOVEREIGN_WINDOWS_CALIBRATION_CASE_COUNT : SOVEREIGN_CALIBRATION_CASE_COUNT)
    && result.passedCases === result.completedCases && dense(result.missed) && result.missed.length === 0
    && authorityFields.every(key => result[key] === false)
    && (!windows || result.qualification === 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION'),
  'SOVEREIGN_SPECIALIST_MODEL_CALIBRATION_UNQUALIFIED');
  requireProof(exactKeys(result, ['schemaVersion', 'status', 'reason', 'repository', 'sourceHead', 'baseSha',
    'reviewerPrincipal', 'reviewerProvider', 'reviewerSessionId', 'manifestSha256', 'observationsSha256',
    'completedCases', 'passedCases', 'missed', ...(windows ? ['qualification'] : []), ...authorityFields]),
  'SOVEREIGN_SPECIALIST_MODEL_CALIBRATION_SCHEMA_INVALID');
}

function fullReviewExecution(artifact, enrollment, keys, now) {
  // Legacy independent chunk summaries are intentionally insufficient. This
  // proof must come from the separately enrolled native witness observing a
  // complete cross-file pass, not from a candidate's `clean`/`complete` flag.
  requireProof(exactKeys(artifact.reviewExecution, ['payload', 'signatureBase64']),
    'SOVEREIGN_SPECIALIST_FULL_REVIEW_EXECUTION_UNPROVEN');
  const execution = signedEnvelope(artifact.reviewExecution, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.execution, keys.witness);
  const profile = enrollment.reviewExecutionProfile;
  requireProof(exactKeys(execution, ['schemaVersion', 'sourceBindingSha256', 'reviewNonce', 'modelDigestSha256',
    'profileSha256', 'stage', 'fullDiffSha256', 'reviewedObjectClosureSha256', 'reviewedPathsSha256',
    'startedAtUtc', 'finishedAtUtc', 'prompt', 'runtime', 'governorChecks'])
    && execution.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.execution
    && execution.stage === 'COMPLETE_CROSS_FILE_REVIEW'
    && execution.sourceBindingSha256 === sovereignSpecialistDigestV1(pick(artifact, SOURCE_FIELDS))
    && execution.reviewNonce === artifact.reviewNonce && execution.modelDigestSha256 === enrollment.modelDigestSha256
    && execution.profileSha256 === profile.profileSha256 && execution.fullDiffSha256 === artifact.fullDiffSha256
    && execution.reviewedObjectClosureSha256 === artifact.reviewedObjectClosureSha256
    && execution.reviewedPathsSha256 === sovereignSpecialistDigestV1(artifact.sourceEvidence.map(file => file.path))
    && timestamp(execution.startedAtUtc) && timestamp(execution.finishedAtUtc),
  'SOVEREIGN_SPECIALIST_FULL_REVIEW_EXECUTION_UNPROVEN');
  const started = Date.parse(execution.startedAtUtc), finished = Date.parse(execution.finishedAtUtc), duration = finished - started;
  requireProof(started >= Date.parse(enrollment.notBeforeUtc) && duration > 0
    && duration <= profile.maximumReviewDurationMs && finished <= Date.parse(artifact.receipt.timestampUtc)
    && finished <= now && now - finished <= MAX_LIFETIME_MS,
  'SOVEREIGN_SPECIALIST_REVIEW_DEADLINE_UNPROVEN');
  const prompt = execution.prompt, runtime = execution.runtime;
  requireProof(exactKeys(prompt, ['sha256', 'bytes', 'inputTokens', 'templateSha256', 'includedDiffSha256',
    'includedDiffBytes', 'tokenizerKind', 'tokenizerArtifactSha256', 'tokenCountEvidenceSha256'])
    && SHA64.test(prompt.sha256) && integer(prompt.bytes) && prompt.bytes >= artifact.diffBytes
    && prompt.bytes <= SOVEREIGN_SPECIALIST_MAX_DIFF_BYTES_V1 + 65536
    && prompt.templateSha256 === profile.promptTemplateSha256 && prompt.includedDiffSha256 === artifact.fullDiffSha256
    && prompt.includedDiffBytes === artifact.diffBytes && integer(prompt.inputTokens)
    && prompt.tokenizerKind === profile.tokenizerKind && prompt.tokenizerArtifactSha256 === profile.tokenizerArtifactSha256
    && SHA64.test(prompt.tokenCountEvidenceSha256), 'SOVEREIGN_SPECIALIST_COMPLETE_PROMPT_UNPROVEN');
  if (profile.tokenizerKind === 'UTF8_BYTE_UPPER_BOUND') {
    requireProof(prompt.inputTokens === prompt.bytes && prompt.tokenCountEvidenceSha256 === sovereignSpecialistDigestV1({
      schemaVersion: 'stephanos.utf8-token-upper-bound.v1', promptSha256: prompt.sha256, bytes: prompt.bytes }),
    'SOVEREIGN_SPECIALIST_INPUT_TOKEN_BOUND_INVALID');
  }
  requireProof(exactKeys(runtime, ['contextTokens', 'outputTokenReserve', 'actualPromptTokens', 'actualOutputTokens',
    'doneReason', 'responseSha256', 'modelSelector']) && integer(runtime.contextTokens)
    && runtime.contextTokens <= profile.modelContextTokens && integer(runtime.outputTokenReserve)
    && runtime.outputTokenReserve <= profile.maximumOutputTokens
    && prompt.inputTokens + runtime.outputTokenReserve <= runtime.contextTokens
    && integer(runtime.actualPromptTokens) && runtime.actualPromptTokens <= prompt.inputTokens
    && (profile.tokenizerKind !== 'INDEPENDENT_PINNED_TOKENIZER' || runtime.actualPromptTokens === prompt.inputTokens)
    && integer(runtime.actualOutputTokens) && runtime.actualOutputTokens <= runtime.outputTokenReserve
    && runtime.doneReason === 'stop' && SHA64.test(runtime.responseSha256)
    && runtime.modelSelector === 'sha256:' + enrollment.modelDigestSha256 + ':local',
  'SOVEREIGN_SPECIALIST_CONTEXT_OR_COMPLETION_UNPROVEN');
  const checks = execution.governorChecks;
  requireProof(exactKeys(checks, ['intervalMs', 'count', 'interruptedCount', 'observationChainSha256', 'before', 'after'])
    && integer(checks.intervalMs) && checks.intervalMs <= 1000 && integer(checks.count)
    && checks.count >= Math.ceil(duration / checks.intervalMs) + 2 && checks.interruptedCount === 0
    && SHA64.test(checks.observationChainSha256), 'SOVEREIGN_SPECIALIST_GAMING_PREEMPTION_UNPROVEN');
  const flags = ['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive', 'virtualAirLinkTestActive', 'prepareLeaseActive'];
  for (const [state, at] of [[checks.before, started], [checks.after, finished]]) {
    requireProof(exactKeys(state, ['schemaVersion', 'governorVersion', 'updatedAtUtc', ...flags,
      'localModelAllowed', 'heavyModelAllowed', 'ollamaLoadMode', 'observationSha256'])
      && state.schemaVersion === 'stephanos.vr-resource-governor.v1' && state.governorVersion === 3
      && flags.every(flag => state[flag] === false) && state.localModelAllowed === true && state.heavyModelAllowed === true
      && state.ollamaLoadMode === 'balanced' && timestamp(state.updatedAtUtc)
      && at - Date.parse(state.updatedAtUtc) >= -5000 && at - Date.parse(state.updatedAtUtc) <= 30000
      && SHA64.test(state.observationSha256), 'SOVEREIGN_SPECIALIST_GAMING_RESOURCE_PROTECTED');
  }
}

function validateSignedReview(artifact, enrollment, keys, now) {
  const binding = sovereignSpecialistReviewBindingV1(artifact);
  signature(artifact.reviewerSignatureBase64, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.review,
    pick(artifact, REVIEW_CORE_FIELDS), keys.reviewer);
  const auditor = signedEnvelope(artifact.auditorAttestation, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.auditor, keys.auditor);
  requireProof(exactKeys(auditor, ['schemaVersion', 'reviewBindingSha256', 'reviewerSignatureSha256',
    'enrollmentId', 'modelDigestSha256', 'qualifiedDomains', 'nativeEvidenceSha256', 'capabilityExamSha256',
    'baselineCalibrationSha256', 'windowsCalibrationSha256', 'reviewExecutionSha256', 'verdict', 'observedAtUtc', 'expiresAtUtc'])
    && auditor.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.auditor
    && auditor.reviewBindingSha256 === binding && auditor.reviewerSignatureSha256 === digest(Buffer.from(artifact.reviewerSignatureBase64, 'base64'))
    && auditor.enrollmentId === enrollment.enrollmentId && auditor.modelDigestSha256 === enrollment.modelDigestSha256
    && equal(auditor.qualifiedDomains, artifact.reviewDomains) && auditor.verdict === 'INDEPENDENT_SPECIALIST_EVIDENCE_ACCEPTED'
    && ['nativeEvidence', 'capabilityExam', 'baselineCalibration', 'windowsCalibration', 'reviewExecution'].every(field => auditor[field + 'Sha256'] === sovereignSpecialistDigestV1(artifact[field])),
  'SOVEREIGN_SPECIALIST_AUDITOR_BINDING_INVALID');
  const audited = currentLifetime(auditor, now, Date.parse(artifact.receipt.timestampUtc));
  const replay = signedEnvelope(artifact.replayWitness, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.replay, keys.witness);
  requireProof(exactKeys(replay, ['schemaVersion', 'enrollmentId', 'reviewBindingSha256', 'reviewNonce',
    'journalGeneration', 'journalEntrySha256', 'state', 'observedAtUtc', 'expiresAtUtc'])
    && replay.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.replay
    && replay.enrollmentId === enrollment.enrollmentId && replay.reviewBindingSha256 === binding
    && replay.reviewNonce === artifact.reviewNonce && integer(replay.journalGeneration)
    && replay.journalGeneration >= enrollment.minimumJournalGeneration
    && SHA64.test(replay.journalEntrySha256) && replay.state === 'BOUND_TO_EXACT_REVIEW',
  'SOVEREIGN_SPECIALIST_REPLAY_BINDING_INVALID');
  currentLifetime(replay, now, audited);
  const selfChange = artifact.reviewDomains.includes('reviewer-trust-and-approval')
    || artifact.sourceEvidence.some(file => SELF_CHANGE_PATHS.has(file.path.toLowerCase()));
  if (!selfChange) {
    requireProof(artifact.selfChangeAttestation === null, 'SOVEREIGN_SPECIALIST_UNEXPECTED_SELF_CHANGE_PROOF');
    return;
  }
  const root = enrollment.outOfBandAuditor;
  requireProof(exactKeys(root, ['principal', 'principalSha256', 'key', 'commissioningProofSha256'])
    && ID.test(root.principal) && SHA64.test(root.principalSha256) && SHA64.test(root.commissioningProofSha256)
    && ![enrollment.reviewerPrincipal, enrollment.auditorPrincipal, enrollment.witnessPrincipal,
      artifact.capabilityExam.implementerPrincipal].includes(root.principal)
    && ![enrollment.reviewerPrincipalSha256, enrollment.auditorPrincipalSha256, enrollment.witnessPrincipalSha256,
      artifact.nativeEvidence.payload.implementerPrincipalSha256].includes(root.principalSha256),
  'SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED');
  const rootKey = loadKey(root.key);
  requireProof(!Object.values(keys).some(key => key.spkiSha256 === rootKey.spkiSha256 || key.keyId === rootKey.keyId),
    'SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED');
  const approval = signedEnvelope(artifact.selfChangeAttestation, SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.selfChange, rootKey);
  requireProof(exactKeys(approval, ['schemaVersion', 'reviewBindingSha256', 'commissioningProofSha256',
    'independentPolicyReviewSha256', 'observedAtUtc', 'expiresAtUtc'])
    && approval.schemaVersion === SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1.selfChange
    && approval.reviewBindingSha256 === binding && approval.commissioningProofSha256 === root.commissioningProofSha256
    && SHA64.test(approval.independentPolicyReviewSha256), 'SOVEREIGN_SPECIALIST_SELF_CHANGE_APPROVAL_INVALID');
  currentLifetime(approval, now, audited);
}

/** Read-only evidence acceptance. Fixed protected enrollment is the only key
 * source. `expected` supplies source identity, never an enrollment/key/clock.
 * Native proof and model exams remain separate; no signed model claim can
 * replace the independent witness's actual OS measurements. */
export function validateSovereignQualifiedSpecialistArtifactV1(artifact = {}, expected = {}) {
  try {
    requireProof(exactKeys(artifact, ARTIFACT_FIELDS) && artifact.schemaVersion === SOVEREIGN_SPECIALIST_ARTIFACT_SCHEMA_V1
      && artifact.kind === 'stephanos.sovereign-qualified-specialist-review.artifact'
      && Buffer.byteLength(sovereignSpecialistCanonicalV1(artifact), 'utf8') <= MAX_ARTIFACT_BYTES
      && SHA64.test(artifact.payloadSha256) && artifact.payloadSha256 === sovereignSpecialistArtifactPayloadSha256V1(artifact)
      && ID.test(artifact.enrollmentId) && SHA64.test(artifact.reviewNonce) && SHA64.test(artifact.modelDigestSha256),
    'SOVEREIGN_SPECIALIST_ARTIFACT_INVALID');
    sourceShape(pick(artifact, SOURCE_FIELDS));
    requireProof(['repository', 'prNumber', 'branch', 'sourceHead', 'baseSha'].every(field => expected[field] === artifact[field]),
      'SOVEREIGN_SPECIALIST_EXPECTED_SOURCE_MISMATCH');
    if (expected.sovereignSourceBinding !== undefined) requireProof(equal(expected.sovereignSourceBinding, pick(artifact, SOURCE_FIELDS)),
      'SOVEREIGN_SPECIALIST_LIVE_SOURCE_BINDING_MISMATCH');
    requireProof(dense(artifact.escalationPaths) && artifact.escalationPaths.length > 0
      && new Set(artifact.escalationPaths).size === artifact.escalationPaths.length
      && equal(artifact.escalationPaths, [...artifact.escalationPaths].sort())
      && artifact.escalationPaths.every(path => artifact.sourceEvidence.some(file => file.path === path)),
    'SOVEREIGN_SPECIALIST_ESCALATION_PATHS_INVALID');
    if (expected.paths) requireProof(equal([...expected.paths].sort(), artifact.escalationPaths), 'SOVEREIGN_SPECIALIST_ESCALATION_PATHS_MISMATCH');
    const now = Date.now();
    requireProof(Number.isSafeInteger(now) && now >= 0, 'SOVEREIGN_SPECIALIST_CLOCK_UNAVAILABLE');
    const { item: enrollment, keys } = enrollmentFor(artifact, now);
    const receipt = validateProviderNeutralReviewReceipt(artifact.receipt, {
      repository: artifact.repository, prNumber: artifact.prNumber, branch: artifact.branch,
      expectedHead: artifact.sourceHead, riskTier: 'high' });
    requireProof(receipt.valid && artifact.receipt.reviewerClass === 'external-qualified'
      && artifact.receipt.reviewerId === enrollment.reviewerId && artifact.receipt.provider === enrollment.provider
      && artifact.receipt.modelClass === enrollment.modelClass && artifact.receipt.assuranceMode === 'specialist'
      && artifact.receipt.verdict === 'clean' && artifact.receipt.findings.length === 0
      && artifact.receipt.implementerProvider !== enrollment.provider
      && artifact.receipt.reviewScope.includes('complete-exact-head-diff')
      && artifact.reviewDomains.every(domain => artifact.receipt.reviewScope.includes('domain:' + domain)),
    'SOVEREIGN_SPECIALIST_REVIEW_RECEIPT_INVALID');
    const native = nativeEvidence(artifact, enrollment, keys, now);
    capabilityExam(artifact, enrollment, keys, native, now);
    calibration(artifact, enrollment, 'baselineCalibration', false, now);
    calibration(artifact, enrollment, 'windowsCalibration', true, now);
    fullReviewExecution(artifact, enrollment, keys, now);
    validateSignedReview(artifact, enrollment, keys, now);
    return Object.freeze({ valid: true, blockers: Object.freeze([]), artifact, receipt: artifact.receipt,
      signatureVerified: true, reviewerEnrollmentVerified: true, nativeEvidenceAccepted: true,
      liveSourceBindingVerified: record(expected.sovereignSourceBinding), ...NO_MUTATION });
  } catch (error) {
    const blocker = error instanceof Error && /^SOVEREIGN_SPECIALIST_[A-Z_]+$/.test(error.message)
      ? error.message : 'SOVEREIGN_SPECIALIST_ENCODING_INVALID';
    return held(blocker);
  }
}

export function sovereignQualifiedSpecialistCommentCandidatesV1(comments, expected = {}) {
  const candidates = [], blockers = [];
  let observed = false;
  if (!dense(comments) || comments.length > 5000) return { candidates, observed, blockers: ['SOVEREIGN_SPECIALIST_COMMENT_ESTATE_INVALID'] };
  for (const comment of comments) {
    if (typeof comment?.body !== 'string' || !comment.body.startsWith(SOVEREIGN_SPECIALIST_COMMENT_MARKER_V1)) continue;
    observed = true;
    try {
      requireProof(record(expected.sovereignSourceBinding), 'SOVEREIGN_SPECIALIST_LIVE_SOURCE_BINDING_REQUIRED');
      requireProof(integer(comment.id) && typeof comment.created_at === 'string' && comment.created_at === comment.updated_at
        && Number.isFinite(Date.parse(comment.created_at)) && Date.parse(comment.created_at) <= Date.now()
        && Buffer.byteLength(comment.body, 'utf8') <= MAX_ARTIFACT_BYTES
        && comment.issue_url === `https://api.github.com/repos/${expected.repository}/issues/${expected.prNumber}`,
      'SOVEREIGN_SPECIALIST_COMMENT_PROVENANCE_INVALID');
      const prefix = SOVEREIGN_SPECIALIST_COMMENT_MARKER_V1 + '\n```json\n', suffix = '\n```';
      requireProof(comment.body.startsWith(prefix) && comment.body.endsWith(suffix), 'SOVEREIGN_SPECIALIST_COMMENT_ENCODING_INVALID');
      const raw = comment.body.slice(prefix.length, -suffix.length), artifact = JSON.parse(raw);
      requireProof(sovereignSpecialistCanonicalV1(artifact) === raw, 'SOVEREIGN_SPECIALIST_COMMENT_ENCODING_INVALID');
      const result = validateSovereignQualifiedSpecialistArtifactV1(artifact, expected);
      requireProof(result.valid, result.blockers[0]);
      requireProof(result.liveSourceBindingVerified === true, 'SOVEREIGN_SPECIALIST_LIVE_SOURCE_BINDING_REQUIRED');
      const posted = Date.parse(comment.created_at);
      requireProof(posted >= Date.parse(artifact.replayWitness.payload.observedAtUtc)
        && posted < Date.parse(artifact.replayWitness.payload.expiresAtUtc), 'SOVEREIGN_SPECIALIST_COMMENT_TIME_UNBOUND');
      candidates.push(Object.freeze({ valid: true, receipt: artifact.receipt, artifact, reviewId: comment.id }));
    } catch (error) {
      blockers.push(error instanceof Error && /^SOVEREIGN_SPECIALIST_[A-Z_]+$/.test(error.message)
        ? error.message : 'SOVEREIGN_SPECIALIST_COMMENT_ENCODING_INVALID');
    }
  }
  return Object.freeze({ candidates: Object.freeze(candidates), observed,
    blockers: Object.freeze([...new Set(blockers)].slice(0, 8)) });
}
