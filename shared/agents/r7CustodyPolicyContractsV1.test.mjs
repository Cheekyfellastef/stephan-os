import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  R7_POLICY_PROPOSAL_DOMAIN, R7_POLICY_PROPOSAL_KINDS,
  r7CustodyContractProposalSchemaV1, validateR7CustodyContractProposalV1,
  verifyR7CustodyProposalSignatureV1,
} from './r7CustodyPolicyContractsV1.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const NOW = '2026-10-21T16:00:00.000Z';
const ISSUED = '2026-10-21T15:59:00.000Z';
const EXPIRES = '2026-10-21T16:04:00.000Z';
const originalSid = 'S-1-5-21-1-2-3-1001', executorSid = 'S-1-5-21-1-2-3-1002';
const operatorSid = 'S-1-5-21-1-2-3-1003', witnessSid = 'S-1-5-80-11-22-33-44-55';
// Ephemeral test keys only. Nothing is written to a host store or enrolled.
const key = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const pin = sha(key.publicKey.export({ type: 'spki', format: 'der' }));
const pem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const evidence = Array.from({ length: 8 }, (_, i) => ({
  evidenceId: 'proof-scope-' + i, evidenceDigest: sha('scope-' + i),
  producerEnrollmentDigest: sha('scope-0'), observedAtUtc: ISSUED,
}));
function base(kind) {
  const role = {
    'exceptional-writer-enrollment': 'ORIGINAL_MISSION_CUSTODY_POLICY_OWNER',
    'windows-commissioning-executor': 'PROTECTED_WINDOWS_COMMISSIONING_POLICY_OWNER',
    'independent-signing-custody': 'INDEPENDENT_HOST_COMMISSIONING_ROOT',
  }[kind];
  return {
    policyState: 'PROPOSED_UNADOPTED', policyVersion: 1,
    requestId: 'r7-policy-fixture-request', commandId: 'r7-policy-fixture-command',
    nonce: sha('fixture-nonce'), issuedAtUtc: ISSUED, expiresAtUtc: EXPIRES,
    original: {
      repository: 'Cheekyfellastef/stephan-os', parentIssue: 2961, capabilityIssue: 3123,
      missionId: 'critical-2962-elastic-goal', leaseId: 'critical-2962-elastic-goal-r7-lease',
      revision: 7, leaseDigest: sha('fixture-lease'),
      sourceExecutionId: 'critical-2962-elastic-goal-r1-0123456789ab',
      branch: 'openclaw/elastic-goal-2962', headSha: '4e5023eef829b285095db4eeb09d6f2b365e33e4',
      worktreePath: 'C:\\fixture-only\\source', worktreeNativeIdentityDigest: sha('native-fixture'),
    },
    candidate: {
      repository: 'Cheekyfellastef/stephan-os', capabilityIssue: 3123, prNumber: 3178,
      branch: 'feature/3123-r7-registry-protection-readback-20261020',
      baseSha: 'a'.repeat(40), sourceHead: 'b'.repeat(40), treeSha: 'c'.repeat(40),
      imageSha256: sha('image'), bundleSha256: sha('bundle'), manifestSha256: sha('manifest'),
      serviceName: 'StephanosOriginalR7CustodyWitness',
    },
    issuer: {
      role, keySpkiSha256: pin, enrollmentEvidenceDigest: evidence[0].evidenceDigest,
      adoptedPolicyDigest: evidence[1].evidenceDigest, currentRevocationDigest: evidence[2].evidenceDigest,
    },
    historicalExecutionOutcome: 'UNKNOWN', historicalReceiptReconstructed: false,
    evidence: structuredClone(evidence),
  };
}
function fixture(kind) {
  const common = base(kind);
  if (kind === 'exceptional-writer-enrollment') return {
    schemaVersion: 'stephanos.r7-exceptional-writer-enrollment-proposal.v1', ...common,
    identityMode: 'PROSPECTIVE_COMPLETE_ESTATE', enrolledPrincipalSids: [originalSid], processBindings: [],
    consumedExecutionEvidenceDigest: evidence[0].evidenceDigest,
    prospectiveEstateEvidenceDigest: evidence[1].evidenceDigest,
    unknownIdentityPolicy: 'PRESERVE_UNKNOWN_REQUIRE_COMPLETE_PROSPECTIVE_SCOPE',
    handleLifetimeBasis: 'AUTHENTICATED_CURRENT_HANDLE_MAPPING_DISPOSITION', bootBoundary: null,
    prospectiveScope: {
      status: 'CLAIMED_COMPLETE_UNVERIFIED',
      sourceBoundaryNativeDigest: evidence[0].evidenceDigest,
      principalCapabilityInventoryDigest: evidence[1].evidenceDigest,
      openHandleAndMappingDispositionDigest: evidence[2].evidenceDigest,
      detachedWriterDispositionDigest: evidence[3].evidenceDigest,
      reentryEstateDigest: evidence[4].evidenceDigest,
      sourceDenialProofDigest: evidence[5].evidenceDigest,
      continuityEvidenceDigest: evidence[6].evidenceDigest,
      queueQuiescenceDigest: evidence[7].evidenceDigest,
    },
    historicalIdentityAuthenticated: false,
  };
  if (kind === 'windows-commissioning-executor') return {
    schemaVersion: 'stephanos.r7-windows-commissioning-executor-proposal.v1', ...common,
    executorSid, witnessSid, operatorSid, originalPrincipalSids: [originalSid],
    operations: ['STAGE_DISABLED_FIXED_WITNESS', 'VERIFY_FIXED_DISABLED_STAGE'],
    originalEnrollmentDigest: evidence[0].evidenceDigest, independentReviewArtifactDigest: evidence[1].evidenceDigest,
    protectedSourceAdmissionDigest: evidence[2].evidenceDigest, protectedOperatorConsentDigest: evidence[3].evidenceDigest,
    executorEnrollmentDigest: evidence[4].evidenceDigest, fixedRecipeDigest: sha('recipe'),
    physicalTestPlanDigest: sha('physical-tests'), recoveryPlanDigest: sha('recovery'),
    recoveryMode: 'HOLD_DISABLED_PRESERVE_ARTIFACTS', arbitraryCommandAllowed: false,
    automaticRollbackAllowed: false, sourceLeaseMutationAllowed: false,
  };
  return {
    schemaVersion: 'stephanos.r7-independent-signing-custody-proposal.v1', ...common,
    witnessSid, operatorSid, executorSid, originalPrincipalSids: [originalSid],
    witnessKeySpkiSha256: sha('different-witness-key'), operatorKeySpkiSha256: pin,
    witnessDomain: 'stephanos.legacy-orphan-os-witness.v1\0',
    operatorDomain: 'stephanos.legacy-orphan-operator-approval.v1\0',
    providerProfile: 'REVIEWED_PROTECTED_SERVICE_ED25519_PROVIDER',
    providerImplementationDigest: sha('provider'), protectedStoragePolicyDigest: sha('storage'),
    keyEpoch: 1, lifecycle: 'PROVISION', predecessorCustodyDigest: null,
    currentRevocationDigest: common.issuer.currentRevocationDigest, oldKeyDisposition: 'NONE',
    physicalContainmentEvidenceDigest: evidence[3].evidenceDigest, protectedAuditContinuityDigest: evidence[4].evidenceDigest,
    operatorApprovalEvidenceDigest: evidence[5].evidenceDigest, arbitraryPayloadSigningAllowed: false,
    sourceWorkerKeyAccessAllowed: false, operatorMayUseWitnessKey: false,
  };
}
function validate(kind, value, options = {}) {
  return validateR7CustodyContractProposalV1(kind, JSON.stringify(value), { nowUtc: NOW, ...options });
}
function noAuthority(value) {
  for (const k of ['policyAdopted', 'issuerEnrolled', 'historicalIdentityAuthenticated',
    'hostExecutionAuthorized', 'rootEnrollmentAuthorized', 'signatureIssuanceAuthorized',
    'canonicalLeaseReleaseAuthorized']) assert.equal(value[k], false, k);
}
function reject(kind, mutate, blocker) {
  const value = fixture(kind); mutate(value); const r = validate(kind, value);
  assert.equal(r.validProposal, false, JSON.stringify(r));
  if (blocker) assert.ok(r.blockers.includes(blocker), JSON.stringify(r));
  noAuthority(r);
}

test('all three versioned closed-world contracts remain unadopted and non-executable', () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    const f = fixture(kind), r = validate(kind, f, { expectedOriginal: f.original, expectedCandidate: f.candidate });
    assert.equal(r.validProposal, true, JSON.stringify(r)); assert.equal(r.expectedBindingsCompared, true); noAuthority(r);
    const schema = r7CustodyContractProposalSchemaV1(kind);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.original.additionalProperties, false);
    assert.equal(schema.properties.issuer.additionalProperties, false);
    schema.properties.policyState.const = 'ADOPTED';
    assert.equal(r7CustodyContractProposalSchemaV1(kind).properties.policyState.const, 'PROPOSED_UNADOPTED');
  }
});

test('prospective complete estate needs no reconstructed historical PID or FILETIME', () => {
  const f = fixture('exceptional-writer-enrollment');
  assert.deepEqual(f.processBindings, []);
  const r = validate('exceptional-writer-enrollment', f);
  assert.equal(r.validProposal, true); assert.equal(r.policyDecisionRequired, false);
  assert.equal(r.canonicalVerifierChanged, false); noAuthority(r);
  // A schema-valid complete-scope assertion is still not authenticated evidence.
  assert.equal(r.status, 'PROPOSAL_STRUCTURALLY_VALID_UNADOPTED');
});

test('unknown/incomplete estate is explicit HOLD and cannot invent historical processes', () => {
  const kind = 'exceptional-writer-enrollment', f = fixture(kind);
  f.identityMode = 'HISTORICAL_IDENTITY_UNKNOWN_SCOPE_INCOMPLETE';
  f.enrolledPrincipalSids = []; f.unknownIdentityPolicy = 'HOLD_SCOPE_INCOMPLETE';
  f.prospectiveScope.status = 'INCOMPLETE_UNKNOWN';
  const r = validate(kind, f); assert.equal(r.validProposal, true); assert.equal(r.policyDecisionRequired, true); noAuthority(r);
  reject(kind, p => { p.processBindings.push({ principalSid: originalSid, processId: 123,
    creationFileTimeUtc: '134000000000000000', enrollmentEvidenceDigest: evidence[3].evidenceDigest,
    tokenObjectEvidenceDigest: evidence[4].evidenceDigest }); }, 'UNKNOWN_HISTORY_MUST_NOT_INVENT_PROCESSES');
});

test('historical process mode binds exact principal, PID and non-floating kernel time', () => {
  const kind = 'exceptional-writer-enrollment', f = fixture(kind);
  f.identityMode = 'AUTHENTICATED_HISTORICAL_ENROLLMENT'; f.unknownIdentityPolicy = 'NO_UNKNOWN_IDENTITY';
  f.processBindings = [{ principalSid: originalSid, processId: 123,
    creationFileTimeUtc: '134000000000000000', enrollmentEvidenceDigest: evidence[3].evidenceDigest,
    tokenObjectEvidenceDigest: evidence[4].evidenceDigest }];
  assert.equal(validate(kind, f).validProposal, true);
  f.processBindings[0].principalSid = executorSid;
  assert.ok(validate(kind, f).blockers.includes('ENROLLMENT_PRINCIPAL_BINDING_INCOMPLETE'));
  f.processBindings[0].creationFileTimeUtc = 134000000000000000;
  assert.equal(validate(kind, f).validProposal, false);
});

test('each prospective coverage domain needs correlated evidence; absent logs are not coverage', () => {
  for (const field of Object.keys(fixture('exceptional-writer-enrollment').prospectiveScope).filter(k => k !== 'status'))
    reject('exceptional-writer-enrollment', p => { p.prospectiveScope[field] = sha('no-evidence'); },
      'PROSPECTIVE_SCOPE_EVIDENCE_UNCORRELATED');
  reject('exceptional-writer-enrollment', p => { p.enrolledPrincipalSids = []; }, 'PROSPECTIVE_ESTATE_SCOPE_INCOMPLETE');
});

test('unknown properties and every added authority claim are rejected at all schema levels', () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    for (const field of ['authenticated', 'adopted', 'releaseLease', 'arbitraryShell', 'privateKeyPem'])
      reject(kind, p => { p[field] = true; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.issuer.authenticated = true; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.original.historicalPid = 123; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.candidate.serviceName = 'DifferentService'; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.historicalExecutionOutcome = 'COMPLETED'; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.historicalReceiptReconstructed = true; }, 'CONTRACT_SHAPE_INVALID');
    reject(kind, p => { p.policyState = 'ADOPTED'; }, 'CONTRACT_SHAPE_INVALID');
  }
});

test('replay, validity, evidence freshness and exact candidate/lease binding fail closed', () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    reject(kind, p => { p.expiresAtUtc = NOW; }, 'VALIDITY_OR_CLOCK_UNPROVEN');
    reject(kind, p => { p.issuedAtUtc = '2026-10-21T16:01:00.000Z'; }, 'VALIDITY_OR_CLOCK_UNPROVEN');
    reject(kind, p => { p.expiresAtUtc = '2026-10-22T16:04:00.000Z'; }, 'VALIDITY_OR_CLOCK_UNPROVEN');
    reject(kind, p => { p.evidence[0].observedAtUtc = EXPIRES; }, 'EVIDENCE_IDENTITY_OR_FRESHNESS_UNPROVEN');
    reject(kind, p => { p.evidence[1].evidenceId = p.evidence[0].evidenceId; }, 'EVIDENCE_IDENTITY_OR_FRESHNESS_UNPROVEN');
    reject(kind, p => { p.nonce = '0'.repeat(64); }, 'PLACEHOLDER_IDENTITY_NOT_EVIDENCE');
    const f = fixture(kind);
    assert.ok(validate(kind, f, { expectedOriginal: { ...f.original, leaseDigest: sha('different') } }).blockers.includes('ORIGINAL_BINDING_MISMATCH'));
    assert.ok(validate(kind, f, { expectedCandidate: { ...f.candidate, imageSha256: sha('different') } }).blockers.includes('CANDIDATE_BINDING_MISMATCH'));
    const repeat = validate(kind, f), changed = validate(kind, { ...f, nonce: sha('different') });
    assert.equal(repeat.replayKey, validate(kind, f).replayKey); assert.notEqual(repeat.replayKey, changed.replayKey);
  }
});

test('alternate worktree syntax cannot redirect a commissioning proposal', () => {
  for (const worktreePath of ['C:\\source\\..\\other', '\\\\server\\share', 'C:\\source:stream',
    'C:/source/path', 'C:\\source\\trailing.', 'C:\\source\\trailing ', 'C:\\source\\*']) {
    reject('windows-commissioning-executor', p => { p.original.worktreePath = worktreePath; }, 'WORKTREE_PATH_UNSAFE');
  }
});

test('executor scope, independent principals and controlled recovery cannot be widened', () => {
  const kind = 'windows-commissioning-executor';
  reject(kind, p => { p.operations = ['RUN_POWERSHELL']; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.operations.push(p.operations[0]); }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.arbitraryCommandAllowed = true; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.sourceLeaseMutationAllowed = true; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.automaticRollbackAllowed = true; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.operatorSid = p.witnessSid; }, 'PRINCIPALS_NOT_INDEPENDENT');
  reject(kind, p => { p.originalPrincipalSids.push(p.witnessSid); }, 'PRINCIPALS_NOT_INDEPENDENT');
  reject(kind, p => { p.witnessSid = 'S-1-5-21-1-2-3-1004'; }, 'FIXED_SERVICE_AND_LEGACY_OPERATOR_SID_REQUIRED');
});

test('provision, rotation and revocation require independent roots and predecessor continuity', () => {
  const kind = 'independent-signing-custody';
  reject(kind, p => { p.witnessKeySpkiSha256 = p.operatorKeySpkiSha256; }, 'SIGNING_ROOTS_NOT_INDEPENDENT');
  reject(kind, p => { p.witnessKeySpkiSha256 = p.issuer.keySpkiSha256; }, 'SIGNING_ROOTS_NOT_INDEPENDENT');
  reject(kind, p => { p.arbitraryPayloadSigningAllowed = true; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.witnessDomain += 'wrong'; }, 'CONTRACT_SHAPE_INVALID');
  reject(kind, p => { p.lifecycle = 'ROTATE'; }, 'KEY_LIFECYCLE_CHAIN_UNPROVEN');
  reject(kind, p => { p.currentRevocationDigest = sha('stale'); }, 'REVOCATION_SNAPSHOT_MISMATCH');
  for (const lifecycle of ['ROTATE', 'REVOKE']) {
    const f = fixture(kind); f.lifecycle = lifecycle; f.keyEpoch = 2;
    f.predecessorCustodyDigest = evidence[6].evidenceDigest; f.oldKeyDisposition = 'DISABLED_AND_RETAINED_FOR_AUDIT';
    const r = validate(kind, f); assert.equal(r.validProposal, true); noAuthority(r);
  }
});

test('real Ed25519 proposal signature plus out-of-band pin still grants no adoption or issuer role', () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    const wire = JSON.stringify(fixture(kind));
    const signature = sign(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + wire), key.privateKey).toString('base64');
    const options = { nowUtc: NOW, publicKeyPem: pem, keySpkiSha256: pin };
    const good = verifyR7CustodyProposalSignatureV1(kind, wire, signature, options);
    assert.equal(good.signatureValid, true, JSON.stringify(good)); noAuthority(good);
    assert.equal(verifyR7CustodyProposalSignatureV1(kind, wire, signature, { nowUtc: NOW }).signatureValid, false);
    assert.equal(verifyR7CustodyProposalSignatureV1(kind, wire, signature + '\n', options).signatureValid, false);
    const wrong = sign(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + wire), other.privateKey).toString('base64');
    assert.equal(verifyR7CustodyProposalSignatureV1(kind, wire, wrong, options).signatureValid, false);
    const domain = sign(null, Buffer.from('wrong-domain\0' + kind + '\0' + wire), key.privateKey).toString('base64');
    assert.equal(verifyR7CustodyProposalSignatureV1(kind, wire, domain, options).signatureValid, false);
    const mismatch = fixture(kind); mismatch.issuer.keySpkiSha256 = sha('claimed-different-key');
    const alteredWire = JSON.stringify(mismatch);
    const self = sign(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + alteredWire), key.privateKey).toString('base64');
    assert.equal(verifyR7CustodyProposalSignatureV1(kind, alteredWire, self, options).signatureValid, false);
  }
});

test('wire budgets, duplicate keys and unsupported schema cannot be interpreted as policy', () => {
  const kind = 'windows-commissioning-executor', wire = JSON.stringify(fixture(kind));
  assert.equal(validateR7CustodyContractProposalV1(kind, wire.replace('{', '{"policyState":"ADOPTED",'), { nowUtc: NOW }).validProposal, false);
  assert.equal(validateR7CustodyContractProposalV1(kind, ' '.repeat(32769), { nowUtc: NOW }).validProposal, false);
  assert.equal(validateR7CustodyContractProposalV1('unknown', wire, { nowUtc: NOW }).validProposal, false);
  assert.equal(validateR7CustodyContractProposalV1(kind, wire + '\n', { nowUtc: NOW }).validProposal, false);
});

test('boot-boundary proposal requires authenticated time bounds and complete post-boot estate, never uptime arithmetic', () => {
  const kind = 'exceptional-writer-enrollment', f = fixture(kind);
  f.handleLifetimeBasis = 'AUTHENTICATED_KERNEL_BOUNDARY_AND_COMPLETE_POST_BOOT_ESTATE';
  f.bootBoundary = {
    currentKernelInstanceDigest: evidence[0].evidenceDigest,
    priorKernelObjectDispositionEvidenceDigest: evidence[1].evidenceDigest,
    writerTimeUpperBoundEvidenceDigest: evidence[2].evidenceDigest,
    bootTimeLowerBoundEvidenceDigest: evidence[3].evidenceDigest,
    clockProvenanceDigest: evidence[4].evidenceDigest,
    postBootEstateDispositionEvidenceDigest: evidence[5].evidenceDigest,
    latestPossiblePreBootWriterEndUtc: '2026-10-10T04:50:00.000Z',
    currentKernelStartLowerBoundUtc: '2026-10-11T23:37:00.000Z',
    reentryFenceEffectiveAtUtc: '2026-10-21T15:58:00.000Z',
    postBootDispositionObservedAtUtc: ISSUED,
  };
  const good = validate(kind, f); assert.equal(good.validProposal, true); noAuthority(good);
  for (const mutate of [
    p => { p.bootBoundary = null; },
    p => { p.bootBoundary.currentKernelStartLowerBoundUtc = p.bootBoundary.latestPossiblePreBootWriterEndUtc; },
    p => { p.bootBoundary.reentryFenceEffectiveAtUtc = EXPIRES; },
    p => { p.prospectiveScope.status = 'INCOMPLETE_UNKNOWN'; },
    p => { p.bootBoundary.writerTimeUpperBoundEvidenceDigest = sha('lease-acquisition-is-not-execution-time'); },
    p => { p.bootBoundary.uptimeSeconds = 834695; },
  ]) {
    const bad = structuredClone(f); mutate(bad);
    const r = validate(kind, bad); assert.equal(r.validProposal, false, JSON.stringify(r)); noAuthority(r);
  }
  const stale = structuredClone(f); stale.bootBoundary.postBootDispositionObservedAtUtc = '2026-10-20T15:59:00.000Z';
  // Old disposition evidence cannot establish current continuity merely by
  // reusing a recent envelope. Require a current post-boot disposition sample.
  const before = validate(kind, stale);
  assert.equal(before.validProposal, false);
});

test('canonical consumed r1 execution identity stays distinct from held lease revision7', () => {
  const kind = 'exceptional-writer-enrollment', f = fixture(kind);
  assert.equal(f.original.revision, 7);
  assert.match(f.original.sourceExecutionId, /-r1-/);
  const expectedOriginal = structuredClone(f.original);
  const accepted = validate(kind, f, { expectedOriginal, expectedCandidate: f.candidate });
  assert.equal(accepted.validProposal, true); noAuthority(accepted);
  f.original.sourceExecutionId = f.original.sourceExecutionId.replace('-r1-', '-r7-');
  const rejected = validate(kind, f, { expectedOriginal, expectedCandidate: f.candidate });
  assert.equal(rejected.validProposal, false);
  assert.ok(rejected.blockers.includes('ORIGINAL_BINDING_MISMATCH')); noAuthority(rejected);
});

test('existing operator/root can own commissioning; no accidental third account or third root is required', () => {
  for (const kind of ['windows-commissioning-executor', 'independent-signing-custody']) {
    const sameOperator = fixture(kind); sameOperator.executorSid = sameOperator.operatorSid;
    const r = validate(kind, sameOperator); assert.equal(r.validProposal, true, JSON.stringify(r)); noAuthority(r);
    // This permits a profile shape only, not privileged service admission.
    for (const sid of ['S-1-5-18', 'S-1-5-80-66-77-88-99-11']) {
      const service = fixture(kind); service.executorSid = sid;
      const result = validate(kind, service); assert.equal(result.validProposal, true); noAuthority(result);
    }
  }
  const signing = fixture('independent-signing-custody');
  assert.equal(signing.operatorKeySpkiSha256, signing.issuer.keySpkiSha256);
  assert.notEqual(signing.operatorKeySpkiSha256, signing.witnessKeySpkiSha256);
  const r = validate('independent-signing-custody', signing);
  assert.equal(r.validProposal, true); noAuthority(r);
});

test('schema exports reject inherited object names and non-string selectors', () => {
  for (const kind of ['__proto__', 'constructor', 'toString', null, {}]) {
    assert.throws(() => r7CustodyContractProposalSchemaV1(kind), /KIND_UNSUPPORTED/);
    const r = validateR7CustodyContractProposalV1(kind, '{}', { nowUtc: NOW });
    assert.equal(r.validProposal, false); noAuthority(r);
  }
});

test('authenticated historical enrollment cannot bypass complete correlated prospective estate', () => {
  const kind = 'exceptional-writer-enrollment';
  const historical = () => {
    const f = fixture(kind);
    f.identityMode = 'AUTHENTICATED_HISTORICAL_ENROLLMENT';
    f.unknownIdentityPolicy = 'NO_UNKNOWN_IDENTITY';
    f.processBindings = [{ principalSid: originalSid, processId: 123,
      creationFileTimeUtc: '134000000000000000', enrollmentEvidenceDigest: evidence[3].evidenceDigest,
      tokenObjectEvidenceDigest: evidence[4].evidenceDigest }];
    return f;
  };
  const complete = historical();
  assert.equal(validate(kind, complete).validProposal, true);
  const incomplete = historical();
  incomplete.prospectiveScope.status = 'INCOMPLETE_UNKNOWN';
  for (const field of Object.keys(incomplete.prospectiveScope).filter(k => k !== 'status'))
    incomplete.prospectiveScope[field] = sha('uncorrelated-' + field);
  const held = validate(kind, incomplete);
  assert.equal(held.validProposal, false);
  assert.ok(held.blockers.includes('COMPLETE_CORRELATED_PROSPECTIVE_ESTATE_REQUIRED'));
  noAuthority(held);
  for (const field of Object.keys(complete.prospectiveScope).filter(k => k !== 'status')) {
    const bad = historical(); bad.prospectiveScope[field] = sha('uncorrelated-' + field);
    const rejected = validate(kind, bad);
    assert.equal(rejected.validProposal, false);
    assert.ok(rejected.blockers.includes('PROSPECTIVE_SCOPE_EVIDENCE_UNCORRELATED'));
    noAuthority(rejected);
  }
  const schema = r7CustodyContractProposalSchemaV1(kind);
  assert.ok(schema.allOf[0].if.properties.identityMode.enum.includes('AUTHENTICATED_HISTORICAL_ENROLLMENT'));
  assert.equal(schema.allOf[0].then.properties.prospectiveScope.properties.status.const, 'CLAIMED_COMPLETE_UNVERIFIED');
});

test('read-only witness cannot be its commissioning executor; operator or admitted fixed route can', () => {
  for (const kind of ['windows-commissioning-executor', 'independent-signing-custody']) {
    const self = fixture(kind); self.executorSid = self.witnessSid;
    const rejected = validate(kind, self);
    assert.equal(rejected.validProposal, false);
    assert.ok(rejected.blockers.includes('PRINCIPALS_NOT_INDEPENDENT')); noAuthority(rejected);
    for (const executor of [operatorSid, 'S-1-5-80-66-77-88-99-11', 'S-1-5-18']) {
      const allowed = fixture(kind); allowed.executorSid = executor;
      const r = validate(kind, allowed); assert.equal(r.validProposal, true); noAuthority(r);
    }
  }
});

test('all digest identities reject placeholders across every contract and signature wrapper', () => {
  let cases = 0;
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    const original = fixture(kind), schema = r7CustodyContractProposalSchemaV1(kind);
    const paths = [];
    function visit(value, spec, path = []) {
      if (typeof value === 'string' && [40, 64].some(size => spec.pattern === '^[a-f0-9]{' + size + '}$')) {
        assert.equal(spec.not.const, '0'.repeat(value.length), path.join('.'));
        paths.push(path);
      } else if (Array.isArray(value)) value.forEach((v, i) => visit(v, spec.items, [...path, i]));
      else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) visit(v, spec.properties[k], [...path, k]);
    }
    visit(original, schema);
    for (const path of paths) {
      const bad = structuredClone(original);
      let parent = bad;
      for (const key of path.slice(0, -1)) parent = parent[key];
      const name = path.at(-1);
      parent[name] = '0'.repeat(parent[name].length);
      const rejected = validate(kind, bad);
      assert.equal(rejected.validProposal, false, kind + ':' + path.join('.'));
      assert.ok(rejected.blockers.includes('PLACEHOLDER_IDENTITY_NOT_EVIDENCE'));
      noAuthority(rejected);
      const wire = JSON.stringify(bad);
      const signature = sign(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + wire), key.privateKey).toString('base64');
      const signed = verifyR7CustodyProposalSignatureV1(kind, wire, signature, {
        publicKeyPem: pem, keySpkiSha256: pin, nowUtc: NOW,
      });
      assert.equal(signed.signatureValid, false, kind + ':' + path.join('.'));
      noAuthority(signed); cases++;
    }
    assert.ok(paths.some(p => p.join('.') === 'evidence.0.producerEnrollmentDigest'));
    assert.ok(paths.some(p => p.join('.') === 'evidence.0.evidenceDigest'));
  }
  assert.ok(cases >= 100, 'all authority-bearing digest fields exercised: ' + cases);
  // Nullable predecessor uses the same non-placeholder definition when present.
  const rotated = fixture('independent-signing-custody');
  Object.assign(rotated, { lifecycle: 'ROTATE', keyEpoch: 2,
    predecessorCustodyDigest: '0'.repeat(64), oldKeyDisposition: 'DISABLED_AND_RETAINED_FOR_AUDIT' });
  assert.equal(validate('independent-signing-custody', rotated).validProposal, false);
});

test('every declared evidence reference resolves in all contract and lifecycle variants, including signed wires', () => {
  const variants = R7_POLICY_PROPOSAL_KINDS.map(kind => [kind, fixture(kind)]);
  const historical = fixture('exceptional-writer-enrollment');
  historical.identityMode = 'AUTHENTICATED_HISTORICAL_ENROLLMENT';
  historical.unknownIdentityPolicy = 'NO_UNKNOWN_IDENTITY';
  historical.processBindings = [{ principalSid: originalSid, processId: 123,
    creationFileTimeUtc: '134000000000000000', enrollmentEvidenceDigest: evidence[3].evidenceDigest,
    tokenObjectEvidenceDigest: evidence[4].evidenceDigest }];
  variants.push(['exceptional-writer-enrollment', historical]);
  const boot = fixture('exceptional-writer-enrollment');
  boot.handleLifetimeBasis = 'AUTHENTICATED_KERNEL_BOUNDARY_AND_COMPLETE_POST_BOOT_ESTATE';
  boot.bootBoundary = {
    currentKernelInstanceDigest: evidence[0].evidenceDigest,
    priorKernelObjectDispositionEvidenceDigest: evidence[1].evidenceDigest,
    writerTimeUpperBoundEvidenceDigest: evidence[2].evidenceDigest,
    bootTimeLowerBoundEvidenceDigest: evidence[3].evidenceDigest,
    clockProvenanceDigest: evidence[4].evidenceDigest,
    postBootEstateDispositionEvidenceDigest: evidence[5].evidenceDigest,
    latestPossiblePreBootWriterEndUtc: '2026-10-10T04:50:00.000Z',
    currentKernelStartLowerBoundUtc: '2026-10-11T23:37:00.000Z',
    reentryFenceEffectiveAtUtc: '2026-10-21T15:58:00.000Z', postBootDispositionObservedAtUtc: ISSUED,
  };
  variants.push(['exceptional-writer-enrollment', boot]);
  for (const lifecycle of ['ROTATE', 'REVOKE']) {
    const previous = fixture('independent-signing-custody');
    Object.assign(previous, { lifecycle, keyEpoch: 2, predecessorCustodyDigest: evidence[6].evidenceDigest,
      oldKeyDisposition: 'DISABLED_AND_RETAINED_FOR_AUDIT' });
    variants.push(['independent-signing-custody', previous]);
  }
  let exercised = 0;
  for (const [kind, original] of variants) {
    assert.equal(validate(kind, original).validProposal, true);
    const paths = [];
    function visit(value, spec, path = []) {
      if (value === null) return;
      if (spec['x-r7-evidence-reference']) paths.push(path);
      if (Array.isArray(value)) value.forEach((item, i) => visit(item, spec.items, [...path, i]));
      else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value))
        visit(item, spec.properties[name], [...path, name]);
    }
    visit(original, r7CustodyContractProposalSchemaV1(kind));
    for (const required of ['issuer.enrollmentEvidenceDigest', 'issuer.adoptedPolicyDigest',
      'issuer.currentRevocationDigest', 'evidence.0.producerEnrollmentDigest'])
      assert.ok(paths.some(path => path.join('.') === required), kind + ':' + required);
    if (kind === 'windows-commissioning-executor') for (const required of ['originalEnrollmentDigest',
      'independentReviewArtifactDigest', 'protectedSourceAdmissionDigest', 'protectedOperatorConsentDigest',
      'executorEnrollmentDigest']) assert.ok(paths.some(path => path.join('.') === required));
    if (kind === 'independent-signing-custody') for (const required of ['physicalContainmentEvidenceDigest',
      'protectedAuditContinuityDigest', 'operatorApprovalEvidenceDigest', 'currentRevocationDigest'])
      assert.ok(paths.some(path => path.join('.') === required));
    for (const path of paths) {
      const bad = structuredClone(original); let parent = bad;
      for (const name of path.slice(0, -1)) parent = parent[name];
      parent[path.at(-1)] = sha('uncorrelated:' + kind + ':' + path.join('.'));
      const rejected = validate(kind, bad);
      assert.equal(rejected.validProposal, false, kind + ':' + path.join('.'));
      assert.ok(rejected.blockers.includes('CONTRACT_EVIDENCE_REFERENCES_UNCORRELATED'));
      assert.ok(rejected.uncorrelatedEvidenceReferences.includes('proposal.' + path.join('.')));
      noAuthority(rejected);
      const wire = JSON.stringify(bad);
      const signature = sign(null, Buffer.from(R7_POLICY_PROPOSAL_DOMAIN + kind + '\0' + wire), key.privateKey).toString('base64');
      const signed = verifyR7CustodyProposalSignatureV1(kind, wire, signature,
        { publicKeyPem: pem, keySpkiSha256: pin, nowUtc: NOW });
      assert.equal(signed.signatureValid, false); noAuthority(signed); exercised++;
    }
  }
  assert.ok(exercised >= 130, 'declared reference traversal count: ' + exercised);
});

test('ambiguous evidence identities, missing producer enrollment and stale records never correlate', () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    reject(kind, p => { p.evidence.push({ ...p.evidence[0], evidenceId: 'different-fixture-identity' }); },
      'EVIDENCE_DIGEST_AMBIGUOUS');
    reject(kind, p => { p.evidence[0].producerEnrollmentDigest = sha('absent-producer'); },
      'CONTRACT_EVIDENCE_REFERENCES_UNCORRELATED');
    reject(kind, p => { p.evidence[0].observedAtUtc = '2026-10-20T15:59:00.000Z'; },
      'EVIDENCE_IDENTITY_OR_FRESHNESS_UNPROVEN');
  }
  const held = fixture('exceptional-writer-enrollment');
  Object.assign(held, { identityMode: 'HISTORICAL_IDENTITY_UNKNOWN_SCOPE_INCOMPLETE',
    enrolledPrincipalSids: [], unknownIdentityPolicy: 'HOLD_SCOPE_INCOMPLETE' });
  held.prospectiveScope.status = 'INCOMPLETE_UNKNOWN';
  for (const name of Object.keys(held.prospectiveScope).filter(name => name !== 'status'))
    held.prospectiveScope[name] = sha('explicit-unknown-scope:' + name);
  const decision = validate('exceptional-writer-enrollment', held);
  assert.equal(decision.validProposal, true); assert.equal(decision.policyDecisionRequired, true); noAuthority(decision);
});

test('persisted proposal schemas carry the same evidence-reference model as semantic validation', async () => {
  for (const kind of R7_POLICY_PROPOSAL_KINDS) {
    const saved = JSON.parse(await readFile(new URL('./r7-custody-contract-proposals/' + kind + '.schema.json', import.meta.url), 'utf8'));
    assert.deepEqual(saved, r7CustodyContractProposalSchemaV1(kind));
  }
});
