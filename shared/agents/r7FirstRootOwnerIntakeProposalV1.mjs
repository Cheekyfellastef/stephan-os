import { createHash, createPublicKey } from 'node:crypto';

// Source proposal only. This validates a proposed intake packet; it does not
// authenticate artifact bytes, adopt host policy, mint tokens or admit an OS
// executor. In particular, source-merge approval is never host consent.
export const R7_FIRST_ROOT_INTAKE_MODE = 'user-owned-r7-first-root-policy-intake';
export const R7_FIRST_ROOT_INTAKE_PURPOSE = 'R7_FIRST_ROOT_OWNER_POLICY_INTAKE';
export const R7_FIRST_ROOT_INTAKE_AUDIENCE = 'stephanos:r7:first-root-owner-permit:v1:';
export const R7_FIRST_ROOT_PEER_PURPOSE = 'ENROLL_EPHEMERAL_R7_OWNER_POLICY_PEER_ONLY';
export const R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE = 'stephanos:r7:inactive-first-root-provisioning:v1:';
export const R7_INACTIVE_ROOT_PROVISIONING_PURPOSE = 'PROVISION_INACTIVE_R7_SIGNING_ROOTS_ONLY';
export const R7_FIRST_ROOT_INTAKE_WORKFLOW = 'Cheekyfellastef/stephan-os/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main';
export const R7_FIRST_ROOT_INTAKE_MISSING = Object.freeze([
  'R7_FIRST_ROOT_POLICY_ADOPTION_NOT_PROVEN',
  'R7_FIRST_ROOT_EXACT_REVIEW_ARTIFACT_AUTHENTICATION_NOT_IMPLEMENTED',
  'R7_FIRST_ROOT_PRIVATE_NATIVE_CHALLENGE_HANDOFF_NOT_IMPLEMENTED',
  'R7_FIRST_ROOT_PRIVATE_TOKEN_DELIVERY_NOT_IMPLEMENTED',
  'R7_FIRST_ROOT_NATIVE_OS_CONSENT_AND_EXECUTOR_ADMISSION_NOT_PROVEN',
]);
const NO_AUTHORITY = Object.freeze({
  policyAdopted: false, sourceMergeAuthorized: false, hostExecutionAuthorized: false,
  humanOsConsentProven: false, executorAdmitted: false, rootEnrollmentAuthorized: false,
  tokenIssuanceAuthorized: false, independentSignatureProven: false,
  canonicalLeaseReleaseAuthorized: false, approvalCardCreated: false,
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, wanted) => plain(value) && Object.keys(value).length === wanted.length
  && wanted.every(key => Object.hasOwn(value, key));
const hex = (value, length) => typeof value === 'string'
  && new RegExp('^[a-f0-9]{' + length + '}$').test(value) && !/^0+$/.test(value);
const decimal = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)
  && BigInt(value) <= 18446744073709551615n;
const stamp = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const result = (classification, blockers, extra = {}) => Object.freeze({
  schemaVersion: 'stephanos.r7-first-root-owner-intake-proposal-result.v1',
  classification, blockers: Object.freeze([...new Set(blockers)]), ...extra, ...NO_AUTHORITY,
});

// Two fixed native operations, selected only by their complete audience prefix.
// A caller purpose/boolean cannot upgrade the old peer-only challenge. This
// parser describes untrusted bindings; it grants neither operation by itself.
export function parseR7NativeOwnerAudience(value) {
  if (typeof value !== 'string') return null;
  const profile = [
    [R7_FIRST_ROOT_INTAKE_AUDIENCE, R7_FIRST_ROOT_PEER_PURPOSE],
    [R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE, R7_INACTIVE_ROOT_PROVISIONING_PURPOSE],
  ].find(([prefix]) => value.startsWith(prefix));
  if (!profile) return null;
  const [prefix, purpose] = profile, binding = value.slice(prefix.length).split(':');
  if (binding.length !== 3 || binding.some(part => !hex(part, 64))) return null;
  return Object.freeze({ prefix, purpose, permitSha256: binding[0], nonce: binding[1],
    recipientSpkiSha256: binding[2] });
}

// One canonical Node recipient profile shared by intake, peer binding and JWE.
// This is public-key shape validation, never native authentication or adoption.
export function r7FirstRootRecipientSpkiDigest(value) {
  if (typeof value !== 'string' || value.length < 128 || value.length > 1536
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return '';
  try {
    const der = Buffer.from(value, 'base64');
    if (der.toString('base64') !== value) return '';
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048
        || key.asymmetricKeyDetails?.publicExponent !== 65537n
        || !key.export({ format: 'der', type: 'spki' }).equals(der)) return '';
    return sha256(der);
  } catch { return ''; }
}

export function prepareR7FirstRootOwnerIntakeProposal({
  permitWire, permitSha256, nativeAudience, nativeRecipientSpkiBase64, dispatch, context, nowUtc,
} = {}) {
  const rejected = reason => result('R7_FIRST_ROOT_INTAKE_REJECTED', [reason]);
  if (typeof permitWire !== 'string' || Buffer.byteLength(permitWire) > 16384
      || !hex(permitSha256, 64) || sha256(permitWire) !== permitSha256)
    return rejected('PERMIT_BYTES_OR_DIGEST_INVALID');
  let p;
  try {
    p = JSON.parse(permitWire);
    // Reject duplicate keys, whitespace aliases and alternate numeric encodings.
    if (JSON.stringify(p) !== permitWire) return rejected('PERMIT_WIRE_NONCANONICAL');
  } catch { return rejected('PERMIT_WIRE_INVALID'); }
  if (!keys(p, ['schemaVersion', 'purpose', 'repository', 'capabilityIssue', 'prNumber',
      'requestId', 'original', 'candidate', 'review', 'hostPolicyProposalDigest',
      'fixedRecipeDigest', 'issuedAtUtc', 'expiresAtUtc'])
      || p.schemaVersion !== 'stephanos.r7-first-root-owner-intake-proposal.v1'
      || p.purpose !== R7_FIRST_ROOT_INTAKE_PURPOSE
      || p.repository !== 'Cheekyfellastef/stephan-os' || p.capabilityIssue !== 3123 || p.prNumber !== 3178
      || typeof p.requestId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{7,119}$/.test(p.requestId)
      || !hex(p.hostPolicyProposalDigest, 64) || !hex(p.fixedRecipeDigest, 64))
    return rejected('PERMIT_CLOSED_WORLD_IDENTITY_INVALID');
  const o = p.original;
  if (!keys(o, ['missionId', 'leaseId', 'leaseRevision', 'leaseDigest', 'sourceExecutionId',
      'branch', 'sourceHead', 'historicalOutcome'])
      || o.missionId !== 'critical-2962-elastic-goal'
      || o.leaseId !== 'critical-2962-elastic-goal-r7-lease' || o.leaseRevision !== 7
      || !hex(o.leaseDigest, 64)
      || typeof o.sourceExecutionId !== 'string'
      || !/^critical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}$/.test(o.sourceExecutionId)
      || o.branch !== 'openclaw/elastic-goal-2962'
      || o.sourceHead !== '4e5023eef829b285095db4eeb09d6f2b365e33e4'
      || o.historicalOutcome !== 'UNKNOWN')
    return rejected('ORIGINAL_MISSION_AND_LEASE_BINDING_INVALID');
  const c = p.candidate;
  if (!keys(c, ['branch', 'sourceHead', 'sourceTree', 'reviewedBase', 'sourceMergeCommit',
      'expectedMain', 'imageSha256', 'bundleSha256', 'manifestSha256'])
      || c.branch !== 'feature/3123-r7-registry-protection-readback-20261020'
      || ['sourceHead', 'sourceTree', 'reviewedBase', 'sourceMergeCommit', 'expectedMain']
        .some(key => !hex(c[key], 40))
      || ['imageSha256', 'bundleSha256', 'manifestSha256'].some(key => !hex(c[key], 64))
      || c.sourceHead === c.reviewedBase)
    return rejected('CANDIDATE_SOURCE_AND_IMAGE_BINDING_INVALID');
  const r = p.review;
  if (!keys(r, ['runId', 'runAttempt', 'artifactId', 'archiveSha256', 'payloadSha256',
      'reviewedSourceHead', 'reviewedSourceTree', 'reviewedBase'])
      || ['runId', 'runAttempt', 'artifactId'].some(key => !decimal(r[key]))
      || ['archiveSha256', 'payloadSha256'].some(key => !hex(r[key], 64))
      || r.reviewedSourceHead !== c.sourceHead || r.reviewedSourceTree !== c.sourceTree
      || r.reviewedBase !== c.reviewedBase)
    return rejected('EXACT_REVIEW_REFERENCE_BINDING_INVALID');
  const dispatchKeys = ['mode', 'pr_number', 'expected_branch', 'expected_head', 'expected_head_tree',
    'expected_base', 'independent_review_run_id', 'independent_review_run_attempt',
    'independent_review_artifact_id', 'independent_review_artifact_digest',
    'independent_review_payload_sha256', 'r7_owner_permit_json', 'r7_owner_permit_sha256',
    'r7_native_challenge_audience', 'r7_native_recipient_spki_base64'];
  if (!(keys(dispatch, dispatchKeys) || keys(dispatch, [...dispatchKeys, 'authorization_comment_id']))
      || (dispatch.authorization_comment_id !== undefined && dispatch.authorization_comment_id !== '')
      || dispatch.mode !== R7_FIRST_ROOT_INTAKE_MODE || dispatch.pr_number !== '3178'
      || dispatch.expected_branch !== c.branch || dispatch.expected_head !== c.sourceHead
      || dispatch.expected_head_tree !== c.sourceTree || dispatch.expected_base !== c.expectedMain
      || dispatch.independent_review_run_id !== r.runId
      || dispatch.independent_review_run_attempt !== r.runAttempt
      || dispatch.independent_review_artifact_id !== r.artifactId
      || dispatch.independent_review_artifact_digest !== 'sha256:' + r.archiveSha256
      || dispatch.independent_review_payload_sha256 !== r.payloadSha256
      || dispatch.r7_owner_permit_json !== permitWire
      || dispatch.r7_owner_permit_sha256 !== permitSha256
      || dispatch.r7_native_challenge_audience !== nativeAudience
      || dispatch.r7_native_recipient_spki_base64 !== nativeRecipientSpkiBase64)
    return rejected('DISPATCH_AND_PERMIT_BINDING_INVALID');
  if (![nowUtc, p.issuedAtUtc, p.expiresAtUtc].every(stamp)
      || Date.parse(p.issuedAtUtc) > Date.parse(nowUtc)
      || Date.parse(p.expiresAtUtc) <= Date.parse(nowUtc)
      || Date.parse(p.expiresAtUtc) - Date.parse(p.issuedAtUtc) > 300000
      || Date.parse(p.expiresAtUtc) <= Date.parse(p.issuedAtUtc))
    return rejected('INTAKE_VALIDITY_INVALID');
  const binding = parseR7NativeOwnerAudience(nativeAudience);
  const recipientDigest = r7FirstRootRecipientSpkiDigest(nativeRecipientSpkiBase64);
  if (!binding || binding.permitSha256 !== permitSha256
      || !recipientDigest || binding.recipientSpkiSha256 !== recipientDigest)
    return rejected('NATIVE_PURPOSE_AND_NONCE_BINDING_INVALID');
  // Supplied context is a fixture/preflight input, never native authentication.
  if (!keys(context, ['eventName', 'mode', 'repository', 'repositoryId', 'ownerId', 'actor',
      'actorId', 'triggeringActor', 'ref', 'sha', 'workflowRef', 'runId', 'runAttempt'])
      || context.eventName !== 'workflow_dispatch' || context.mode !== R7_FIRST_ROOT_INTAKE_MODE
      || context.repository !== p.repository || context.repositoryId !== '1179385578'
      || context.ownerId !== '267490109' || context.actor !== 'Cheekyfellastef'
      || context.actorId !== '267490109' || context.triggeringActor !== 'Cheekyfellastef'
      || context.ref !== 'refs/heads/main' || context.sha !== c.expectedMain
      || context.workflowRef !== R7_FIRST_ROOT_INTAKE_WORKFLOW
      || !decimal(context.runId) || !decimal(context.runAttempt))
    return rejected('EXACT_OWNER_WORKFLOW_CONTEXT_INVALID');
  return result('R7_FIRST_ROOT_INTAKE_PREPARED_HELD', R7_FIRST_ROOT_INTAKE_MISSING, {
    permitDigest: permitSha256, sourceHead: c.sourceHead, sourceTree: c.sourceTree,
    expectedMain: c.expectedMain, runId: context.runId, runAttempt: context.runAttempt,
    nativeOperationPurpose: binding.purpose,
    proposedReferencesConsistent: true,
    // This must remain false until actual artifact/run/merge/protection checks
    // exist. Shape checks and caller references are not authentic evidence.
    reviewArtifactAuthenticated: false, sourceAdoptionAuthenticated: false,
    nativeChallengeFreshnessAuthenticated: false,
  });
}
