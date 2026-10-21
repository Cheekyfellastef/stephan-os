import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';

// UNADOPTED POLICY CONTRACT PROPOSALS. This module is not connected to a host
// executor, key store, lease authority, policy-adoption endpoint or trust loader.
// Signature validity is not issuer enrollment or adoption.
export const R7_POLICY_PROPOSAL_DOMAIN = 'stephanos.r7-policy-proposal-signature.v1\0';
export const R7_POLICY_PROPOSAL_KINDS = Object.freeze([
  'exceptional-writer-enrollment', 'windows-commissioning-executor', 'independent-signing-custody',
]);
const hex = size => ({ type: 'string', pattern: '^[a-f0-9]{' + size + '}$',
  not: { const: '0'.repeat(size) } });
// Content identities and evidence references are different types. This shared
// source annotation drives semantic correlation and exported-schema traversal
// tests; no contract branch maintains its own selected reference list.
const evidenceRef = (scope = 'ALWAYS') => ({ ...hex(64), 'x-r7-evidence-reference': scope });
const id = { type: 'string', minLength: 8, maxLength: 120, pattern: '^[a-z0-9][a-z0-9._:-]*$' };
const sid = { type: 'string', minLength: 8, maxLength: 184, pattern: '^S-1-[1-9][0-9]*(?:-(?:0|[1-9][0-9]*)){1,15}$' };
const stamp = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$' };
const literal = value => ({ const: value });
const enumeration = (...values) => ({ enum: values });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems, uniqueItems: true });
const object = properties => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const original = object({
  repository: literal('Cheekyfellastef/stephan-os'), parentIssue: literal(2961), capabilityIssue: literal(3123),
  missionId: literal('critical-2962-elastic-goal'), leaseId: literal('critical-2962-elastic-goal-r7-lease'),
  revision: literal(7), leaseDigest: hex(64),
  sourceExecutionId: { type: 'string', pattern: '^critical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}$' },
  branch: literal('openclaw/elastic-goal-2962'),
  headSha: literal('4e5023eef829b285095db4eeb09d6f2b365e33e4'),
  worktreePath: { type: 'string', minLength: 4, maxLength: 240 },
  worktreeNativeIdentityDigest: hex(64),
});
const candidate = object({
  repository: literal('Cheekyfellastef/stephan-os'), capabilityIssue: literal(3123), prNumber: literal(3178),
  branch: literal('feature/3123-r7-registry-protection-readback-20261020'),
  baseSha: hex(40), sourceHead: hex(40), treeSha: hex(40),
  imageSha256: hex(64), bundleSha256: hex(64), manifestSha256: hex(64),
  serviceName: literal('StephanosOriginalR7CustodyWitness'),
});
const issuer = role => object({
  role: literal(role), keySpkiSha256: hex(64), enrollmentEvidenceDigest: evidenceRef(),
  adoptedPolicyDigest: evidenceRef(), currentRevocationDigest: evidenceRef(),
});
const evidence = object({
  evidenceId: id, evidenceDigest: hex(64), producerEnrollmentDigest: evidenceRef(),
  observedAtUtc: stamp,
});
const common = role => ({
  policyState: literal('PROPOSED_UNADOPTED'), policyVersion: literal(1),
  requestId: id, commandId: id, nonce: hex(64), issuedAtUtc: stamp, expiresAtUtc: stamp,
  original, candidate, issuer: issuer(role),
  historicalExecutionOutcome: literal('UNKNOWN'),
  historicalReceiptReconstructed: literal(false),
  evidence: array(evidence, 1, 16),
});
const enrollment = object({
  schemaVersion: literal('stephanos.r7-exceptional-writer-enrollment-proposal.v1'),
  ...common('ORIGINAL_MISSION_CUSTODY_POLICY_OWNER'),
  identityMode: enumeration('AUTHENTICATED_HISTORICAL_ENROLLMENT', 'PROSPECTIVE_COMPLETE_ESTATE', 'HISTORICAL_IDENTITY_UNKNOWN_SCOPE_INCOMPLETE'),
  enrolledPrincipalSids: array(sid, 0, 16),
  processBindings: array(object({
    principalSid: sid, processId: integer(1, 2147483647),
    creationFileTimeUtc: { type: 'string', pattern: '^[1-9][0-9]{15,19}$' },
    enrollmentEvidenceDigest: evidenceRef(), tokenObjectEvidenceDigest: evidenceRef(),
  }), 0, 16),
  consumedExecutionEvidenceDigest: evidenceRef(),
  prospectiveEstateEvidenceDigest: evidenceRef(),
  unknownIdentityPolicy: enumeration('NO_UNKNOWN_IDENTITY', 'PRESERVE_UNKNOWN_REQUIRE_COMPLETE_PROSPECTIVE_SCOPE', 'HOLD_SCOPE_INCOMPLETE'),
  handleLifetimeBasis: enumeration('AUTHENTICATED_CURRENT_HANDLE_MAPPING_DISPOSITION',
    'AUTHENTICATED_KERNEL_BOUNDARY_AND_COMPLETE_POST_BOOT_ESTATE'),
  bootBoundary: { ...object({
    currentKernelInstanceDigest: evidenceRef(), priorKernelObjectDispositionEvidenceDigest: evidenceRef(),
    writerTimeUpperBoundEvidenceDigest: evidenceRef(), bootTimeLowerBoundEvidenceDigest: evidenceRef(),
    clockProvenanceDigest: evidenceRef(), postBootEstateDispositionEvidenceDigest: evidenceRef(),
    latestPossiblePreBootWriterEndUtc: stamp, currentKernelStartLowerBoundUtc: stamp,
    reentryFenceEffectiveAtUtc: stamp, postBootDispositionObservedAtUtc: stamp,
  }), type: ['object', 'null'] },
  prospectiveScope: object({
    status: enumeration('CLAIMED_COMPLETE_UNVERIFIED', 'INCOMPLETE_UNKNOWN'),
    sourceBoundaryNativeDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'), principalCapabilityInventoryDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'),
    openHandleAndMappingDispositionDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'), detachedWriterDispositionDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'),
    reentryEstateDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'), sourceDenialProofDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'),
    continuityEvidenceDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'), queueQuiescenceDigest: evidenceRef('COMPLETE_PROSPECTIVE_SCOPE'),
  }),
  historicalIdentityAuthenticated: literal(false),
});
const executor = object({
  schemaVersion: literal('stephanos.r7-windows-commissioning-executor-proposal.v1'),
  ...common('PROTECTED_WINDOWS_COMMISSIONING_POLICY_OWNER'),
  executorSid: sid, witnessSid: sid, operatorSid: sid, originalPrincipalSids: array(sid, 1, 16),
  operations: array(enumeration('STAGE_DISABLED_FIXED_WITNESS', 'VERIFY_FIXED_DISABLED_STAGE',
    'COMMISSION_FIXED_PROSPECTIVE_CUSTODY'), 1, 3),
  originalEnrollmentDigest: evidenceRef(), independentReviewArtifactDigest: evidenceRef(),
  protectedSourceAdmissionDigest: evidenceRef(), protectedOperatorConsentDigest: evidenceRef(),
  executorEnrollmentDigest: evidenceRef(), fixedRecipeDigest: hex(64), physicalTestPlanDigest: hex(64),
  recoveryPlanDigest: hex(64), recoveryMode: literal('HOLD_DISABLED_PRESERVE_ARTIFACTS'),
  arbitraryCommandAllowed: literal(false), automaticRollbackAllowed: literal(false),
  sourceLeaseMutationAllowed: literal(false),
});
const signing = object({
  schemaVersion: literal('stephanos.r7-independent-signing-custody-proposal.v1'),
  ...common('INDEPENDENT_HOST_COMMISSIONING_ROOT'),
  witnessSid: sid, operatorSid: sid, executorSid: sid, originalPrincipalSids: array(sid, 1, 16),
  witnessKeySpkiSha256: hex(64), operatorKeySpkiSha256: hex(64),
  witnessDomain: literal('stephanos.legacy-orphan-os-witness.v1\0'),
  operatorDomain: literal('stephanos.legacy-orphan-operator-approval.v1\0'),
  providerProfile: literal('REVIEWED_PROTECTED_SERVICE_ED25519_PROVIDER'),
  providerImplementationDigest: hex(64), protectedStoragePolicyDigest: hex(64),
  keyEpoch: integer(1, 2147483647),
  lifecycle: enumeration('PROVISION', 'ROTATE', 'REVOKE'),
  predecessorCustodyDigest: { ...evidenceRef(), type: ['string', 'null'] },
  currentRevocationDigest: evidenceRef(),
  oldKeyDisposition: enumeration('NONE', 'DISABLED_AND_RETAINED_FOR_AUDIT'),
  physicalContainmentEvidenceDigest: evidenceRef(), protectedAuditContinuityDigest: evidenceRef(),
  operatorApprovalEvidenceDigest: evidenceRef(),
  arbitraryPayloadSigningAllowed: literal(false),
  sourceWorkerKeyAccessAllowed: literal(false),
  operatorMayUseWitnessKey: literal(false),
});
const schemas = Object.freeze({
  'exceptional-writer-enrollment': enrollment,
  'windows-commissioning-executor': executor,
  'independent-signing-custody': signing,
});
const noAuthority = Object.freeze({
  policyAdopted: false, issuerEnrolled: false, historicalIdentityAuthenticated: false,
  hostExecutionAuthorized: false, rootEnrollmentAuthorized: false,
  signatureIssuanceAuthorized: false, canonicalLeaseReleaseAuthorized: false,
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
  : JSON.stringify(value);
const same = (left, right) => stable(left) === stable(right);
const time = value => typeof value === 'string' && stamp.pattern
  && new RegExp(stamp.pattern).test(value) && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value ? Date.parse(value) : NaN;

export function r7CustodyContractProposalSchemaV1(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(schemas, kind)) throw new Error('R7_POLICY_PROPOSAL_KIND_UNSUPPORTED');
  return JSON.parse(JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:stephanos:r7-policy-proposal:' + kind + ':v1', ...schemas[kind],
    $comment: 'Shape alone cannot establish correlated evidence or principal independence; the semantic validator is mandatory and never grants authority.',
    ...(kind === 'exceptional-writer-enrollment' ? { allOf: [{
      if: { properties: { identityMode: { enum: [
        'AUTHENTICATED_HISTORICAL_ENROLLMENT', 'PROSPECTIVE_COMPLETE_ESTATE'
      ] } }, required: ['identityMode'] },
      then: { properties: { prospectiveScope: {
        properties: { status: { const: 'CLAIMED_COMPLETE_UNVERIFIED' } }
      } } }
    }] } : {}),
  }));
}

// Structural predicates are deliberately restricted to the schema vocabulary
// above. No executable expressions, user validators, file paths or commands.
function shape(value, spec, location, errors) {
  if ('const' in spec) { if (value !== spec.const) errors.push(location + ':const'); return; }
  if ('enum' in spec) { if (!spec.enum.includes(value)) errors.push(location + ':enum'); return; }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const expected = Array.isArray(spec.type) ? spec.type : [spec.type];
  if (!expected.includes(type) && !(expected.includes('integer') && Number.isSafeInteger(value))) {
    errors.push(location + ':type'); return;
  }
  if (type === 'null') return;
  if (type === 'string') {
    if (spec.not && value === spec.not.const) errors.push(location + ':placeholder');
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) errors.push(location + ':pattern');
    if (value.length < (spec.minLength ?? 0) || value.length > (spec.maxLength ?? 4096))
      errors.push(location + ':length');
  } else if (type === 'number') {
    if (!Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum)
      errors.push(location + ':range');
  } else if (type === 'array') {
    if (value.length < spec.minItems || value.length > spec.maxItems) { errors.push(location + ':budget'); return; }
    if (new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(location + ':duplicate');
    value.forEach((v, i) => shape(v, spec.items, location + '.' + i, errors));
  } else if (type === 'object') {
    if (Object.keys(value).length !== spec.required.length
        || Object.keys(value).some(k => !Object.hasOwn(spec.properties, k))) {
      errors.push(location + ':closed-world'); return;
    }
    for (const key of spec.required) shape(value[key], spec.properties[key], location + '.' + key, errors);
  }
}
function safeWorktree(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]:\\/.test(value)
      || value.includes('/') || value.slice(2).includes(':') || value.includes('\0')
      || path.win32.normalize(value) !== value) return false;
  return value.slice(3).split('\\').every(part => part.length > 0
    && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/[<>"|?*]/.test(part));
}
function result(valid, blockers, extra = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.r7-policy-proposal-verification.v1',
    validProposal: valid, status: valid ? 'PROPOSAL_STRUCTURALLY_VALID_UNADOPTED' : 'PROPOSAL_REJECTED',
    blockers: Object.freeze([...new Set(blockers)]), ...extra, ...noAuthority,
  });
}

function evidenceReferences(value, spec, completeScope, location = 'proposal', found = []) {
  if (value === null) return found;
  const reference = spec['x-r7-evidence-reference'];
  if (reference === 'ALWAYS' || (reference === 'COMPLETE_PROSPECTIVE_SCOPE' && completeScope))
    found.push({ location, digest: value });
  if (Array.isArray(value)) value.forEach((item, i) =>
    evidenceReferences(item, spec.items, completeScope, location + '.' + i, found));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value))
    evidenceReferences(item, spec.properties[key], completeScope, location + '.' + key, found);
  return found;
}

export function validateR7CustodyContractProposalV1(kind, wire, {
  nowUtc, expectedOriginal, expectedCandidate,
} = {}) {
  if (typeof kind !== 'string' || !Object.hasOwn(schemas, kind)) return result(false, ['CONTRACT_KIND_UNSUPPORTED']);
  if (typeof wire !== 'string' || Buffer.byteLength(wire) > 32 * 1024)
    return result(false, ['CONTRACT_WIRE_INVALID_OR_OVER_BUDGET']);
  let value;
  try {
    value = JSON.parse(wire);
    // Canonical wire prevents duplicate keys, whitespace aliases and alternate
    // numeric representations from sharing a signed claim interpretation.
    if (JSON.stringify(value) !== wire) return result(false, ['CONTRACT_WIRE_NONCANONICAL']);
  } catch { return result(false, ['CONTRACT_WIRE_INVALID']); }
  const errors = []; shape(value, schemas[kind], 'proposal', errors);
  if (errors.length) return result(false, ['CONTRACT_SHAPE_INVALID',
    ...(errors.some(error => error.endsWith(':placeholder')) ? ['PLACEHOLDER_IDENTITY_NOT_EVIDENCE'] : [])
  ], { fields: Object.freeze(errors.slice(0, 24)) });
  const issued = time(value.issuedAtUtc), expires = time(value.expiresAtUtc), now = time(nowUtc);
  if (![issued, expires, now].every(Number.isFinite) || issued > now || expires <= now
      || expires <= issued || expires - issued > 300_000) errors.push('VALIDITY_OR_CLOCK_UNPROVEN');
  if (!safeWorktree(value.original.worktreePath)) errors.push('WORKTREE_PATH_UNSAFE');
  if (value.candidate.baseSha === value.candidate.sourceHead) errors.push('CANDIDATE_NOT_A_CHANGE');
  if (expectedOriginal && !same(value.original, expectedOriginal)) errors.push('ORIGINAL_BINDING_MISMATCH');
  if (expectedCandidate && !same(value.candidate, expectedCandidate)) errors.push('CANDIDATE_BINDING_MISMATCH');
  const evidenceIds = value.evidence.map(e => e.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length
      || value.evidence.some(e => !Number.isFinite(time(e.observedAtUtc))
        || time(e.observedAtUtc) > issued || issued - time(e.observedAtUtc) > 300_000))
    errors.push('EVIDENCE_IDENTITY_OR_FRESHNESS_UNPROVEN');
  const evidenceDigests = new Set(value.evidence.map(e => e.evidenceDigest));
  if (evidenceDigests.size !== value.evidence.length) errors.push('EVIDENCE_DIGEST_AMBIGUOUS');
  const uncorrelated = evidenceReferences(value, schemas[kind],
    value.prospectiveScope?.status === 'CLAIMED_COMPLETE_UNVERIFIED')
    .filter(reference => !evidenceDigests.has(reference.digest)).map(reference => reference.location);
  if (uncorrelated.length) {
    errors.push('CONTRACT_EVIDENCE_REFERENCES_UNCORRELATED');
    if (uncorrelated.some(field => field.startsWith('proposal.bootBoundary.')))
      errors.push('BOOT_BOUNDARY_EVIDENCE_UNCORRELATED');
    if (uncorrelated.some(field => field.startsWith('proposal.prospectiveScope.')))
      errors.push('PROSPECTIVE_SCOPE_EVIDENCE_UNCORRELATED');
  }
  let policyDecisionRequired = false;
  if (kind === 'exceptional-writer-enrollment') {
    const known = value.identityMode === 'AUTHENTICATED_HISTORICAL_ENROLLMENT';
    // Historical identity never completes prospective handle/mapping,
    // detached-writer, re-entry or continuity coverage.
    if (value.identityMode !== 'HISTORICAL_IDENTITY_UNKNOWN_SCOPE_INCOMPLETE'
        && value.prospectiveScope.status !== 'CLAIMED_COMPLETE_UNVERIFIED')
      errors.push('COMPLETE_CORRELATED_PROSPECTIVE_ESTATE_REQUIRED');
    if (known && (!value.enrolledPrincipalSids.length || !value.processBindings.length
        || value.unknownIdentityPolicy !== 'NO_UNKNOWN_IDENTITY'
        || value.processBindings.some(p => !value.enrolledPrincipalSids.includes(p.principalSid))
        || value.enrolledPrincipalSids.some(s => !value.processBindings.some(p => p.principalSid === s))))
      errors.push('ENROLLMENT_PRINCIPAL_BINDING_INCOMPLETE');
    if (!known) {
      // The canonical exceptional verifier does not require a historic PID or
      // FILETIME. Complete prospective capability scope may be asserted without
      // reconstructing historical identity; actual physical proof is separate.
      if (value.processBindings.length) errors.push('UNKNOWN_HISTORY_MUST_NOT_INVENT_PROCESSES');
      if (value.identityMode === 'PROSPECTIVE_COMPLETE_ESTATE') {
        if (!value.enrolledPrincipalSids.length
            || value.unknownIdentityPolicy !== 'PRESERVE_UNKNOWN_REQUIRE_COMPLETE_PROSPECTIVE_SCOPE'
            || value.prospectiveScope.status !== 'CLAIMED_COMPLETE_UNVERIFIED')
          errors.push('PROSPECTIVE_ESTATE_SCOPE_INCOMPLETE');
      } else {
        policyDecisionRequired = true;
        if (value.unknownIdentityPolicy !== 'HOLD_SCOPE_INCOMPLETE'
            || value.prospectiveScope.status !== 'INCOMPLETE_UNKNOWN')
          errors.push('INCOMPLETE_SCOPE_MUST_HOLD');
      }
    }
    const boot = value.bootBoundary;
    if (value.handleLifetimeBasis === 'AUTHENTICATED_KERNEL_BOUNDARY_AND_COMPLETE_POST_BOOT_ESTATE') {
      if (!boot || ![boot.latestPossiblePreBootWriterEndUtc, boot.currentKernelStartLowerBoundUtc,
          boot.reentryFenceEffectiveAtUtc, boot.postBootDispositionObservedAtUtc].every(v => Number.isFinite(time(v)))
          || time(boot.latestPossiblePreBootWriterEndUtc) >= time(boot.currentKernelStartLowerBoundUtc)
          || time(boot.currentKernelStartLowerBoundUtc) > time(boot.postBootDispositionObservedAtUtc)
          || time(boot.reentryFenceEffectiveAtUtc) > time(boot.postBootDispositionObservedAtUtc)
          || time(boot.postBootDispositionObservedAtUtc) > issued
          || issued - time(boot.postBootDispositionObservedAtUtc) > 300_000
          || value.prospectiveScope.status !== 'CLAIMED_COMPLETE_UNVERIFIED')
        errors.push('BOOT_BOUNDARY_TIME_OR_POST_BOOT_SCOPE_UNPROVEN');
    } else if (boot !== null) errors.push('UNSELECTED_BOOT_EVIDENCE_FORBIDDEN');
  } else {
    // The executor is a role, not a required third account. Use the actual
    // admitted operator/fixed service profile; syntax is never host enrollment.
    if (!/^S-1-5-80-(?:[0-9]+-){4}[0-9]+$/.test(value.witnessSid)
        || !/^S-1-[1-9][0-9]*(?:-[0-9]+){2,15}$/.test(value.operatorSid))
      errors.push('FIXED_SERVICE_AND_LEGACY_OPERATOR_SID_REQUIRED');
    if (value.witnessSid === value.operatorSid || value.executorSid === value.witnessSid
        || [value.witnessSid, value.operatorSid, value.executorSid]
          .some(p => value.originalPrincipalSids.includes(p)))
      errors.push('PRINCIPALS_NOT_INDEPENDENT');
    if (kind === 'independent-signing-custody') {
      if (value.witnessKeySpkiSha256 === value.operatorKeySpkiSha256
          || value.witnessKeySpkiSha256 === value.issuer.keySpkiSha256)
        errors.push('SIGNING_ROOTS_NOT_INDEPENDENT');
      if (value.lifecycle === 'PROVISION'
          ? value.keyEpoch !== 1 || value.predecessorCustodyDigest !== null || value.oldKeyDisposition !== 'NONE'
          : value.keyEpoch < 2 || value.predecessorCustodyDigest === null
            || value.oldKeyDisposition !== 'DISABLED_AND_RETAINED_FOR_AUDIT')
        errors.push('KEY_LIFECYCLE_CHAIN_UNPROVEN');
      if (value.currentRevocationDigest !== value.issuer.currentRevocationDigest)
        errors.push('REVOCATION_SNAPSHOT_MISMATCH');
    }
  }
  return result(errors.length === 0, errors, {
    proposalDigest: sha(Buffer.from(wire)), contractKind: kind, policyDecisionRequired,
    replayKey: sha(Buffer.from(kind + '\0' + value.requestId + '\0' + value.nonce)),
    expectedBindingsCompared: Boolean(expectedOriginal && expectedCandidate),
    uncorrelatedEvidenceReferences: Object.freeze(uncorrelated.slice(0, 24)),
    canonicalVerifierChanged: false,
  });
}

// Verifies a domain-separated proposal signature against an out-of-band pin.
// This deliberately reports only cryptographic validity: it cannot enroll the
// pinned key, adopt policy, authenticate native observations or grant execution.
export function verifyR7CustodyProposalSignatureV1(kind, wire, signatureBase64,
  { publicKeyPem, keySpkiSha256, ...validationOptions } = {}) {
  const proposal = validateR7CustodyContractProposalV1(kind, wire, validationOptions);
  if (!proposal.validProposal) return Object.freeze({ ...proposal, signatureValid: false });
  try {
    if (typeof publicKeyPem !== 'string' || Buffer.byteLength(publicKeyPem) > 4096
        || !/^[a-f0-9]{64}$/.test(keySpkiSha256 || '')) throw new Error();
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519'
        || sha(key.export({ type: 'spki', format: 'der' })) !== keySpkiSha256
        || JSON.parse(wire).issuer.keySpkiSha256 !== keySpkiSha256) throw new Error();
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== signatureBase64
        || !verify(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + wire), key, signature))
      throw new Error();
    return Object.freeze({ ...proposal, signatureValid: true, ...noAuthority });
  } catch {
    return Object.freeze({ ...proposal, signatureValid: false,
      blockers: Object.freeze([...proposal.blockers, 'PROPOSAL_SIGNATURE_OR_OUT_OF_BAND_PIN_INVALID']), ...noAuthority });
  }
}
