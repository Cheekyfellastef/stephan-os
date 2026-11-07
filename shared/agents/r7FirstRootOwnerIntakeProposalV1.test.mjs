import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { prepareR7FirstRootOwnerIntakeProposal as prepare, R7_FIRST_ROOT_INTAKE_MODE as mode,
  R7_FIRST_ROOT_INTAKE_WORKFLOW as workflow, R7_FIRST_ROOT_INTAKE_MISSING as missing,
  R7_FIRST_ROOT_INTAKE_PURPOSE as purpose, R7_FIRST_ROOT_INTAKE_AUDIENCE as prefix,
  R7_FIRST_ROOT_PEER_PURPOSE as peerPurpose, R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE as provisioningPrefix,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE as provisioningPurpose,
  parseR7NativeOwnerAudience as parseAudience } from './r7FirstRootOwnerIntakeProposalV1.mjs';
import { validateOperatorEnvironmentApprovalV1 } from './operatorEnvironmentApprovalAdapterV1.mjs';
import { recipientSpkiBase64, otherRecipientSpkiBase64 } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';

const nowUtc = '2026-10-21T18:40:00.000Z';
const hash = text => createHash('sha256').update(text).digest('hex');
const h = size => 'a'.repeat(size);
function permit() {
  return { schemaVersion: 'stephanos.r7-first-root-owner-intake-proposal.v1', purpose,
    repository: 'Cheekyfellastef/stephan-os', capabilityIssue: 3123, prNumber: 3178,
    requestId: 'existing-r7-request-fixture',
    original: { missionId: 'critical-2962-elastic-goal', leaseId: 'critical-2962-elastic-goal-r7-lease',
      leaseRevision: 7, leaseDigest: h(64), sourceExecutionId: 'critical-2962-elastic-goal-r1-0123456789ab',
      branch: 'openclaw/elastic-goal-2962', sourceHead: '4e5023eef829b285095db4eeb09d6f2b365e33e4',
      historicalOutcome: 'UNKNOWN' },
    candidate: { branch: 'feature/3123-r7-registry-protection-readback-20261020',
      sourceHead: h(40), sourceTree: 'b'.repeat(40), reviewedBase: 'c'.repeat(40),
      sourceMergeCommit: 'd'.repeat(40), expectedMain: 'e'.repeat(40),
      imageSha256: h(64), bundleSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) },
    review: { runId: '123', runAttempt: '2', artifactId: '456', archiveSha256: h(64),
      payloadSha256: 'b'.repeat(64), reviewedSourceHead: h(40), reviewedSourceTree: 'b'.repeat(40),
      reviewedBase: 'c'.repeat(40) },
    hostPolicyProposalDigest: 'd'.repeat(64), fixedRecipeDigest: 'e'.repeat(64),
    issuedAtUtc: '2026-10-21T18:39:00.000Z', expiresAtUtc: '2026-10-21T18:44:00.000Z' };
}
function fixture(p = permit()) {
  const permitWire = JSON.stringify(p), permitSha256 = hash(permitWire);
  const nativeAudience = prefix + permitSha256 + ':' + 'f'.repeat(64) + ':' + hash(Buffer.from(recipientSpkiBase64, 'base64'));
  return { permitWire, permitSha256, nativeAudience, nativeRecipientSpkiBase64: recipientSpkiBase64, nowUtc,
    dispatch: { mode, pr_number: '3178', expected_branch: p.candidate.branch,
      expected_head: p.candidate.sourceHead, expected_head_tree: p.candidate.sourceTree,
      expected_base: p.candidate.expectedMain, independent_review_run_id: p.review.runId,
      independent_review_run_attempt: p.review.runAttempt, independent_review_artifact_id: p.review.artifactId,
      independent_review_artifact_digest: 'sha256:' + p.review.archiveSha256,
      independent_review_payload_sha256: p.review.payloadSha256, authorization_comment_id: '',
      r7_owner_permit_json: permitWire, r7_owner_permit_sha256: permitSha256,
      r7_native_challenge_audience: nativeAudience, r7_native_recipient_spki_base64: recipientSpkiBase64 },
    context: { eventName: 'workflow_dispatch', mode, repository: p.repository, repositoryId: '1179385578',
      ownerId: '267490109', actor: 'Cheekyfellastef', actorId: '267490109', triggeringActor: 'Cheekyfellastef',
      ref: 'refs/heads/main', sha: p.candidate.expectedMain, workflowRef: workflow, runId: '789', runAttempt: '1' } };
}
function noAuthority(r) {
  for (const key of ['policyAdopted', 'sourceMergeAuthorized', 'hostExecutionAuthorized',
    'humanOsConsentProven', 'executorAdmitted', 'rootEnrollmentAuthorized', 'tokenIssuanceAuthorized',
    'independentSignatureProven', 'canonicalLeaseReleaseAuthorized', 'approvalCardCreated'])
    assert.equal(r[key], false, key);
}
function rejected(args) { const r = prepare(args); assert.equal(r.classification, 'R7_FIRST_ROOT_INTAKE_REJECTED'); noAuthority(r); }

test('complete proposed intake remains HELD, unauthenticated and non-issuing', () => {
  const r = prepare(fixture());
  assert.equal(r.classification, 'R7_FIRST_ROOT_INTAKE_PREPARED_HELD');
  assert.deepEqual(r.blockers, missing); noAuthority(r);
  assert.equal(r.reviewArtifactAuthenticated, false);
  assert.equal(r.sourceAdoptionAuthenticated, false);
  assert.equal(r.nativeChallengeFreshnessAuthenticated, false);
  const incomplete = prepare(); noAuthority(incomplete);
});
test('native operation is derived only from one of two complete prefixes and grants no root or host authority', () => {
  const old = fixture(), next = fixture();
  next.nativeAudience = next.nativeAudience.replace(prefix, provisioningPrefix);
  next.dispatch.r7_native_challenge_audience = next.nativeAudience;
  assert.equal(prepare(old).nativeOperationPurpose, peerPurpose);
  const result = prepare(next);
  assert.equal(result.classification, 'R7_FIRST_ROOT_INTAKE_PREPARED_HELD');
  assert.equal(result.nativeOperationPurpose, provisioningPurpose); noAuthority(result);
  assert.equal(JSON.parse(next.permitWire).purpose, purpose);
  // No operation supplied as a separate field can broaden a peer-only request.
  assert.equal(prepare({...old, nativeOperationPurpose: provisioningPurpose}).nativeOperationPurpose, peerPurpose);
  const changed = permit(); changed.purpose = provisioningPurpose; rejected(fixture(changed));
  const extra = fixture(); extra.dispatch.native_operation_purpose = provisioningPurpose; rejected(extra);
  for (const nativeAudience of [
    next.nativeAudience + ':extra', next.nativeAudience + '\n', ' ' + next.nativeAudience,
    next.nativeAudience.replace(provisioningPrefix, provisioningPrefix.toUpperCase()),
    next.nativeAudience.replace(provisioningPrefix, provisioningPrefix + prefix),
    next.nativeAudience.replace(provisioningPrefix, provisioningPrefix.replace(':v1:', ':v10:')),
    next.nativeAudience.replace(provisioningPrefix, provisioningPrefix.slice(0, -1)),
    next.nativeAudience.replace('f'.repeat(64), '0'.repeat(64)),
  ]) {
    assert.equal(parseAudience(nativeAudience), null);
    rejected({...next, nativeAudience, dispatch:{...next.dispatch, r7_native_challenge_audience:nativeAudience}});
  }
});
test('every unknown or authority-bearing property is refused at every packet level', () => {
  for (const segment of ['', 'original', 'candidate', 'review']) {
    for (const key of ['hostExecutionAuthorized', 'policyAdopted', 'operatorApproved', 'token', '__proto__']) {
      const p = permit(), target = segment ? p[segment] : p;
      Object.defineProperty(target, key, { value: true, enumerable: true }); rejected(fixture(p));
    }
  }
});
test('each exact original identity and all review references fail closed on substitution', () => {
  for (const [key, value] of [['missionId', 'other'], ['leaseId', 'other'], ['leaseRevision', 8],
    ['leaseDigest', '0'.repeat(64)], ['sourceExecutionId', 'fabricated'], ['branch', 'main'],
    ['sourceHead', 'b'.repeat(40)], ['historicalOutcome', 'COMPLETE']]) {
    const p = permit(); p.original[key] = value; rejected(fixture(p));
  }
  for (const key of ['reviewedSourceHead', 'reviewedSourceTree', 'reviewedBase']) {
    const p = permit(); p.review[key] = 'f'.repeat(40); rejected(fixture(p));
  }
  for (const key of ['runId', 'runAttempt', 'artifactId']) for (const value of ['0', '-1', '01', '1e2', '18446744073709551616', 1]) {
    const p = permit(); p.review[key] = value; rejected(fixture(p));
  }
});
test('zero/invalid source and image pins are rejected even with recomputed packet digest', () => {
  for (const key of ['sourceHead', 'sourceTree', 'reviewedBase', 'sourceMergeCommit', 'expectedMain',
    'imageSha256', 'bundleSha256', 'manifestSha256']) {
    const p = permit(); p.candidate[key] = '0'.repeat(key.endsWith('Sha256') ? 64 : 40); rejected(fixture(p));
  }
  const p = permit(); p.candidate.sourceHead = p.candidate.reviewedBase; rejected(fixture(p));
});
test('source merge inputs, old authorization and distinct purpose cannot be laundered into intake', () => {
  for (const key of Object.keys(fixture().dispatch)) {
    if (key === 'authorization_comment_id') continue;
    const f = fixture(); f.dispatch[key] = 'changed'; rejected(f);
  }
  const f = fixture(); f.dispatch.authorization_comment_id = '123'; rejected(f);
});
test('owner, run, attempt, workflow and current-main contexts must all match', () => {
  for (const key of Object.keys(fixture().context)) {
    const f = fixture(); f.context[key] = 'other'; rejected(f);
  }
  const f = fixture(); f.context.actor = 'github-actions[bot]'; rejected(f);
  const fork = fixture(); fork.context.workflowRef = workflow.replace('refs/heads/main', 'refs/heads/candidate'); rejected(fork);
});
test('canonical bytes and exact nonzero permit, nonce and recipient digest audience components are required', () => {
  for (const nativeAudience of [prefix + h(64) + ':' + 'f'.repeat(64), prefix + fixture().permitSha256 + ':' + '0'.repeat(64),
    prefix + fixture().permitSha256 + ':' + 'f'.repeat(64) + ':extra', 'https://example.com'])
    rejected({ ...fixture(), nativeAudience });
  const f = fixture(); f.permitWire += '\n'; f.permitSha256 = hash(f.permitWire); rejected(f);
  const d = fixture(); d.permitWire = d.permitWire.replace('"purpose":', '"purpose":"old","purpose":');
  d.permitSha256 = hash(d.permitWire); rejected(d);
  rejected({ ...fixture(), permitWire: 'x'.repeat(16385) });
});

test('SPKI bytes must be canonical RSA2048 public DER matching the audience digest', () => {
  const rebind = (f, key, audience = f.nativeAudience) => ({ ...f, nativeRecipientSpkiBase64: key, nativeAudience: audience,
    dispatch: { ...f.dispatch, r7_native_recipient_spki_base64: key, r7_native_challenge_audience: audience } });
  const f = fixture(), suffix = hash(Buffer.from(recipientSpkiBase64, 'base64'));
  for (const key of [undefined, '', 'x'.repeat(1537), recipientSpkiBase64 + '\n', otherRecipientSpkiBase64,
    Buffer.from('not DER').toString('base64'), Buffer.concat([Buffer.from(recipientSpkiBase64, 'base64'), Buffer.from([0])]).toString('base64')])
    rejected(rebind(f, key));
  for (const audience of [f.nativeAudience.slice(0, -(suffix.length + 1)), f.nativeAudience + ':extra',
    f.nativeAudience.replace(suffix, '0'.repeat(64)), f.nativeAudience.replace(suffix, 'e'.repeat(64)),
    f.nativeAudience.replace('f'.repeat(64), '0'.repeat(64))]) rejected(rebind(f, recipientSpkiBase64, audience));
  for (const key of [Buffer.from('not DER').toString('base64'),
    Buffer.concat([Buffer.from(recipientSpkiBase64, 'base64'), Buffer.from([0])]).toString('base64'),
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64')])
    rejected(rebind(f, key, f.nativeAudience.slice(0, -64) + hash(Buffer.from(key, 'base64'))));
  const changed = rebind(f, otherRecipientSpkiBase64,
    f.nativeAudience.slice(0, -64) + hash(Buffer.from(otherRecipientSpkiBase64, 'base64')));
  const result = prepare(changed);
  assert.equal(result.classification, 'R7_FIRST_ROOT_INTAKE_PREPARED_HELD'); noAuthority(result);
  assert.equal(result.nativeChallengeFreshnessAuthenticated, false);
});
test('expired, future, overlong or invalid windows HOLD without nonce renewal', () => {
  for (const changes of [
    { expiresAtUtc: nowUtc }, { issuedAtUtc: '2026-10-21T18:41:00.000Z' },
    { expiresAtUtc: '2026-10-21T18:44:00.001Z' }, { issuedAtUtc: '2026-02-30T18:39:00.000Z' },
  ]) { const p = Object.assign(permit(), changes); rejected(fixture(p)); }
  rejected({ ...fixture(), nowUtc: '2026-10-21T19:00:00.000Z' });
});
test('existing actual merge-environment adapter rejects the distinct first-root run title', () => {
  const f = fixture(), p = permit();
  const input = { authorization: { repository: p.repository, prNumber: 3178, branch: p.candidate.branch,
    headSha: p.candidate.sourceHead, baseSha: p.candidate.expectedMain, workflowRunId: 789,
    environmentName: 'operator-merge-approval', operator: 'Cheekyfellastef', decision: 'approved' },
    observed: { authenticatedActor: 'Cheekyfellastef', currentMainSha: p.candidate.expectedMain,
      pullRequest: { number: 3178, state: 'open', merged: false, branch: p.candidate.branch,
        headSha: p.candidate.sourceHead, baseRef: 'main', baseSha: p.candidate.expectedMain },
      workflowRun: { id: 789, status: 'waiting', conclusion: null, event: 'workflow_dispatch',
        headSha: p.candidate.expectedMain, displayTitle: 'Protected operator merge ' + p.candidate.sourceHead },
      pendingDeployments: [{ environment: { id: 10, name: 'operator-merge-approval' }, wait_timer: 0,
        current_user_can_approve: true, reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }] }] } };
  assert.equal(validateOperatorEnvironmentApprovalV1(input).valid, true);
  input.observed.workflowRun.displayTitle = 'R7 first-root owner policy intake ' + f.permitSha256;
  const r = validateOperatorEnvironmentApprovalV1(input);
  assert.equal(r.valid, false); assert.equal(r.mutationAuthority, false);
  assert.ok(r.blockers.includes('workflow-run-title-mismatch'));
});
