import { createHash, createPublicKey, verify } from 'node:crypto';
import { MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2 as enrollments,
  MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2 as publicArtifacts } from './canonicalMailboxNativeEvidenceEnrollmentV2.mjs';
import { decodeMailboxNativeEvidenceV2, mailboxNativeEvidenceSignatureInputV2,
  MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 as domain } from './canonicalMailboxNativeEvidenceCodecV2.mjs';

const fields = ['schemaVersion', 'enrollmentId', 'repository', 'deviceIdSha256', 'producerId',
  'producerPrincipalSha256', 'producerProfileSha256', 'keyId', 'algorithm',
  'verificationKeySpkiSha256', 'verificationKeyArtifactSha256', 'signatureDomain',
  'allowedEvidenceKinds', 'commissionedAtUtc', 'notBeforeUtc', 'revokedAtUtc',
  'commissioningProofSha256', 'independentReviewArtifactSha256', 'operatorApprovalRef'];
const sha = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const timestamp = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function held(blocker, artifactSha256 = '') {
  return Object.freeze({ ok: false, blocker, artifactSha256, signatureVerified: false,
    producerEnrollmentVerified: false, nativeAuthorityVerified: false,
    freezeCertified: false, mergeAuthorized: false, sourceSyncAuthorized: false });
}
function validEnrollment(record) {
  if (!record || Object.keys(record).length !== fields.length || !fields.every(key => Object.hasOwn(record, key))
    || record.schemaVersion !== 'stephanos.canonical-mailbox-native-enrollment.v2'
    || record.repository !== 'Cheekyfellastef/stephan-os' || record.algorithm !== 'Ed25519'
    || record.signatureDomain !== domain || !Array.isArray(record.allowedEvidenceKinds)
    || JSON.stringify(record.allowedEvidenceKinds) !== '["CONTROL_TERMINAL","DRAIN_OBSERVATION"]'
    || !['enrollmentId', 'producerId', 'keyId'].every(key => typeof record[key] === 'string' && id.test(record[key]))
    || !['deviceIdSha256', 'producerPrincipalSha256', 'producerProfileSha256', 'verificationKeySpkiSha256',
      'verificationKeyArtifactSha256', 'commissioningProofSha256', 'independentReviewArtifactSha256']
      .every(key => typeof record[key] === 'string' && sha.test(record[key]))
    || !timestamp(record.commissionedAtUtc) || !timestamp(record.notBeforeUtc)
    || !(record.revokedAtUtc === null || timestamp(record.revokedAtUtc))
    || typeof record.operatorApprovalRef !== 'string'
    || !/^https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/(?:issues|pull)\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/.test(record.operatorApprovalRef)) return false;
  return true;
}

/** Verify only the pinned producer signature and observation lifetime.
 * This is NOT rotation admission. The original guarded transaction, immutable
 * terminal/proof bundle, real owner consent, source generations, full inventories
 * and phase-specific operation still require independent canonical validation.
 * There is intentionally no key/enrollment/clock/context options argument.
 */
export function verifyMailboxNativeEvidenceOriginV2(bytes) {
  let decoded;
  try { decoded = decodeMailboxNativeEvidenceV2(bytes); }
  catch { return held('MAILBOX_NATIVE_EVIDENCE_ENCODING_INVALID'); }
  const { envelope, artifactSha256 } = decoded;
  const heldHere = reason => held(reason, artifactSha256);
  const matches = enrollments.filter(record => record.enrollmentId === envelope.enrollmentId);
  if (matches.length !== 1) return heldHere('NATIVE_ROTATION_PRODUCER_UNQUALIFIED');
  const enrollment = matches[0];
  if (!validEnrollment(enrollment)) return heldHere('NATIVE_ROTATION_ENROLLMENT_INVALID');
  const payload = envelope.payload;
  if (enrollment.keyId !== envelope.keyId || ['repository', 'deviceIdSha256', 'producerId',
    'producerPrincipalSha256', 'producerProfileSha256'].some(key => enrollment[key] !== payload[key])) {
    return heldHere('NATIVE_ROTATION_PRODUCER_IDENTITY_MISMATCH');
  }
  const now = Date.now();
  const commissioned = Date.parse(enrollment.commissionedAtUtc), notBefore = Date.parse(enrollment.notBeforeUtc);
  const observed = Date.parse(payload.observedAtUtc), expires = Date.parse(payload.expiresAtUtc);
  const actionsObserved = Date.parse(payload.drain.actionsObservedAtUtc);
  if (enrollment.revokedAtUtc !== null || commissioned > now || notBefore > now
    || observed < commissioned || observed < notBefore) return heldHere('NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT');
  if (observed > now || now - observed > 120000 || expires <= observed || expires - observed > 120000
    || now >= expires || actionsObserved > observed || now - actionsObserved > 120000) {
    return heldHere('NATIVE_ROTATION_OBSERVATION_NOT_FRESH');
  }
  if (!Object.hasOwn(publicArtifacts, enrollment.keyId)) return heldHere('NATIVE_ROTATION_PUBLIC_ARTIFACT_MISSING');
  const artifact = publicArtifacts[enrollment.keyId];
  if (typeof artifact !== 'string' || Buffer.byteLength(artifact, 'utf8') > 4096
    || digest(Buffer.from(artifact, 'utf8')) !== enrollment.verificationKeyArtifactSha256) {
    return heldHere('NATIVE_ROTATION_PUBLIC_ARTIFACT_PIN_MISMATCH');
  }
  try {
    const key = createPublicKey(artifact);
    if (key.asymmetricKeyType !== 'ed25519'
      || digest(key.export({ type: 'spki', format: 'der' })) !== enrollment.verificationKeySpkiSha256) {
      return heldHere('NATIVE_ROTATION_PUBLIC_KEY_PIN_MISMATCH');
    }
    if (!verify(null, mailboxNativeEvidenceSignatureInputV2(payload), key, Buffer.from(envelope.signatureBase64, 'base64'))) {
      return heldHere('NATIVE_ROTATION_SIGNATURE_INVALID');
    }
  } catch { return heldHere('NATIVE_ROTATION_SIGNATURE_INVALID'); }
  return Object.freeze({ ok: true, blocker: 'ORIGINAL_GUARDED_TRANSACTION_PROOF_REQUIRED', artifactSha256,
    envelope, signatureVerified: true, producerEnrollmentVerified: true,
    nativeAuthorityVerified: false, freezeCertified: false, mergeAuthorized: false, sourceSyncAuthorized: false });
}
