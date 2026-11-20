import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOVEREIGN_SPECIALIST_ENROLLMENTS_V1, SOVEREIGN_SPECIALIST_PUBLIC_ARTIFACTS_V1 } from './sovereignQualifiedSpecialistEnrollmentV1.mjs';
import { validateSovereignQualifiedSpecialistArtifactV1 as productionValidate,
  SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1 as domains, sovereignSpecialistDigestV1 as hashObject } from './sovereignQualifiedSpecialistReviewV1.mjs';
import { makeFixture, resealFixture, sealOuter, signProof, sha, sourceBinding,
  isolatedModules, commentFor, findingsFor } from './fixtures/sovereign-qualified-specialist-fixture-v1.mjs';

function noMutation(result) {
  for (const key of ['mergeAuthority', 'operatorApprovalAuthority', 'sourceMutationAllowed', 'runtimeMutationAllowed',
    'reviewerEnrollmentAuthority', 'leaseReleaseAuthority', 'physicalPickupProven']) assert.equal(result[key], false, key);
}
const validate = async f => (await isolatedModules(f)).verifier.validateSovereignQualifiedSpecialistArtifactV1(f.artifact, f.expected);
const adjudicate = async (f, changes = {}) => (await isolatedModules(f)).qualified.adjudicateQualifiedSpecialistReview({
  ...f.expected, analysis: findingsFor(f), codexRequired: false, reviews: [], comments: [commentFor(f)], ...changes,
});

test('production has no enrolled identity; caller key, clock and provisioning claims cannot grant one', () => {
  const f = makeFixture();
  assert.deepEqual(SOVEREIGN_SPECIALIST_ENROLLMENTS_V1, []);
  assert.deepEqual(SOVEREIGN_SPECIALIST_PUBLIC_ARTIFACTS_V1, {});
  assert(Object.isFrozen(SOVEREIGN_SPECIALIST_ENROLLMENTS_V1));
  const result = productionValidate(f.artifact, { ...f.expected, enrollment: f.record, publicArtifacts: f.artifacts,
    provisioningVerified: true, qualifiedWindowsSpecialist: true, now: f.now });
  assert.equal(result.valid, false);
  assert.deepEqual(result.blockers, ['SOVEREIGN_SPECIALIST_NOT_ENROLLED']);
  assert.equal(result.liveSourceBindingVerified, false); noMutation(result);
});

test('isolated cryptographic fixture accepts only complete source/native/model/execution evidence without mutation authority', async () => {
  const f = makeFixture(), result = await validate(f);
  assert.equal(result.valid, true, result.blockers.join(','));
  assert.equal(result.liveSourceBindingVerified, true);
  assert.equal(result.signatureVerified, true); assert.equal(result.nativeEvidenceAccepted, true); noMutation(result);
});

test('pure artifact revalidation is narrower than live adjudication and reports the missing live binding', async () => {
  const f = makeFixture(), modules = await isolatedModules(f);
  const result = modules.qualified.validateQualifiedSpecialistReviewArtifact(f.artifact, f.identity);
  assert.equal(result.valid, true); assert.equal(result.liveSourceBindingVerified, false); noMutation(result);
  const decision = await adjudicate(f, { sovereignSourceBinding: undefined });
  assert.equal(decision.valid, false); assert.equal(decision.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert(decision.blockers.includes('SOVEREIGN_SPECIALIST_LIVE_SOURCE_BINDING_REQUIRED'));
  assert.deepEqual(decision.analysis.findings, findingsFor(f).findings);
});

test('existing consumer seals native fixture with Codex disabled and existing immutable artifact revalidates it', async () => {
  const f = makeFixture(), modules = await isolatedModules(f);
  const decision = modules.qualified.adjudicateQualifiedSpecialistReview({ ...f.expected, analysis: findingsFor(f),
    codexRequired: false, reviews: [], comments: [commentFor(f)] });
  assert.equal(decision.valid, true, decision.blockers.join(','));
  assert.equal(decision.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');
  const artifact = modules.artifact.buildIndependentReviewArtifact({ ...f.identity, workflowRunId: 9001,
    workflowRunAttempt: 1, createdAtUtc: new Date(f.now).toISOString(), analysis: decision.analysis,
    specialistReviewArtifact: decision.artifact });
  const checked = modules.artifact.validateIndependentReviewArtifact(artifact, { ...f.identity,
    expectedHead: f.identity.sourceHead, expectedBaseSha: f.identity.baseSha, workflowRunId: 9001, workflowRunAttempt: 1 });
  assert.equal(checked.valid, true, checked.blockers.join(','));
  assert.equal(checked.specialist.liveSourceBindingVerified, false);
  // Pure artifact validity still requires real run/job/archive provenance at
  // the unchanged protected consumer; this test creates no such hosted proof.
  assert.equal(artifact.specialistReviewArtifact.payloadSha256, f.artifact.payloadSha256);
});

test('native specialist evidence cannot erase semantic findings or an unrelated bootstrap P0', async () => {
  const f = makeFixture(), original = findingsFor(f);
  original.findings.push({ severity: 'P1', code: 'real-semantic-defect', path: f.artifact.escalationPaths[0], summary: 'Fixture real defect remains.' });
  original.counts.P1 = 1;
  const decision = await adjudicate(f, { analysis: original });
  assert.equal(decision.valid, false); assert.deepEqual(decision.analysis.findings, original.findings);
  const bootstrap = findingsFor(f);
  bootstrap.findings.push({ severity: 'P0', code: 'operator-approval-boundary-bootstrap-required', path: 'scripts/protected-policy.mjs', summary: 'Separate protected bootstrap.' });
  bootstrap.counts.P0 += 1;
  const mixed = await adjudicate(f, { analysis: bootstrap });
  assert.equal(mixed.valid, true); assert.equal(mixed.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert.deepEqual(mixed.analysis.findings.map(item => item.code), ['operator-approval-boundary-bootstrap-required']);
});

for (const [name, mutate] of [
  ['duplicate enrolled identity', f => f.records.push({ ...f.record })],
  ['self-enrollment using the reviewer as auditor', f => { f.record.auditorPrincipal = f.record.reviewerPrincipal; f.record.auditorPrincipalSha256 = f.record.reviewerPrincipalSha256; }],
  ['one signing key reused for reviewer and witness', f => { f.record.keys.witness = f.record.keys.reviewer; }],
  ['revoked reviewer identity', f => { f.record.revokedAtUtc = new Date(f.now - 1000).toISOString(); }],
  ['future revocation is still a hold', f => { f.record.revokedAtUtc = new Date(f.now + 60000).toISOString(); }],
  ['expired enrollment', f => { f.record.expiresAtUtc = new Date(f.now - 1000).toISOString(); }],
  ['uncommissioned future enrollment', f => { f.record.notBeforeUtc = new Date(f.now + 60000).toISOString(); }],
  ['missing public key artifact', f => { delete f.artifacts[f.record.keys.witness.keyId]; }],
  ['changed public-key bytes', f => { f.artifacts[f.record.keys.auditor.keyId] += '\n'; }],
  ['model digest changed after qualification', f => { f.record.modelDigestSha256 = sha('different-model'); }],
  ['insufficient qualified diff bound', f => { f.record.maxDiffBytes = 1; }],
]) test(name, async () => {
  const f = makeFixture(); mutate(f); const result = await validate(f);
  assert.equal(result.valid, false); noMutation(result);
});

for (const [name, mutate] of [
  ['failed 13-case Windows calibration', f => { f.artifact.windowsCalibration.result.passedCases = 12; }],
  ['candidate model falsely declares itself qualified', f => { f.artifact.windowsCalibration.result.qualifiedWindowsSpecialist = true; }],
  ['missing independently signed capability challenge', f => { f.artifact.capabilityExam.receipts.pop(); }],
  ['failed 10-case baseline model calibration', f => { f.artifact.baselineCalibration.result.passedCases = 9; }],
  ['wrong calibration corpus', f => { f.artifact.windowsCalibration.result.manifestSha256 = sha('different-corpus'); }],
  ['signed passed checkboxes in place of native OS measurements', f => {
    f.artifact.nativeEvidence.payload.measurements = Object.fromEntries(Object.keys(f.artifact.nativeEvidence.payload.measurements).map(key => [key, { passed: true }]));
  }],
  ['wrong effective Windows token', f => { f.artifact.nativeEvidence.payload.measurements['native-windows-identity'].tokenUserSidSha256 = sha('other-sid'); }],
  ['original writer successfully writes the reviewer root', f => { f.artifact.nativeEvidence.payload.measurements['original-writer-negative-write'].probes[0].win32Error = 0; }],
  ['missing negative-write probe for signing root', f => { f.artifact.nativeEvidence.payload.measurements['original-writer-negative-write'].probes.pop(); }],
  ['task re-entry succeeds', f => { f.artifact.nativeEvidence.payload.measurements['direct-and-task-reentry-denial'].taskWin32Error = 0; }],
  ['wrong installed protected source tree', f => { f.artifact.nativeEvidence.payload.measurements['independently-audited-commissioning'].installedTree = 'e'.repeat(40); }],
  ['ordinary writable signer store', f => { f.artifact.nativeEvidence.payload.measurements['separate-protected-signers'].store = 'PROJECT_WORKTREE'; }],
  ['reviewer and implementer share a native principal', f => { f.artifact.nativeEvidence.payload.implementerPrincipalSha256 = f.record.reviewerPrincipalSha256; }],
  ['reviewer and implementer share a session', f => { f.artifact.nativeEvidence.payload.implementerSessionId = f.artifact.receipt.reviewerSessionId; }],
  ['expired native observation', f => { f.artifact.nativeEvidence.payload.expiresAtUtc = new Date(f.now - 1000).toISOString(); }],
  ['legacy independent chunk-only clean summary', f => { f.artifact.reviewExecution.payload.stage = 'CHUNKS_CLEAN'; }],
  ['missing complete cross-file execution', f => { f.artifact.reviewExecution.payload = { schemaVersion: domains.execution, complete: true }; }],
  ['partial canonical diff in the prompt', f => { f.artifact.reviewExecution.payload.prompt.includedDiffSha256 = sha('partial-diff'); }],
  ['context input/output over budget', f => { f.artifact.reviewExecution.payload.runtime.contextTokens = 1; }],
  ['model output stopped at token limit', f => { f.artifact.reviewExecution.payload.runtime.doneReason = 'length'; }],
  ['unverified remote model selector', f => { f.artifact.reviewExecution.payload.runtime.modelSelector = 'cloud-model'; }],
  ['aggregate duration exceeds protected profile', f => { f.artifact.reviewExecution.payload.startedAtUtc = new Date(f.now - 900000).toISOString(); }],
  ['gaming governor active during review', f => { f.artifact.reviewExecution.payload.governorChecks.before.airLinkActive = true; }],
  ['resource permission revoked before completion', f => { f.artifact.reviewExecution.payload.governorChecks.after.heavyModelAllowed = false; }],
  ['missing continuous gaming preemption observations', f => { f.artifact.reviewExecution.payload.governorChecks.count = 1; }],
  ['governor interruption was ignored', f => { f.artifact.reviewExecution.payload.governorChecks.interruptedCount = 1; }],
]) test(name, async () => {
  const f = makeFixture(); mutate(f); resealFixture(f);
  const result = await validate(f); assert.equal(result.valid, false, name); noMutation(result);
});

test('mixed domains and unknown execution paths require qualification for every derived domain', async () => {
  const f = makeFixture(['scripts/windows/fixture-native.ps1', 'scripts/openclaw-fixture.mjs', 'scripts/unknown-execution.mjs']);
  assert.equal((await validate(f)).valid, true);
  f.record.allowedDomains = ['windows-os-and-services'];
  f.record.domainQualificationSha256 = { 'windows-os-and-services': sha('windows-only') };
  assert.deepEqual((await validate(f)).blockers, ['SOVEREIGN_SPECIALIST_DOMAIN_OR_MODEL_NOT_QUALIFIED']);
});

test('partial live diff/changed-path/tree binding cannot be replaced by valid native signatures', async () => {
  for (const change of [binding => { binding.fullDiffSha256 = sha('partial'); },
    binding => { binding.sourceTree = 'e'.repeat(40); }, binding => { binding.reviewedObjectClosureSha256 = sha('different-closure'); },
    binding => { binding.sourceEvidence = []; }]) {
    const f = makeFixture(); f.expected.sovereignSourceBinding = structuredClone(f.expected.sovereignSourceBinding);
    change(f.expected.sovereignSourceBinding);
    assert.equal((await adjudicate(f)).valid, false);
  }
});

test('435KB-class source cannot fit an 8K context by raising the byte cap alone', async () => {
  const f = makeFixture(undefined, { contentBytes: 450000 });
  assert(f.artifact.diffBytes > 435000 && f.artifact.diffBytes < 1024 * 1024);
  f.record.reviewExecutionProfile.modelContextTokens = 8192;
  f.artifact.reviewExecution.payload.runtime.contextTokens = 8192; resealFixture(f);
  assert.deepEqual((await validate(f)).blockers, ['SOVEREIGN_SPECIALIST_CONTEXT_OR_COMPLETION_UNPROVEN']);
});

test('replayed prior nonce reservation and old journal generation fail closed; exact artifact rereads are idempotent', async () => {
  const f = makeFixture(), old = f.artifact.replayWitness;
  assert.equal((await validate(f)).valid, true); assert.equal((await validate(f)).valid, true);
  f.artifact.reviewNonce = sha('new-nonce'); f.artifact.nativeEvidence.payload.reviewNonce = f.artifact.reviewNonce;
  f.artifact.reviewExecution.payload.reviewNonce = f.artifact.reviewNonce; resealFixture(f);
  f.artifact.replayWitness = old; sealOuter(f.artifact);
  assert.deepEqual((await validate(f)).blockers, ['SOVEREIGN_SPECIALIST_REPLAY_BINDING_INVALID']);
  const g = makeFixture(); g.artifact.replayWitness.payload.journalGeneration = 6;
  g.artifact.replayWitness = signProof(domains.replay, g.artifact.replayWitness.payload, g.keyPairs.witness.privateKey); sealOuter(g.artifact);
  assert.deepEqual((await validate(g)).blockers, ['SOVEREIGN_SPECIALIST_REPLAY_BINDING_INVALID']);
});

for (const path of ['shared/agents/sovereignQualifiedSpecialistEnrollmentV1.mjs',
  'shared/agents/sovereignQualifiedSpecialistReviewV1.mjs', 'shared/agents/sovereignQualifiedSpecialistSourceV1.mjs',
  'shared/agents/operatorMergeReviewArtifactV1.mjs', 'shared/agents/operatorMergeApprovalGate.mjs',
  'scripts/independent-merge-security-review-v2.mjs', '.github/workflows/independent-merge-security-review.yml']) {
  test('out-of-band root is mandatory for authority self-change: ' + path, async () => {
    const f = makeFixture([path]); assert.deepEqual((await validate(f)).blockers, ['SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED']);
    const admitted = makeFixture([path], { outOfBand: true }); assert.equal((await validate(admitted)).valid, true);
    admitted.record.outOfBandAuditor.key = admitted.record.keys.auditor;
    assert.deepEqual((await validate(admitted)).blockers, ['SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED']);
  });
}

test('duplicate valid carriers, edited comments and foreign PR comments cannot seal a finding', async () => {
  const f = makeFixture();
  assert.equal((await adjudicate(f, { comments: [commentFor(f, 1201), commentFor(f, 1202)] })).valid, false);
  const edited = commentFor(f); edited.updated_at = new Date(f.now).toISOString();
  assert.equal((await adjudicate(f, { comments: [edited] })).valid, false);
  const foreign = commentFor(f); foreign.issue_url = foreign.issue_url.replace('/3424', '/3425');
  assert.equal((await adjudicate(f, { comments: [foreign] })).valid, false);
});

test('hosted source collector retains original Codex opt-out and uses only the bounded canonical source transport', () => {
  const source = readFileSync(new URL('../../scripts/independent-merge-security-review-v2.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/adjudicateQualifiedSpecialistReview\(\{[\s\S]*?codexRequired: false,/g) || []).length, 2);
  assert.match(source, /captureSovereignSpecialistGitHubSourceV1/);
  assert.match(source, /readJson: createSovereignSpecialistGitHubSourceTransportV1/);
  assert.match(source, /sovereignSourceBinding = source.binding/);
});
