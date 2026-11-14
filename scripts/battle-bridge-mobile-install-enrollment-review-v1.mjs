// Offline review artifact for the existing #1814 owner. Never enrolls or installs.
// Source membership and matching digests do not authenticate review/merge evidence.
import { createHash } from 'node:crypto';
import { prepareFixedRuntimeSourcePackageV1, bindFixedRuntimeInstallerPackageV1,
  FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1, FIXED_RUNTIME_PACKAGE_LIMITS_V1 }
  from './sovereign-fixed-runtime-install-source-package-v1.mjs';
import { fixedRuntimeGitClosureSha256V1 } from './sovereign-fixed-runtime-installer-candidate-v1.mjs';

export const MOBILE_ENROLLMENT_REVIEW_INPUT_V1 = 'stephanos.mobile-install-enrollment-review-input.v1';
export const MOBILE_ENROLLMENT_REVIEW_V1 = 'stephanos.mobile-install-enrollment-review.v1';
const ROOT = 'C:\\Program Files\\Stephanos\\SovereignMobileInstallerV1';
const PACKAGE_PATH = ROOT + '\\runtime-package.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refused = () => { throw Error('MOBILE_ENROLLMENT_REVIEW_INPUT_REFUSED'); };
const keys = ['schemaVersion', 'sourceInput', 'expectedMain', 'sourceTree', 'operatorSid',
  'machineHash', 'enrollmentGeneration', 'releaseEvidenceBase64'];

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Private operator data in, private NOT_INSTALLABLE review bytes out. No I/O. */
export function prepareMobileInstallEnrollmentReviewV1(serializedInput) {
  if (typeof serializedInput !== 'string'
      || Buffer.byteLength(serializedInput) > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) refused();
  let input;
  try { input = JSON.parse(serializedInput); } catch { refused(); }
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== [...keys].sort().join(',')
      || input.schemaVersion !== MOBILE_ENROLLMENT_REVIEW_INPUT_V1
      || typeof input.machineHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.machineHash)
      || !Number.isSafeInteger(input.enrollmentGeneration) || input.enrollmentGeneration < 1
      || typeof input.releaseEvidenceBase64 !== 'string' || input.releaseEvidenceBase64.length > 1_398_104
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.releaseEvidenceBase64)) refused();
  const evidence = Buffer.from(input.releaseEvidenceBase64, 'base64');
  if (!evidence.length || evidence.length > 1_048_576 || evidence.toString('base64') !== input.releaseEvidenceBase64) refused();
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(evidence); } catch { refused(); }
  const sourcePackage = prepareFixedRuntimeSourcePackageV1(JSON.stringify(input.sourceInput));
  const bound = bindFixedRuntimeInstallerPackageV1(JSON.stringify({
    schemaVersion: FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1, sourcePackage,
    expectedMain: input.expectedMain, sourceTree: input.sourceTree, operatorSid: input.operatorSid,
  }));
  const payload = Buffer.from(bound.privateCandidate.payloadBase64, 'base64');
  const captured = JSON.parse(payload.toString('utf8'));
  const original = bound.privateCandidate.script;
  const oldPath = bound.privateCandidate.payloadPath;
  // Change only the existing fixed bootstrap's data location. Its source/blob,
  // identity, current-main, administrator and installation checks remain intact.
  // The location is this module's constant, never a caller-selected path.
  const literal = "$path='" + oldPath + "'";
  if (original.split(literal).length !== 2) refused();
  const bootstrap = Buffer.from(original.replace(literal, "$path='" + PACKAGE_PATH + "'"), 'utf8');
  if (bootstrap.length > 32768) refused();
  const fields = {
    repository: 'Cheekyfellastef/stephan-os', action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1',
    machineHash: input.machineHash, operatorSid: input.operatorSid,
    enrollmentGeneration: String(input.enrollmentGeneration), sourceHead: input.expectedMain,
    sourceTree: input.sourceTree, packageSha256: hash(payload),
    closureSha256: fixedRuntimeGitClosureSha256V1(captured.Records),
    releaseProofSha256: hash(evidence), bootstrapSha256: hash(bootstrap),
  };
  const permit = 'STEPHANOS_MOBILE_INSTALL_RELEASE_PIN_V1\n'
    + Object.entries(fields).map(([key, value]) => key + '=' + value + '\n').join('');
  const file = (name, data) => ({ name, sha256: hash(data), bytes: data.length, contentBase64: data.toString('base64') });
  return freeze({
    schemaVersion: MOBILE_ENROLLMENT_REVIEW_V1, state: 'PREPARED_FOR_PRIVATE_REVIEW',
    installability: 'NOT_INSTALLABLE', containsPrivateOperatorIdentity: true,
    source: { repository: fields.repository, head: fields.sourceHead, tree: fields.sourceTree },
    privateFiles: [file('release.pin', Buffer.from(permit, 'ascii')),
      file('runtime-package.json', payload), file('runtime-bootstrap.ps1', bootstrap),
      file('release-evidence.json', evidence)],
    requiredGates: ['AUTHENTICATED_PROTECTED_REVIEW_MERGE_EVIDENCE', 'WINDOWS_SECURITY_SPECIALIST_QUALIFICATION',
      'AUTHENTICATED_DEVICE_ENROLLMENT', 'SAME_OPERATOR_ADMINISTRATOR_ENROLLMENT',
      'PROTECTED_RECEIPT_KEY_AND_SIGNED_JOURNAL_GENESIS', 'EXACT_OPERATOR_INSTALLATION_APPROVAL'],
    authority: { sourceAdmissionProven: false, releaseEligibilityProven: false,
      evidenceAuthenticationProven: false, enrollmentQualified: false, operatorApprovalProven: false,
      executionAuthorityGranted: false, dispatchAllowed: false, elevationPerformed: false,
      installed: false, rebootAllowed: false },
  });
}
