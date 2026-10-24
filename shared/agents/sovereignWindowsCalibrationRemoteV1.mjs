import { sovereignWindowsCalibrationManifestV1 } from './sovereignWindowsCalibrationV1.mjs';

export const WINDOWS_CALIBRATION_REMOTE_ACTION = 'sovereign-windows-reviewer-calibration';
export const WINDOWS_CALIBRATION_REMOTE_MARKER = 'SOVEREIGN_WINDOWS_CALIBRATION_REMOTE_RESULT=';
const PASS = 'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED';
const HOLD = 'WINDOWS_CALIBRATION_HELD';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const denial = Object.freeze({
  qualifiedWindowsSpecialist: false, independentSecurityReviewSatisfied: false,
  independentHostAttestation: false, signatureVerified: false,
  protectedMergeAuthority: false, serviceInstallationAuthority: false,
  sourceMutationAuthority: false, leaseReleaseAuthority: false,
  signedWindowsCustodyProven: false, physicalPickupProven: false,
});
const reasons = new Set([
  '', 'NATIVE_WINDOWS_HOST_REQUIRED', 'MODEL_INVALID', 'EXACT_LOCAL_SOURCE_UNPROVEN',
  'REVIEWER_EXECUTABLE_BYTES_UNPROVEN', 'GAMING_RESOURCE_UNAVAILABLE_OR_PROTECTED',
  'LOCAL_MODEL_DIGEST_UNPROVEN', 'SOURCE_CHANGED_DURING_CALIBRATION',
  'SOURCE_MODEL_OR_GAMING_CHANGED_DURING_CALIBRATION', 'LOCAL_CALIBRATION_EXECUTION_FAILED',
  'CALIBRATION_TOTAL_DEADLINE_EXCEEDED', 'EXACT_SOURCE_OR_INDEPENDENT_REVIEW_IDENTITY_MISSING',
  'LOCAL_MODEL_NOT_CONNECTED', 'LOCAL_MODEL_EXECUTION_FAILED', 'LOCAL_MODEL_RESPONSE_UNBOUNDED',
  'LOCAL_MODEL_RESPONSE_NOT_JSON', 'LOCAL_MODEL_RESPONSE_INVALID',
  'WINDOWS_REVIEW_COMPETENCE_NOT_DEMONSTRATED',
]);
const safeHash = (value, re) => typeof value === 'string' && re.test(value) ? value : '';

// Projection is deliberately lossy. No principals, sessions, model name,
// missed-case IDs, raw prompts, answer keys, paths or transcripts leave the host.
export function projectWindowsCalibrationForRemoteV1(input = {}) {
  const manifest = sovereignWindowsCalibrationManifestV1();
  const noAuthority = Object.keys(denial).every(key => input[key] === false);
  const completed = Number.isInteger(input.completedCases)
    && input.completedCases >= 0 && input.completedCases <= manifest.challengeCount
    ? input.completedCases : 0;
  const passed = Number.isInteger(input.passedCases)
    && input.passedCases >= 0 && input.passedCases <= completed ? input.passedCases : 0;
  const validPass = input.status === PASS && noAuthority
    && input.reason === '' && input.repository === 'Cheekyfellastef/stephan-os'
    && SHA40.test(input.sourceHead ?? '') && SHA40.test(input.baseSha ?? '')
    && input.sourceHead !== input.baseSha
    && input.manifestSha256 === manifest.manifestSha256
    && SHA64.test(input.observationsSha256 ?? '') && SHA64.test(input.modelDigestSha256 ?? '')
    && completed === manifest.challengeCount && passed === manifest.challengeCount
    && input.qualification === 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION';
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-windows-calibration-remote.v1',
    status: validPass ? PASS : HOLD,
    reason: validPass ? '' : input.status === HOLD && noAuthority && reasons.has(input.reason)
      && input.reason ? input.reason : 'CALIBRATION_RESULT_INVALID',
    sourceHead: safeHash(input.sourceHead, SHA40), baseSha: safeHash(input.baseSha, SHA40),
    manifestSha256: manifest.manifestSha256,
    observationsSha256: safeHash(input.observationsSha256, SHA64),
    modelDigestSha256: safeHash(input.modelDigestSha256, SHA64),
    completedCases: completed, passedCases: passed,
    qualification: 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',
    ...denial,
  });
}

export function parseWindowsCalibrationRemoteV1(envelope = {}, expectedHead = '', expectedBase = '') {
  if (envelope.command?.plan?.processId !== WINDOWS_CALIBRATION_REMOTE_ACTION) return null;
  const raw = envelope.structuredContent?.stdout;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096) return null;
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0].startsWith(WINDOWS_CALIBRATION_REMOTE_MARKER)) return null;
  let parsed;
  try { parsed = JSON.parse(lines[0].slice(WINDOWS_CALIBRATION_REMOTE_MARKER.length)); }
  catch { return null; }
  if (!validateWindowsCalibrationRemoteProjectionV1(parsed)) return null;
  if (parsed.status === PASS) {
    const returnedBase = envelope.command?.plan?.reviewIdentity?.baseSha;
    if (typeof expectedBase !== 'string' || !SHA40.test(expectedBase)
      || returnedBase !== expectedBase || parsed.baseSha !== expectedBase
      || !SHA40.test(expectedHead) || parsed.sourceHead !== expectedHead
      || envelope.ok !== true || envelope.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !SHA64.test(envelope.proofHash ?? '') || envelope.structuredContent.status !== 0) return null;
  } else if (envelope.ok !== false || envelope.finalVerdict !== 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
    || envelope.structuredContent.status !== 2) return null;
  return Object.freeze(parsed);
}

export function validateWindowsCalibrationRemoteProjectionV1(parsed) {
  const expectedKeys = Object.keys(projectWindowsCalibrationForRemoteV1()).sort();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys)
    || parsed.schemaVersion !== 'stephanos.sovereign-windows-calibration-remote.v1'
    || !Object.keys(denial).every(key => parsed[key] === false)
    || parsed.qualification !== 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION'
    || parsed.manifestSha256 !== sovereignWindowsCalibrationManifestV1().manifestSha256
    || ![parsed.sourceHead, parsed.baseSha].every(x => typeof x === 'string' && (x === '' || SHA40.test(x)))
    || ![parsed.observationsSha256, parsed.modelDigestSha256].every(x => typeof x === 'string' && (x === '' || SHA64.test(x)))) return false;
  if (parsed.status === PASS) {
    if (!SHA40.test(parsed.sourceHead) || !SHA40.test(parsed.baseSha) || parsed.baseSha === parsed.sourceHead
      || !SHA64.test(parsed.observationsSha256) || !SHA64.test(parsed.modelDigestSha256)
      || parsed.completedCases !== 13 || parsed.passedCases !== 13 || parsed.reason !== '') return false;
  } else if (parsed.status !== HOLD
    || ![...reasons, 'CALIBRATION_RESULT_INVALID'].includes(parsed.reason) || !parsed.reason
    || !Number.isInteger(parsed.completedCases) || parsed.completedCases < 0 || parsed.completedCases > 13
    || !Number.isInteger(parsed.passedCases) || parsed.passedCases < 0
    || parsed.passedCases > parsed.completedCases) return false;
  return true;
}
