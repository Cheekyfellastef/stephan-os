import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReadyReviewSourceContext, assertReadyReviewHandoff, assertReadyReviewIndependent, assertReadyReviewLaunchRun,
  parseReadyReviewInputs, sealReadyReviewPayload, selectReadyReviewRun,
  validateProtectedReadyReviewLifecycleEvidence, validateProtectedReadyReviewRecoveryEvidence,
  buildReadyReviewRecoveryContinuity, READY_REVIEW_RECOVERY_SOURCE_PATHS,
} from './protectedReadyReviewLifecycleV1.mjs';
import { clock, readyLifecycleFixture, readyRecoveryFixture, fixtureEnv } from './fixtures/protectedReadyReviewLifecycleV1.fixture.mjs';

const validate = f => validateProtectedReadyReviewLifecycleEvidence(f.proof, f.identity, 50);
test('consumes a distinct completed main-headed review without changing its actual event or PR association', () => {
  const f = readyLifecycleFixture(), original = JSON.stringify(f.proof);
  const result = validate(f);
  assert.equal(result.valid, true, result.blocker);
  assert.equal(result.reviewMode, 'clean-independent');
  assert.equal(result.workflowRunId, 200);
  assert.equal(JSON.stringify(f.proof), original);
  assert.equal(f.proof.review.run.event, 'workflow_dispatch');
  assert.equal(f.proof.review.run.head_sha, f.identity.baseSha);
  assert.deepEqual(f.proof.review.run.pull_requests, []);
});

test('fails closed on altered run, source, job, artifact, owner and selected review evidence', async t => {
  const attacks = {
    'candidate source': f => { f.proof.review.run.head_sha = f.identity.sourceHead; },
    'event alias': f => { f.proof.review.run.event = 'pull_request_target'; },
    'invented PR association': f => { f.proof.review.run.pull_requests = [{ number: f.identity.prNumber }]; },
    'unrelated workflow': f => { f.proof.review.run.path = '.github/workflows/exact-head-review-dispatch.yml'; },
    'inactive workflow': f => { f.proof.review.definition.state = 'disabled_manually'; },
    'different workflow ID': f => { f.proof.review.run.workflow_id++; },
    'unbound display title': f => { f.proof.review.run.display_title += '-unbound'; },
    'actor lookalike ID': f => { f.proof.review.run.triggering_actor = { login: 'github-actions[bot]', id: 99 }; },
    'second attempt': f => { f.proof.review.run.run_attempt = 2; },
    'review still running': f => { f.proof.review.run.status = 'in_progress'; f.proof.review.run.conclusion = null; },
    'review canceled': f => { f.proof.review.run.conclusion = 'cancelled'; },
    'review job failed': f => { f.proof.review.job.conclusion = 'failure'; },
    'check provider spoof': f => { f.proof.review.check.app.id = 99; },
    'check detached from run': f => { f.proof.review.check.check_suite.id++; },
    'check detached from job': f => { f.proof.review.check.id++; },
    'archive digest mismatch': f => { f.proof.review.artifact.archiveSha256 = 'f'.repeat(64); },
    'receipt modified': f => { f.proof.review.artifact.payload = { ...f.proof.review.artifact.payload, reviewRunId: 201 }; },
    'artifact from another run': f => { f.proof.review.artifact.metadata.workflow_run.id++; },
    'artifact expired': f => { f.proof.review.artifact.metadata.expired = true; },
    'payload swapped': f => { f.proof.review.artifact.payload = f.proof.handoff.artifact.payload; },
    'producer failed after upload': f => { f.proof.handoff.run.conclusion = 'failure'; },
    'producer canceled after upload': f => { f.proof.handoff.run.conclusion = 'cancelled'; },
    'producer run still running': f => { f.proof.handoff.run.status = 'in_progress'; f.proof.handoff.run.conclusion = null; },
    'producer job skipped': f => { f.proof.handoff.job.conclusion = 'skipped'; },
    'dispatch job failed after launching': f => { f.proof.handoff.dispatchJob.conclusion = 'failure'; },
    'dispatch job absent': f => { delete f.proof.handoff.dispatchJob; },
    'coordinator alias': f => { f.proof.handoff.definition.path = '.github/workflows/exact-head-review-dispatch.yml'; },
    'source checkout drift': f => { f.proof.handoff.run.head_sha = 'd'.repeat(40); },
    'owner edited': f => { f.proof.handoff.ownerComment.updated_at = clock(1); },
    'owner ID spoof': f => { f.proof.handoff.ownerComment.user = { login: 'Cheekyfellastef', id: 1, type: 'User' }; },
    'foreign mailbox': f => { f.proof.handoff.ownerComment.issue_url = f.proof.handoff.ownerComment.issue_url.replace(/\d+$/, '1507'); },
    'independent run failed': f => { f.proof.independent.run.conclusion = 'failure'; },
    'independent attempt changed': f => { f.proof.independent.run.run_attempt++; },
    'independent archive changed': f => { f.proof.independent.archiveSha256 = 'e'.repeat(64); },
    'independent payload forged': f => { f.proof.independent.payload = { ...f.proof.independent.payload,
      receipt: { ...f.proof.independent.payload.receipt, verdict: 'findings' } }; },
    'tree changed': f => { f.identity = { ...f.identity, sourceTree: 'd'.repeat(40) }; },
    'base changed': f => { f.identity = { ...f.identity, baseSha: 'd'.repeat(40) }; },
    'head changed': f => { f.identity = { ...f.identity, sourceHead: 'd'.repeat(40) }; },
    'missing tree': f => { f.identity = { ...f.identity, sourceTree: undefined }; },
    'review launched before completed READY': f => { f.proof.review.run.created_at = clock(9); },
    'review launched outside fixed dispatch job': f => { f.proof.review.run.created_at = clock(21); },
  };
  for (const [name, mutate] of Object.entries(attacks)) await t.test(name, () => {
    const f = readyLifecycleFixture(); mutate(f); assert.equal(validate(f).valid, false, name);
  });
});

test('producer completion permits target launch but never permits final admission while the run is active', () => {
  const f = readyLifecycleFixture();
  f.proof.handoff.run.status = 'in_progress'; f.proof.handoff.run.conclusion = null;
  assert.doesNotThrow(() => assertReadyReviewHandoff(f.proof.handoff, { terminal: false, at: clock(15) }));
  assert.equal(validate(f).valid, false);
  f.proof.handoff.job.status = 'in_progress'; f.proof.handoff.job.conclusion = null;
  assert.throws(() => assertReadyReviewHandoff(f.proof.handoff, { terminal: false, at: clock(15) }), /JOB_PROVENANCE/);
});

test('a queued exact dispatch is launch evidence only and never terminal review evidence', () => {
  const f = readyLifecycleFixture(), handoff = f.proof.handoff.artifact.payload;
  f.proof.review.run.status = 'queued'; f.proof.review.run.conclusion = null; f.proof.review.run.run_started_at = null;
  assert.doesNotThrow(() => assertReadyReviewLaunchRun(f.proof.review.run, f.proof.review.definition, f.identity,
    { readyRunId: handoff.producerRunId, handoffSha256: handoff.payloadSha256 }));
  assert.equal(validate(f).valid, false);
});

test('the immutable handoff preserves proven zero threads only for an actual draft transition', () => {
  for (const count of [undefined, null, 1, '0']) {
    const f = readyLifecycleFixture(), { payloadSha256, ...body } = f.proof.handoff.artifact.payload;
    f.proof.handoff.artifact.payload = sealReadyReviewPayload({ ...body, unresolvedReviewThreads: count });
    assert.throws(() => assertReadyReviewHandoff(f.proof.handoff), /HANDOFF_BINDING/);
  }
  const f = readyLifecycleFixture({ alreadyReady: true });
  assert.equal(f.proof.handoff.artifact.payload.unresolvedReviewThreads, null);
  assert.doesNotThrow(() => assertReadyReviewHandoff(f.proof.handoff));
});

test('each of the five independent evidence fields is bound by the original immutable owner READY packet', () => {
  for (const key of ['independentReviewRunId', 'independentReviewRunAttempt', 'independentReviewArtifactId',
    'independentReviewArtifactDigest', 'independentReviewPayloadSha256']) {
    const f = readyLifecycleFixture();
    const h = f.proof.handoff.artifact.payload;
    const { payloadSha256, ...body } = h;
    body.command = { ...body.command, [key]: typeof body.command[key] === 'number' ? body.command[key] + 1 : 'e'.repeat(64) };
    f.proof.handoff.artifact.payload = sealReadyReviewPayload(body);
    assert.throws(() => assertReadyReviewHandoff(f.proof.handoff), /OWNER|IDENTITY|SELECTION|DIGEST/);
  }
});

test('the original owner window is checked at review start and is never renewed by artifact timestamps', () => {
  const f = readyLifecycleFixture();
  assert.throws(() => assertReadyReviewHandoff(f.proof.handoff, { at: clock(301) }), /EXPIRED/);
  assert.doesNotThrow(() => assertReadyReviewHandoff(f.proof.handoff, { at: clock(15) }));
  assert.equal(validate(f).valid, true);
});

test('bootstrap findings remain findings and never authorize a new draft transition', () => {
  const draft = readyLifecycleFixture({ bootstrap: true, engineFindings: true });
  assert.equal(assertReadyReviewIndependent(draft.proof.independent, draft.command), 'qualified-operator-bootstrap');
  assert.equal(validate(draft).valid, false);
  assert.match(validate(draft).blocker, /DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED/);
  const ready = readyLifecycleFixture({ bootstrap: true, alreadyReady: true, engineFindings: true });
  assert.equal(validate(ready).valid, true, validate(ready).blocker);
  assert.equal(validate(ready).reviewMode, 'qualified-operator-bootstrap');
  assert.equal(ready.proof.review.artifact.payload.engineReceipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.ok(ready.proof.independent.payload.receipt.findings.length);
});

test('a historical skip requires a later real run, never an older successful lifecycle receipt', () => {
  const f = readyLifecycleFixture();
  assert.equal(validateProtectedReadyReviewLifecycleEvidence(f.proof, f.identity, 200).valid, false);
  assert.equal(validateProtectedReadyReviewLifecycleEvidence(f.proof, f.identity, 201).valid, false);
});

test('complete inventory never cherry-picks old success over later pending, failed or canceled executions', () => {
  for (const state of ['queued', 'in_progress', 'failure', 'cancelled', 'success']) {
    const f = readyLifecycleFixture();
    const later = { ...f.proof.review.run, id: 201,
      status: ['queued', 'in_progress'].includes(state) ? state : 'completed',
      conclusion: ['queued', 'in_progress'].includes(state) ? null : state };
    assert.throws(() => selectReadyReviewRun([f.proof.review.run, later], f.identity), /NOT_UNIQUE/);
  }
  const f = readyLifecycleFixture();
  assert.throws(() => selectReadyReviewRun([{ ...f.proof.review.run, display_title: 'unbound manual execution' }], f.identity), /AMBIGUOUS/);
});

test('dispatch inputs are closed-world identities and source context cannot choose candidate code', () => {
  const f = readyLifecycleFixture();
  assert.equal(parseReadyReviewInputs(f.inputs).readyRunId, 100);
  for (const altered of [{ ...f.inputs, arbitrary_command: 'true' }, { ...f.inputs, ready_run_id: 100 },
    { ...f.inputs, base_sha: 'main' }, { ...f.inputs, pr_number: '1;id' }]) {
    assert.throws(() => parseReadyReviewInputs(altered));
  }
  const env = fixtureEnv(f);
  assert.doesNotThrow(() => assertReadyReviewSourceContext(env, f.identity.baseSha, f.identity.baseSha, 'exact-head-review'));
  for (const mutation of [{ GITHUB_REF: `refs/heads/${f.identity.branch}` }, { GITHUB_WORKFLOW_SHA: f.identity.sourceHead },
    { GITHUB_SHA: f.identity.sourceHead }, { GITHUB_EVENT_NAME: 'issue_comment' }, { GITHUB_RUN_ATTEMPT: '2' }]) {
    assert.throws(() => assertReadyReviewSourceContext({ ...env, ...mutation }, f.identity.baseSha,
      f.identity.baseSha, 'exact-head-review'), /TRUSTED_SOURCE_CONTEXT/);
  }
  assert.throws(() => assertReadyReviewSourceContext(env, f.identity.sourceHead, f.identity.baseSha,
    'exact-head-review'), /TRUSTED_SOURCE_CONTEXT/);
});

test('preserved failed attempt plus distinct qualified recovery is accepted without rewriting failure history', () => {
  const f = readyRecoveryFixture(), original = JSON.stringify(f.proof.failedReview);
  const result = validateProtectedReadyReviewRecoveryEvidence(f.proof, f.identity, 50);
  assert.equal(result.valid, true, result.blocker);
  assert.equal(result.failedReviewRunId, 200);
  assert.equal(result.workflowRunId, 300);
  assert.equal(result.recoverySourceSha, f.currentMainSha);
  assert.equal(JSON.stringify(f.proof.failedReview), original);
  assert.equal(f.proof.failedReview.run.conclusion, 'failure');
  assert.equal(f.proof.failedReview.job.steps.filter(step => step.conclusion === 'failure').length, 1);
});

test('recovery rejects failed-run, diagnostic, continuity, qualification and replay substitutions', async t => {
  const reseal = (f, changes) => {
    const { payloadSha256, ...body } = f.proof.recovery.artifact.payload;
    f.proof.recovery.artifact.payload = sealReadyReviewPayload({ ...body, ...changes });
  };
  const attacks = {
    'different failed run': f => { f.proof.failedReview.run.id++; },
    'failed run attempt replay': f => { f.proof.failedReview.run.run_attempt = 2; },
    'failed run made successful': f => { f.proof.failedReview.run.conclusion = 'success'; },
    'different failing step': f => { f.proof.failedReview.job.steps[0].conclusion = 'failure'; },
    'missing diagnostic': f => { f.proof.failedReview.diagnosticArtifacts = []; },
    'second diagnostic': f => { f.proof.failedReview.diagnosticArtifacts.push({ ...f.proof.failedReview.diagnosticArtifacts[0], id: 999 }); },
    'manufactured lifecycle receipt': f => { f.proof.failedReview.lifecycleArtifacts.push({ id: 999 }); },
    'diagnostic patch changed': f => { f.proof.failedReview.diagnostic.patch += 'forged'; },
    'diagnostic input base changed': f => { f.proof.failedReview.diagnostic.input = { ...f.proof.failedReview.diagnostic.input, baseSha: 'e'.repeat(40) }; },
    'recovery run rerun': f => { f.proof.recovery.run.run_attempt = 2; },
    'recovery wrong event': f => { f.proof.recovery.run.event = 'workflow_dispatch'; },
    'recovery title replay': f => { f.proof.recovery.run.display_title = f.proof.recovery.run.display_title.replace('comment-901', 'comment-902'); },
    'receipt points at other failure': f => { reseal(f, { failedReviewRunId: 201 }); },
    'continuity overlaps candidate': f => { const p = f.proof.recovery.artifact.payload; reseal(f, { continuity: { ...p.continuity,
      changedFiles: [...f.proof.failedReview.diagnostic.input.changedFiles],
      changedFilesSha256: 'f'.repeat(64) } }); },
    'correction tip includes unrelated source': f => { const p = f.proof.recovery.artifact.payload; reseal(f, { continuity: { ...p.continuity,
      correctionFiles: ['README.md'], correctionFilesSha256: 'f'.repeat(64) } }); },
    'current main changed': f => { f.identity = { ...f.identity, baseSha: 'e'.repeat(40) }; },
    'qualification detached': f => { const p = f.proof.recovery.artifact.payload; reseal(f, { qualification: { ...p.qualification, ownerCommentId: 902 } }); },
    'edited escalation': f => { f.proof.escalationComment.updated_at = clock(6); },
  };
  for (const [name, mutate] of Object.entries(attacks)) await t.test(name, () => {
    const f = readyRecoveryFixture(); mutate(f);
    assert.equal(validateProtectedReadyReviewRecoveryEvidence(f.proof, f.identity, 50).valid, false, name);
  });
});

test('recovery keeps its exact failed-run receipt and requires it to follow every observed draft skip', () => {
  const f = readyRecoveryFixture();
  assert.equal(validateProtectedReadyReviewRecoveryEvidence(f.proof, f.identity, 50).valid, true);
  assert.equal(validateProtectedReadyReviewRecoveryEvidence(f.proof, f.identity, 200).valid, false);
  assert.equal(validateProtectedReadyReviewRecoveryEvidence(f.proof, f.identity, 201).valid, false);
});

test('continuity admits complete protected history only when disjoint and the correction is the exact tip', () => {
  const f = readyRecoveryFixture(), intermediate = 'e'.repeat(40);
  const compare = { status: 'ahead', ahead_by: 2, behind_by: 0, total_commits: 2,
    base_commit: { sha: f.originalIdentity.baseSha }, merge_base_commit: { sha: f.originalIdentity.baseSha },
    commits: [{ sha: intermediate }, { sha: f.currentMainSha }],
    files: [{ filename: 'README.md' }, { filename: 'scripts/protected-ready-review-lifecycle-v1.mjs' }] };
  const correction = { sha: f.currentMainSha, parents: [{ sha: intermediate }],
    files: [{ filename: 'scripts/protected-ready-review-lifecycle-v1.mjs' }] };
  const result = buildReadyReviewRecoveryContinuity(compare, correction, f.originalIdentity,
    f.currentMainSha, f.input.changedFiles);
  assert.equal(Object.hasOwn(compare, 'head_commit'), false);
  assert.deepEqual(result.commitShas, [intermediate, f.currentMainSha]);
  assert.deepEqual(result.correctionFiles, ['scripts/protected-ready-review-lifecycle-v1.mjs']);
  assert.throws(() => buildReadyReviewRecoveryContinuity({ ...compare,
    files: [...compare.files, { filename: f.input.changedFiles[0] }] }, correction,
  f.originalIdentity, f.currentMainSha, f.input.changedFiles), /OVERLAP/);
  assert.throws(() => buildReadyReviewRecoveryContinuity(compare, { ...correction,
    files: [{ filename: 'README.md' }] }, f.originalIdentity, f.currentMainSha, f.input.changedFiles), /CORRECTION_TIP/);
});

test('recovery source allowlist covers the complete canonical merge-consumer correction', () => {
  assert.ok(READY_REVIEW_RECOVERY_SOURCE_PATHS.includes('shared/agents/operatorPersonalRepositoryMergeV1.mjs'));
  assert.ok(READY_REVIEW_RECOVERY_SOURCE_PATHS
    .includes('shared/agents/operatorPersonalRepositoryMergeDraftSkipV1.test.mjs'));
});
